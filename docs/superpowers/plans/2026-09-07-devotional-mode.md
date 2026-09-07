# Devotional Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Devotional" study mode that turns a user-supplied verse/theme (or an LLM-picked verse) into a streamed 1,200–1,600 word devotional, shown as a seed-verse bubble plus a link that opens the finished text in the artifact pane.

**Architecture:** A new `chatbot/devotional.py` module resolves the seed verse (explicit reference, theme → LLM pick, or fallback list) and streams the devotional from the configured LLM using a fixed prompt. `chatbot/api.py`'s SSE handler gains a `devotional` branch that runs the generation; the buffered `/chat` handler returns only the short pill-selection primer via `build_mode_primer`. The React frontend adds the mode, a starter with two choice pills, an auto-fire for the "system" path, and a `DevotionalArtifact` view; the finished devotional text rides on the chat message and in the artifact link's params (no second network call).

**Tech Stack:** Python 3.13, FastAPI, httpx, pytest / pytest-asyncio (backend); React 18 + TypeScript, Zustand, Vite, Vitest + Testing Library (frontend).

**Spec:** `docs/superpowers/specs/2026-09-07-devotional-mode-design.md`

## Global Constraints

- **Seed-verse translation:** KJV only, from the existing `fetch_verse_translations(ref, languages=["eng"])`. No translation picker for the seed verse.
- **Devotional length target in the prompt:** 1,200–1,600 words (verbatim in `DEVOTIONAL_PROMPT_TEMPLATE`).
- **`max_tokens`:** default stays `2048` for every existing LLM call; the streamed devotional call passes `3600`; the theme→verse pick call passes `64`.
- **Fallback verse rotation (exact, USFM):** `["JHN 14:27", "PSA 23:1", "ISA 41:10", "ROM 8:28", "PHP 4:6-7", "MAT 11:28"]`.
- **Artifact link label (exact):** `"Read the devotional ▸"` (note the `▸` U+25B8 and the leading space before it in "the devotional ▸" — copy verbatim).
- **`ArtifactLink['type']` string:** `'devotional'`.
- **`SessionMode` value:** `'devotional'`; **`MODE_LABELS` label:** `'Devotional'`.
- **`ModeParams` additions:** `source?: 'user' | 'system'`, `delivered?: boolean`.
- **`delivered` is set to `true` only after a *successful* generating turn** (resolved result whose `type` is not `'error'`), never after an error, so the user can retry.
- **No follow-up chips** on the devotional turn: the `final` result carries no `follow_up_questions` (omit the key or set `[]`).
- **Backend test command:** `python -m pytest tests/chatbot/<file> -v` (repo root; `pytest.ini` sets `pythonpath = .`, `asyncio_mode = auto`).
- **Frontend test command:** `cd frontend && npx vitest run <path>` (Vitest config lives in `frontend/vite.config.ts`).
- **Commit after every task.** Conventional-commit prefixes (`feat:`, `test:`, `feat(chat):` …) as in recent history. End commit messages with the two trailer lines used in this repo:
  ```
  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_0118MhC6UKx3em8wQyt2Wzsa
  ```

---

## File Structure

**Backend**

| File | Responsibility |
|---|---|
| `chatbot/ollama_client.py` (modify) | `max_tokens` kwarg on `_build_request`; two new explicit-prompt helpers: `simple_completion` (non-streamed) and `stream_devotional_completion` (streamed) |
| `chatbot/devotional.py` (**new**) | Prompt template, `DevotionalError`, `FALLBACK_VERSES`, `build_devotional_prompt`, `pick_verse_for_theme`, `resolve_seed_verse`, `stream_devotional` |
| `chatbot/router.py` (modify) | `build_mode_primer` gains a `devotional` case (pill-selection primer text only) |
| `chatbot/api.py` (modify) | `_stream_chat_response` gains a `devotional` generating branch, before the empty-message primer block |
| `chatbot/schemas.py` (modify) | `ChatRequest.mode` description mentions `devotional` |

**Frontend**

| File | Responsibility |
|---|---|
| `frontend/src/types/session.ts` (modify) | `SessionMode` + `'devotional'`; `ModeParams` + `source`/`delivered`; `ArtifactLink['type']` + `'devotional'`; new `DevotionalArtifactParams` |
| `frontend/src/store/useSessionsStore.ts` (modify) | `MODE_LABELS.devotional` |
| `frontend/src/components/shell/ModePickerScreen.tsx` (modify) | "Devotional" starter button → `startWithChoices` with two pills |
| `frontend/src/store/useArtifactStore.ts` (modify) | `fetchForLink` → `case 'devotional'` (pass-through, no fetch) |
| `frontend/src/components/artifacts/DevotionalArtifact.tsx` (**new**) | Reference heading + `renderMarkdown(text)` + copy button |
| `frontend/src/components/shell/ArtifactPane.tsx` (modify) | Render `<DevotionalArtifact>` for `type === 'devotional'` |
| `frontend/src/components/shell/ChatPane.tsx` (modify) | Devotional-aware `streamAssistantReply`; `generateDevotional`; auto-fire `useEffect`; set `delivered` after a successful turn |

---

## Task 1: LLM client — `max_tokens` kwarg + explicit-prompt helpers

**Files:**
- Modify: `chatbot/ollama_client.py`
- Test: `tests/chatbot/test_ollama_client_devotional.py` (new)

**Interfaces:**
- Consumes: existing module internals `_build_request`, `_llm_config`, `_extract_content`, `_stream_delta`, `llm_unconfigured_error`, `active_model_label`, `record_llm`, `httpx`.
- Produces:
  - `_build_request(messages, *, stream, max_tokens: int = 2048) -> tuple[str, str, dict, dict]` — unchanged call sites keep 2048.
  - `async def simple_completion(system_prompt: str, user_prompt: str, *, max_tokens: int = 2048) -> str` — returns model text, or `""` on unconfigured provider / any HTTP or parse error.
  - `async def stream_devotional_completion(system_prompt: str, user_prompt: str, *, max_tokens: int = 3600) -> AsyncIterator[dict]` — yields `{"type": "stream", "chunk": str}` zero+ times, then `{"type": "done"}`; or a single `{"type": "error", "message": str}` and stops.

- [ ] **Step 1: Write the failing tests**

Create `tests/chatbot/test_ollama_client_devotional.py`:

```python
import pytest

from chatbot import ollama_client


def test_build_request_default_max_tokens_is_2048():
    _p, _u, _h, payload = ollama_client._build_request(
        [{"role": "user", "content": "hi"}], stream=False
    )
    # ollama nests sampling params under "options"; nvidia puts them top-level
    got = payload.get("options", payload).get("max_tokens")
    assert got == 2048


def test_build_request_accepts_max_tokens_override():
    _p, _u, _h, payload = ollama_client._build_request(
        [{"role": "user", "content": "hi"}], stream=True, max_tokens=3600
    )
    got = payload.get("options", payload).get("max_tokens")
    assert got == 3600


@pytest.mark.asyncio
async def test_simple_completion_returns_text(monkeypatch):
    monkeypatch.setattr(ollama_client, "llm_unconfigured_error", lambda: None)

    class FakeResp:
        def raise_for_status(self): pass
        def json(self): return {"message": {"content": "John 14:27"}}

    class FakeClient:
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        async def post(self, *a, **k): return FakeResp()

    monkeypatch.setattr(ollama_client.httpx, "AsyncClient", lambda *a, **k: FakeClient())
    out = await ollama_client.simple_completion("sys", "user", max_tokens=64)
    assert out == "John 14:27"


@pytest.mark.asyncio
async def test_simple_completion_swallows_errors(monkeypatch):
    monkeypatch.setattr(ollama_client, "llm_unconfigured_error", lambda: None)

    class FakeClient:
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        async def post(self, *a, **k): raise ollama_client.httpx.HTTPError("boom")

    monkeypatch.setattr(ollama_client.httpx, "AsyncClient", lambda *a, **k: FakeClient())
    assert await ollama_client.simple_completion("sys", "user") == ""


@pytest.mark.asyncio
async def test_simple_completion_empty_when_unconfigured(monkeypatch):
    monkeypatch.setattr(ollama_client, "llm_unconfigured_error", lambda: "no key")
    assert await ollama_client.simple_completion("sys", "user") == ""


@pytest.mark.asyncio
async def test_stream_devotional_completion_yields_chunks_then_done(monkeypatch):
    monkeypatch.setattr(ollama_client, "llm_unconfigured_error", lambda: None)

    class FakeStreamResp:
        def raise_for_status(self): pass
        async def aiter_lines(self):
            import json as _j
            yield _j.dumps({"message": {"content": "Peace "}})
            yield _j.dumps({"message": {"content": "I leave"}})
            yield _j.dumps({"done": True})

    class FakeStreamCtx:
        async def __aenter__(self): return FakeStreamResp()
        async def __aexit__(self, *a): return False

    class FakeClient:
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        def stream(self, *a, **k): return FakeStreamCtx()

    monkeypatch.setattr(ollama_client.httpx, "AsyncClient", lambda *a, **k: FakeClient())
    events = [e async for e in ollama_client.stream_devotional_completion("sys", "user")]
    assert [e["type"] for e in events] == ["stream", "stream", "done"]
    assert "".join(e["chunk"] for e in events if e["type"] == "stream") == "Peace I leave"


@pytest.mark.asyncio
async def test_stream_devotional_completion_emits_error_when_unconfigured(monkeypatch):
    monkeypatch.setattr(ollama_client, "llm_unconfigured_error", lambda: "no key")
    events = [e async for e in ollama_client.stream_devotional_completion("s", "u")]
    assert events == [{"type": "error", "message": "no key"}]
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python -m pytest tests/chatbot/test_ollama_client_devotional.py -v`
Expected: FAIL — `test_build_request_default_max_tokens_is_2048` may pass by luck (current code hard-codes 2048), the override test FAILs with `TypeError: _build_request() got an unexpected keyword argument 'max_tokens'`, and the `simple_completion` / `stream_devotional_completion` tests FAIL with `AttributeError`.

