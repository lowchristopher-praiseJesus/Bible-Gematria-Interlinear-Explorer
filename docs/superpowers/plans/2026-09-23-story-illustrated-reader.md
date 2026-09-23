# Illustrated Story Reader Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Tell a Story's single-blob text artifact into a structured, page-by-page story with a Gemini-generated illustration per page, viewable in a new full-screen page-flip reader opened from an icon on the existing artifact.

**Architecture:** `chatbot/story_mode.py`'s `generate_story` asks the LLM for structured JSON (title, a character-appearance line, a cover scene, and a list of `{text, scene}` pages) instead of one prose blob; the chat turn returns immediately with that structure and every `image_url` null. A new `chatbot/story_illustrations.py` module wraps the Gemini API's image model behind a content-hash disk cache (mirroring `chatbot/devotional_audio.py`'s pattern exactly), exposed through a new `POST /story/illustrations` endpoint that streams one newline-delimited JSON result per illustration as it finishes, with per-item fail-open error handling and bounded concurrency. The frontend's new `StoryReaderOverlay` (a full-screen Radix Dialog, structurally modeled on `DevotionalListenOverlay`) opens instantly on click and calls that endpoint itself, patching each page's image in as it streams — completely decoupled from the chat turn's own latency.

**Tech Stack:** Python/FastAPI (`chatbot/`), `google-genai` SDK, React/TypeScript/Vite (`frontend/`), Radix UI Dialog, Vitest/Testing Library, pytest/pytest-asyncio.

**Spec:** `docs/superpowers/specs/2026-09-23-story-illustrated-reader-design.md`

## Global Constraints

- Word bands are unchanged: `AGE_WORD_BANDS = {"3-6": (500, 800), "7-8": (800, 1200), "9-10": (1200, 1800)}`.
- New page-count bands, fewer/shorter pages for younger readers: `PAGE_COUNT_BANDS = {"3-6": (5, 6), "7-8": (7, 8), "9-10": (9, 10)}`.
- Illustration model id is `gemini-3.1-flash-lite-image`, overridable via the `STORY_IMAGE_MODEL` env var (default baked into the code) — the exact id is unverified against current Google docs as of this plan, so it must never be hardcoded anywhere except that one default.
- Auth is a Google AI Studio API key via the `GEMINI_API_KEY` env var (the `google-genai` SDK's own default pickup) — no GCP service account, unlike the existing TTS credential.
- Every generated image uses aspect ratio `"4:3"`.
- Every image prompt is `STYLE_PREFIX + scene + characters`, built by `story_illustrations.build_prompt` — never scene text alone.
- Illustration generation concurrency is capped at 4 concurrent Gemini calls per `/story/illustrations` request.
- A single illustration's failure (network, rate limit, no image returned, missing/invalid API key) is fail-open: that one page or the cover shows without an image; it never fails the whole request or the whole story.
- Illustrations are cached on disk keyed by `sha256(prompt)` and served via a `/story-images` static mount — never embedded as inline/base64 image data anywhere (wire payloads or the browser's persisted session state).
- The chat turn's latency is unaffected by illustration generation: `_story_turn` returns as soon as the structured story text is generated; illustrations are fetched by a separate request the frontend issues after the artifact already exists.
- **Deviation from the spec, decided during planning:** resolved illustration URLs are kept only in the reader overlay's own component state for this plan, not written back into `useSessionsStore`/`localStorage`. The spec floated write-back as a way to avoid a redundant fetch on reopen, but the backend's content-hash cache already makes a repeat fetch fast (no regeneration, just a cache-hit disk read), so the persistence plumbing (threading session/message identifiers through `ArtifactPane` into `StoryArtifact`) isn't justified for v1. Easy to add later if reopen latency proves to matter in practice.

## Review Focus

- **Story LLM reply is unparseable, or valid JSON with an empty `pages` array** — must be treated as a failure (retried once, then an honest "couldn't write the story" error), never surfaced as a blank or partially-broken artifact. Tests: Task 3.
- **One page's or the cover's illustration generation fails** (network error, rate limit, Gemini returns no image) — that one page/cover degrades to text-only; every other page still gets its illustration, and the whole `/story/illustrations` request still returns 200. Tests: Task 1, Task 2, Task 5.
- **`GEMINI_API_KEY` is unset or the Gemini client fails to construct** — every illustration in the affected request degrades to text-only rather than the endpoint raising a 500. Tests: Task 1, Task 2 (via the same fail-open path as the item above).
- **The reader overlay is closed and reopened while an illustration fetch is still in flight** — the stale, still-running fetch's results must not land on the new open's state after the component re-runs its effect. Tests: Task 5.
- **"Try again" (or any request) hits an already-cached prompt** (same scene + character text as a prior story) — served straight from the on-disk cache, `synthesize_illustration` never called again for it. Tests: Task 2.

---

### Task 1: Illustration generation module (`chatbot/story_illustrations.py`)

**Files:**
- Create: `chatbot/story_illustrations.py`
- Modify: `chatbot/__init__.py` (mount `/story-images`)
- Modify: `requirements.txt` (add `google-genai`, `pillow`)
- Modify: `.env.example` (add `GEMINI_API_KEY`, `STORY_IMAGE_MODEL`)
- Test: `tests/chatbot/test_story_illustrations.py`

**Interfaces:**
- Produces: `STORY_IMAGE_CACHE_DIR: Path`, `IMAGE_MODEL: str`, `STYLE_PREFIX: str`, `class StoryIllustrationError(Exception)`, `cache_key(prompt: str) -> str`, `build_prompt(scene: str, characters: str) -> str`, `synthesize_illustration(prompt: str) -> bytes` (raises `StoryIllustrationError` on any failure) — all consumed by Task 2.

- [ ] **Step 1: Add the new dependencies**

Append to `requirements.txt`, right after the existing `google-cloud-texttospeech` line:

```
google-genai>=1.0.0                 # chatbot/story_illustrations.py: Gemini image generation
pillow>=10.0.0                      # chatbot/story_illustrations.py: image byte handling
```

Run: `pip install -r requirements.txt`
Expected: `google-genai` and `pillow` install successfully.

- [ ] **Step 2: Document the new env vars**

Add to `.env.example`, right after the "Devotional audio" section:

```
# ─── Tell a Story illustrations (Gemini API image generation) ─────────────
# Read by chatbot/story_illustrations.py. A standard Google AI Studio API
# key (ai.google.dev) — no GCP service account needed, unlike the TTS key
# above. Free-tier keys are rate-limited; a failed/rate-limited image
# request degrades that one page to text-only rather than failing the
# story. Put the real value only in .env, never in .env.example.
GEMINI_API_KEY=
# Override only if Google renames/deprecates the model id below.
STORY_IMAGE_MODEL=gemini-3.1-flash-lite-image
```

- [ ] **Step 3: Write the failing tests for the pure functions**

Create `tests/chatbot/test_story_illustrations.py`:

```python
import pytest

from chatbot import story_illustrations as si


def test_cache_key_changes_with_prompt():
    assert si.cache_key("A fox in a garden") != si.cache_key("A sparrow in a tree")


def test_cache_key_is_deterministic():
    assert si.cache_key("A fox in a garden") == si.cache_key("A fox in a garden")


def test_build_prompt_includes_style_scene_and_characters():
    prompt = si.build_prompt(
        "Amara finds a ribbon in the clover.",
        "Amara: curly black hair, yellow raincoat.",
    )
    assert si.STYLE_PREFIX.strip() in prompt
    assert "Amara finds a ribbon in the clover." in prompt
    assert "Amara: curly black hair, yellow raincoat." in prompt


def test_build_prompt_omits_blank_characters():
    prompt = si.build_prompt("The cover scene.", "")
    assert "The cover scene." in prompt
    assert "  " not in prompt  # no doubled-up whitespace from the empty field
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `pytest tests/chatbot/test_story_illustrations.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'chatbot.story_illustrations'`

- [ ] **Step 5: Write the module's pure functions**

Create `chatbot/story_illustrations.py`:

```python
"""Per-page story illustrations via the Gemini API's image generation
model (a Google AI Studio API key — no GCP service account, unlike
chatbot/devotional_audio.py's TTS credential). Mirrors devotional_audio's
content-hash disk cache pattern exactly.
"""

import hashlib
import os
from pathlib import Path

from google import genai
from google.genai import types

IMAGE_MODEL = os.environ.get("STORY_IMAGE_MODEL", "gemini-3.1-flash-lite-image")
IMAGE_ASPECT_RATIO = "4:3"

STORY_IMAGE_CACHE_DIR = Path(os.environ.get("STORY_IMAGE_CACHE_DIR", "STORY_IMAGE_CACHE"))
STORY_IMAGE_CACHE_DIR.mkdir(parents=True, exist_ok=True)

STYLE_PREFIX = (
    "Children's storybook illustration, soft warm watercolor style, "
    "gentle colors, no text or words anywhere in the image. "
)


class StoryIllustrationError(Exception):
    """Raised for any failure generating one illustration. Callers must
    treat this as expected and degrade that one page/cover — never let it
    fail an entire story or request."""


def cache_key(prompt: str) -> str:
    return hashlib.sha256(prompt.encode("utf-8")).hexdigest()


def build_prompt(scene: str, characters: str) -> str:
    parts = [STYLE_PREFIX.strip(), scene.strip(), characters.strip()]
    return " ".join(p for p in parts if p)


def synthesize_illustration(prompt: str) -> bytes:
    """One image's PNG bytes for `prompt`. Raises StoryIllustrationError on
    any failure — client construction, network/API error, or an empty
    response — never returns partial/invalid data silently."""
    try:
        client = genai.Client()
    except Exception as exc:  # noqa: BLE001 — any client/credential failure
        raise StoryIllustrationError(f"Gemini client unavailable: {exc}") from exc

    try:
        response = client.models.generate_content(
            model=IMAGE_MODEL,
            contents=prompt,
            config=types.GenerateContentConfig(
                response_modalities=["IMAGE"],
                image_config=types.ImageConfig(aspect_ratio=IMAGE_ASPECT_RATIO),
            ),
        )
    except Exception as exc:  # noqa: BLE001 — network/API failure
        raise StoryIllustrationError(f"Image generation failed: {exc}") from exc

    for candidate in getattr(response, "candidates", None) or []:
        for part in getattr(candidate.content, "parts", None) or []:
            inline_data = getattr(part, "inline_data", None)
            if inline_data and inline_data.data:
                return inline_data.data
    raise StoryIllustrationError("Gemini returned no image data")
```

- [ ] **Step 6: Run the tests to verify the pure functions pass**

Run: `pytest tests/chatbot/test_story_illustrations.py -v`
Expected: PASS (4 tests)

- [ ] **Step 7: Write the failing tests for `synthesize_illustration`**

Append to `tests/chatbot/test_story_illustrations.py`:

```python
class _FakeInlineData:
    def __init__(self, data):
        self.data = data


class _FakePart:
    def __init__(self, data):
        self.inline_data = _FakeInlineData(data) if data else None


class _FakeContent:
    def __init__(self, parts):
        self.parts = parts


class _FakeCandidate:
    def __init__(self, parts):
        self.content = _FakeContent(parts)


class _FakeResponse:
    def __init__(self, parts):
        self.candidates = [_FakeCandidate(parts)]


def test_synthesize_illustration_returns_image_bytes(monkeypatch):
    class FakeModels:
        def generate_content(self, **kwargs):
            return _FakeResponse([_FakePart(b"fake-png-bytes")])

    class FakeClient:
        def __init__(self):
            self.models = FakeModels()

    monkeypatch.setattr(si.genai, "Client", FakeClient)

    assert si.synthesize_illustration("a prompt") == b"fake-png-bytes"


def test_synthesize_illustration_raises_when_no_image_returned(monkeypatch):
    class FakeModels:
        def generate_content(self, **kwargs):
            return _FakeResponse([_FakePart(None)])

    class FakeClient:
        def __init__(self):
            self.models = FakeModels()

    monkeypatch.setattr(si.genai, "Client", FakeClient)

    with pytest.raises(si.StoryIllustrationError):
        si.synthesize_illustration("a prompt")


def test_synthesize_illustration_wraps_api_failure(monkeypatch):
    class FakeModels:
        def generate_content(self, **kwargs):
            raise RuntimeError("rate limited")

    class FakeClient:
        def __init__(self):
            self.models = FakeModels()

    monkeypatch.setattr(si.genai, "Client", FakeClient)

    with pytest.raises(si.StoryIllustrationError):
        si.synthesize_illustration("a prompt")


def test_synthesize_illustration_wraps_client_construction_failure(monkeypatch):
    class FailingClient:
        def __init__(self):
            raise RuntimeError("credentials not found")

    monkeypatch.setattr(si.genai, "Client", FailingClient)

    with pytest.raises(si.StoryIllustrationError):
        si.synthesize_illustration("a prompt")
```

- [ ] **Step 8: Run the tests to verify they fail correctly, then pass**

Run: `pytest tests/chatbot/test_story_illustrations.py -v`
Expected: PASS (8 tests total) — the implementation from Step 5 already satisfies these; if any fails, fix `synthesize_illustration` (not the test) to match the documented behavior above.

- [ ] **Step 9: Mount `/story-images`**

In `chatbot/__init__.py`, right after the existing devotional-audio mount:

```python
    from chatbot.devotional_audio import AUDIO_CACHE_DIR
    app.mount("/devotional-audio", StaticFiles(directory=str(AUDIO_CACHE_DIR)), name="devotional-audio")

    from chatbot.story_illustrations import STORY_IMAGE_CACHE_DIR
    app.mount("/story-images", StaticFiles(directory=str(STORY_IMAGE_CACHE_DIR)), name="story-images")
```

No dedicated test for the mount itself — `AUDIO_CACHE_DIR`'s identical mount has none either in this codebase (endpoint tests only check the returned URL string and that bytes were written to the isolated cache path, per `tests/chatbot/test_devotional_audio_endpoint.py`); Task 2's endpoint tests follow that same precedent for `/story-images`.

- [ ] **Step 10: Add the docker-compose volume**

In `docker-compose.yml`, add a new named volume right after the `audio-cache` block (around line 32-33):

```yaml
  # Persistent store for generated story illustrations (see
  # chatbot/story_illustrations.py), content-hash keyed the same way as
  # audio-cache above. Mounted into `chatbot` at /app/STORY_IMAGE_CACHE.
  # No active eviction.
  story-image-cache:
```

In the `chatbot` service's `environment:` block, add right after `AUDIO_CACHE_DIR`:

```yaml
      # Filesystem cache dir for generated story illustrations (see the
      # `story-image-cache` volume below).
      STORY_IMAGE_CACHE_DIR: /app/STORY_IMAGE_CACHE
```

In the `chatbot` service's `volumes:` list, add right after `- audio-cache:/app/AUDIO_CACHE`:

```yaml
      - story-image-cache:/app/STORY_IMAGE_CACHE
```

Note: `GEMINI_API_KEY` needs no docker-compose entry of its own — it's a plain env var already passed through by the existing `env_file: [.env]` line, the same way `NVIDIA_API_KEY`/`OPENROUTER_API_KEY` are.

- [ ] **Step 11: Document the volume in DEPLOYMENT.md**

In `DEPLOYMENT.md`, add a new subsection right after "Devotional audio (Listen) and devotional-of-the-day" (after its "Manual step — GCP credentials" paragraph):

```markdown
### Tell a Story illustrations

Each page's illustration is generated via the Gemini API's image model
(`chatbot/story_illustrations.py`) and cached on the `story-image-cache`
named volume, mounted into `chatbot` at `/app/STORY_IMAGE_CACHE` (env
`STORY_IMAGE_CACHE_DIR`), keyed by a content hash of the full image
prompt (style prefix + scene + character description). There is no
eviction — files accumulate indefinitely, same as `audio-cache`; an
operator can clear the volume directly if it grows too large.

**Manual step — Gemini API key (not automated by `docker compose up`):**
Unlike the TTS credential above, this is a plain Google AI Studio API key
(from ai.google.dev), not a GCP service-account file. Set `GEMINI_API_KEY`
in `.env` — it's picked up automatically via the existing `env_file: [.env]`
wiring, no docker-compose changes needed. A missing or invalid key
degrades every illustration to text-only (see `chatbot/story_illustrations.py`'s
fail-open behavior) rather than breaking Tell a Story.
```

- [ ] **Step 12: Commit**

```bash
git add chatbot/story_illustrations.py chatbot/__init__.py requirements.txt .env.example docker-compose.yml DEPLOYMENT.md tests/chatbot/test_story_illustrations.py
git commit -m "feat(chatbot): add Gemini-backed per-image story illustration generation"
```

---

### Task 2: `POST /story/illustrations` streaming endpoint

**Files:**
- Modify: `chatbot/schemas.py` (add `StoryIllustrationsRequest`, `StoryIllustrationItem`)
- Modify: `chatbot/api.py` (add the endpoint, ~after line 244)
- Test: `tests/chatbot/test_story_illustrations_endpoint.py`

**Interfaces:**
- Consumes (from Task 1): `STORY_IMAGE_CACHE_DIR`, `StoryIllustrationError`, `build_prompt(scene, characters)`, `cache_key(prompt)`, `synthesize_illustration(prompt)`.
- Produces: `POST /story/illustrations` — request body `{characters: str, cover_scene: str, page_scenes: list[str]}`; response is `media_type="application/x-ndjson"`, one JSON object per line, each `{"index": int, "image_url": str|null, "error": str|null}` (`index == -1` is the cover, `0..N-1` are pages in `page_scenes` order — lines may arrive out of index order since generation is concurrent). Consumed by Task 4's `streamStoryIllustrations`.

- [ ] **Step 1: Write the failing schema/endpoint tests**

Create `tests/chatbot/test_story_illustrations_endpoint.py`:

```python
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
    assert items[1]["error"] == "rate limited"


def test_cache_hit_skips_regeneration(client, monkeypatch, isolated_image_cache):
    prompt = build_prompt("Already generated scene.", "")
    key = cache_key(prompt)
    (isolated_image_cache / f"{key}.png").write_bytes(b"already-cached")

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
    assert items[0]["image_url"] == f"/story-images/{key}.png"


def test_empty_page_scenes_returns_422(client, isolated_image_cache):
    resp = client.post("/story/illustrations", json={
        "characters": "", "cover_scene": "A cover.", "page_scenes": [],
    })
    assert resp.status_code == 422


def test_blank_cover_scene_returns_422(client, isolated_image_cache):
    resp = client.post("/story/illustrations", json={
        "characters": "", "cover_scene": "   ", "page_scenes": ["A page."],
    })
    assert resp.status_code == 422


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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pytest tests/chatbot/test_story_illustrations_endpoint.py -v`
Expected: FAIL — `404` (route doesn't exist yet) or `AttributeError` on `api_module.STORY_IMAGE_CACHE_DIR`/`api_module.synthesize_illustration`.

- [ ] **Step 3: Add the request/response schemas**

In `chatbot/schemas.py`, after `DevotionalAudioResponse` (end of file):

```python
class StoryIllustrationsRequest(BaseModel):
    characters: str = Field("", description="One-line character appearance description, appended to every page's image prompt for visual consistency")
    cover_scene: str = Field(..., description="One-sentence description of the cover illustration")
    page_scenes: List[str] = Field(..., description="One-sentence scene description per story page, in reading order")


class StoryIllustrationItem(BaseModel):
    index: int = Field(..., description="-1 for the cover illustration, 0-based page index otherwise")
    image_url: Optional[str] = Field(None, description="Path to the generated/cached PNG, relative to the chatbot service root (e.g. '/story-images/<hash>.png') — present only on success")
    error: Optional[str] = Field(None, description="Present only when this one illustration failed — the page's own text is still usable without it")
```

- [ ] **Step 4: Add the endpoint**

In `chatbot/api.py`:

Extend the `from chatbot.schemas import (...)` block (around line 11) to include `StoryIllustrationsRequest, StoryIllustrationItem`.

Add, after `from chatbot.devotional_audio import (...)` (around line 35-40):

```python
from chatbot.story_illustrations import (
    STORY_IMAGE_CACHE_DIR,
    StoryIllustrationError,
    build_prompt,
    cache_key,
    synthesize_illustration,
)
```

Add, right after the `post_devotional_audio` endpoint (after line 244):

```python
STORY_ILLUSTRATION_CONCURRENCY = 4


async def _generate_one_illustration(
    index: int, scene: str, characters: str, semaphore: asyncio.Semaphore,
) -> StoryIllustrationItem:
    prompt = build_prompt(scene, characters)
    key = cache_key(prompt)
    cache_path = STORY_IMAGE_CACHE_DIR / f"{key}.png"
    if cache_path.exists():
        return StoryIllustrationItem(index=index, image_url=f"/story-images/{key}.png")
    async with semaphore:
        try:
            image_bytes = await asyncio.to_thread(synthesize_illustration, prompt)
        except StoryIllustrationError as exc:
            return StoryIllustrationItem(index=index, error=str(exc))
        cache_path.write_bytes(image_bytes)
        return StoryIllustrationItem(index=index, image_url=f"/story-images/{key}.png")


@router.post("/story/illustrations")
async def post_story_illustrations(request: StoryIllustrationsRequest) -> StreamingResponse:
    """Newline-delimited JSON, one StoryIllustrationItem per line, streamed
    as each illustration finishes (cover plus every page, generated
    concurrently — lines may arrive out of reading order). A single
    illustration's failure never raises; it's reported as that line's
    `error` field so every other illustration still streams through."""
    if not request.cover_scene.strip() or not request.page_scenes:
        raise HTTPException(status_code=422, detail="cover_scene and page_scenes must not be empty")

    semaphore = asyncio.Semaphore(STORY_ILLUSTRATION_CONCURRENCY)
    tasks = [
        asyncio.create_task(_generate_one_illustration(-1, request.cover_scene, request.characters, semaphore))
    ]
    tasks += [
        asyncio.create_task(_generate_one_illustration(i, scene, request.characters, semaphore))
        for i, scene in enumerate(request.page_scenes)
    ]

    async def stream():
        for coro in asyncio.as_completed(tasks):
            item = await coro
            yield item.model_dump_json() + "\n"

    return StreamingResponse(stream(), media_type="application/x-ndjson")
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pytest tests/chatbot/test_story_illustrations_endpoint.py -v`
Expected: PASS (6 tests)

- [ ] **Step 6: Run the full backend test suite to check for regressions**

Run: `pytest tests/ -v`
Expected: PASS (no regressions in unrelated modules)

- [ ] **Step 7: Commit**

```bash
git add chatbot/schemas.py chatbot/api.py tests/chatbot/test_story_illustrations_endpoint.py
git commit -m "feat(chatbot): add POST /story/illustrations streaming endpoint"
```

---

### Task 3: Structured page-by-page story generation (`chatbot/story_mode.py`)

**Files:**
- Modify: `chatbot/story_mode.py`
- Modify: `tests/chatbot/test_story_mode.py:115-341` (full replacement of this range)

**Interfaces:**
- Produces: `PAGE_COUNT_BANDS: dict[str, tuple[int, int]]`; `generate_story(digest, themes, age_range) -> dict` now returns `{"title": str, "characters": str, "cover_scene": str, "pages": [{"text": str, "scene": str}], "word_count": int}` (empty `pages` list signals total failure, replacing the old empty-`text` signal). `_story_turn`'s returned artifact `params` gain `characters: str`, `cover: {"scene": str, "image_url": None}`, and `pages: [{"text": str, "scene": str, "image_url": None}]`, and drop the old single `text` field — consumed by Task 4's frontend types.

- [ ] **Step 1: Replace the story-generation tests**

In `tests/chatbot/test_story_mode.py`, first add `import json` to the top import block:

```python
import json

import pytest

from chatbot import story_mode
```

Then replace everything from line 115 (`async def test_generate_story_uses_the_word_band_for_the_age_range(llm):`) through the end of the file (line 341) with:

```python
def _story_reply(
    title="Test", characters="Zara: red hair.", cover_scene="A cover scene.", pages=None,
):
    if pages is None:
        pages = [{"text": "word " * 650, "scene": "A scene."}]
    return json.dumps({
        "title": title, "characters": characters, "cover_scene": cover_scene, "pages": pages,
    })


async def test_generate_story_uses_the_word_band_for_the_age_range(llm):
    llm.state["replies"] = [_story_reply(
        title="The Brave Little Sparrow", pages=[{"text": "word " * 650, "scene": "A scene."}],
    )]
    result = await story_mode.generate_story(
        "digest", [{"id": "t1", "label": "Trust", "description": "..."}], "3-6"
    )
    assert result["title"] == "The Brave Little Sparrow"
    assert 600 <= result["word_count"] <= 700
    assert len(llm.calls) == 1


async def test_generate_story_returns_structured_pages_and_cover(llm):
    llm.state["replies"] = [_story_reply(
        title="A Story",
        characters="Zara: red hair, green boots.",
        cover_scene="Zara stands at the garden gate.",
        pages=[
            {"text": "word " * 300, "scene": "Scene one."},
            {"text": "word " * 300, "scene": "Scene two."},
        ],
    )]
    result = await story_mode.generate_story(
        "digest", [{"id": "t1", "label": "Trust", "description": "..."}], "3-6"
    )
    assert result["characters"] == "Zara: red hair, green boots."
    assert result["cover_scene"] == "Zara stands at the garden gate."
    assert result["pages"] == [
        {"text": "word " * 300, "scene": "Scene one."},
        {"text": "word " * 300, "scene": "Scene two."},
    ]
    assert result["word_count"] == 600


async def test_generate_story_defaults_missing_optional_fields(llm):
    # A reply missing `characters`/`cover_scene`/a page's `scene` must not
    # crash the parser — those fields degrade to "" (an illustration built
    # from "" just skips that part of the prompt, see story_illustrations
    # tests) rather than blocking story delivery.
    llm.state["replies"] = ['{"title": "T", "pages": [{"text": "word word word"}]}']
    result = await story_mode.generate_story(
        "digest", [{"id": "t1", "label": "Trust", "description": "..."}], "3-6"
    )
    assert result["title"] == "T"
    assert result["characters"] == ""
    assert result["cover_scene"] == ""
    assert result["pages"][0]["scene"] == ""
    assert len(llm.calls) == 2  # 3 words is far outside the band -> retries once


async def test_generate_story_treats_unparseable_reply_as_empty(llm):
    llm.state["replies"] = ["not json at all", "still not json"]
    result = await story_mode.generate_story(
        "digest", [{"id": "t1", "label": "Trust", "description": "..."}], "3-6"
    )
    assert result["pages"] == []
    assert len(llm.calls) == 2


async def test_generate_story_treats_a_reply_with_no_pages_as_empty(llm):
    # Well-formed JSON, but genuinely no pages — must be treated the same
    # as an unparseable reply (a failure to retry/report), not delivered
    # as a titled artifact with nothing to read.
    llm.state["replies"] = ['{"title": "T", "pages": []}', '{"title": "T2", "pages": []}']
    result = await story_mode.generate_story(
        "digest", [{"id": "t1", "label": "Trust", "description": "..."}], "3-6"
    )
    assert result["pages"] == []
    assert len(llm.calls) == 2


async def test_generate_story_assigns_two_random_character_names(llm, monkeypatch):
    # Real usage showed the model reliably defaulting to "Pip" for a small
    # animal sidekick across many generated stories, since each call is a
    # fresh, stateless completion with nothing to vary against on its own.
    # The server must pick the names itself rather than trust the model.
    monkeypatch.setattr(story_mode.random, "sample", lambda pool, k: ["Zara", "Kofi"])
    llm.state["replies"] = [_story_reply()]
    await story_mode.generate_story(
        "digest", [{"id": "t1", "label": "Sharing", "description": "..."}], "3-6"
    )
    prompt = llm.calls[0]["user_prompt"]
    assert "Zara" in prompt
    assert "Kofi" in prompt
    assert "Pip" in prompt  # named as the example to avoid defaulting to


async def test_generate_story_draws_names_from_the_character_name_pool(llm, monkeypatch):
    seen = {}

    def fake_sample(pool, k):
        seen["pool"] = pool
        seen["k"] = k
        return pool[:k]

    monkeypatch.setattr(story_mode.random, "sample", fake_sample)
    llm.state["replies"] = [_story_reply()]
    await story_mode.generate_story(
        "digest", [{"id": "t1", "label": "Sharing", "description": "..."}], "3-6"
    )
    assert seen["pool"] is story_mode.CHARACTER_NAME_POOL
    assert seen["k"] == 2
    assert len(story_mode.CHARACTER_NAME_POOL) >= 20
    assert len(set(story_mode.CHARACTER_NAME_POOL)) == len(story_mode.CHARACTER_NAME_POOL)
    assert "Pip" not in story_mode.CHARACTER_NAME_POOL


async def test_generate_story_prompt_for_ages_3_6_forbids_abstract_endings(llm):
    # Real usage (a "Report an Issue" submission) showed the 3-6 band's
    # stories reliably closing on an abstract simile ("like the wind and
    # the leaves") and a tacked-on "The lesson is..." moral — both lose a
    # 3-6-year-old even when the rest of the story lands. The prompt must
    # tell the model not to do that.
    llm.state["replies"] = [_story_reply()]
    await story_mode.generate_story(
        "digest", [{"id": "t1", "label": "Sharing", "description": "..."}], "3-6"
    )
    prompt = llm.calls[0]["user_prompt"].lower()
    assert "abstract" in prompt
    assert "moral" in prompt


async def test_generate_story_weaves_multiple_themes_into_the_prompt(llm):
    llm.state["replies"] = [_story_reply(title="Two Lessons")]
    themes = [
        {"id": "t1", "label": "Trusting God", "description": "..."},
        {"id": "t2", "label": "Coming home", "description": "..."},
    ]
    await story_mode.generate_story("digest", themes, "3-6")
    prompt = llm.calls[0]["user_prompt"]
    assert "Trusting God" in prompt
    assert "Coming home" in prompt


async def test_generate_story_retries_once_when_word_count_is_far_outside_the_band(llm):
    llm.state["replies"] = [
        _story_reply(title="Too Short", pages=[{"text": "Just a few words.", "scene": "A scene."}]),
        _story_reply(title="Just Right", pages=[{"text": "word " * 650, "scene": "A scene."}]),
    ]
    result = await story_mode.generate_story(
        "digest", [{"id": "t1", "label": "Trust", "description": "..."}], "3-6"
    )
    assert len(llm.calls) == 2
    assert result["title"] == "Just Right"
    assert result["word_count"] > 600


async def test_generate_story_delivers_the_retry_result_even_if_still_out_of_band(llm):
    llm.state["replies"] = [
        _story_reply(title="Too Short", pages=[{"text": "Just a few words.", "scene": "A scene."}]),
        _story_reply(title="Still Short", pages=[{"text": "Still just a few words.", "scene": "A scene."}]),
    ]
    result = await story_mode.generate_story(
        "digest", [{"id": "t1", "label": "Trust", "description": "..."}], "3-6"
    )
    assert len(llm.calls) == 2
    assert result["title"] == "Still Short"


async def test_generate_story_rejects_an_unknown_age_range(llm):
    with pytest.raises(ValueError):
        await story_mode.generate_story(
            "digest", [{"id": "t1", "label": "Trust", "description": "..."}], "13-18"
        )
    assert llm.calls == []


def test_page_count_bands_are_smaller_for_younger_ages():
    assert story_mode.PAGE_COUNT_BANDS["3-6"] < story_mode.PAGE_COUNT_BANDS["7-8"] < story_mode.PAGE_COUNT_BANDS["9-10"]


@pytest.mark.parametrize("age_range,low,high,page_low,page_high", [
    ("3-6", 500, 800, 5, 6), ("7-8", 800, 1200, 7, 8), ("9-10", 1200, 1800, 9, 10),
])
async def test_generate_story_targets_the_right_band_per_age_range(llm, age_range, low, high, page_low, page_high):
    llm.state["replies"] = [_story_reply(
        title="A Story", pages=[{"text": "word " * ((low + high) // 2), "scene": "A scene."}],
    )]
    result = await story_mode.generate_story(
        "digest", [{"id": "t1", "label": "Trust", "description": "..."}], age_range
    )
    assert len(llm.calls) == 1  # within band, no retry needed
    prompt = llm.calls[0]["user_prompt"]
    assert f"{low}-{high} words" in prompt
    assert f"{page_low}-{page_high} pages" in prompt


async def test_build_primer_with_no_themes_yet_derives_them(llm):
    result = await story_mode.build_primer(
        {"source_messages": [{"role": "user", "text": "Tell me about the prodigal son."}]}
    )
    assert result["type"] == "chat"
    assert result["data"]["themes"]
    assert "pick" in result["message"].lower()


async def test_build_primer_reports_when_no_themes_can_be_found(llm):
    llm.state["replies"] = ['{"themes": [], "digest": "Small talk, nothing to draw a lesson from."}']
    result = await story_mode.build_primer({"source_messages": [{"role": "user", "text": "hi"}]})
    assert result["type"] == "chat"
    assert "couldn't find a story" in result["message"].lower()
    assert result["data"] == {"themesRetry": True}


async def test_build_primer_reports_a_distinct_message_when_theme_derivation_fails(llm):
    llm.state["replies"] = [""]
    result = await story_mode.build_primer({"source_messages": [{"role": "user", "text": "hi"}]})
    assert result["type"] == "chat"
    assert "trouble right now" in result["message"].lower()
    assert "couldn't find a story" not in result["message"].lower()
    assert result["data"] == {"themesRetry": True}


async def test_build_primer_generates_the_story_once_themes_are_selected(llm):
    llm.state["replies"] = [_story_reply(
        title="The Brave Sparrow", pages=[{"text": "word " * 650, "scene": "A scene."}],
    )]
    themes = [{"id": "t1", "label": "Trusting God", "description": "..."}]
    result = await story_mode.build_primer({
        "story_themes": themes,
        "story_digest": "digest text",
        "story_selected_theme_ids": ["t1"],
        "story_age_range": "3-6",
    })
    assert result["artifacts"][0]["type"] == "story"
    params = result["artifacts"][0]["params"]
    assert params["title"] == "The Brave Sparrow"
    assert params["themes"] == ["Trusting God"]
    assert params["age_range"] == "3-6"
    assert params["cover"] == {"scene": "A cover scene.", "image_url": None}
    assert params["pages"] == [{"text": "word " * 650, "scene": "A scene.", "image_url": None}]


async def test_build_primer_defaults_age_range_when_missing(llm):
    llm.state["replies"] = [_story_reply(title="A Story")]
    themes = [{"id": "t1", "label": "Trusting God", "description": "..."}]
    result = await story_mode.build_primer({
        "story_themes": themes, "story_digest": "d", "story_selected_theme_ids": ["t1"],
    })
    assert result["artifacts"][0]["params"]["age_range"] == "3-6"


async def test_build_primer_with_stale_selected_ids_asks_to_choose_again(llm):
    result = await story_mode.build_primer({
        "story_themes": [{"id": "t1", "label": "Trust", "description": "..."}],
        "story_digest": "d",
        "story_selected_theme_ids": ["not-a-real-id"],
    })
    assert result["type"] == "chat"
    assert "choose again" in result["message"].lower()


async def test_build_primer_is_an_error_when_llm_is_unconfigured(monkeypatch):
    monkeypatch.setattr(story_mode, "llm_unconfigured_error", lambda: "LLM not configured.")
    result = await story_mode.build_primer({"source_messages": [{"role": "user", "text": "hi"}]})
    assert result["type"] == "error"


async def test_build_primer_guards_none_mode_params(monkeypatch):
    monkeypatch.setattr(story_mode, "llm_unconfigured_error", lambda: None)
    result = await story_mode.build_primer(None)
    assert result["type"] == "chat"


async def test_build_primer_returns_an_error_when_the_story_comes_back_empty(llm):
    # generate_story's initial attempt AND its one retry both come back
    # empty/unparseable — simple_completion() returns "" on any provider/
    # network/timeout failure rather than raising, so nothing upstream of
    # _story_turn would otherwise notice this is actually a failure.
    llm.state["replies"] = ["", ""]
    themes = [{"id": "t1", "label": "Trusting God", "description": "..."}]
    result = await story_mode.build_primer({
        "story_themes": themes, "story_digest": "d", "story_selected_theme_ids": ["t1"],
        "story_age_range": "3-6",
    })
    assert result["type"] == "error"
    assert "couldn't write the story" in result["message"].lower()
    assert "artifacts" not in result or not result.get("artifacts")


async def test_build_primer_returns_an_error_for_an_unrecognized_age_range_instead_of_raising(llm):
    themes = [{"id": "t1", "label": "Trusting God", "description": "..."}]
    result = await story_mode.build_primer({
        "story_themes": themes, "story_digest": "d", "story_selected_theme_ids": ["t1"],
        "story_age_range": "not-a-real-range",
    })
    assert result["type"] == "error"
    assert llm.calls == []
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pytest tests/chatbot/test_story_mode.py -v`
Expected: FAIL — `AttributeError: module 'chatbot.story_mode' has no attribute 'PAGE_COUNT_BANDS'` and assertion failures (old `generate_story` still returns the single-`text` shape).

- [ ] **Step 3: Rewrite `generate_story` and its prompt in `chatbot/story_mode.py`**

Replace the `AGE_WORD_BANDS`/`AGE_COMPLEXITY` block's neighbor — add right after `AGE_WORD_BANDS`:

```python
PAGE_COUNT_BANDS = {
    "3-6": (5, 6),
    "7-8": (7, 8),
    "9-10": (9, 10),
}
```

Replace `_STORY_SYSTEM_PROMPT` entirely with:

```python
_STORY_SYSTEM_PROMPT = (
    "You write short, warm, original children's stories that illustrate a "
    "lesson from a Bible conversation, without retelling the Bible "
    "passage itself or naming any real biblical figure. Invent your own "
    "characters instead — a child, an animal, or similar — the way a "
    "parable teaches through an original story rather than a dramatized "
    "retelling.\n\n"
    "Reply with ONLY a JSON object, no markdown fence, no commentary:\n"
    '{"title": "story title", "characters": "one line per named '
    'character: name - brief physical appearance, for a consistent '
    'illustration style", "cover_scene": "one sentence describing a '
    'cover illustration for the whole story", "pages": [{"text": "this '
    'page\'s story prose", "scene": "one sentence describing this '
    'page\'s illustration"}]}\n'
    "Split the story into short pages of roughly even length."
)
```

Replace `_story_prompt` entirely with:

```python
def _story_prompt(
    digest: str, themes: List[Dict[str, str]], age_range: str, low: int, high: int,
    page_low: int, page_high: int, name1: str, name2: str,
) -> str:
    theme_lines = "\n".join(f"- {t['label']}: {t['description']}" for t in themes)
    return (
        f"CONVERSATION SUMMARY: {digest}\n\n"
        f"THEME(S) TO WEAVE INTO ONE STORY:\n{theme_lines}\n\n"
        f"TARGET READER: age {age_range}. {AGE_COMPLEXITY[age_range]}\n"
        f"LENGTH: {low}-{high} words total, across {page_low}-{page_high} pages.\n"
        f"CHARACTER NAMES: give your two main characters these names — "
        f"{name1} and {name2} — assigning each to whichever role fits (a "
        f"child, an animal, or similar). Do not use any other names for "
        f"them. If the story truly needs another named character, pick a "
        f"name other than {name1}, {name2}, or \"Pip\" — vary your choices "
        f"instead of defaulting to a familiar storybook name."
    )
```

Delete `_TITLE_LINE_RE` and `_split_title` entirely (no longer used — replaced by the JSON parsing below).

Replace `generate_story` entirely with:

```python
def _parse_story(reply: str) -> Optional[Dict[str, Any]]:
    if not reply:
        return None
    parsed = _extract_json_object(reply)
    if not parsed:
        return None
    title = str(parsed.get("title", "")).strip() or "A Story for You"
    characters = str(parsed.get("characters", "")).strip()
    cover_scene = str(parsed.get("cover_scene", "")).strip()
    pages: List[Dict[str, str]] = []
    for raw in parsed.get("pages", []):
        if not isinstance(raw, dict):
            continue
        text = str(raw.get("text", "")).strip()
        if not text:
            continue
        pages.append({"text": text, "scene": str(raw.get("scene", "")).strip()})
    if not pages:
        return None
    return {"title": title, "characters": characters, "cover_scene": cover_scene, "pages": pages}


def _story_word_count(story: Optional[Dict[str, Any]]) -> int:
    if not story:
        return 0
    return sum(len(p["text"].split()) for p in story["pages"])


async def generate_story(digest: str, themes: List[Dict[str, str]], age_range: str) -> Dict[str, Any]:
    """A structured story — title, a one-line character-appearance
    description (for illustration consistency), a cover scene, and a list
    of short pages ({text, scene}) — sized to age_range's word and page
    bands and weaving every theme in `themes` together. Retries once, with
    a corrective instruction, if the summed word count lands far outside
    the target band — delivers the result either way rather than blocking
    the user. An empty `pages` list in the return value signals total
    failure (unparseable/empty reply on both attempts)."""
    if age_range not in AGE_WORD_BANDS:
        raise ValueError(f"Unknown story age range: {age_range!r}")
    low, high = AGE_WORD_BANDS[age_range]
    page_low, page_high = PAGE_COUNT_BANDS[age_range]
    name1, name2 = random.sample(CHARACTER_NAME_POOL, 2)

    prompt = _story_prompt(digest, themes, age_range, low, high, page_low, page_high, name1, name2)
    reply = await simple_completion(
        _STORY_SYSTEM_PROMPT, prompt, max_tokens=2400, timeout=STORY_LLM_TIMEOUT_SECONDS,
    )
    story = _parse_story(reply)
    word_count = _story_word_count(story)

    # Only retry when far outside the band (30% slack either way) — a
    # story a little short or long is still delivered as-is.
    if story is None or not (low * 0.7 <= word_count <= high * 1.3):
        corrective = (
            prompt
            + f"\n\nYour previous attempt was {word_count} words. Write again, "
            f"between {low} and {high} words total this time."
        )
        retry_reply = await simple_completion(
            _STORY_SYSTEM_PROMPT, corrective, max_tokens=2400, timeout=STORY_LLM_TIMEOUT_SECONDS,
        )
        retry_story = _parse_story(retry_reply)
        if retry_story is not None:
            story = retry_story
            word_count = _story_word_count(story)

    if story is None:
        return {"title": "", "characters": "", "cover_scene": "", "pages": [], "word_count": 0}
    return {**story, "word_count": word_count}
```

- [ ] **Step 4: Update `_story_turn`'s artifact shape**

In `_story_turn`, replace the empty-story check and the returned `artifacts` block:

```python
    try:
        story = await generate_story(digest, selected, age_range)
    except ValueError:
        return {
            "type": "error",
            "message": "Something went wrong with that age range — please pick one and try again.",
            "data": None,
            "route": "Mode primer → story → invalid age range",
        }
    if not story["pages"]:
        return {
            "type": "error",
            "message": "I couldn't write the story just now — please try again in a moment.",
            "data": None,
            "route": "Mode primer → story → generation failed",
        }
    theme_labels = [t["label"] for t in selected]
    return {
        "type": "chat",
        "message": f"Here's your story — **{story['title']}**.",
        "data": None,
        "route": "Mode primer → story → generated",
        "artifacts": [{
            "type": "story",
            "label": "Read the story ▸",
            "params": {
                "title": story["title"],
                "themes": theme_labels,
                "age_range": age_range,
                "word_count": story["word_count"],
                "characters": story["characters"],
                "cover": {"scene": story["cover_scene"], "image_url": None},
                "pages": [
                    {"text": p["text"], "scene": p["scene"], "image_url": None}
                    for p in story["pages"]
                ],
            },
        }],
    }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pytest tests/chatbot/test_story_mode.py -v`
Expected: PASS (all tests in the file)

- [ ] **Step 6: Run the full backend test suite to check for regressions**

Run: `pytest tests/ -v`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add chatbot/story_mode.py tests/chatbot/test_story_mode.py
git commit -m "feat(chatbot): generate Tell a Story as structured, age-scaled pages"
```

---

### Task 4: Frontend types and the `streamStoryIllustrations` client

**Files:**
- Modify: `frontend/src/types/session.ts`
- Modify: `frontend/src/lib/chatApi.ts`
- Modify: `frontend/src/lib/chatApi.test.ts`

**Interfaces:**
- Consumes (from Task 2): the `/story/illustrations` NDJSON contract.
- Produces: `interface StoryPage { text: string; scene: string; image_url: string | null }`, `interface StoryCover { scene: string; image_url: string | null }`, updated `interface StoryArtifactParams { title, themes, age_range, word_count, characters, cover: StoryCover, pages: StoryPage[] }` (in `types/session.ts`); `interface StoryIllustrationItem { index: number; image_url: string | null; error?: string | null }` and `async function* streamStoryIllustrations(payload: { characters: string; cover_scene: string; page_scenes: string[] }): AsyncGenerator<StoryIllustrationItem>` (in `lib/chatApi.ts`) — consumed by Task 5.

- [ ] **Step 1: Write the failing tests for `streamStoryIllustrations`**

In `frontend/src/lib/chatApi.test.ts`, add `streamStoryIllustrations` to the existing import block (line 2-13), then add a new `describe` block at the end of the file:

```ts
describe('streamStoryIllustrations', () => {
  it('yields one item per newline-delimited JSON line', async () => {
    mockStreamFetch([
      '{"index":-1,"image_url":"/story-images/a.png"}\n{"index":0,"image_url":"/story-images/b.png"}\n',
    ])
    const items = []
    for await (const item of streamStoryIllustrations({ characters: '', cover_scene: 'cover', page_scenes: ['p1'] })) {
      items.push(item)
    }
    expect(items).toEqual([
      { index: -1, image_url: '/story-images/a.png' },
      { index: 0, image_url: '/story-images/b.png' },
    ])
  })

  it('reassembles a line split across multiple read() chunks', async () => {
    mockStreamFetch(['{"index":-1,"ima', 'ge_url":"/story-images/a.png"}\n'])
    const items = []
    for await (const item of streamStoryIllustrations({ characters: '', cover_scene: 'cover', page_scenes: [] })) {
      items.push(item)
    }
    expect(items).toEqual([{ index: -1, image_url: '/story-images/a.png' }])
  })

  it('yields a trailing line with no terminating newline', async () => {
    mockStreamFetch(['{"index":0,"image_url":null,"error":"rate limited"}'])
    const items = []
    for await (const item of streamStoryIllustrations({ characters: '', cover_scene: 'cover', page_scenes: ['p1'] })) {
      items.push(item)
    }
    expect(items).toEqual([{ index: 0, image_url: null, error: 'rate limited' }])
  })

  it('posts to /api/bible-chat/story/illustrations with the given payload', async () => {
    mockStreamFetch(['{"index":-1,"image_url":"/story-images/a.png"}\n'])
    const payload = { characters: 'Zara: red hair.', cover_scene: 'A cover.', page_scenes: ['Page one.'] }
    for await (const _item of streamStoryIllustrations(payload)) {
      // drain the generator
    }
    expect(fetch).toHaveBeenCalledWith(
      '/api/bible-chat/story/illustrations',
      expect.objectContaining({ method: 'POST', body: JSON.stringify(payload) })
    )
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/chatApi.test.ts`
Expected: FAIL — `streamStoryIllustrations is not a function` (or a TypeScript import error).

- [ ] **Step 3: Add the types**

In `frontend/src/types/session.ts`, replace the existing `StoryArtifactParams` interface with:

```ts
export interface StoryPage {
  text: string
  scene: string
  image_url: string | null
}

export interface StoryCover {
  scene: string
  image_url: string | null
}

/** Params for a `story`-type ArtifactLink — the finished story travels
 * inline (no fetch when the pane opens it), as the devotional and
 * hermeneutics report do. Illustrations are fetched separately by
 * StoryReaderOverlay via streamStoryIllustrations — `cover.image_url`
 * and each page's `image_url` start null and are filled in client-side,
 * never persisted back onto this object's source message. Field names
 * match the backend's dict verbatim (snake_case) — ArtifactLink params
 * are never passed through toWireModeParams's camelCase mapping, unlike
 * ModeParams. */
export interface StoryArtifactParams {
  title: string
  themes: string[]
  age_range: string
  word_count: number
  characters: string
  cover: StoryCover
  pages: StoryPage[]
}
```

- [ ] **Step 4: Add `streamStoryIllustrations` to `chatApi.ts`**

In `frontend/src/lib/chatApi.ts`, add near `postDevotionalAudio`:

```ts
export interface StoryIllustrationItem {
  index: number
  image_url: string | null
  error?: string | null
}

interface StoryIllustrationsPayload {
  characters: string
  cover_scene: string
  page_scenes: string[]
}

export async function* streamStoryIllustrations(
  payload: StoryIllustrationsPayload,
): AsyncGenerator<StoryIllustrationItem> {
  const res = await fetch(`${CHAT_API}/story/illustrations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok || !res.body) return

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let newlineIndex = buffer.indexOf('\n')
    while (newlineIndex >= 0) {
      const line = buffer.slice(0, newlineIndex).trim()
      buffer = buffer.slice(newlineIndex + 1)
      if (line) yield JSON.parse(line) as StoryIllustrationItem
      newlineIndex = buffer.indexOf('\n')
    }
  }
  const trailing = buffer.trim()
  if (trailing) yield JSON.parse(trailing) as StoryIllustrationItem
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/lib/chatApi.test.ts`
Expected: PASS (all tests in the file, including the 4 new ones)

- [ ] **Step 6: Commit**

```bash
git add frontend/src/types/session.ts frontend/src/lib/chatApi.ts frontend/src/lib/chatApi.test.ts
git commit -m "feat(frontend): add story page/illustration types and NDJSON streaming client"
```

---

### Task 5: `StoryReaderOverlay` full-screen page-flip reader

**Files:**
- Create: `frontend/src/components/artifacts/StoryReaderOverlay.tsx`
- Create: `frontend/src/components/artifacts/StoryReaderOverlay.test.tsx`
- Modify: `frontend/src/index.css` (add `.story-reader-bg`)

**Interfaces:**
- Consumes (from Task 4): `StoryArtifactParams`, `StoryCover`, `StoryPage` (types), `streamStoryIllustrations` (function).
- Produces: `interface StoryReaderOverlayProps { artifact: StoryArtifactParams; open: boolean; onClose: () => void }`, `function StoryReaderOverlay(props: StoryReaderOverlayProps): JSX.Element` — consumed by Task 6.

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/components/artifacts/StoryReaderOverlay.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StoryReaderOverlay } from './StoryReaderOverlay'
import type { StoryArtifactParams } from '@/types/session'

const { streamStoryIllustrations } = vi.hoisted(() => ({ streamStoryIllustrations: vi.fn() }))
vi.mock('@/lib/chatApi', () => ({ streamStoryIllustrations }))

async function* emptyStream() {}

const artifact: StoryArtifactParams = {
  title: 'The Brave Little Sparrow',
  themes: ['Trusting God'],
  age_range: '7-8',
  word_count: 40,
  characters: 'Sparrow: small and brown.',
  cover: { scene: 'The sparrow on a branch.', image_url: null },
  pages: [
    { text: 'Page one text.', scene: 'Scene one.', image_url: null },
    { text: 'Page two text.', scene: 'Scene two.', image_url: null },
  ],
}

describe('StoryReaderOverlay', () => {
  it('shows the cover page with title and badges when opened', () => {
    streamStoryIllustrations.mockReturnValue(emptyStream())
    render(<StoryReaderOverlay artifact={artifact} open onClose={() => {}} />)
    expect(screen.getAllByText('The Brave Little Sparrow').length).toBeGreaterThan(0)
    expect(screen.getByText('Ages 7-8')).toBeInTheDocument()
    expect(screen.getByText('Cover')).toBeInTheDocument()
  })

  it('navigates to the next page and shows its text and position', async () => {
    streamStoryIllustrations.mockReturnValue(emptyStream())
    render(<StoryReaderOverlay artifact={artifact} open onClose={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: 'Next page' }))
    expect(screen.getByText('Page one text.')).toBeInTheDocument()
    expect(screen.getByText('1 / 2')).toBeInTheDocument()
  })

  it('disables Previous on the cover and Next on the last page', async () => {
    streamStoryIllustrations.mockReturnValue(emptyStream())
    render(<StoryReaderOverlay artifact={artifact} open onClose={() => {}} />)
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Next page' }))
    await userEvent.click(screen.getByRole('button', { name: 'Next page' }))
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled()
  })

  it('fetches illustrations on open and fills in the cover image as it arrives', async () => {
    async function* stream() {
      yield { index: -1, image_url: '/story-images/cover.png' }
      yield { index: 0, image_url: '/story-images/page0.png' }
    }
    streamStoryIllustrations.mockReturnValue(stream())
    const { container } = render(<StoryReaderOverlay artifact={artifact} open onClose={() => {}} />)
    await waitFor(() => {
      expect(container.querySelector('img')?.getAttribute('src')).toBe('/story-images/cover.png')
    })
  })

  it('shows an "illustration unavailable" state for a page whose image failed', async () => {
    async function* stream() {
      yield { index: 0, image_url: null, error: 'rate limited' }
    }
    streamStoryIllustrations.mockReturnValue(stream())
    render(<StoryReaderOverlay artifact={artifact} open onClose={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: 'Next page' }))
    expect(await screen.findByRole('img', { name: 'Illustration unavailable' })).toBeInTheDocument()
  })

  it('does not fetch illustrations when every image is already resolved', () => {
    streamStoryIllustrations.mockReturnValue(emptyStream())
    const resolved: StoryArtifactParams = {
      ...artifact,
      cover: { ...artifact.cover, image_url: '/story-images/cover.png' },
      pages: artifact.pages.map((p) => ({ ...p, image_url: '/story-images/page.png' })),
    }
    render(<StoryReaderOverlay artifact={resolved} open onClose={() => {}} />)
    expect(streamStoryIllustrations).not.toHaveBeenCalled()
  })

  it('ignores a stale in-flight fetch after the overlay is closed and reopened', async () => {
    let resolveFirst!: (item: { index: number; image_url: string }) => void
    const firstStream = (async function* () {
      yield await new Promise<{ index: number; image_url: string }>((resolve) => {
        resolveFirst = resolve
      })
    })()
    streamStoryIllustrations.mockReturnValueOnce(firstStream)
    streamStoryIllustrations.mockReturnValueOnce(emptyStream())

    const { rerender, container } = render(
      <StoryReaderOverlay artifact={artifact} open onClose={() => {}} />
    )
    rerender(<StoryReaderOverlay artifact={artifact} open={false} onClose={() => {}} />)
    rerender(<StoryReaderOverlay artifact={artifact} open onClose={() => {}} />)

    resolveFirst({ index: -1, image_url: '/story-images/stale.png' })
    await new Promise((r) => setTimeout(r, 0))

    expect(container.querySelector('img')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/artifacts/StoryReaderOverlay.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the component**

Create `frontend/src/components/artifacts/StoryReaderOverlay.tsx`:

```tsx
import { useEffect, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { ArrowLeft, ArrowRight, ImageOff } from 'lucide-react'
import { streamStoryIllustrations } from '@/lib/chatApi'
import type { StoryArtifactParams, StoryCover, StoryPage } from '@/types/session'

export interface StoryReaderOverlayProps {
  artifact: StoryArtifactParams
  open: boolean
  onClose: () => void
}

const AGE_RANGE_LABELS: Record<string, string> = {
  '3-6': 'Ages 3-6',
  '7-8': 'Ages 7-8',
  '9-10': 'Ages 9-10',
}

export function StoryReaderOverlay({ artifact, open, onClose }: StoryReaderOverlayProps) {
  const [cover, setCover] = useState<StoryCover>(artifact.cover)
  const [pages, setPages] = useState<StoryPage[]>(artifact.pages)
  const [pageIndex, setPageIndex] = useState(0)
  const [failedIndexes, setFailedIndexes] = useState<Set<number>>(new Set())

  useEffect(() => {
    if (!open) return
    setCover(artifact.cover)
    setPages(artifact.pages)
    setPageIndex(0)
    setFailedIndexes(new Set())
  }, [open, artifact])

  useEffect(() => {
    if (!open) return
    const needsImages = !artifact.cover.image_url || artifact.pages.some((p) => !p.image_url)
    if (!needsImages) return

    let cancelled = false

    async function run() {
      for await (const item of streamStoryIllustrations({
        characters: artifact.characters,
        cover_scene: artifact.cover.scene,
        page_scenes: artifact.pages.map((p) => p.scene),
      })) {
        if (cancelled) break
        if (item.index === -1) {
          if (item.image_url) {
            setCover((c) => ({ ...c, image_url: item.image_url }))
          } else {
            setFailedIndexes((prev) => new Set(prev).add(-1))
          }
          continue
        }
        if (item.image_url) {
          const url = item.image_url
          setPages((prev) => prev.map((p, i) => (i === item.index ? { ...p, image_url: url } : p)))
        } else {
          setFailedIndexes((prev) => new Set(prev).add(item.index))
        }
      }
    }

    run()
    return () => {
      cancelled = true
    }
  }, [open, artifact])

  const totalPages = pages.length
  const onCover = pageIndex === 0
  const currentPage = onCover ? null : pages[pageIndex - 1]
  const currentImageUrl = onCover ? cover.image_url : (currentPage?.image_url ?? null)
  const currentFailed = failedIndexes.has(onCover ? -1 : pageIndex - 1)

  function goPrev() {
    setPageIndex((i) => Math.max(0, i - 1))
  }
  function goNext() {
    setPageIndex((i) => Math.min(totalPages, i + 1))
  }

  useEffect(() => {
    if (!open) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'ArrowLeft') goPrev()
      if (e.key === 'ArrowRight') goNext()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, totalPages])

  return (
    <Dialog.Root open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 story-reader-bg" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed inset-0 z-50 flex flex-col items-center gap-4 p-6 focus:outline-none story-reader-bg"
        >
          <Dialog.Title className="text-sm font-semibold tracking-tight text-white/90">
            {artifact.title}
          </Dialog.Title>

          <div className="flex-1 min-h-0 w-full max-w-2xl flex flex-col items-center gap-4 overflow-y-auto">
            <div className="w-full aspect-[4/3] rounded-xl bg-white/10 flex items-center justify-center overflow-hidden shrink-0">
              {currentImageUrl ? (
                <img src={currentImageUrl} alt="" className="w-full h-full object-cover" />
              ) : currentFailed ? (
                <div role="img" aria-label="Illustration unavailable" className="flex items-center justify-center">
                  <ImageOff className="h-8 w-8 text-white/50" aria-hidden="true" />
                </div>
              ) : (
                <div
                  role="status"
                  aria-label="Loading illustration"
                  className="h-8 w-8 rounded-full border-2 border-white/40 border-t-white animate-spin"
                />
              )}
            </div>

            {onCover ? (
              <div className="flex flex-wrap items-center gap-1.5 text-xs text-white/70">
                <span className="px-2 py-0.5 rounded-full border border-white/30">
                  {AGE_RANGE_LABELS[artifact.age_range] ?? artifact.age_range}
                </span>
                {artifact.themes.map((theme) => (
                  <span key={theme} className="px-2 py-0.5 rounded-full border border-white/30">
                    {theme}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-white text-lg leading-relaxed whitespace-pre-wrap px-2">
                {currentPage?.text}
              </p>
            )}
          </div>

          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={goPrev}
              disabled={onCover}
              aria-label="Previous page"
              className="flex h-9 w-9 items-center justify-center rounded-full bg-white/20 text-white transition-opacity disabled:opacity-30 hover:bg-white/30"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            </button>
            <span className="text-xs text-white/70">{onCover ? 'Cover' : `${pageIndex} / ${totalPages}`}</span>
            <button
              type="button"
              onClick={goNext}
              disabled={pageIndex >= totalPages}
              aria-label="Next page"
              className="flex h-9 w-9 items-center justify-center rounded-full bg-white/20 text-white transition-opacity disabled:opacity-30 hover:bg-white/30"
            >
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>

          <Dialog.Close asChild>
            <button
              type="button"
              aria-label="Done"
              className="text-xs px-3 py-1.5 rounded border border-white/30 text-white/90 hover:bg-white/10"
            >
              Done
            </button>
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
```

- [ ] **Step 4: Add the `.story-reader-bg` CSS**

In `frontend/src/index.css`, right after the `.devotional-listen-bg` rule block (after its closing `}`, before the "Hebrew/Greek word element" comment):

```css
@keyframes story-reader-gradient {
  0% { background-position: 0% 0%, 0% 50%; }
  50% { background-position: 0% 0%, 100% 50%; }
  100% { background-position: 0% 0%, 0% 50%; }
}

/* Same technique as .devotional-listen-bg (see its comment above) — a
   dark scrim over an animated themed gradient keeps white reader text
   legible across every reader theme. */
.story-reader-bg {
  background:
    linear-gradient(rgba(0, 0, 0, 0.65), rgba(0, 0, 0, 0.65)),
    linear-gradient(
      120deg,
      var(--color-surface),
      var(--color-accent-dark),
      var(--color-surface-alt),
      var(--color-accent)
    );
  background-size: 100% 100%, 300% 300%;
  animation: story-reader-gradient 20s ease-in-out infinite;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/components/artifacts/StoryReaderOverlay.test.tsx`
Expected: PASS (7 tests)

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/artifacts/StoryReaderOverlay.tsx frontend/src/components/artifacts/StoryReaderOverlay.test.tsx frontend/src/index.css
git commit -m "feat(frontend): add full-screen page-flip StoryReaderOverlay"
```

---

### Task 6: Wire `StoryArtifact` to the new reader and page structure

**Files:**
- Modify: `frontend/src/components/artifacts/StoryArtifact.tsx`
- Modify: `frontend/src/components/artifacts/StoryArtifact.test.tsx`

**Interfaces:**
- Consumes (from Task 4): updated `StoryArtifactParams`. Consumes (from Task 5): `StoryReaderOverlay`.

- [ ] **Step 1: Replace the tests**

Replace `frontend/src/components/artifacts/StoryArtifact.test.tsx` entirely:

```tsx
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StoryArtifact } from './StoryArtifact'
import type { StoryArtifactParams } from '@/types/session'

const { streamStoryIllustrations } = vi.hoisted(() => ({ streamStoryIllustrations: vi.fn() }))
vi.mock('@/lib/chatApi', () => ({ streamStoryIllustrations }))

async function* emptyStream() {}

const props: StoryArtifactParams = {
  title: 'The Brave Little Sparrow',
  themes: ['Trusting God', 'Coming home'],
  age_range: '7-8',
  word_count: 850,
  characters: 'Sparrow: small and brown.',
  cover: { scene: 'The sparrow on a branch.', image_url: null },
  pages: [
    { text: 'Once upon a time, a small sparrow learned to trust the wind.', scene: 'A scene.', image_url: null },
    { text: 'It flew home at last.', scene: 'Another scene.', image_url: null },
  ],
}

describe('StoryArtifact', () => {
  it('renders the title, age badge, theme chips, first page and word count', () => {
    streamStoryIllustrations.mockReturnValue(emptyStream())
    render(<StoryArtifact {...props} />)
    expect(screen.getByText('The Brave Little Sparrow')).toBeInTheDocument()
    expect(screen.getByText('Ages 7-8')).toBeInTheDocument()
    expect(screen.getByText('Trusting God')).toBeInTheDocument()
    expect(screen.getByText('Coming home')).toBeInTheDocument()
    expect(screen.getByText(/small sparrow learned to trust/)).toBeInTheDocument()
    expect(screen.getByText('850 words')).toBeInTheDocument()
  })

  it("copies every page's text, joined, to the clipboard", async () => {
    streamStoryIllustrations.mockReturnValue(emptyStream())
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    render(<StoryArtifact {...props} />)
    await userEvent.click(screen.getByRole('button', { name: /copy story/i }))
    expect(writeText).toHaveBeenCalledWith(
      'Once upon a time, a small sparrow learned to trust the wind.\n\nIt flew home at last.'
    )
  })

  it('opens the full-screen reader when "Read full screen" is clicked', async () => {
    streamStoryIllustrations.mockReturnValue(emptyStream())
    render(<StoryArtifact {...props} />)
    expect(screen.queryByText('Cover')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /read full screen/i }))
    expect(screen.getByText('Cover')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/artifacts/StoryArtifact.test.tsx`
Expected: FAIL — `props.pages` undefined (component still destructures the old `text` field), "Read full screen" button not found.

- [ ] **Step 3: Rewrite the component**

Replace `frontend/src/components/artifacts/StoryArtifact.tsx` entirely:

```tsx
import { useState } from 'react'
import { BookOpen, Check, Copy } from 'lucide-react'
import { renderMarkdown } from '@/lib/renderMarkdown'
import { StoryReaderOverlay } from './StoryReaderOverlay'
import type { StoryArtifactParams } from '@/types/session'

const AGE_RANGE_LABELS: Record<string, string> = {
  '3-6': 'Ages 3-6',
  '7-8': 'Ages 7-8',
  '9-10': 'Ages 9-10',
}

export function StoryArtifact(props: StoryArtifactParams) {
  const { title, themes, age_range, word_count, pages } = props
  const [copied, setCopied] = useState(false)
  const [readerOpen, setReaderOpen] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(pages.map((p) => p.text).join('\n\n'))
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard access can be denied by the browser; nothing useful to
      // do beyond leaving the copy affordance unconfirmed.
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setReaderOpen(true)}
            aria-label="Read full screen"
            title="Read full screen"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-alt)] hover:text-[var(--color-text-primary)]"
          >
            <BookOpen className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          <button
            onClick={copy}
            aria-label="Copy story"
            title="Copy"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-alt)] hover:text-[var(--color-text-primary)]"
          >
            {copied ? (
              <Check className="h-3.5 w-3.5 text-[var(--color-green)]" aria-hidden="true" />
            ) : (
              <Copy className="h-3.5 w-3.5" aria-hidden="true" />
            )}
          </button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-xs text-[var(--color-text-secondary)]">
        <span className="px-2 py-0.5 rounded-full border border-[var(--color-theme-border)]">
          {AGE_RANGE_LABELS[age_range] ?? age_range}
        </span>
        {themes.map((theme) => (
          <span key={theme} className="px-2 py-0.5 rounded-full border border-[var(--color-theme-border)]">
            {theme}
          </span>
        ))}
      </div>
      <div className="text-sm leading-relaxed max-w-prose">{renderMarkdown(pages[0]?.text ?? '')}</div>
      <p className="text-xs text-[var(--color-text-secondary)]">{word_count} words</p>
      <StoryReaderOverlay artifact={props} open={readerOpen} onClose={() => setReaderOpen(false)} />
    </div>
  )
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/components/artifacts/StoryArtifact.test.tsx`
Expected: PASS (3 tests)

- [ ] **Step 5: Run the full frontend test suite to check for regressions**

Run: `npx vitest run`
Expected: PASS (no regressions in unrelated files — `ArtifactPane.tsx` needs no change since it spreads `StoryArtifactParams` generically)

- [ ] **Step 6: Run the TypeScript compiler**

Run: `npx tsc --noEmit`
Expected: No errors (confirms no other file still references the removed `StoryArtifactParams.text` field)

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/artifacts/StoryArtifact.tsx frontend/src/components/artifacts/StoryArtifact.test.tsx
git commit -m "feat(frontend): open the illustrated story reader from StoryArtifact"
```
