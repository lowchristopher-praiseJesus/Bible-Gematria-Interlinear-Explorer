# tests/chatbot/test_router_trace.py
import pytest

from chatbot import router
from chatbot.trace import TraceRecorder, current_recorder


@pytest.mark.asyncio
async def test_deterministic_gematria_branch_records_routing(monkeypatch):
    async def fake_search(value):
        return {"wordResults": [], "verseResults": []}

    monkeypatch.setattr(router, "search_gematria", fake_search)
    rec = TraceRecorder("/chat", "gematria value 26")
    token = current_recorder.set(rec)
    try:
        result = await router.route_deterministic("gematria value 26")
    finally:
        current_recorder.reset(token)

    assert result["type"] == "gematria"
    labels = [s["label"] for s in rec.finalize("gematria")["steps"] if s["kind"] == "routing"]
    assert labels == ["deterministic: gematria value match"]


@pytest.mark.asyncio
async def test_fallthrough_records_routing():
    rec = TraceRecorder("/chat", "tell me about your feelings on modern art")
    token = current_recorder.set(rec)
    try:
        result = await router.route_deterministic("tell me about your feelings on modern art")
    finally:
        current_recorder.reset(token)

    assert result is None
    labels = [s["label"] for s in rec.finalize("chat")["steps"] if s["kind"] == "routing"]
    assert labels[-1] == "fell through to LLM"


@pytest.mark.asyncio
async def test_mode_primer_records_routing():
    rec = TraceRecorder("primer", "")
    token = current_recorder.set(rec)
    try:
        await router.build_mode_primer("freeform", {})
    finally:
        current_recorder.reset(token)
    labels = [s["label"] for s in rec.finalize("chat")["steps"] if s["kind"] == "routing"]
    assert labels == ["mode primer: freeform"]
