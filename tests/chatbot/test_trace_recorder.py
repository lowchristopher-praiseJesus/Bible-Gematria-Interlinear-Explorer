import os
import pytest

from chatbot.trace import TraceRecorder, redact, current_recorder, record_tool, record_routing


def test_finalize_shapes_the_trace_contract():
    rec = TraceRecorder("/chat", "hello", mode="freeform", history_length=2)
    rec.add_routing("deterministic: quote keyword")
    with rec.tool_step("fetch_verse_translations", {"args": {"reference": "JHN 3:16"}}) as step:
        step.set_response({"eng-KJV": "For God so loved the world"})
    trace = rec.finalize("verse", route="Deterministic -> Quote keyword")

    assert trace["requestPath"] == "/chat"
    assert trace["input"] == {
        "message": "hello", "mode": "freeform", "modeParams": None,
        "historyLength": 2, "pageContext": None,
    }
    assert [s["kind"] for s in trace["steps"]] == ["routing", "tool"]
    assert [s["index"] for s in trace["steps"]] == [0, 1]
    tool = trace["steps"][1]
    assert tool["status"] == "completed"
    assert tool["request"] == {"args": {"reference": "JHN 3:16"}}
    assert tool["response"]["preview"] == {"eng-KJV": "For God so loved the world"}
    assert isinstance(tool["response"]["bytesTotal"], int)
    assert tool["durationMs"] >= 0
    assert trace["outcome"] == {"type": "verse", "route": "Deterministic -> Quote keyword", "error": None}
    assert trace["totals"]["toolCalls"] == 1
    assert trace["totals"]["llmCalls"] == 0
    assert trace["totals"]["llmTokens"] is None


def test_tool_step_records_exception_and_reraises():
    rec = TraceRecorder("/chat", "x")
    with pytest.raises(RuntimeError):
        with rec.tool_step("boom", None):
            raise RuntimeError("kaboom")
    step = rec.finalize("error", error="RuntimeError: kaboom")["steps"][0]
    assert step["status"] == "error"
    assert step["error"] == "RuntimeError: kaboom"


def test_llm_step_token_totals_feed_finalize():
    rec = TraceRecorder("/chat", "x")
    with rec.llm_step("Ollama (m)", {"system": "s", "messages": []}) as step:
        step.set_response("answer")
        step.set_tokens(100, 25)
    trace = rec.finalize("chat")
    assert trace["steps"][0]["tokens"] == {"prompt": 100, "completion": 25, "total": 125}
    assert trace["totals"]["llmTokens"] == 125


def test_redact_removes_authorization_and_key_values(monkeypatch):
    monkeypatch.setenv("SOME_API_KEY", "sk-supersecret")
    out = redact({"Authorization": "Bearer sk-supersecret", "note": "uses sk-supersecret here", "n": 1})
    assert out["Authorization"] == "[redacted]"
    assert out["note"] == "uses [redacted] here"
    assert out["n"] == 1


def test_deep_truncation_keeps_bytes_total():
    rec = TraceRecorder("/chat", "x")
    big = "z" * 40000
    with rec.tool_step("t", {"blob": big}) as step:
        step.set_response({"blob": big})
    step_rec = rec.finalize("chat")["steps"][0]
    assert len(step_rec["request"]["blob"]) == 16384
    assert step_rec["response"]["bytesTotal"] > 40000
    assert len(step_rec["response"]["preview"]["blob"]) == 16384


def test_module_helpers_noop_without_a_recorder():
    assert current_recorder.get() is None
    record_routing("ignored")            # must not raise
    with record_tool("ignored", {"a": 1}) as step:
        step.set_response({"ok": True})  # no-op box, must not raise