- [ ] **Step 3: Add the `max_tokens` kwarg to `_build_request`**

In `chatbot/ollama_client.py`, change the signature and both payload branches:

```python
def _build_request(messages, *, stream, max_tokens: int = 2048):
    """(provider, url, headers, payload) for a chat call to the active provider."""
    provider, base_url, model, api_key = _llm_config()
    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    if provider == "nvidia":
        url = f"{base_url}/chat/completions"
        payload = {
            "model": model,
            "messages": messages,
            "stream": stream,
            "temperature": 0.7,
            "max_tokens": max_tokens,
        }
    else:
        url = f"{base_url}/api/chat"
        payload = {
            "model": model,
            "messages": messages,
            "stream": stream,
            "options": {
                "temperature": 0.7,
                "max_tokens": max_tokens,
            },
        }
    return provider, url, headers, payload
```

- [ ] **Step 4: Add `simple_completion` and `stream_devotional_completion`**

Append to `chatbot/ollama_client.py` (after `stream_chat_with_ollama`):

```python
# ---------------------------------------------------------------------------
# Explicit-prompt helpers (no research-data assembly, no history) — used by
# Devotional mode. `simple_completion` for the short theme→verse pick,
# `stream_devotional_completion` for the long devotional itself.
# ---------------------------------------------------------------------------

async def simple_completion(
    system_prompt: str, user_prompt: str, *, max_tokens: int = 2048
) -> str:
    """One non-streamed completion from an explicit system + user prompt.
    Returns the model's text, or "" on an unconfigured provider or any HTTP
    / parse error (callers treat "" as "no usable answer")."""
    if llm_unconfigured_error():
        return ""
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt},
    ]
    provider, url, headers, payload = _build_request(
        messages, stream=False, max_tokens=max_tokens
    )
    async with httpx.AsyncClient() as client:
        try:
            response = await client.post(url, headers=headers, json=payload, timeout=60.0)
            response.raise_for_status()
            result = response.json()
        except Exception:  # noqa: BLE001 — any failure means "no answer"
            return ""
    content, error = _extract_content(provider, result)
    if error or not content:
        return ""
    return content


async def stream_devotional_completion(
    system_prompt: str, user_prompt: str, *, max_tokens: int = 3600
) -> AsyncIterator[Dict[str, Any]]:
    """Stream a long-form completion from an explicit system + user prompt.
    Yields {"type": "stream", "chunk": str} zero or more times, then
    {"type": "done"}; or yields exactly one {"type": "error", "message": str}
    and stops. Bytes flow the whole time so a proxy / idle-connection
    timeout can't drop a multi-minute generation."""
    err = llm_unconfigured_error()
    if err:
        yield {"type": "error", "message": err}
        return

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt},
    ]
    provider, url, headers, payload = _build_request(
        messages, stream=True, max_tokens=max_tokens
    )
    llm_request = {
        "system": system_prompt,
        "messages": messages,
        "params": {k: v for k, v in payload.items() if k != "messages"},
    }

    with record_llm(active_model_label(), llm_request) as _step:
        accumulated = ""
        async with httpx.AsyncClient() as client:
            try:
                async with client.stream(
                    "POST", url, headers=headers, json=payload, timeout=300.0
                ) as response:
                    response.raise_for_status()
                    done_sent = False
                    async for line in response.aiter_lines():
                        parsed = _stream_delta(provider, line)
                        if parsed is None:
                            continue
                        kind, text = parsed
                        if kind == "done":
                            done_sent = True
                            _step.set_response(accumulated)
                            yield {"type": "done"}
                            break
                        if text:
                            accumulated += text
                            yield {"type": "stream", "chunk": text}
                    if not done_sent:
                        _step.set_response(accumulated)
                        yield {"type": "done"}
            except httpx.HTTPError as e:
                detail = str(e) or type(e).__name__
                _step.set_error(f"LLM API error: {detail}")
                yield {"type": "error", "message": f"LLM API error: {detail}"}
            except Exception as e:  # noqa: BLE001
                _step.set_error(f"{type(e).__name__}: {e}")
                yield {"type": "error", "message": f"LLM error: {type(e).__name__}: {e}"}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `python -m pytest tests/chatbot/test_ollama_client_devotional.py -v`
Expected: PASS (7 tests).

- [ ] **Step 6: Run the full chatbot suite for regressions**

Run: `python -m pytest tests/chatbot -q`
Expected: PASS — no existing test touches `_build_request`'s new kwarg.

- [ ] **Step 7: Commit**

```bash
git add chatbot/ollama_client.py tests/chatbot/test_ollama_client_devotional.py
git commit -m "feat(chatbot): explicit-prompt LLM helpers + max_tokens override

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0118MhC6UKx3em8wQyt2Wzsa"
```

---

## Task 2: `chatbot/devotional.py` — prompt, seed-verse resolution, theme pick

**Files:**
- Create: `chatbot/devotional.py`
- Test: `tests/chatbot/test_devotional_resolve.py` (new)

**Interfaces:**
- Consumes:
  - `chatbot.router._resolve_verse_reference(text) -> Optional[str]` (e.g. `"John 3:16"` → `"JHN 3:16"`, `"1 Thess 4:13-18"` → `"1TH 4:13-18"`; `None` if not a reference).
  - `chatbot.tools.fetch_verse_translations(reference, languages=["eng"]) -> dict` (single verse only; returns `{}` on miss; keys look like `"eng-KJV"`).
  - `chatbot.router._find_flexible_verse_refs(text) -> list[tuple]`, `chatbot.router._format_reference(full, book, chapter, verse, verse_end) -> str`.
  - `chatbot.ollama_client.simple_completion`, `chatbot.ollama_client.llm_unconfigured_error` (from Task 1).
- Produces:
  - `class DevotionalError(Exception)`.
  - `FALLBACK_VERSES: list[str]` (the Global Constraints rotation).
  - `DEVOTIONAL_SYSTEM_PROMPT: str`, `DEVOTIONAL_PROMPT_TEMPLATE: str`.
  - `build_devotional_prompt(reference: str, verse_text: str) -> str`.
  - `async def pick_verse_for_theme(theme: Optional[str]) -> str` — a USFM reference string, always non-empty (LLM pick, one retry, then `random.choice(FALLBACK_VERSES)`).
  - `async def resolve_seed_verse(raw: Optional[str], source: str) -> tuple[str, dict]` — `(usfm_reference, translations_dict)`; `translations_dict` is the real multi-translation dict for a single verse, or `{"eng-KJV": "<joined text>"}` for a range. Raises `DevotionalError` if no verse text can be fetched.

- [ ] **Step 1: Write the failing tests**

Create `tests/chatbot/test_devotional_resolve.py`:

```python
import pytest

from chatbot import devotional


def test_build_devotional_prompt_substitutes_the_marker():
    out = devotional.build_devotional_prompt("JHN 14:27", "Peace I leave with you...")
    assert "[INSERT VERSE AND REFERENCE]" not in out
    assert "JHN 14:27 (KJV)" in out
    assert "Peace I leave with you..." in out
    assert "1,200" in out  # length instruction survived


@pytest.mark.asyncio
async def test_resolve_seed_verse_explicit_single_reference(monkeypatch):
    async def fake_fetch(reference, languages=None):
        assert reference == "JHN 14:27"
        return {"eng-KJV": "Peace I leave with you..."}

    monkeypatch.setattr(devotional, "fetch_verse_translations", fake_fetch)
    ref, translations = await devotional.resolve_seed_verse("John 14:27", "user")
    assert ref == "JHN 14:27"
    assert translations == {"eng-KJV": "Peace I leave with you..."}


@pytest.mark.asyncio
async def test_resolve_seed_verse_range_joins_verse_text(monkeypatch):
    async def fake_fetch(reference, languages=None):
        return {"PSA 23:1": {"eng-KJV": "The LORD is my shepherd; I shall not want."},
                "PSA 23:2": {"eng-KJV": "He maketh me to lie down in green pastures:"},
                "PSA 23:3": {"eng-KJV": "He restoreth my soul:"}}[reference]

    monkeypatch.setattr(devotional, "fetch_verse_translations", fake_fetch)
    ref, translations = await devotional.resolve_seed_verse("Psalm 23:1-3", "user")
    assert ref == "PSA 23:1-3"
    assert translations["eng-KJV"] == (
        "The LORD is my shepherd; I shall not want. "
        "He maketh me to lie down in green pastures: "
        "He restoreth my soul:"
    )


@pytest.mark.asyncio
async def test_resolve_seed_verse_theme_goes_through_pick(monkeypatch):
    async def fake_pick(theme):
        assert theme == "facing anxiety"
        return "PHP 4:6-7"

    async def fake_fetch(reference, languages=None):
        return {"eng-KJV": "..."}

    monkeypatch.setattr(devotional, "pick_verse_for_theme", fake_pick)
    monkeypatch.setattr(devotional, "fetch_verse_translations", fake_fetch)
    ref, _ = await devotional.resolve_seed_verse("facing anxiety", "user")
    assert ref == "PHP 4:6-7"


@pytest.mark.asyncio
async def test_resolve_seed_verse_system_source_empty_goes_through_pick(monkeypatch):
    async def fake_pick(theme):
        assert theme is None
        return "ROM 8:28"

    async def fake_fetch(reference, languages=None):
        return {"eng-KJV": "..."}

    monkeypatch.setattr(devotional, "pick_verse_for_theme", fake_pick)
    monkeypatch.setattr(devotional, "fetch_verse_translations", fake_fetch)
    ref, _ = await devotional.resolve_seed_verse(None, "system")
    assert ref == "ROM 8:28"


