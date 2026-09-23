import json

import pytest

from chatbot import api as api_module
from chatbot.story_illustrations import StoryIllustrationError, build_prompt, cache_key


@pytest.fixture
def isolated_image_cache(tmp_path, monkeypatch):
    monkeypatch.setattr(api_module, "STORY_IMAGE_CACHE_DIR", tmp_path)
    return tmp_path


def _lines(resp):
    return [json.loads(line) for line in resp.text.strip().split("\n") if line.strip()]


def test_generates_cover_and_page_illustrations(client, monkeypatch, isolated_image_cache):
    calls = []

    def fake_synthesize(prompt):
        calls.append(prompt)
        return b"fake-png-bytes"

    monkeypatch.setattr(api_module, "synthesize_illustration", fake_synthesize)

    resp = client.post("/story/illustrations", json={
        "characters": "Amara: curly black hair.",
        "cover_scene": "The cover scene.",
        "page_scenes": ["Page one scene.", "Page two scene."],
    })

    assert resp.status_code == 200
    items = _lines(resp)
    assert sorted(item["index"] for item in items) == [-1, 0, 1]
    assert all(item["image_url"] and item.get("error") is None for item in items)
    assert len(calls) == 3


def test_one_page_failure_does_not_block_the_others(client, monkeypatch, isolated_image_cache):
    def flaky_synthesize(prompt):
        if "Page two" in prompt:
            raise StoryIllustrationError("rate limited")
        return b"fake-png-bytes"

    monkeypatch.setattr(api_module, "synthesize_illustration", flaky_synthesize)

    resp = client.post("/story/illustrations", json={
        "characters": "",
        "cover_scene": "The cover scene.",
        "page_scenes": ["Page one scene.", "Page two scene."],
    })

    assert resp.status_code == 200
    items = {item["index"]: item for item in _lines(resp)}
    assert items[-1]["image_url"] is not None
    assert items[0]["image_url"] is not None
    assert items[1]["image_url"] is None
    assert items[1]["error"]


def test_failure_is_logged_server_side_and_generic_to_the_client(
    client, monkeypatch, isolated_image_cache, caplog,
):
    # Raw SDK/credential error text belongs in the operator's log, never in
    # the response body a browser sees.
    def failing_synthesize(prompt):
        raise StoryIllustrationError("Gemini client unavailable: Missing key inputs argument!")

    monkeypatch.setattr(api_module, "synthesize_illustration", failing_synthesize)

    with caplog.at_level("WARNING", logger=api_module.logger.name):
        resp = client.post("/story/illustrations", json={
            "characters": "", "cover_scene": "Cover.", "page_scenes": ["Page."],
        })

    assert resp.status_code == 200
    items = _lines(resp)
    assert all(item["error"] == "Illustration unavailable" for item in items)
    assert "Missing key inputs" not in resp.text
    assert "Missing key inputs" in caplog.text


def test_cache_hit_skips_regeneration(client, monkeypatch, isolated_image_cache):
    # Pre-cache both cover and page so synthesize_illustration is never called
    cover_prompt = build_prompt("Some other cover.", "")
    cover_key = cache_key(cover_prompt)
    (isolated_image_cache / f"{cover_key}.png").write_bytes(b"cover-cached")

    page_prompt = build_prompt("Already generated scene.", "")
    page_key = cache_key(page_prompt)
    (isolated_image_cache / f"{page_key}.png").write_bytes(b"page-cached")

    def fail_synthesize(prompt):
        raise AssertionError("synthesize_illustration must not be called on a cache hit")

    monkeypatch.setattr(api_module, "synthesize_illustration", fail_synthesize)

    resp = client.post("/story/illustrations", json={
        "characters": "",
        "cover_scene": "Some other cover.",
        "page_scenes": ["Already generated scene."],
    })

    assert resp.status_code == 200
    items = {item["index"]: item for item in _lines(resp)}
    assert items[-1]["image_url"] == f"/story-images/{cover_key}.png"
    assert items[0]["image_url"] == f"/story-images/{page_key}.png"


def test_empty_page_scenes_returns_422(client, isolated_image_cache):
    resp = client.post("/story/illustrations", json={
        "characters": "", "cover_scene": "A cover.", "page_scenes": [],
    })
    assert resp.status_code == 422


def test_blank_cover_scene_still_generates_a_cover(client, monkeypatch, isolated_image_cache):
    # story_mode defaults a missing LLM `cover_scene` to "" (see
    # test_generate_story_defaults_missing_optional_fields), so a blank
    # cover_scene is a real, expected input — it must not 422 the whole
    # request (which would fail every page's illustration too).
    calls = []

    def fake_synthesize(prompt):
        calls.append(prompt)
        return b"fake-png-bytes"

    monkeypatch.setattr(api_module, "synthesize_illustration", fake_synthesize)

    resp = client.post("/story/illustrations", json={
        "characters": "Amara: curly black hair.", "cover_scene": "   ", "page_scenes": ["A page."],
    })

    assert resp.status_code == 200
    items = {item["index"]: item for item in _lines(resp)}
    assert items[-1]["image_url"] and items[-1].get("error") is None
    assert items[0]["image_url"] and items[0].get("error") is None
    assert build_prompt("   ", "Amara: curly black hair.") in calls


def test_response_disables_proxy_buffering(client, monkeypatch, isolated_image_cache):
    # nginx's generic /api/ location buffers by default; without this header
    # every illustration would arrive at once instead of progressively.
    monkeypatch.setattr(api_module, "synthesize_illustration", lambda prompt: b"fake-png-bytes")
    resp = client.post("/story/illustrations", json={
        "characters": "", "cover_scene": "Cover.", "page_scenes": ["Page."],
    })
    assert resp.status_code == 200
    assert resp.headers["x-accel-buffering"] == "no"


def test_concurrency_is_bounded(client, monkeypatch, isolated_image_cache):
    import threading
    import time

    active = {"count": 0, "max": 0}
    lock = threading.Lock()

    def slow_synthesize(prompt):
        with lock:
            active["count"] += 1
            active["max"] = max(active["max"], active["count"])
        time.sleep(0.05)
        with lock:
            active["count"] -= 1
        return b"fake-png-bytes"

    monkeypatch.setattr(api_module, "synthesize_illustration", slow_synthesize)

    resp = client.post("/story/illustrations", json={
        "characters": "",
        "cover_scene": "Cover.",
        "page_scenes": [f"Page {i}." for i in range(10)],
    })

    assert resp.status_code == 200
    assert active["max"] <= 4
