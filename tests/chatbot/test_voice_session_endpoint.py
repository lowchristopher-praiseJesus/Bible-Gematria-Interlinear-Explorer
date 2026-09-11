"""Tests for POST /voice/session — proxies the GPT-Live WebRTC SDP
handshake using a caller-supplied OpenAI key, never persisting it."""

import json

import httpx

import chatbot.api as api


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
        assert payload["model"] == "gpt-live-1"
        assert payload["delegation"] == {"type": "client"}
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