@pytest.mark.asyncio
async def test_resolve_seed_verse_raises_when_no_text(monkeypatch):
    async def fake_fetch(reference, languages=None):
        return {}

    monkeypatch.setattr(devotional, "fetch_verse_translations", fake_fetch)
    with pytest.raises(devotional.DevotionalError):
        await devotional.resolve_seed_verse("John 14:27", "user")


@pytest.mark.asyncio
async def test_pick_verse_for_theme_parses_llm_reference(monkeypatch):
    async def fake_simple(system, user, *, max_tokens=2048):
        return "Try John 14:27 — a good one."

    monkeypatch.setattr(devotional, "simple_completion", fake_simple)
    monkeypatch.setattr(devotional, "llm_unconfigured_error", lambda: None)
    assert await devotional.pick_verse_for_theme("peace") == "JHN 14:27"


@pytest.mark.asyncio
async def test_pick_verse_for_theme_retries_then_falls_back(monkeypatch):
    calls = []

    async def fake_simple(system, user, *, max_tokens=2048):
        calls.append(1)
        return "no reference here"

    monkeypatch.setattr(devotional, "simple_completion", fake_simple)
    monkeypatch.setattr(devotional, "llm_unconfigured_error", lambda: None)
    monkeypatch.setattr(devotional.random, "choice", lambda seq: seq[0])
    out = await devotional.pick_verse_for_theme("peace")
    assert len(calls) == 2                     # one retry
    assert out == devotional.FALLBACK_VERSES[0]


@pytest.mark.asyncio
async def test_pick_verse_for_theme_unconfigured_uses_fallback(monkeypatch):
    monkeypatch.setattr(devotional, "llm_unconfigured_error", lambda: "no key")
    monkeypatch.setattr(devotional.random, "choice", lambda seq: seq[2])
    out = await devotional.pick_verse_for_theme(None)
    assert out == devotional.FALLBACK_VERSES[2]
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python -m pytest tests/chatbot/test_devotional_resolve.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'chatbot.devotional'`.

- [ ] **Step 3: Create `chatbot/devotional.py`**

```python
"""Devotional mode: turn a seed verse into the prompt for a long-form
devotional, and stream that devotional from the configured LLM.

The seed verse comes from one of three places:
  * an explicit reference the user typed ("John 3:16", "Psalm 23:1-3");
  * a theme the user typed ("facing anxiety") → one short LLM pick;
  * the "pick one for me" path → the same LLM pick with no theme.
Anything the LLM pick can't produce falls back to FALLBACK_VERSES.
"""

import random
import re
from typing import AsyncIterator, Dict, Optional, Tuple

from chatbot.router import (
    _find_flexible_verse_refs,
    _format_reference,
    _resolve_verse_reference,
)
from chatbot.tools import fetch_verse_translations
from chatbot.ollama_client import (
    llm_unconfigured_error,
    simple_completion,
    stream_devotional_completion,
)


class DevotionalError(Exception):
    """Raised when a seed verse can't be resolved to any verse text."""


FALLBACK_VERSES = ["JHN 14:27", "PSA 23:1", "ISA 41:10", "ROM 8:28", "PHP 4:6-7", "MAT 11:28"]

DEVOTIONAL_SYSTEM_PROMPT = "You are an experienced Christian devotional writer."

_PICK_SYSTEM_PROMPT = (
    "You suggest a single Bible verse for a devotional. Reply with only one "
    "verse reference and nothing else."
)

# The devotional-writer brief. `[INSERT VERSE AND REFERENCE]` is replaced by
# `build_devotional_prompt` with the seed verse block.
DEVOTIONAL_PROMPT_TEMPLATE = """You are an experienced Christian devotional writer. Write a deeply personal, emotionally powerful devotional based on the Bible verse provided below.

BIBLE VERSE:
[INSERT VERSE AND REFERENCE]

Your devotional should have a warm, conversational, pastoral voice. It should feel as though a compassionate pastor is sitting across from the reader, talking directly to them about something they may be experiencing in their own life.

STYLE AND VOICE:

- Begin with a relatable question, situation, struggle, or everyday experience that immediately connects the biblical truth to something the reader may be feeling.
- Move naturally from that modern-day experience into the biblical passage or story surrounding the verse.
- Retell the relevant biblical scene in a vivid but conversational way. Help the reader picture what was happening, what the people involved may have been feeling, and what may have been going through their minds.
- Do not make the writing sound academic, theological, or like a Bible commentary. Keep it accessible, intimate, and spoken.
- Use phrases such as "Think about it," "Maybe today you're..." or "Can I tell you this?" naturally when appropriate, but do not overuse them.
- Frequently connect the biblical situation back to the reader's own life.
- Use rhetorical questions to create reflection and emotional connection.
- Explore the human emotions in the passage: fear, grief, disappointment, loneliness, hope, regret, uncertainty, longing, joy, faith, or surrender, depending on the verse.
- When appropriate, gently speculate about what a biblical character might have been thinking or feeling, while clearly presenting it as possibility rather than fact.
- Build the devotional gradually. Start with an ordinary human struggle, reveal the biblical truth, then show how that truth speaks directly into the reader's situation.
- Make the central spiritual truth clear and memorable.
- Avoid merely explaining what the verse means. Show the reader why it matters to their life right now.
- Include practical ways the reader can respond to the truth: what they can surrender, believe, change, pursue, remember, or place in God's hands.
- Keep Jesus at the center whenever the passage allows for it. Point the reader toward His character, His presence, His promises, His finished work, or His invitation.
- End with a strong emotional resolution. The final paragraphs should feel like the devotional has arrived somewhere meaningful rather than simply stopping.
- The ending should leave the reader with hope, faith, comfort, conviction, or renewed trust in God.
- Whenever possible, echo the central image or idea from the opening so the devotional feels complete and intentional.

PACING AND STRUCTURE:

Use a flowing, story-driven structure rather than headings or numbered sections.

A helpful progression is:

1. Start with a question or familiar human experience.
2. Introduce the biblical passage naturally.
3. Tell or unpack the biblical scene.
4. Highlight the surprising or beautiful truth in the verse.
5. Connect that truth to situations the reader may be facing today.
6. Offer a deeper spiritual perspective that the reader may not have considered.
7. Give the reader a practical response.
8. Bring the focus back to Jesus.
9. Finish with a memorable, emotionally powerful statement of hope or faith.

WRITING CHARACTERISTICS:

- Write in natural spoken English.
- Use a mixture of short, punchy sentences and longer reflective sentences.
- Let important sentences stand alone for emphasis.
- Use repetition sparingly when it creates emotional weight.
- Prefer concrete images and everyday experiences over abstract theological language.
- Make the devotional feel personal without assuming specific details about the reader.
- Write with warmth and sincerity rather than hype.
- Be emotionally powerful without becoming melodramatic.
- Be encouraging without making promises that Scripture does not make.
- Do not force a lesson that isn't genuinely supported by the passage.
- Stay faithful to the biblical context.
- If the verse has a difficult or surprising meaning, acknowledge that honestly before explaining its hope or significance.
- Avoid clichés, excessive Christian jargon, generic motivational language, and overly polished corporate-sounding prose.
- Do not sound like a textbook, sermon outline, Bible study worksheet, or theological essay.

LENGTH:

Write approximately 1,200-1,600 words.

MOST IMPORTANT:

The reader should finish feeling as though Scripture has spoken directly into something they are carrying today.

The devotional should move from:
"Here is something happening in the Bible"
to
"Here is what this means for you"
to
"Here is what Jesus is inviting you to believe, surrender, or receive."

Do not simply summarize the verse. Turn the biblical truth into a personal encounter with God.

Now write the devotional based on the verse provided above."""


# "PSA 23:1", "1CO 13:4-7", "SNG 2:1" — USFM book code, chapter:verse, optional -end.
_USFM_REF_RE = re.compile(r"^([1-3]?[A-Z]{2,3})\s+(\d+):(\d+)(?:-(\d+))?$")

# Fetching a whole range one verse at a time is a handful of calls; guard
# against a pathological span ("Genesis 1:1-999") fanning out.
_MAX_RANGE_SPAN = 20


def _kjv_text(translations: Dict[str, str]) -> str:
    """Pull the KJV (or best-available) plain text out of a translations dict."""
    if not translations:
        return ""
    for code, text in translations.items():
        if code.endswith("-KJV") or code == "eng":
            return text
    return next(iter(translations.values()), "")


def build_devotional_prompt(reference: str, verse_text: str) -> str:
    verse_block = f"{reference} (KJV)\n{verse_text}"
    return DEVOTIONAL_PROMPT_TEMPLATE.replace("[INSERT VERSE AND REFERENCE]", verse_block)


async def pick_verse_for_theme(theme: Optional[str]) -> str:
    """One short LLM call → a USFM reference. One retry on an unparseable
    reply, then a random FALLBACK_VERSES pick. Never returns empty."""
    if llm_unconfigured_error():
        return random.choice(FALLBACK_VERSES)

    ask = (
        f"Suggest one Bible verse for a devotional on the theme: '{theme}'."
        if theme
        else "Suggest one well-known Bible verse for a devotional."
    ) + " Reply with only the reference, e.g. `John 14:27`. Choose a pastorally rich verse; vary your choice."

    for _ in range(2):
        reply = await simple_completion(_PICK_SYSTEM_PROMPT, ask, max_tokens=64)
        refs = _find_flexible_verse_refs(reply or "")
        if refs:
            return _format_reference(*refs[0])
    return random.choice(FALLBACK_VERSES)


async def _range_text(usfm: str, chapter: int, start: int, end: int) -> str:
    """KJV text for a verse range, fetched one verse at a time (every caller
    of fetch_verse_translations in this codebase passes it a USFM ref, so no
    book-name lookup is needed) and space-joined."""
    last = min(end, start + _MAX_RANGE_SPAN)
    parts = []
    for v in range(start, last + 1):
        got = _kjv_text(await fetch_verse_translations(f"{usfm} {chapter}:{v}", languages=["eng"]))
        if got:
            parts.append(got)
    return " ".join(parts)


