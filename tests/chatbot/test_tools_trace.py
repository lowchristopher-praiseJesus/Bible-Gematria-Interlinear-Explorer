import pytest

from chatbot import tools
from chatbot.trace import TraceRecorder, current_recorder


@pytest.mark.asyncio
async def test_search_gematria_emits_one_tool_step(monkeypatch):
    monkeypatch.setattr(tools, "search_gematria_sync", lambda value: {"wordResults": [], "verseResults": []})
    rec = TraceRecorder("/chat", "gematria 26")
    token = current_recorder.set(rec)
    try:
        result = await tools.search_gematria(26)
    finally:
        current_recorder.reset(token)

    assert result == {"wordResults": [], "verseResults": []}
    trace = rec.finalize("gematria")
    assert [s["label"] for s in trace["steps"]] == ["search_gematria"]
    assert trace["steps"][0]["kind"] == "tool"
    assert trace["steps"][0]["request"] == {"args": {"value": 26}}
    assert trace["steps"][0]["response"]["preview"] == {"wordResults": [], "verseResults": []}


@pytest.mark.asyncio
async def test_tools_run_unchanged_without_a_recorder(monkeypatch):
    monkeypatch.setattr(tools, "search_english_sync", lambda query: {"results": [1, 2]})
    assert current_recorder.get() is None
    assert await tools.search_english("faith") == {"results": [1, 2]}


@pytest.mark.asyncio
async def test_tool_step_marks_error_on_exception(monkeypatch):
    def boom(value):
        raise ValueError("bad value")

    monkeypatch.setattr(tools, "search_gematria_sync", boom)
    rec = TraceRecorder("/chat", "x")
    token = current_recorder.set(rec)
    try:
        with pytest.raises(ValueError):
            await tools.search_gematria(1)
    finally:
        current_recorder.reset(token)
    step = rec.finalize("error")["steps"][0]
    assert step["status"] == "error"
    assert "bad value" in step["error"]
