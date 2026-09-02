import httpx
import pytest

from chatbot import ollama_client as oc
from chatbot.trace import TraceRecorder, current_recorder


def _ollama(monkeypatch):
    for name, value in {
        "LLM_PROVIDER": "ollama",
        "OLLAMA_API_URL": "http://localhost:11434",
        "OLLAMA_MODEL": "m",
        "OLLAMA_API_KEY": None,
    }.items():
        monkeypatch.setattr(oc, name, value)


@pytest.mark.asyncio
async def test_call_ollama_records_llm_step_with_tokens(monkeypatch):
    _ollama(monkeypatch)

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "message": {"content": "Grace is unmerited favour."},
                "prompt_eval_count": 812,
                "eval_count": 40,
            },
        )

    transport = httpx.MockTransport(handler)
    real_client = httpx.AsyncClient

    def patched_client(*args, **kwargs):
        kwargs["transport"] = transport
        return real_client(*args, **kwargs)

    monkeypatch.setattr(oc.httpx, "AsyncClient", patched_client)

    rec = TraceRecorder("/chat", "what is grace")
    token = current_recorder.set(rec)
    try:
        result = await oc.call_ollama_with_context("what is grace", research_data="DATA")
    finally:
        current_recorder.reset(token)

    assert result["type"] == "chat"
    step = rec.finalize("chat")["steps"][0]
    assert step["kind"] == "llm"
    assert step["label"].startswith("Ollama")
    assert step["request"]["system"].startswith("You are a biblical research assistant")
    assert "DATA" in step["request"]["system"]
    assert step["request"]["messages"][-1] == {"role": "user", "content": "what is grace"}
    assert "messages" not in step["request"]["params"]
    assert step["response"]["preview"] == "Grace is unmerited favour."
    assert step["tokens"] == {"prompt": 812, "completion": 40, "total": 852}


def test_extract_tokens_by_provider():
    assert oc._extract_tokens("ollama", {"prompt_eval_count": 5, "eval_count": 7}) == (5, 7)
    assert oc._extract_tokens("nvidia", {"usage": {"prompt_tokens": 9, "completion_tokens": 3}}) == (9, 3)
    assert oc._extract_tokens("nvidia", {}) == (None, None)
