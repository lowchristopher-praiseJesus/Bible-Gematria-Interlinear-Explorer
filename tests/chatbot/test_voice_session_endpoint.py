"""Tests for POST /voice/session — proxies the GPT-Live WebRTC SDP
handshake using a caller-supplied OpenAI key, never persisting it."""

import json
import logging

import httpx
import pytest

import chatbot.api as api
from chatbot.schemas import VoiceSessionRequest
from chatbot.trace import TraceRecorder, current_recorder


def _install_transport(monkeypatch, handler):
    transport = httpx.MockTransport(handler)
    real_async_client = httpx.AsyncClient

    def client_factory(*args, **kwargs):
        kwargs["transport"] = transport
        return real_async_client(*args, **kwargs)

    monkeypatch.setattr(api.httpx, "AsyncClient", client_factory)


def test_create_voice_session_happy_path(client, monkeypatch):
    def handler(request):
        assert str(request.url) == "https://api.openai.com/v1/live/sessions"
        assert request.headers["Authorization"] == "Bearer sk-test-123"
        payload = json.loads(request.content)
        assert payload["session"]["model"] == "gpt-live-1"
        assert payload["session"]["delegation"] == {"type": "client"}
        assert "verbatim" in payload["session"]["instructions"]
        assert "continues a conversation" not in payload["session"]["instructions"]
        assert payload["transport"] == {"type": "webrtc", "sdp": "fake-offer-sdp"}
        return httpx.Response(
            200,
            json={"session": {"id": "live_123"}, "transport": {"sdp": "fake-answer-sdp"}},
        )

    _install_transport(monkeypatch, handler)
    res = client.post(
        "/voice/session",
        json={"sdp": "fake-offer-sdp"},
        headers={"X-OpenAI-Key": "sk-test-123"},
    )
    assert res.status_code == 200
    assert res.json() == {"session_id": "live_123", "sdp": "fake-answer-sdp"}


def test_create_voice_session_continuation_instructions_when_history_present(client, monkeypatch):
    def handler(request):
        payload = json.loads(request.content)
        assert "continues a conversation" in payload["session"]["instructions"]
        return httpx.Response(
            200,
            json={"session": {"id": "live_123"}, "transport": {"sdp": "fake-answer-sdp"}},
        )

    _install_transport(monkeypatch, handler)
    res = client.post(
        "/voice/session",
        json={"sdp": "fake-offer-sdp", "has_history": True},
        headers={"X-OpenAI-Key": "sk-test-123"},
    )
    assert res.status_code == 200


def test_create_voice_session_missing_key_header(client):
    res = client.post("/voice/session", json={"sdp": "fake-offer-sdp"})
    assert res.status_code == 422


def test_create_voice_session_oversize_sdp_rejected_before_openai_call(client, monkeypatch):
    def fail_if_called(request):
        raise AssertionError("oversize SDP must not reach OpenAI")

    _install_transport(monkeypatch, fail_if_called)
    res = client.post(
        "/voice/session",
        json={"sdp": "x" * (64 * 1024 + 1)},
        headers={"X-OpenAI-Key": "sk-test-123"},
    )
    assert res.status_code == 413


def test_create_voice_session_bad_key_maps_to_clean_401(client, monkeypatch):
    def handler(request):
        return httpx.Response(401, json={"error": {"message": "Incorrect API key provided: sk-test-123"}})

    _install_transport(monkeypatch, handler)
    res = client.post(
        "/voice/session",
        json={"sdp": "fake-offer-sdp"},
        headers={"X-OpenAI-Key": "sk-test-123"},
    )
    assert res.status_code == 401
    assert "sk-test-123" not in res.text
    assert res.json()["detail"] == "Couldn't start a voice session — check your OpenAI API key in Settings."


def test_create_voice_session_rate_limited_maps_to_429(client, monkeypatch):
    def handler(request):
        return httpx.Response(429, json={"error": {"message": "rate limited"}})

    _install_transport(monkeypatch, handler)
    res = client.post(
        "/voice/session",
        json={"sdp": "fake-offer-sdp"},
        headers={"X-OpenAI-Key": "sk-test-123"},
    )
    assert res.status_code == 429