async def resolve_seed_verse(raw: Optional[str], source: str) -> Tuple[str, Dict[str, str]]:
    """(usfm_reference, translations_dict). For a single verse the dict is the
    real multi-translation payload; for a range it's {"eng-KJV": joined text}.
    Raises DevotionalError when no verse text can be fetched."""
    ref = _resolve_verse_reference(raw) if (source == "user" and raw) else None
    if ref is None:
        theme = raw.strip() if (raw and raw.strip()) else None
        ref = await pick_verse_for_theme(theme)

    m = _USFM_REF_RE.match(ref)
    is_range = bool(m and m.group(4) and int(m.group(4)) != int(m.group(3)))

    if is_range:
        text = await _range_text(m.group(1), int(m.group(2)), int(m.group(3)), int(m.group(4)))
        if not text:
            raise DevotionalError(f"No verse text for {ref}")
        return ref, {"eng-KJV": text}

    translations = await fetch_verse_translations(ref, languages=["eng"])
    if not translations:
        raise DevotionalError(f"No verse text for {ref}")
    return ref, translations
```

> **Note on structure vs. the spec:** the spec's pseudocode kept translation
> fetching inside `stream_devotional` and passed it back on the `done`
> event. This plan folds the single-verse translations fetch into
> `resolve_seed_verse` (it already needs the text) and returns it directly —
> same data reaches the `final` payload, one fewer fetch, and `stream_devotional`
> stays purely about producing prose. Behaviour is unchanged.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python -m pytest tests/chatbot/test_devotional_resolve.py -v`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add chatbot/devotional.py tests/chatbot/test_devotional_resolve.py
git commit -m "feat(chatbot): devotional prompt + seed-verse resolution

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0118MhC6UKx3em8wQyt2Wzsa"
```

---

## Task 3: `stream_devotional` orchestrator

**Files:**
- Modify: `chatbot/devotional.py`
- Test: `tests/chatbot/test_devotional_stream.py` (new)

**Interfaces:**
- Consumes: `resolve_seed_verse`, `build_devotional_prompt`, `_kjv_text`, `DEVOTIONAL_SYSTEM_PROMPT`, `DevotionalError` (Task 2); `stream_devotional_completion` (Task 1).
- Produces:
  - `async def stream_devotional(raw: Optional[str], source: str, page_context: Optional[str]) -> AsyncIterator[dict]` — yields `{"type": "stream", "chunk": str}` zero+ times; then either `{"type": "error", "message": str}` (LLM stream failure) **or** `{"type": "done", "text": str, "reference": str, "translations": dict}`. Propagates `DevotionalError` from seed-verse resolution to the caller (does not swallow it). `page_context` is accepted for signature symmetry with other routers and is currently unused.

- [ ] **Step 1: Write the failing tests**

Create `tests/chatbot/test_devotional_stream.py`:

```python
import pytest

from chatbot import devotional


@pytest.mark.asyncio
async def test_stream_devotional_happy_path(monkeypatch):
    async def fake_resolve(raw, source):
        return "JHN 14:27", {"eng-KJV": "Peace I leave with you..."}

    async def fake_completion(system, user, *, max_tokens=3600):
        assert "JHN 14:27 (KJV)" in user
        for chunk in ["Some ", "morning ", "you wake..."]:
            yield {"type": "stream", "chunk": chunk}
        yield {"type": "done"}

    monkeypatch.setattr(devotional, "resolve_seed_verse", fake_resolve)
    monkeypatch.setattr(devotional, "stream_devotional_completion", fake_completion)

    events = [e async for e in devotional.stream_devotional("John 14:27", "user", None)]
    assert [e["type"] for e in events[:-1]] == ["stream", "stream", "stream"]
    done = events[-1]
    assert done["type"] == "done"
    assert done["text"] == "Some morning you wake..."
    assert done["reference"] == "JHN 14:27"
    assert done["translations"] == {"eng-KJV": "Peace I leave with you..."}


@pytest.mark.asyncio
async def test_stream_devotional_llm_error_is_forwarded(monkeypatch):
    async def fake_resolve(raw, source):
        return "JHN 14:27", {"eng-KJV": "..."}

    async def fake_completion(system, user, *, max_tokens=3600):
        yield {"type": "error", "message": "LLM API error: boom"}

    monkeypatch.setattr(devotional, "resolve_seed_verse", fake_resolve)
    monkeypatch.setattr(devotional, "stream_devotional_completion", fake_completion)

    events = [e async for e in devotional.stream_devotional("x", "user", None)]
    assert events == [{"type": "error", "message": "LLM API error: boom"}]


@pytest.mark.asyncio
async def test_stream_devotional_propagates_devotional_error(monkeypatch):
    async def fake_resolve(raw, source):
        raise devotional.DevotionalError("nope")

    monkeypatch.setattr(devotional, "resolve_seed_verse", fake_resolve)

    with pytest.raises(devotional.DevotionalError):
        [e async for e in devotional.stream_devotional("x", "user", None)]
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python -m pytest tests/chatbot/test_devotional_stream.py -v`
Expected: FAIL — `AttributeError: module 'chatbot.devotional' has no attribute 'stream_devotional'`.

- [ ] **Step 3: Add `stream_devotional` to `chatbot/devotional.py`**

Append:

```python
async def stream_devotional(
    raw: Optional[str], source: str, page_context: Optional[str] = None
) -> AsyncIterator[Dict[str, object]]:
    """Resolve the seed verse, then stream the devotional. Yields
    {"type": "stream", "chunk": str} while generating, then one terminal
    event: {"type": "error", "message": str} on an LLM stream failure, or
    {"type": "done", "text", "reference", "translations"} on success.
    A DevotionalError from seed-verse resolution propagates to the caller."""
    reference, translations = await resolve_seed_verse(raw, source)
    verse_text = _kjv_text(translations)
    prompt = build_devotional_prompt(reference, verse_text)

    full = ""
    async for ev in stream_devotional_completion(DEVOTIONAL_SYSTEM_PROMPT, prompt, max_tokens=3600):
        if ev["type"] == "stream":
            full += ev["chunk"]
            yield {"type": "stream", "chunk": ev["chunk"]}
        elif ev["type"] == "error":
            yield {"type": "error", "message": ev["message"]}
            return
    yield {"type": "done", "text": full, "reference": reference, "translations": translations}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python -m pytest tests/chatbot/test_devotional_stream.py -v`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add chatbot/devotional.py tests/chatbot/test_devotional_stream.py
git commit -m "feat(chatbot): stream_devotional orchestrator

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0118MhC6UKx3em8wQyt2Wzsa"
```

---

## Task 4: `build_mode_primer` — devotional pill-selection primer

**Files:**
- Modify: `chatbot/router.py` (inside `build_mode_primer`, before the final `freeform` `return`)
- Test: `tests/chatbot/test_mode_primers.py` (add cases)

**Interfaces:**
- Consumes: `build_mode_primer(mode: str, mode_params: Optional[dict]) -> dict` (existing).
- Produces: for `mode == "devotional"`, a `{"type": "chat", "message": str, "data": None, "route": str, "follow_up_questions": []}` dict — instruction text for `source == "user"`, a short ack for `source == "system"`. This is the response the buffered `/chat` endpoint returns when a devotional choice pill is picked (empty message). It never generates a devotional.

- [ ] **Step 1: Write the failing tests**

Add to `tests/chatbot/test_mode_primers.py`:

```python
@pytest.mark.asyncio
async def test_devotional_primer_user_source_asks_for_a_verse_or_theme():
    result = await build_mode_primer("devotional", {"source": "user"})
    assert result["type"] == "chat"
    assert "verse reference" in result["message"].lower()
    assert "theme" in result["message"].lower()
    assert result["follow_up_questions"] == []


@pytest.mark.asyncio
async def test_devotional_primer_system_source_is_a_short_ack():
    result = await build_mode_primer("devotional", {"source": "system"})
    assert result["type"] == "chat"
    assert "find a verse" in result["message"].lower()


@pytest.mark.asyncio
async def test_devotional_primer_defaults_to_user_source():
    result = await build_mode_primer("devotional", {})
    assert result["type"] == "chat"
    assert "verse reference" in result["message"].lower()
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python -m pytest tests/chatbot/test_mode_primers.py -k devotional -v`
Expected: FAIL — the current `build_mode_primer` falls through to the `freeform` primer, so `message` is `"Ask me anything about the Bible."` and the assertions fail.

- [ ] **Step 3: Add the `devotional` case**

In `chatbot/router.py`, inside `build_mode_primer`, immediately **before** the final `return { ... "route": "Mode primer → freeform" ... }`:

```python
    if mode == "devotional":
        source = mode_params.get("source", "user")
        if source == "system":
            message = "Let me find a verse for you…"
        else:
            message = (
                "Tell me a verse reference (e.g. John 3:16) or a theme "
                "(e.g. 'facing anxiety'), and I'll write you a devotional."
            )
        return {
            "type": "chat",
            "message": message,
            "data": None,
            "route": f"Mode primer → devotional ({source})",
            "follow_up_questions": [],
        }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python -m pytest tests/chatbot/test_mode_primers.py -k devotional -v`
Expected: PASS (3 tests).

- [ ] **Step 5: Run the full primer + smoke suite**

