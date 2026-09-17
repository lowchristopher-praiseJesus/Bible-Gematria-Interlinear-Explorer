import pytest

from chatbot import api as api_module
from chatbot.devotional_audio import DevotionalAudioError, cache_key


@pytest.fixture
def isolated_audio_cache(tmp_path, monkeypatch):
    monkeypatch.setattr(api_module, "AUDIO_CACHE_DIR", tmp_path)
    return tmp_path


def test_generates_and_caches_audio(client, monkeypatch, isolated_audio_cache):
    calls = []

    def fake_synthesize(text):
        calls.append(text)
        return b"fake-mp3-bytes"

    monkeypatch.setattr(api_module, "synthesize_devotional_audio", fake_synthesize)

    resp = client.post("/devotional/audio", json={"reference": "JHN 14:27", "text": "Peace be with you."})
    assert resp.status_code == 200
    key = resp.json()["audio_url"].removeprefix("/devotional-audio/").removesuffix(".mp3")
    assert (isolated_audio_cache / f"{key}.mp3").read_bytes() == b"fake-mp3-bytes"
    assert calls == ["Peace be with you."]


def test_cache_hit_skips_regeneration(client, monkeypatch, isolated_audio_cache):
    key = cache_key("Already generated.")
    (isolated_audio_cache / f"{key}.mp3").write_bytes(b"already-cached")

    def fail_synthesize(text):
        raise AssertionError("synthesize_devotional_audio must not be called on a cache hit")

    monkeypatch.setattr(api_module, "synthesize_devotional_audio", fail_synthesize)

    resp = client.post("/devotional/audio", json={"reference": "JHN 14:27", "text": "Already generated."})
    assert resp.status_code == 200
    assert resp.json()["audio_url"] == f"/devotional-audio/{key}.mp3"


def test_tts_failure_returns_502(client, monkeypatch, isolated_audio_cache):
    def fake_synthesize(text):
        raise DevotionalAudioError("TTS synthesis failed: boom")

    monkeypatch.setattr(api_module, "synthesize_devotional_audio", fake_synthesize)

    resp = client.post("/devotional/audio", json={"reference": "JHN 14:27", "text": "Some text."})
    assert resp.status_code == 502


def test_empty_text_returns_422(client, isolated_audio_cache):
    resp = client.post("/devotional/audio", json={"reference": "JHN 14:27", "text": "   "})
    assert resp.status_code == 422