def test_create_voice_session_forbidden_maps_to_403_with_model_access_message(client, monkeypatch):
    # A valid key that simply lacks GPT-Live access is a realistic BYOK
    # failure for a newly released model — it must not read as server
    # trouble ("OpenAI couldn't start the voice session").
    def handler(request):
        return httpx.Response(
            403, json={"error": {"message": "Project does not have access to model gpt-live-1"}}
        )

    _install_transport(monkeypatch, handler)
    res = client.post(
        "/voice/session",
        json={"sdp": "fake-offer-sdp"},
        headers={"X-OpenAI-Key": "sk-test-123"},
    )
    assert res.status_code == 403
    assert "sk-test-123" not in res.text
    assert res.json()["detail"] == (
        "This OpenAI key doesn't have access to GPT-Live — check your OpenAI account's model access."
    )


def test_create_voice_session_network_error_maps_to_502(client, monkeypatch):
    def handler(request):
        raise httpx.ConnectError("network down", request=request)

    _install_transport(monkeypatch, handler)
    res = client.post(
        "/voice/session",
        json={"sdp": "fake-offer-sdp"},
        headers={"X-OpenAI-Key": "sk-test-123"},
    )
    assert res.status_code == 502


@pytest.mark.parametrize(
    "response_factory",
    [
        # 200 with a JSON body of an unexpected shape (missing keys).
        lambda: httpx.Response(200, json={"unexpected": "shape"}),
        # 200 whose `session` is not an object at all.
        lambda: httpx.Response(200, json={"session": "live_123", "transport": {"sdp": "x"}}),
        # 200 whose ids are not strings.
        lambda: httpx.Response(200, json={"session": {"id": 7}, "transport": {"sdp": None}}),
        # 200 that isn't JSON at all — response.json() itself raises.
        lambda: httpx.Response(200, text="<html>not json</html>"),
    ],
)
def test_create_voice_session_malformed_success_body_maps_to_clean_502(
    client, monkeypatch, response_factory
):
    def handler(request):
        return response_factory()

    _install_transport(monkeypatch, handler)
    res = client.post(
        "/voice/session",
        json={"sdp": "fake-offer-sdp"},
        headers={"X-OpenAI-Key": "sk-test-123"},
    )
    assert res.status_code == 502
    assert res.json()["detail"] == "OpenAI returned an unexpected response."


@pytest.mark.asyncio
async def test_voice_session_key_never_reaches_trace_output_or_logs(monkeypatch, caplog):
    """Spec (Testing): the key never appears in trace.py output or captured
    logs for this route.

    `create_voice_session` deliberately opens no TraceRecorder of its own —
    the key is used for one outbound call and discarded. This calls the
    handler directly (rather than through TestClient, whose worker thread
    doesn't inherit the test's ContextVars) with an *ambient* recorder
    installed on `current_recorder`, exactly as the other trace tests do, so
    any `record_tool`/`record_llm` instrumentation someone later wires into
    this route would land in `recorder` and be visible here. The empty-steps
    assertion pins today's "no trace interaction at all" property; the
    key-absence assertion is the security property that must hold either way.
    """
    key = "sk-trace-secret-abcdef"
    caplog.set_level(logging.DEBUG)

    def handler(request):
        assert request.headers["Authorization"] == f"Bearer {key}"
        return httpx.Response(
            200, json={"session": {"id": "live_123"}, "transport": {"sdp": "fake-answer-sdp"}}
        )

    _install_transport(monkeypatch, handler)

    recorder = TraceRecorder("/voice/session", "")
    token = current_recorder.set(recorder)
    try:
        result = await api.create_voice_session(
            VoiceSessionRequest(sdp="fake-offer-sdp"), x_openai_key=key
        )
    finally:
        current_recorder.reset(token)

    assert result.session_id == "live_123"
    trace = recorder.finalize("chat")
    assert trace["steps"] == []
    assert key not in json.dumps(trace, default=str)
    assert key not in caplog.text


def test_voice_session_route_opens_no_trace_recorder(client, monkeypatch, caplog):
    """The route never constructs a TraceRecorder, so there is no trace
    document for this turn that could carry the key at all."""
    key = "sk-trace-secret-abcdef"
    caplog.set_level(logging.DEBUG)
    created: list[tuple] = []

    class SpyRecorder(TraceRecorder):
        def __init__(self, *args, **kwargs):
            created.append((args, kwargs))
            super().__init__(*args, **kwargs)

    monkeypatch.setattr(api, "TraceRecorder", SpyRecorder)

    def handler(request):
        return httpx.Response(
            200, json={"session": {"id": "live_123"}, "transport": {"sdp": "fake-answer-sdp"}}
        )

    _install_transport(monkeypatch, handler)
    res = client.post(
        "/voice/session",
        json={"sdp": "fake-offer-sdp"},
        headers={"X-OpenAI-Key": key},
    )

    assert res.status_code == 200
    assert created == []
    assert key not in res.text
    assert key not in caplog.text