Run: `python -m pytest tests/chatbot/test_mode_primers.py tests/chatbot/test_smoke.py -q`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add chatbot/router.py tests/chatbot/test_mode_primers.py
git commit -m "feat(chatbot): devotional mode primer (pill-selection text)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0118MhC6UKx3em8wQyt2Wzsa"
```

---

## Task 5: `/chat/stream` devotional generating branch

**Files:**
- Modify: `chatbot/api.py` (`_stream_chat_response`)
- Modify: `chatbot/schemas.py` (`ChatRequest.mode` description)
- Test: `tests/chatbot/test_chat_stream_devotional.py` (new)

**Interfaces:**
- Consumes: `chatbot.devotional.stream_devotional`, `chatbot.devotional.DevotionalError` (Tasks 2–3); `chatbot.ollama_client.active_model_label`; `get_book_context` (already imported in `api.py`); `sse_event`, `_note_outcome` (in scope inside `_stream_chat_response`).
- Produces: on `/chat/stream`, for `mode == "devotional"` with a falsy `mode_params.delivered`, a stream of `stream` SSE events followed by one `final` event. The `final` result on success:
  ```json
  {
    "type": "verse",
    "message": "Here's a devotional on **<REF>**.",
    "data": { "reference": "<REF>", "translations": { ... },
              "book_context": { ... } | null, "devotional": "<full markdown>" },
    "artifacts": [ { "type": "devotional", "label": "Read the devotional ▸",
                     "params": { "reference": "<REF>", "text": "<full markdown>" } } ],
    "route": "Mode → devotional → <model label>"
  }
  ```
  On failure, `{ "type": "error", "message": <str>, "data": null, "route": ... }`. Never includes `follow_up_questions`. A terminal `trace` event still follows (existing `finally` in `_stream_chat_response`).

- [ ] **Step 1: Write the failing tests**

Create `tests/chatbot/test_chat_stream_devotional.py`:

```python
import json

import pytest


def _events(raw: str):
    out = []
    for chunk in raw.strip().split("\n\n"):
        line = chunk.strip()
        if line.startswith("data: "):
            out.append(json.loads(line[len("data: "):]))
    return out


def _patch_stream_devotional(monkeypatch, gen):
    import chatbot.api as api_module
    # api.py imports stream_devotional lazily inside the branch, so patch the
    # source module.
    import chatbot.devotional as devo
    monkeypatch.setattr(devo, "stream_devotional", gen)


def test_devotional_stream_emits_verse_final_with_artifact(client, monkeypatch):
    async def fake_stream(raw, source, page_context):
        assert raw == "peace"
        assert source == "user"
        yield {"type": "stream", "chunk": "Some morning "}
        yield {"type": "stream", "chunk": "you wake..."}
        yield {"type": "done", "text": "Some morning you wake...",
               "reference": "JHN 14:27", "translations": {"eng-KJV": "Peace I leave..."}}

    _patch_stream_devotional(monkeypatch, fake_stream)

    resp = client.post("/chat/stream", json={
        "message": "peace", "mode": "devotional", "mode_params": {"source": "user"},
    })
    assert resp.status_code == 200
    events = _events(resp.text)

    assert any(e["type"] == "stream" for e in events)
    final = next(e for e in events if e["type"] == "final")["result"]
    assert final["type"] == "verse"
    assert final["message"] == "Here's a devotional on **JHN 14:27**."
    assert final["data"]["reference"] == "JHN 14:27"
    assert final["data"]["devotional"] == "Some morning you wake..."
    assert final["data"]["translations"] == {"eng-KJV": "Peace I leave..."}
    assert final["artifacts"] == [{
        "type": "devotional",
        "label": "Read the devotional ▸",
        "params": {"reference": "JHN 14:27", "text": "Some morning you wake..."},
    }]
    assert "follow_up_questions" not in final or final["follow_up_questions"] in ([], None)
    assert events[-1]["type"] == "trace"


def test_devotional_stream_empty_message_system_source_still_generates(client, monkeypatch):
    async def fake_stream(raw, source, page_context):
        assert raw is None
        assert source == "system"
        yield {"type": "done", "text": "A devotional.", "reference": "ROM 8:28",
               "translations": {"eng-KJV": "..."}}

    _patch_stream_devotional(monkeypatch, fake_stream)

    resp = client.post("/chat/stream", json={
        "message": "", "mode": "devotional", "mode_params": {"source": "system"},
    })
    final = next(e for e in _events(resp.text) if e["type"] == "final")["result"]
    assert final["type"] == "verse"
    assert final["data"]["reference"] == "ROM 8:28"


def test_devotional_stream_devotional_error_becomes_error_result(client, monkeypatch):
    import chatbot.devotional as devo

    async def fake_stream(raw, source, page_context):
        raise devo.DevotionalError("no text")
        yield  # noqa: unreachable — makes this an async generator

    _patch_stream_devotional(monkeypatch, fake_stream)

    resp = client.post("/chat/stream", json={
        "message": "Nonexistent 9:9", "mode": "devotional", "mode_params": {"source": "user"},
    })
    final = next(e for e in _events(resp.text) if e["type"] == "final")["result"]
    assert final["type"] == "error"
    assert "try another verse or a theme" in final["message"].lower()


def test_devotional_stream_llm_error_becomes_error_result(client, monkeypatch):
    async def fake_stream(raw, source, page_context):
        yield {"type": "error", "message": "LLM API error: boom"}

    _patch_stream_devotional(monkeypatch, fake_stream)

    resp = client.post("/chat/stream", json={
        "message": "peace", "mode": "devotional", "mode_params": {"source": "user"},
    })
    final = next(e for e in _events(resp.text) if e["type"] == "final")["result"]
    assert final["type"] == "error"
    assert "boom" in final["message"]


def test_devotional_stream_delivered_true_falls_through_to_normal_routing(client, monkeypatch):
    # After delivery, a follow-up must NOT re-enter the devotional branch —
    # it routes like any freeform message. A bare verse ref → deterministic
    # verse response.
    def fake_fetch_verse(book, chapter, verse):
        return {"eng-KJV": "Jesus wept."}

    monkeypatch.setattr("chatbot.tools._fetch_verse", fake_fetch_verse)

    resp = client.post("/chat/stream", json={
        "message": "quote John 11:35", "mode": "devotional",
        "mode_params": {"source": "user", "delivered": True},
    })
    final = next(e for e in _events(resp.text) if e["type"] == "final")["result"]
    assert final["type"] == "verse"
    assert "11:35" in final["data"]["reference"]
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python -m pytest tests/chatbot/test_chat_stream_devotional.py -v`
Expected: FAIL — with no devotional branch, `message: ""` + `mode: "devotional"` hits the generic primer path (`build_mode_primer` → the Task 4 ack for the system case; the `user` cases send a non-empty message so they fall to deterministic/AI routing and don't produce a `verse` with a `devotional` artifact). Assertions on `final["type"] == "verse"` and the artifact fail.

- [ ] **Step 3: Add the devotional branch to `_stream_chat_response`**

In `chatbot/api.py`, inside `_stream_chat_response`, add this block **immediately after** `history = (...)` is computed and **before** `if request.mode and not request.message.strip():`:

```python
        # ── Devotional mode: the generating turn ──────────────────────────
        # Every non-generating devotional call (the pill-selection primer)
        # goes through the buffered /chat endpoint, so on /chat/stream a
        # devotional request that isn't already `delivered` is always a
        # request to generate — whether the message is a typed verse/theme
        # (source=user) or empty (source=system, auto-fired by the client).
        md = request.mode_params or {}
        if request.mode == "devotional" and not md.get("delivered"):
            from chatbot.devotional import stream_devotional, DevotionalError
            from chatbot.ollama_client import active_model_label

            raw = request.message.strip()
            source = md.get("source", "user")
            full_text, reference, translations, stream_error = "", None, {}, None
            try:
                async for ev in stream_devotional(raw or None, source, request.page_context):
                    if ev["type"] == "stream":
                        yield await sse_event("stream", {"chunk": ev["chunk"], "text": ""})
                    elif ev["type"] == "error":
                        stream_error = ev["message"]
                    elif ev["type"] == "done":
                        full_text = ev["text"]
                        reference = ev["reference"]
                        translations = ev["translations"]
            except DevotionalError:
                result = {
                    "type": "error",
                    "message": "I couldn't find text for that reference — try another verse or a theme.",
                    "data": None,
                    "route": "Mode → devotional → unresolved",
                }
                _note_outcome(result)
                yield await sse_event("final", {"result": result})
                return

            if stream_error or not full_text or not reference:
                result = {
                    "type": "error",
                    "message": stream_error or "The devotional could not be generated.",
                    "data": None,
                    "route": "Error path",
                }
            else:
                book_context = get_book_context(reference.split(" ")[0].upper())
                result = {
                    "type": "verse",
                    "message": f"Here's a devotional on **{reference}**.",
                    "data": {
                        "reference": reference,
                        "translations": translations,
                        "book_context": book_context,
                        "devotional": full_text,
                    },
                    "artifacts": [{
                        "type": "devotional",
                        "label": "Read the devotional ▸",
                        "params": {"reference": reference, "text": full_text},
                    }],
                    "route": f"Mode → devotional → {active_model_label()}",
                }
            _note_outcome(result)
            yield await sse_event("final", {"result": result})
            return
```

- [ ] **Step 4: Update the `ChatRequest.mode` description**

In `chatbot/schemas.py`, change the `mode` field description on `ChatRequest`:

```python
    mode: Optional[str] = Field(None, description="Study mode: reading_plan, parable, verse, topic, devotional, freeform")
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `python -m pytest tests/chatbot/test_chat_stream_devotional.py -v`
Expected: PASS (5 tests).

- [ ] **Step 6: Run the full backend suite for regressions**

Run: `python -m pytest tests/chatbot -q`
Expected: PASS — the new branch is gated on `mode == "devotional"` and does not affect any other route.

- [ ] **Step 7: Commit**

```bash
git add chatbot/api.py chatbot/schemas.py tests/chatbot/test_chat_stream_devotional.py
git commit -m "feat(chatbot): stream a generated devotional on /chat/stream

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0118MhC6UKx3em8wQyt2Wzsa"
```

---

## Task 6: Frontend types + mode label

**Files:**
- Modify: `frontend/src/types/session.ts`
- Modify: `frontend/src/store/useSessionsStore.ts`
- Test: `frontend/src/store/useSessionsStore.test.ts` (add a case)

**Interfaces:**
- Produces:
  - `SessionMode` union now includes `'devotional'`.
  - `ModeParams` now has `source?: 'user' | 'system'` and `delivered?: boolean`.
  - `ArtifactLink['type']` union now includes `'devotional'`.
  - `export interface DevotionalArtifactParams { reference: string; text: string }`.
  - `MODE_LABELS.devotional === 'Devotional'`.

- [ ] **Step 1: Write the failing test**

Add to `frontend/src/store/useSessionsStore.test.ts` (inside the top-level `describe`):

```ts
  it('creates a devotional session titled "Devotional"', () => {
    const s = useSessionsStore.getState().createSession('devotional', { source: 'system' })
    expect(s.mode).toBe('devotional')
    expect(s.title).toBe('Devotional')
    expect(s.modeParams).toEqual({ source: 'system' })
  })
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run src/store/useSessionsStore.test.ts`
Expected: FAIL — TypeScript rejects `'devotional'` as a `SessionMode`, so the test file won't compile / the run errors.

- [ ] **Step 3: Extend `session.ts`**

In `frontend/src/types/session.ts`:

```ts
export type SessionMode = 'reading_plan' | 'parable' | 'verse' | 'topic' | 'freeform' | 'devotional'

export interface ModeParams {
  plan?: 'chronological' | 'canonical'
  dayIndex?: number
  completedDays?: number[]
  parableId?: string
  seriesId?: string
  conceptSlug?: string
  reference?: string
  /** Devotional mode: whose verse — one the user typed (a reference or a
   * theme), or one the system/LLM picks. */
  source?: 'user' | 'system'
  /** Devotional mode: set once a devotional has been delivered, so later
   * messages in the session route as ordinary chat instead of
   * regenerating. */
  delivered?: boolean
}

export interface ArtifactLink {
  type: 'interlinear' | 'chapter' | 'strongs' | 'book_context' | 'gematria' | 'english_search' | 'devotional'
  label: string
  params: Record<string, unknown>
}

/** Params for a `devotional`-type ArtifactLink — the finished devotional
 * text travels inline (no fetch when the pane opens it). */
export interface DevotionalArtifactParams {
  reference: string
  text: string
}
```

- [ ] **Step 4: Add the `MODE_LABELS` entry**

In `frontend/src/store/useSessionsStore.ts`:

```ts
export const MODE_LABELS: Record<SessionMode, string> = {
  reading_plan: 'Bible in a Year',
  parable: 'Parable Study',
  verse: 'Verse of the Day',
  topic: 'Topical Study',
  freeform: 'Ask Anything',
  devotional: 'Devotional',
}
```

(`deriveTitle` needs no change — its final `return MODE_LABELS[mode]` already covers `devotional`.)

- [ ] **Step 5: Run the test + typecheck**

Run: `cd frontend && npx vitest run src/store/useSessionsStore.test.ts`
Expected: PASS.
Run: `cd frontend && npx tsc -b --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/types/session.ts frontend/src/store/useSessionsStore.ts frontend/src/store/useSessionsStore.test.ts
git commit -m "feat(chat): devotional SessionMode, ModeParams, artifact type

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0118MhC6UKx3em8wQyt2Wzsa"
```

---

## Task 7: "Devotional" starter button

**Files:**
- Modify: `frontend/src/components/shell/ModePickerScreen.tsx`
- Test: `frontend/src/components/shell/ModePickerScreen.test.tsx` (add a case)

**Interfaces:**
- Consumes: `startWithChoices(mode: SessionMode, userLabel: string, promptText: string, choices: MessageChoice[])` (existing helper in the component); `MessageChoice = { label: string; modeParams: ModeParams }`.
- Produces: a starter button labelled "Devotional" that creates a `devotional` session with a first assistant message carrying two choice pills — `{ label: "I'll choose", modeParams: { source: 'user' } }` and `{ label: 'Pick one for me', modeParams: { source: 'system' } }` — and `choicesStatus: 'ready'`.

- [ ] **Step 1: Write the failing test**

Add to `frontend/src/components/shell/ModePickerScreen.test.tsx`:

```ts
  it('selecting Devotional offers the "your verse vs mine" choice inline', async () => {
    render(<ModePickerScreen onSessionStarted={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: /devotional/i }))

    const session = firstSession()
    expect(session.mode).toBe('devotional')
    expect(session.messages[0]).toMatchObject({ role: 'user', text: '📖 Devotional' })
    expect(session.messages[1].role).toBe('assistant')
    expect(session.messages[1].choicesStatus).toBe('ready')
    expect(session.messages[1].choices).toEqual([
      { label: "I'll choose", modeParams: { source: 'user' } },
      { label: 'Pick one for me', modeParams: { source: 'system' } },
    ])
  })
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run src/components/shell/ModePickerScreen.test.tsx`
Expected: FAIL — `Unable to find an accessible element with the role "button" and name /devotional/i`.

- [ ] **Step 3: Add the button**

In `frontend/src/components/shell/ModePickerScreen.tsx`:

1. Add `HeartHandshake` to the `lucide-react` import:

```ts
import { ArrowUp, BookOpen, CalendarDays, HeartHandshake, Loader2, MessageCircle, Search, Sparkles, Sprout } from 'lucide-react'
```

2. Add this button inside the `<div className="flex flex-wrap justify-center gap-2">`, immediately before the "Ask Anything" button:

```tsx
          <button
            className={STARTER_BUBBLE}
            onClick={() =>
              startWithChoices(
                'devotional',
                '📖 Devotional',
                'Would you like a devotional on a verse or theme you choose, or one I pick for you?',
                [
                  { label: "I'll choose", modeParams: { source: 'user' } },
                  { label: 'Pick one for me', modeParams: { source: 'system' } },
                ]
              )
            }
          >
            <HeartHandshake className="h-4 w-4 shrink-0" aria-hidden="true" /> Devotional
          </button>
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && npx vitest run src/components/shell/ModePickerScreen.test.tsx`
Expected: PASS (the new case plus the existing ones).

> The existing test `'shows all four mode cards plus Ask Anything'` does not assert the *absence* of a Devotional button, so it still passes. No edit needed there.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/shell/ModePickerScreen.tsx frontend/src/components/shell/ModePickerScreen.test.tsx
git commit -m "feat(chat): Devotional mode starter with verse/theme choice

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0118MhC6UKx3em8wQyt2Wzsa"
```

---

## Task 8: Artifact store — `devotional` pass-through

**Files:**
- Modify: `frontend/src/store/useArtifactStore.ts` (`fetchForLink`)
- Test: `frontend/src/store/useArtifactStore.test.ts` (add a case)

**Interfaces:**
- Consumes: `openArtifact(link: ArtifactLink)` (existing).
- Produces: `fetchForLink` returns `link.params` verbatim for `link.type === 'devotional'` — no network call — so `openArtifact` transitions straight `loading → ready` with `data === link.params`.

- [ ] **Step 1: Write the failing test**

Add to `frontend/src/store/useArtifactStore.test.ts`:

```ts
  it('openArtifact for a devotional link resolves from params with no fetch', async () => {
    const interlinearSpy = vi.spyOn(chatApi, 'fetchInterlinear')
    const strongsSpy = vi.spyOn(chatApi, 'fetchStrongsEntry')
    const link = {
      type: 'devotional' as const,
      label: 'Read the devotional ▸',
      params: { reference: 'JHN 14:27', text: '# A devotional\n\nSome words.' },
    }
    await useArtifactStore.getState().openArtifact(link)
    const s = useArtifactStore.getState()
    expect(s.status).toBe('ready')
    expect(s.data).toEqual(link.params)
    expect(interlinearSpy).not.toHaveBeenCalled()
    expect(strongsSpy).not.toHaveBeenCalled()
  })
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run src/store/useArtifactStore.test.ts`
Expected: FAIL — `fetchForLink` hits its `default:` branch and throws `Unknown artifact type: devotional`, so `status` becomes `'error'`.

- [ ] **Step 3: Add the `case`**

In `frontend/src/store/useArtifactStore.ts`, in `fetchForLink`, add before `default:`:

```ts
    case 'devotional':
      // The finished devotional text travels inline on the link params
      // (set by the chat message that produced it) — nothing to fetch.
      return link.params
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && npx vitest run src/store/useArtifactStore.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/store/useArtifactStore.ts frontend/src/store/useArtifactStore.test.ts
git commit -m "feat(chat): artifact store resolves devotional links inline

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0118MhC6UKx3em8wQyt2Wzsa"
```

---

## Task 9: `DevotionalArtifact` component + pane wiring

**Files:**
- Create: `frontend/src/components/artifacts/DevotionalArtifact.tsx`
- Modify: `frontend/src/components/shell/ArtifactPane.tsx`
- Test: `frontend/src/components/artifacts/DevotionalArtifact.test.tsx` (new)

**Interfaces:**
- Consumes: `DevotionalArtifactParams` (Task 6); `renderMarkdown(text: string): ReactNode` from `@/lib/renderMarkdown`.
- Produces: `export function DevotionalArtifact({ reference, text }: DevotionalArtifactParams)` — an `<h2>` with the reference, the markdown-rendered body, and a copy-to-clipboard button. Rendered by `ArtifactPane` when `activeArtifact.type === 'devotional'`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/artifacts/DevotionalArtifact.test.tsx`:

```tsx
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DevotionalArtifact } from './DevotionalArtifact'

describe('DevotionalArtifact', () => {
  afterEach(() => vi.restoreAllMocks())

  it('renders the reference heading and the markdown body', () => {
    render(<DevotionalArtifact reference="JHN 14:27" text={'Peace is **not** the absence of a storm.\n\nIt is His presence in it.'} />)
    expect(screen.getByRole('heading', { name: 'JHN 14:27' })).toBeInTheDocument()
    expect(screen.getByText('not').tagName).toBe('STRONG')
    expect(screen.getByText(/It is His presence in it\./)).toBeInTheDocument()
  })

  it('copies the raw devotional text to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    render(<DevotionalArtifact reference="JHN 14:27" text={'# Title\n\nBody.'} />)
    await userEvent.click(screen.getByRole('button', { name: /copy/i }))
    expect(writeText).toHaveBeenCalledWith('# Title\n\nBody.')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run src/components/artifacts/DevotionalArtifact.test.tsx`
Expected: FAIL — module `./DevotionalArtifact` not found.

- [ ] **Step 3: Create the component**

`frontend/src/components/artifacts/DevotionalArtifact.tsx`:

```tsx
import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { renderMarkdown } from '@/lib/renderMarkdown'
import type { DevotionalArtifactParams } from '@/types/session'

export function DevotionalArtifact({ reference, text }: DevotionalArtifactParams) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
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
        <h2 className="text-sm font-semibold">{reference}</h2>
        <button
          onClick={copy}
          aria-label="Copy devotional"
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
      <div className="text-sm leading-relaxed max-w-prose">{renderMarkdown(text)}</div>
    </div>
  )
}
```

- [ ] **Step 4: Wire it into `ArtifactPane`**

In `frontend/src/components/shell/ArtifactPane.tsx`:

1. Add the imports:

```ts
import { DevotionalArtifact } from '@/components/artifacts/DevotionalArtifact'
import type {
  BookContextResponse,
  EnglishResponse,
  ExplorerResponse,
  GematriaResponse,
  StrongsResponse,
} from '@/types/api'
import type { DevotionalArtifactParams } from '@/types/session'
```

2. In the `status === 'ready' && activeArtifact && !!data` block, add a line after the `english_search` line:

```tsx
                {activeArtifact.type === 'english_search' && <EnglishSearchArtifact data={data as EnglishResponse} />}
                {activeArtifact.type === 'devotional' && (
                  <DevotionalArtifact {...(data as DevotionalArtifactParams)} />
                )}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/components/artifacts/DevotionalArtifact.test.tsx src/components/shell/ArtifactPane.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/artifacts/DevotionalArtifact.tsx frontend/src/components/artifacts/DevotionalArtifact.test.tsx frontend/src/components/shell/ArtifactPane.tsx
git commit -m "feat(chat): DevotionalArtifact pane view

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0118MhC6UKx3em8wQyt2Wzsa"
```

---

## Task 10: `ChatPane` — generating turn, auto-fire, `delivered`

**Files:**
- Modify: `frontend/src/components/shell/ChatPane.tsx`
- Test: `frontend/src/components/shell/ChatPane.test.tsx` (add cases)

**Interfaces:**
- Consumes: `postChatStream(payload, handlers?) -> Promise<ChatApiResponse>` (existing); `useSessionsStore` `appendMessage` / `updateMessage` / `updateModeParams`; `stream_devotional` `final` payload shape from Task 5.
- Produces: within a `devotional` session —
  - `source: 'system'`: exactly one auto-fired generating turn (empty message) on mount when the last message is the assistant ack and no user turn exists.
  - `source: 'user'`: no auto-fire; the user's typed message is the generating turn.
  - the generating turn calls `postChatStream` with **no `onChunk`** (body text never enters the chat bubble; the existing typing indicator covers the wait).
  - `modeParams.delivered` set to `true` only after a generating turn whose resolved `type` is not `'error'`.
  - once `delivered` is `true`, further messages are ordinary streamed chat turns (with `onChunk`).

- [ ] **Step 1: Write the failing tests**

Add to `frontend/src/components/shell/ChatPane.test.tsx`:

```ts
  function devotionalFinal() {
    return {
      type: 'verse',
      message: "Here's a devotional on **JHN 14:27**.",
      data: {
        reference: 'JHN 14:27',
        translations: { 'eng-KJV': 'Peace I leave with you...' },
        book_context: null,
        devotional: '# On Peace\n\nSome words.',
      },
      artifacts: [{
        type: 'devotional',
        label: 'Read the devotional ▸',
        params: { reference: 'JHN 14:27', text: '# On Peace\n\nSome words.' },
      }],
    }
  }

  it('auto-fires the devotional generation for a system-source session', async () => {
    const session = useSessionsStore.getState().createSession('devotional', { source: 'system' })
    useSessionsStore.getState().appendMessage(session.id, { id: 'u1', role: 'user', text: '📖 Devotional' })
    useSessionsStore.getState().appendMessage(session.id, {
      id: 'a1', role: 'assistant', text: 'pick', choicesStatus: 'ready',
      choices: [{ label: "I'll choose", modeParams: { source: 'user' } }],
    })
    useSessionsStore.getState().appendMessage(session.id, { id: 'a2', role: 'assistant', text: 'Let me find a verse for you…' })

    const spy = vi.spyOn(chatApi, 'postChatStream').mockImplementation(async (_payload, handlers) => {
      handlers?.onChunk?.('LEAKED BODY TEXT')
      return devotionalFinal() as never
    })

    render(<ChatPane sessionId={session.id} />)

    expect(await screen.findByText("Here's a devotional on", { exact: false })).toBeInTheDocument()
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ message: '', mode: 'devotional', mode_params: expect.objectContaining({ source: 'system' }) }),
      expect.anything()
    )
    // body text streamed by the mock must NOT appear in the bubble
    expect(screen.queryByText('LEAKED BODY TEXT')).not.toBeInTheDocument()
    // the devotional link (artifact pill) is shown
    expect(screen.getByRole('button', { name: /read the devotional/i })).toBeInTheDocument()
    // delivered flag set
    expect(useSessionsStore.getState().sessions[session.id].modeParams.delivered).toBe(true)
  })

  it('does not auto-fire for a user-source session; the typed message is the generation', async () => {
    const session = useSessionsStore.getState().createSession('devotional', { source: 'user' })
    useSessionsStore.getState().appendMessage(session.id, { id: 'u1', role: 'user', text: '📖 Devotional' })
    useSessionsStore.getState().appendMessage(session.id, {
      id: 'a1', role: 'assistant',
      text: "Tell me a verse reference (e.g. John 3:16) or a theme (e.g. 'facing anxiety'), and I'll write you a devotional.",
    })
    const spy = vi.spyOn(chatApi, 'postChatStream').mockResolvedValue(devotionalFinal() as never)

    render(<ChatPane sessionId={session.id} />)
    expect(spy).not.toHaveBeenCalled()

    await userEvent.type(screen.getByPlaceholderText(/ask about a verse/i), 'Psalm 23')
    await userEvent.click(screen.getByRole('button', { name: /send/i }))

    expect(await screen.findByText("Here's a devotional on", { exact: false })).toBeInTheDocument()
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Psalm 23', mode: 'devotional' }),
      expect.anything()
    )
    expect(useSessionsStore.getState().sessions[session.id].modeParams.delivered).toBe(true)
  })

  it('after delivery, a follow-up is an ordinary streamed chat turn', async () => {
    const session = useSessionsStore.getState().createSession('devotional', { source: 'user', delivered: true })
    useSessionsStore.getState().appendMessage(session.id, {
      id: 'a1', role: 'assistant', text: "Here's a devotional on **JHN 14:27**.", type: 'verse',
      data: { reference: 'JHN 14:27', translations: { 'eng-KJV': '...' } },
      artifacts: [{ type: 'devotional', label: 'Read the devotional ▸', params: { reference: 'JHN 14:27', text: '# d' } }],
    })
    const spy = vi.spyOn(chatApi, 'postChatStream').mockImplementation(async (_payload, handlers) => {
      handlers?.onChunk?.('streaming answer…')
      return { type: 'chat', message: 'The Greek word here is eirēnē.' } as never
    })

    render(<ChatPane sessionId={session.id} />)
    await userEvent.type(screen.getByPlaceholderText(/ask about a verse/i), 'what is the Greek word?')
    await userEvent.click(screen.getByRole('button', { name: /send/i }))

    expect(await screen.findByText('The Greek word here is eirēnē.')).toBeInTheDocument()
    // onChunk output IS rendered for a normal turn (devotional flag not set)
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'what is the Greek word?', mode: 'devotional' }),
      expect.objectContaining({ onChunk: expect.any(Function) })
    )
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/components/shell/ChatPane.test.tsx`
Expected: FAIL — no auto-fire happens (`postChatStream` never called on mount); `delivered` is never set.

- [ ] **Step 3: Make `streamAssistantReply` devotional-aware and return the result**

In `frontend/src/components/shell/ChatPane.tsx`, change `streamAssistantReply` to accept an options arg, skip `onChunk` for a devotional turn, and return the resolved response (or `null` on throw):

```tsx
  const streamAssistantReply = useCallback(
    async (
      assistantId: string,
      payload: Parameters<typeof postChatStream>[0],
      opts?: { devotional?: boolean }
    ) => {
      let started = false
      const put = (patch: Partial<SessionMessage>) => {
        if (!started) {
          started = true
          appendMessage(sessionId, { id: assistantId, role: 'assistant', text: '', ...patch })
        } else {
          updateMessage(sessionId, assistantId, patch)
        }
      }
      try {
        // A devotional generating turn streams over SSE only to keep the
        // connection alive through a multi-minute generation — the body
        // text must not land in the chat bubble (it opens from a link in
        // the artifact pane). So no onChunk: the message is created once,
        // complete, from the final payload; the typing indicator covers
        // the wait.
        const response = await postChatStream(
          payload,
          opts?.devotional ? {} : { onChunk: (text) => put({ text }) }
        )
        put({
          text: response.message,
          type: response.type,
          data: response.data ?? undefined,
          artifacts: response.artifacts,
          followUpQuestions: response.follow_up_questions,
          trace: response.trace,
        })
        return response
      } catch (err) {
        put({ text: 'Sorry, something went wrong: ' + errorMessage(err) })
        return null
      }
    },
    [sessionId, appendMessage, updateMessage]
  )
```

- [ ] **Step 4: Add `generateDevotional` and make `sendMessage` handle the devotional turn**

Add `generateDevotional` (place it after `streamAssistantReply`):

```tsx
  // The devotional generating turn. Used both by the auto-fire effect
  // (source: 'system', empty message) and — via sendMessage — by a typed
  // verse/theme (source: 'user'). `delivered` is set only on a successful
  // result so an error leaves the session retryable.
  const runDevotionalTurn = useCallback(
    async (message: string) => {
      if (!session) return
      const history = session.messages.slice(-6).map((m) => ({ role: m.role, text: m.text }))
      setLoading(true)
      try {
        const response = await streamAssistantReply(
          genId(),
          { message, history, mode: 'devotional', mode_params: { ...session.modeParams } },
          { devotional: true }
        )
        if (response && response.type !== 'error') {
          updateModeParams(sessionId, { delivered: true })
        }
      } finally {
        setLoading(false)
      }
    },
    [session, sessionId, streamAssistantReply, updateModeParams]
  )
```

Change `sendMessage` so a not-yet-delivered devotional session routes through `runDevotionalTurn`:

```tsx
  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || !session) return
      const userMessage: SessionMessage = { id: genId(), role: 'user', text }
      appendMessage(sessionId, userMessage)
      setInput('')

      if (session.mode === 'devotional' && !session.modeParams.delivered) {
        await runDevotionalTurn(text)
        return
      }

      const history = session.messages.slice(-6).map((m) => ({ role: m.role, text: m.text }))
      setLoading(true)
      try {
        await streamAssistantReply(genId(), {
          message: text,
          history,
          mode: session.mode,
          mode_params: { ...session.modeParams },
        })
      } finally {
        setLoading(false)
      }
    },
    [session, sessionId, appendMessage, streamAssistantReply, runDevotionalTurn]
  )
```

- [ ] **Step 5: Add the auto-fire effect**

Add a ref near the other `useState`/`useRef` declarations:

```tsx
  const devotionalAutoFired = useRef(false)
```

Add this effect (near the existing auto-scroll `useEffect`):

```tsx
  // "Pick one for me" devotional: once the pill has resolved (its ack is
  // the last message and the user hasn't typed anything), kick off the
  // generation automatically so there's no extra "generate" tap. Fires at
  // most once per mount; an errored generation is retried from the input,
  // not re-fired.
  useEffect(() => {
    if (!session || session.mode !== 'devotional') return
    if (session.modeParams.source !== 'system' || session.modeParams.delivered) return
    if (devotionalAutoFired.current || isBusy) return
    const hasUserQuestion = session.messages.some(
      (m) => m.role === 'user' && !m.text.startsWith('📖')
    )
    const last = session.messages[session.messages.length - 1]
    if (hasUserQuestion || !last || last.role !== 'assistant' || last.choicesStatus) return
    devotionalAutoFired.current = true
    void runDevotionalTurn('')
  }, [session, isBusy, runDevotionalTurn])
```

Confirm `useRef` is already in the React import at the top of the file (it is: `import { useCallback, useEffect, useRef, useState } from 'react'`).

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/components/shell/ChatPane.test.tsx`
Expected: PASS (the three new cases plus all existing ChatPane cases).

- [ ] **Step 7: Run the full frontend suite + typecheck**

Run: `cd frontend && npx vitest run`
Expected: PASS.
Run: `cd frontend && npx tsc -b --noEmit`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/shell/ChatPane.tsx frontend/src/components/shell/ChatPane.test.tsx
git commit -m "feat(chat): devotional generating turn + auto-fire in ChatPane

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0118MhC6UKx3em8wQyt2Wzsa"
```

---

## Task 11: End-to-end manual smoke + docs

**Files:**
- Modify: `CLAUDE.md` (routes/modes note, if a mode list is present) — optional, only if it lists modes
- No test file

- [ ] **Step 1: Start the services**

Run (two terminals, per `CHATBOT_SETUP.md` / `start-chatbot.sh`):
```bash
./start-chatbot.sh
python myproject.py
```
Ensure an LLM provider is configured in `.env` (`LLM_PROVIDER`, `OLLAMA_API_URL`/`OLLAMA_API_KEY` or `NVIDIA_API_KEY`).

- [ ] **Step 2: Exercise "Pick one for me"**

In the app: open the chat SPA → **Devotional** → **Pick one for me**. Expect: a brief "Let me find a verse for you…" ack, then the typing indicator for the duration of generation (no prose scrolling into the bubble), then a `VerseBubble` with a picked verse and a **"Read the devotional ▸"** pill. Click the pill → the devotional renders in the right-hand pane with a reference heading and formatted paragraphs. Click the pane's copy button → devotional text is on the clipboard.

- [ ] **Step 3: Exercise "I'll choose" with a reference and with a theme**

**Devotional → I'll choose**, type `Psalm 23:1-3` → devotional on that range. New session: **Devotional → I'll choose**, type `dealing with grief` → a fitting verse is picked and a devotional written on it.

- [ ] **Step 4: Follow-up + reload**

After a devotional is delivered, type a follow-up ("what does the Greek/Hebrew here mean?") → it answers as a normal chat turn (streamed, may cite a boxed verse). Reload the page → the devotional message is still there and the "Read the devotional ▸" pill still opens the full text.

- [ ] **Step 5: Error path**

**Devotional → I'll choose**, type a nonsense reference like `Zzz 9:9` → it's treated as a theme and a verse is picked (no hard error). Temporarily unset the LLM provider env and retry a generation → a clean error message in the chat, and the session still accepts another attempt (no `delivered` lock).

- [ ] **Step 6: Commit any doc tweak**

```bash
git add CLAUDE.md
git commit -m "docs: note Devotional mode

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0118MhC6UKx3em8wQyt2Wzsa"
```
(Skip this commit if `CLAUDE.md` has no mode list to update.)

---

## Self-Review

**1. Spec coverage**

| Spec item | Task |
|---|---|
| `'devotional'` SessionMode + `MODE_LABELS` + `deriveTitle` | Task 6 |
| `ModeParams.source` / `.delivered`, `DevotionalArtifactParams` | Task 6 |
| "Devotional" starter with two choice pills | Task 7 |
| Backend primer for the two pill selections (`/chat` buffered) | Task 4 (`build_mode_primer`) |
| Streamed generating turn on `/chat/stream` | Task 5 |
| `chatbot/devotional.py`: prompt template, `resolve_seed_verse`, `pick_verse_for_theme`, fallback rotation, `stream_devotional` | Tasks 2, 3 |
| `max_tokens` param on `_build_request` (default 2048, devotional 3600) | Task 1 |
| Devotional-aware `streamAssistantReply` (discards body chunks) | Task 10 |
| Auto-fire `useEffect` for `source: 'system'` (once, `useRef` guard) | Task 10 |
| `updateModeParams(..., { delivered: true })` after success only | Task 10 (`runDevotionalTurn`, `sendMessage`) |
| `fetchForLink` → `case 'devotional'` (no network) | Task 8 |
| `ArtifactPane` renders `DevotionalArtifact` | Task 9 |
| `DevotionalArtifact.tsx` (reference heading, markdown, copy) | Task 9 |
| `ArtifactLink['type']` union += `'devotional'` (single definition in `session.ts`) | Task 6 |
| `schemas.py` `mode` description mentions `devotional` | Task 5 |
| Post-delivery follow-ups route as `freeform`-equivalent | Task 5 (branch gated on `!delivered`) + Task 10 (`sendMessage`) |
| Error table: theme-pick unparseable → retry → random fallback | Task 2 |
| Error table: empty translations → `DevotionalError` → error result | Tasks 2, 5 |
| Error table: LLM stream error → error result, no `delivered` | Tasks 3, 5, 10 |
| Error table: LLM unconfigured | Task 1 (`stream_devotional_completion` guard) → Task 5 surfaces it |
| Error table: reload mid-generation re-fires once for `system` | Task 10 (`useRef` is per-mount) |
| Backend + frontend test coverage | every task |
| Manual smoke | Task 11 |

> Deviation from the spec, deliberate and behaviour-preserving: the spec's
> illustrative pseudocode put the pill-selection primer text inside an
> `api.py` branch and fetched translations inside `stream_devotional`.
> This plan puts the primer in `build_mode_primer` (matching how `topic`'s
> primer already lives there) and folds the single-verse translations
> fetch into `resolve_seed_verse`. Same responses, same payloads.

**2. Placeholder scan:** No `TBD` / `TODO` / "add error handling" / "write tests for the above" / "similar to Task N". Every code step is a full block; the full devotional prompt text is inlined in Task 2.

**3. Type consistency:**
- `stream_devotional` terminal event keys `text` / `reference` / `translations` — produced in Task 3, consumed identically in Task 5.
- `stream_devotional_completion` event shape `{"type": "stream"|"done"|"error"}` — Task 1 produces, Task 3 consumes.
- `resolve_seed_verse(raw, source) -> (str, dict)` — Task 2 defines, Task 3 calls with `(raw, source)`.
- `ModeParams.source` values `'user'` / `'system'` — Task 6 defines; Tasks 7, 10 use those exact strings; Task 4, 5 read `md.get("source", "user")`.
- Artifact link: `type: 'devotional'`, `label: 'Read the devotional ▸'`, `params: { reference, text }` — emitted in Task 5, consumed in Tasks 8 (`fetchForLink` returns `params`) and 9 (`DevotionalArtifactParams` = `{ reference, text }`).
- `streamAssistantReply(assistantId, payload, opts?)` now returns `ChatApiResponse | null` — Task 10 defines and both callers (`runDevotionalTurn`, regenerate/sendMessage) tolerate the new return (existing callers ignore it).
- `MODE_LABELS` is `Record<SessionMode, string>` — Task 6 adds the `devotional` key so the type stays total.

All consistent.
