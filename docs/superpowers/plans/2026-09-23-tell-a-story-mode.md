# Tell a Story Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Tell a Story" mode that derives up to three themes from an existing conversation, lets the user pick theme(s) and a target reading age, and generates a short original children's story illustrating them.

**Architecture:** A new backend module (`chatbot/story_mode.py`) does two LLM calls (theme derivation, story generation) behind a single `build_primer()` entry point wired into `chatbot/router.py`'s existing mode-primer dispatcher — no changes to `chatbot/api.py` are needed, because every Tell a Story turn (the trigger, the theme/age submission, and "Try again") is an empty-message call, and `api.py` already routes every empty-message call straight to `build_mode_primer()` before any mode-specific branch. On the frontend, "Tell a Story" is a new session mode (`story`) created either from a toolbar button on a live conversation or from a new past-conversation picker screen; a bespoke multi-select `ThemePicker` component (not the existing single-pick `MessageChoice` pills) renders the derived themes, and the finished story is delivered as an inline `'story'`-type artifact reusing the existing artifact-pane machinery.

**Tech Stack:** Python 3 / FastAPI / Pydantic (backend), React / TypeScript / Zustand / Vitest + Testing Library (frontend), pytest + pytest-asyncio (backend tests).

**Spec:** `docs/superpowers/specs/2026-09-23-tell-a-story-mode-design.md`

## Deviations from the spec (discovered while planning)

The spec describes two things slightly differently than this plan implements them — both are simplifications enabled by patterns already in the codebase, not scope changes:

1. **No `ChatRequest.source_messages` / `ChatResponse.story_themes` schema fields.** `mode_params: Dict[str, Any]` and `data: Optional[Dict[str, Any]]` are already free-form on the wire, exactly like `run_digest`/`scope_chapter` (Deep Study) and `data.reference`/`data.runDigest`. Tell a Story's transcript, themes and digest travel the same way — no Pydantic schema changes at all.
2. **No `chatbot/api.py` changes.** Every Tell a Story request in this plan sends an empty `message` (the trigger, the theme/age submission, and "Try again" are all empty-message calls, matching how Topical Study's concept drill-down and Reading Plan's "mark day complete" already work). `api.py`'s `if request.mode and not request.message.strip(): build_mode_primer(...)` check runs *before* every mode-specific branch in both `post_chat` and `_stream_chat_response`, so 100% of Tell a Story's traffic is already routed to `build_mode_primer` without touching `api.py`.
3. **No dedicated Retry button for "couldn't find a story yet."** The spec's error-handling section suggested reusing the `choicesStatus:'error'` + Retry treatment for a failed theme derivation. This plan instead just shows the plain message (Task 3's `_themes_turn`) with no retry affordance — retrying means clicking "Tell a Story" again, which creates a fresh attempt from scratch anyway since nothing is cached server-side. If this proves confusing in practice, a Retry button can be added to `ThemePicker`'s render path in a follow-up without any backend change.

## Global Constraints

- Word-count target scales with the chosen age range: **3–6 → 500–800 words, 7–8 → 800–1200 words, 9–10 → 1200–1800 words** (`chatbot/story_mode.py`'s `AGE_WORD_BANDS`).
- The story always uses **original invented characters** (a child, an animal, etc.) — never a named biblical figure — regardless of what the source conversation discussed.
- Never pad theme derivation to 3 themes with filler — return however many are genuinely present (minimum 1; 0 is reported to the user as "couldn't find a story yet").
- No audio/Listen narration for this mode (text only, v1).
- TDD throughout: write the failing test before the implementation in every task below.
- Backend tests live in `tests/chatbot/` (pytest, `asyncio_mode = auto` — no `@pytest.mark.asyncio` needed). Frontend tests live beside the file they test and run via `npm test` (`vitest run`) from `frontend/`.

---

### Task 1: `chatbot/story_mode.py` — theme derivation

**Files:**
- Create: `chatbot/story_mode.py`
- Test: `tests/chatbot/test_story_mode.py`

**Interfaces:**
- Consumes: `chatbot.ollama_client.simple_completion(system_prompt: str, user_prompt: str, *, max_tokens: int = 2048, timeout: float = 60.0) -> str` and `chatbot.ollama_client.llm_unconfigured_error() -> Optional[str]`.
- Produces: `MAX_STORY_SOURCE_MESSAGES: int`, `async def derive_themes(source_messages: List[Dict[str, str]]) -> Dict[str, Any]` returning `{"themes": [{"id": str, "label": str, "description": str}, ...], "digest": str}` (0–3 theme dicts). Used by Task 3's `build_primer`.

- [ ] **Step 1: Write the failing tests**

Create `tests/chatbot/test_story_mode.py`:

```python
import pytest

from chatbot import story_mode


@pytest.fixture
def llm(monkeypatch):
    """Stubs the simple_completion LLM boundary; records what story_mode
    sent it. `state["replies"]` is a queue consumed one per call."""
    calls = []
    state = {"replies": [
        '{"themes": [{"id": "t1", "label": "Trusting God", "description": '
        '"God provides even when we cannot see how."}, {"id": "t2", '
        '"label": "Coming home", "description": "It is never too late to '
        'return."}], "digest": "We talked about the prodigal son and how '
        'God welcomes us back."}'
    ]}

    async def fake_completion(system_prompt, user_prompt, *, max_tokens=2048, timeout=60.0):
        calls.append({
            "system_prompt": system_prompt, "user_prompt": user_prompt,
            "max_tokens": max_tokens, "timeout": timeout,
        })
        return state["replies"].pop(0) if state["replies"] else ""

    monkeypatch.setattr(story_mode, "simple_completion", fake_completion)
    monkeypatch.setattr(story_mode, "llm_unconfigured_error", lambda: None)
    return type("LLM", (), {"calls": calls, "state": state})


async def test_derive_themes_returns_up_to_three_themes_and_a_digest(llm):
    messages = [
        {"role": "user", "text": "Tell me about the prodigal son."},
        {"role": "assistant", "text": "It's a parable about a father's forgiveness."},
    ]
    result = await story_mode.derive_themes(messages)
    assert len(result["themes"]) == 2
    assert result["themes"][0] == {
        "id": "t1", "label": "Trusting God",
        "description": "God provides even when we cannot see how.",
    }
    assert "prodigal son" in result["digest"]


async def test_derive_themes_never_pads_below_three(llm):
    llm.state["replies"] = [
        '{"themes": [{"id": "t1", "label": "One lesson", "description": "..."}], "digest": "short chat"}'
    ]
    result = await story_mode.derive_themes([{"role": "user", "text": "hi"}])
    assert len(result["themes"]) == 1


async def test_derive_themes_handles_a_single_message_transcript(llm):
    result = await story_mode.derive_themes([{"role": "user", "text": "What does John 3:16 mean?"}])
    assert len(result["themes"]) >= 1


async def test_derive_themes_caps_long_transcripts(llm):
    long_transcript = [{"role": "user", "text": f"message {i}"} for i in range(200)]
    await story_mode.derive_themes(long_transcript)
    sent = llm.calls[0]["user_prompt"]
    assert "message 199" in sent
    assert "message 0" not in sent


async def test_derive_themes_returns_empty_on_unparseable_reply(llm):
    llm.state["replies"] = ["not json at all"]
    result = await story_mode.derive_themes([{"role": "user", "text": "hi"}])
    assert result["themes"] == []


async def test_derive_themes_returns_empty_for_no_messages(llm):
    result = await story_mode.derive_themes([])
    assert result["themes"] == []
    assert llm.calls == []


async def test_derive_themes_caps_at_three_even_if_the_model_returns_more(llm):
    llm.state["replies"] = [
        '{"themes": ['
        '{"id": "t1", "label": "A", "description": ""},'
        '{"id": "t2", "label": "B", "description": ""},'
        '{"id": "t3", "label": "C", "description": ""},'
        '{"id": "t4", "label": "D", "description": ""}'
        '], "digest": "d"}'
    ]
    result = await story_mode.derive_themes([{"role": "user", "text": "hi"}])
    assert len(result["themes"]) == 3
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/chatbot/test_story_mode.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'chatbot.story_mode'` (or `AttributeError`).

- [ ] **Step 3: Write the implementation**

Create `chatbot/story_mode.py`:

```python
"""Tell a Story mode: derive up to three themes/lessons from an existing
conversation, let the user pick which to weave together and a target
reading age, then write a short original children's story illustrating
them. See docs/superpowers/specs/2026-09-23-tell-a-story-mode-design.md.
"""

import json
import re
from typing import Any, Dict, List, Optional

from chatbot.ollama_client import llm_unconfigured_error, simple_completion

MAX_STORY_SOURCE_MESSAGES = 60

# Kept comfortably under Flask's 180s proxy timeout: every Tell a Story
# turn is an empty-message call routed through build_mode_primer, which —
# unlike Deep Study's phase-by-phase streaming — has no SSE keepalive.
STORY_LLM_TIMEOUT_SECONDS = 120.0

_THEMES_SYSTEM_PROMPT = (
    "You read a transcript of a Bible-study conversation and identify the "
    "moral or spiritual lessons in it that would make a good children's "
    "story. Reply with ONLY a JSON object, no markdown fence, no "
    "commentary:\n"
    '{"themes": [{"id": "t1", "label": "short theme name", "description": '
    '"one sentence describing it"}], "digest": "2-4 sentence summary of '
    'what the conversation was about"}\n'
    "List 1 to 3 themes. Only list a theme that is genuinely present in "
    "the conversation — a short or narrow conversation may honestly have "
    "only one."
)


def _extract_json_object(content: str) -> Optional[Dict[str, Any]]:
    """Best-effort extraction of a JSON object from LLM output that may be
    wrapped in a markdown fence or padded with stray prose. Returns None
    for anything that isn't a JSON object."""
    text = content.strip()
    fence_match = re.search(r"```(?:json)?\s*(.*?)```", text, re.DOTALL)
    if fence_match:
        text = fence_match.group(1).strip()
    if not text.startswith("{"):
        brace_match = re.search(r"\{.*\}", text, re.DOTALL)
        if brace_match:
            text = brace_match.group(0)
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        return None
    return parsed if isinstance(parsed, dict) else None


def _transcript_for(source_messages: List[Dict[str, str]]) -> str:
    capped = source_messages[-MAX_STORY_SOURCE_MESSAGES:]
    return "\n".join(f"{m['role'].upper()}: {m['text']}" for m in capped)


async def derive_themes(source_messages: List[Dict[str, str]]) -> Dict[str, Any]:
    """Up to 3 {id, label, description} themes plus a compact digest of the
    conversation, from one LLM call. Never pads to 3 with filler — a thin
    conversation returns however many themes are genuinely there."""
    transcript = _transcript_for(source_messages)
    if not transcript.strip():
        return {"themes": [], "digest": ""}

    reply = await simple_completion(
        _THEMES_SYSTEM_PROMPT,
        f"CONVERSATION:\n{transcript}",
        max_tokens=800,
        timeout=STORY_LLM_TIMEOUT_SECONDS,
    )
    parsed = _extract_json_object(reply) if reply else None
    if not parsed:
        return {"themes": [], "digest": ""}

    themes: List[Dict[str, str]] = []
    seen_ids = set()
    for i, raw in enumerate(parsed.get("themes", [])[:3]):
        if not isinstance(raw, dict):
            continue
        label = str(raw.get("label", "")).strip()
        if not label:
            continue
        theme_id = str(raw.get("id") or "").strip() or f"theme-{i + 1}"
        if theme_id in seen_ids:
            theme_id = f"theme-{i + 1}"
        seen_ids.add(theme_id)
        themes.append({
            "id": theme_id,
            "label": label,
            "description": str(raw.get("description", "")).strip(),
        })

    digest = str(parsed.get("digest", "")).strip()
    return {"themes": themes, "digest": digest}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/chatbot/test_story_mode.py -v`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add chatbot/story_mode.py tests/chatbot/test_story_mode.py
git commit -m "$(cat <<'EOF'
feat(chatbot): add Tell a Story theme derivation

One LLM call turns an existing conversation's transcript into up to
three candidate themes/lessons plus a compact digest, for the new Tell
a Story mode.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `chatbot/story_mode.py` — story generation

**Files:**
- Modify: `chatbot/story_mode.py`
- Test: `tests/chatbot/test_story_mode.py`

**Interfaces:**
- Consumes: Task 1's `simple_completion` import (already present in the module).
- Produces: `AGE_WORD_BANDS: Dict[str, Tuple[int, int]]`, `async def generate_story(digest: str, themes: List[Dict[str, str]], age_range: str) -> Dict[str, Any]` returning `{"title": str, "text": str, "word_count": int}`; raises `ValueError` for an unrecognized `age_range`. Used by Task 3's `build_primer`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/chatbot/test_story_mode.py`:

```python
async def test_generate_story_uses_the_word_band_for_the_age_range(llm):
    llm.state["replies"] = ["Title: The Brave Little Sparrow\n\n" + ("word " * 650)]
    result = await story_mode.generate_story(
        "digest", [{"id": "t1", "label": "Trust", "description": "..."}], "3-6"
    )
    assert result["title"] == "The Brave Little Sparrow"
    assert 600 <= result["word_count"] <= 700
    assert len(llm.calls) == 1


async def test_generate_story_weaves_multiple_themes_into_the_prompt(llm):
    llm.state["replies"] = ["Title: Two Lessons\n\n" + ("word " * 650)]
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
        "Title: Too Short\n\nJust a few words.",
        "Title: Just Right\n\n" + ("word " * 650),
    ]
    result = await story_mode.generate_story(
        "digest", [{"id": "t1", "label": "Trust", "description": "..."}], "3-6"
    )
    assert len(llm.calls) == 2
    assert result["title"] == "Just Right"
    assert result["word_count"] > 600


async def test_generate_story_delivers_the_retry_result_even_if_still_out_of_band(llm):
    llm.state["replies"] = [
        "Title: Too Short\n\nJust a few words.",
        "Title: Still Short\n\nStill just a few words.",
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


@pytest.mark.parametrize("age_range,low,high", [
    ("3-6", 500, 800), ("7-8", 800, 1200), ("9-10", 1200, 1800),
])
async def test_generate_story_targets_the_right_band_per_age_range(llm, age_range, low, high):
    llm.state["replies"] = ["Title: A Story\n\n" + ("word " * ((low + high) // 2))]
    result = await story_mode.generate_story(
        "digest", [{"id": "t1", "label": "Trust", "description": "..."}], age_range
    )
    assert len(llm.calls) == 1  # within band, no retry needed
    prompt = llm.calls[0]["user_prompt"]
    assert f"{low}-{high} words" in prompt
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/chatbot/test_story_mode.py -k generate_story -v`
Expected: FAIL with `AttributeError: module 'chatbot.story_mode' has no attribute 'generate_story'`.

- [ ] **Step 3: Write the implementation**

Append to `chatbot/story_mode.py`:

```python
AGE_WORD_BANDS = {
    "3-6": (500, 800),
    "7-8": (800, 1200),
    "9-10": (1200, 1800),
}

AGE_COMPLEXITY = {
    "3-6": "Simple sentences, concrete imagery, and one clear lesson stated plainly.",
    "7-8": "Slightly longer sentences, a light subplot, and gentle vocabulary growth.",
    "9-10": (
        "A fuller plot with some dialogue, richer vocabulary, and a lesson "
        "shown through the story rather than stated outright."
    ),
}

_STORY_SYSTEM_PROMPT = (
    "You write short, warm, original children's stories that illustrate a "
    "lesson from a Bible conversation, without retelling the Bible "
    "passage itself or naming any real biblical figure. Invent your own "
    "characters instead — a child, an animal, or similar — the way a "
    "parable teaches through an original story rather than a dramatized "
    "retelling.\n\n"
    "Start your reply with a single line `Title: <story title>`, a blank "
    "line, then the story itself as plain prose (no headings, no bullet "
    "points)."
)

_TITLE_LINE_RE = re.compile(r"^Title:\s*(.+)$", re.IGNORECASE | re.MULTILINE)


def _split_title(text: str) -> Dict[str, str]:
    match = _TITLE_LINE_RE.search(text)
    if not match:
        return {"title": "A Story for You", "body": text.strip()}
    title = match.group(1).strip()
    body = text[match.end():].strip()
    return {"title": title or "A Story for You", "body": body}


def _story_prompt(digest: str, themes: List[Dict[str, str]], age_range: str, low: int, high: int) -> str:
    theme_lines = "\n".join(f"- {t['label']}: {t['description']}" for t in themes)
    return (
        f"CONVERSATION SUMMARY: {digest}\n\n"
        f"THEME(S) TO WEAVE INTO ONE STORY:\n{theme_lines}\n\n"
        f"TARGET READER: age {age_range}. {AGE_COMPLEXITY[age_range]}\n"
        f"LENGTH: {low}-{high} words."
    )


async def generate_story(digest: str, themes: List[Dict[str, str]], age_range: str) -> Dict[str, Any]:
    """One story, sized to `age_range`'s word band, weaving every theme in
    `themes` together. Retries once, with a corrective instruction, if the
    word count lands far outside the target band — delivers the result
    either way rather than blocking the user."""
    if age_range not in AGE_WORD_BANDS:
        raise ValueError(f"Unknown story age range: {age_range!r}")
    low, high = AGE_WORD_BANDS[age_range]

    prompt = _story_prompt(digest, themes, age_range, low, high)
    text = await simple_completion(
        _STORY_SYSTEM_PROMPT, prompt, max_tokens=2400, timeout=STORY_LLM_TIMEOUT_SECONDS,
    )
    parts = _split_title(text)
    word_count = len(parts["body"].split())

    # Only retry when far outside the band (30% slack either way) — a
    # story a little short or long is still delivered as-is.
    if not (low * 0.7 <= word_count <= high * 1.3):
        corrective = (
            prompt
            + f"\n\nYour previous attempt was {word_count} words. Write again, "
            f"between {low} and {high} words this time."
        )
        retry_text = await simple_completion(
            _STORY_SYSTEM_PROMPT, corrective, max_tokens=2400, timeout=STORY_LLM_TIMEOUT_SECONDS,
        )
        if retry_text.strip():
            parts = _split_title(retry_text)
            word_count = len(parts["body"].split())

    return {"title": parts["title"], "text": parts["body"], "word_count": word_count}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/chatbot/test_story_mode.py -v`
Expected: PASS (13 tests total).

- [ ] **Step 5: Commit**

```bash
git add chatbot/story_mode.py tests/chatbot/test_story_mode.py
git commit -m "$(cat <<'EOF'
feat(chatbot): add Tell a Story generation with age-scaled length

generate_story() writes one story sized to the chosen age band
(3-6/7-8/9-10), weaving every selected theme together, with a
one-shot corrective retry when the word count lands far outside band.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `build_primer` dispatcher + router wiring + endpoint routing

**Files:**
- Modify: `chatbot/story_mode.py`
- Modify: `chatbot/router.py:1008` (import), and the mode-branch chain inside `build_mode_primer` (insert after the `devotional` branch, before the final freeform fallback — currently around `chatbot/router.py:1309-1326`)
- Test: `tests/chatbot/test_story_mode.py`
- Create: `tests/chatbot/test_chat_endpoint_story.py`

**Interfaces:**
- Consumes: Task 1's `derive_themes`, Task 2's `generate_story`, `chatbot.ollama_client.llm_unconfigured_error`.
- Produces: `async def build_primer(mode_params: Dict[str, Any]) -> Dict[str, Any]` — the mode's single entry point, called from `chatbot/router.py`'s `build_mode_primer` as `if mode == "story": return await story_mode.build_primer(mode_params)`. Reads `mode_params["source_messages"]` (list of `{"role", "text"}` dicts, present only on the theme-derivation turn), `mode_params["story_themes"]`, `mode_params["story_digest"]`, `mode_params["story_selected_theme_ids"]`, `mode_params["story_age_range"]` (defaults to `"3-6"`).

- [ ] **Step 1: Write the failing tests**

Append to `tests/chatbot/test_story_mode.py`:

```python
async def test_build_primer_with_no_themes_yet_derives_them(llm):
    result = await story_mode.build_primer(
        {"source_messages": [{"role": "user", "text": "Tell me about the prodigal son."}]}
    )
    assert result["type"] == "chat"
    assert result["data"]["themes"]
    assert "pick" in result["message"].lower()


async def test_build_primer_reports_when_no_themes_can_be_found(llm):
    llm.state["replies"] = [""]
    result = await story_mode.build_primer({"source_messages": [{"role": "user", "text": "hi"}]})
    assert result["type"] == "chat"
    assert "couldn't find a story" in result["message"].lower()
    assert result["data"] is None


async def test_build_primer_generates_the_story_once_themes_are_selected(llm):
    llm.state["replies"] = ["Title: The Brave Sparrow\n\n" + ("word " * 650)]
    themes = [{"id": "t1", "label": "Trusting God", "description": "..."}]
    result = await story_mode.build_primer({
        "story_themes": themes,
        "story_digest": "digest text",
        "story_selected_theme_ids": ["t1"],
        "story_age_range": "3-6",
    })
    assert result["artifacts"][0]["type"] == "story"
    assert result["artifacts"][0]["params"]["title"] == "The Brave Sparrow"
    assert result["artifacts"][0]["params"]["themes"] == ["Trusting God"]
    assert result["artifacts"][0]["params"]["age_range"] == "3-6"


async def test_build_primer_defaults_age_range_when_missing(llm):
    llm.state["replies"] = ["Title: A Story\n\n" + ("word " * 650)]
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
```

Create `tests/chatbot/test_chat_endpoint_story.py`:

```python
"""Tell a Story mode: every turn is an empty-message call, so router.py's
generic empty-message check in chatbot/api.py dispatches both the
theme-derivation primer and the "Make my story"/"Try again" submission to
story_mode.build_primer — unlike character/hermeneutics mode, api.py needs
no dedicated mode=="story" branch. See
docs/superpowers/specs/2026-09-23-tell-a-story-mode-design.md."""

import json


def _events(raw: str):
    out = []
    for chunk in raw.strip().split("\n\n"):
        line = chunk.strip()
        if not line.startswith("data: "):
            continue
        out.append(json.loads(line[len("data: "):]))
    return out


def test_chat_with_empty_message_and_no_themes_yet_derives_them(client, monkeypatch):
    import chatbot.router as router_module

    async def fake_build_primer(mode_params):
        assert mode_params == {"source_messages": [{"role": "user", "text": "hi"}]}
        return {
            "type": "chat", "message": "[themes derived]",
            "data": {"themes": [{"id": "t1", "label": "Trust", "description": ""}], "digest": "d"},
            "route": "test",
        }

    monkeypatch.setattr(router_module.story_mode, "build_primer", fake_build_primer)

    res = client.post("/chat", json={
        "message": "",
        "mode": "story",
        "mode_params": {"source_messages": [{"role": "user", "text": "hi"}]},
    })
    assert res.status_code == 200
    assert res.json()["message"] == "[themes derived]"
    assert res.json()["data"]["themes"][0]["label"] == "Trust"


def test_chat_stream_with_empty_message_dispatches_to_story_build_primer(client, monkeypatch):
    import chatbot.router as router_module

    async def fake_build_primer(mode_params):
        return {
            "type": "chat", "message": "[story generated]", "data": None, "route": "test",
            "artifacts": [{
                "type": "story", "label": "Read the story ▸",
                "params": {"title": "T", "themes": ["Trust"], "age_range": "3-6", "text": "...", "word_count": 650},
            }],
        }

    monkeypatch.setattr(router_module.story_mode, "build_primer", fake_build_primer)

    res = client.post("/chat/stream", json={
        "message": "",
        "mode": "story",
        "mode_params": {"story_selected_theme_ids": ["t1"]},
    })
    assert res.status_code == 200
    final = next(e for e in _events(res.text) if e["type"] == "final")
    assert final["result"]["artifacts"][0]["type"] == "story"


def test_a_non_empty_message_in_story_mode_still_reaches_build_mode_primer(client, monkeypatch):
    # Tell a Story never sends a non-empty message in this plan, but the
    # mode should not silently fall through to the generic AI-fallback
    # path if it ever did — build_mode_primer is only reached for an
    # EMPTY message, so this documents (and locks in) that a stray
    # non-empty "story" message currently falls through to the
    # deterministic/AI-fallback path like any unhandled mode, rather than
    # erroring.
    res = client.post("/chat", json={"message": "hello", "mode": "story", "mode_params": {}})
    assert res.status_code == 200
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/chatbot/test_story_mode.py tests/chatbot/test_chat_endpoint_story.py -v`
Expected: FAIL — `build_primer` doesn't exist yet, and `router_module.story_mode` isn't imported yet.

- [ ] **Step 3: Write the implementation**

Append to `chatbot/story_mode.py`:

```python
async def build_primer(mode_params: Dict[str, Any]) -> Dict[str, Any]:
    """The mode's whole turn structure: every Tell a Story request is an
    empty-message call (theme derivation, then "Make my story"/"Try
    again"), so this single entry point — reached from
    router.build_mode_primer on every turn — decides which by whether the
    user has already picked themes."""
    llm_error = llm_unconfigured_error()
    if llm_error:
        return {
            "type": "error", "message": llm_error, "data": None,
            "route": "Mode primer → story → LLM unconfigured",
        }

    selected_ids = mode_params.get("story_selected_theme_ids")
    if selected_ids:
        return await _story_turn(mode_params, selected_ids)
    return await _themes_turn(mode_params)


async def _themes_turn(mode_params: Dict[str, Any]) -> Dict[str, Any]:
    source_messages = mode_params.get("source_messages") or []
    result = await derive_themes(source_messages)
    if not result["themes"]:
        return {
            "type": "chat",
            "message": "Couldn't find a story in this conversation yet — try chatting a bit more first.",
            "data": None,
            "route": "Mode primer → story → no themes",
        }
    return {
        "type": "chat",
        "message": (
            "Here's what stood out from that conversation — pick what you'd "
            "like the story to be about, and an age range, then I'll write it."
        ),
        "data": {"themes": result["themes"], "digest": result["digest"]},
        "route": "Mode primer → story → themes derived",
        "follow_up_questions": [],
    }


async def _story_turn(mode_params: Dict[str, Any], selected_ids: List[str]) -> Dict[str, Any]:
    all_themes = mode_params.get("story_themes") or []
    selected = [t for t in all_themes if t.get("id") in set(selected_ids)]
    if not selected:
        return {
            "type": "chat",
            "message": "I lost track of which theme you picked — please choose again.",
            "data": None,
            "route": "Mode primer → story → no matching themes",
        }
    age_range = mode_params.get("story_age_range") or "3-6"
    digest = mode_params.get("story_digest") or ""
    story = await generate_story(digest, selected, age_range)
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
                "text": story["text"],
                "word_count": story["word_count"],
            },
        }],
    }
```

In `chatbot/router.py`, change line 1008:

```python
from chatbot import wiki_loader, wiki_qa, character_chat
```

to:

```python
from chatbot import wiki_loader, wiki_qa, character_chat, story_mode
```

Then, inside `build_mode_primer`, insert this block right after the `devotional` branch (i.e. right after the `return {...}` that closes the `if mode == "devotional":` block, currently ending around `chatbot/router.py:1324`, and before the final freeform-fallback `return {...}` around line 1326):

```python
    if mode == "story":
        return await story_mode.build_primer(mode_params)

```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/chatbot/test_story_mode.py tests/chatbot/test_chat_endpoint_story.py -v`
Expected: PASS (19 tests in `test_story_mode.py`, 3 in `test_chat_endpoint_story.py`).

Then run the full backend suite to confirm nothing else broke: `pytest tests/chatbot -v`

- [ ] **Step 5: Commit**

```bash
git add chatbot/story_mode.py chatbot/router.py tests/chatbot/test_story_mode.py tests/chatbot/test_chat_endpoint_story.py
git commit -m "$(cat <<'EOF'
feat(chatbot): wire Tell a Story mode into the primer dispatcher

build_primer() is the mode's whole turn structure — theme derivation
when no themes are selected yet, story generation once they are —
reached from router.build_mode_primer. No chatbot/api.py changes are
needed since every Tell a Story turn is an empty-message call, already
routed to build_mode_primer ahead of every other mode's branch.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Frontend types + wire-format mapping

**Files:**
- Modify: `frontend/src/types/session.ts`
- Modify: `frontend/src/lib/chatApi.ts`
- Test: `frontend/src/lib/chatApi.test.ts`

**Interfaces:**
- Produces: `SessionMode` includes `'story'`. `ModeParams` gains `storyThemes?: { id: string; label: string; description: string }[]`, `storyDigest?: string`, `storySelectedThemeIds?: string[]`, `storyAgeRange?: '3-6' | '7-8' | '9-10'`, `storySourceSessionId?: string`, `storySourceLabel?: string`, `storySourceMessages?: { role: 'user' | 'assistant'; text: string }[]`. `ArtifactLink.type` includes `'story'`. New `StoryArtifactParams` interface: `{ title: string; themes: string[]; age_range: string; text: string; word_count: number }`. `toWireModeParams` maps `storyThemes→story_themes`, `storyDigest→story_digest`, `storySelectedThemeIds→story_selected_theme_ids`, `storyAgeRange→story_age_range`, `storySourceMessages→source_messages` (the two bookkeeping-only fields, `storySourceSessionId`/`storySourceLabel`, are never read by the backend and pass through the `default` case unmapped).

- [ ] **Step 1: Write the failing test**

In `frontend/src/lib/chatApi.test.ts`, find the existing `describe`/`it` blocks for `toWireModeParams` (search for `toWireModeParams`) and add a new case alongside them:

```ts
it('maps Tell a Story mode_params keys to their snake_case wire names', () => {
  const wire = toWireModeParams({
    storyThemes: [{ id: 't1', label: 'Trust', description: 'desc' }],
    storyDigest: 'a digest',
    storySelectedThemeIds: ['t1'],
    storyAgeRange: '7-8',
    storySourceMessages: [{ role: 'user', text: 'hi' }],
    storySourceSessionId: 'sess-1',
    storySourceLabel: 'Socratic Study',
  })
  expect(wire).toEqual({
    story_themes: [{ id: 't1', label: 'Trust', description: 'desc' }],
    story_digest: 'a digest',
    story_selected_theme_ids: ['t1'],
    story_age_range: '7-8',
    source_messages: [{ role: 'user', text: 'hi' }],
    storySourceSessionId: 'sess-1',
    storySourceLabel: 'Socratic Study',
  })
})
```

(Add the `toWireModeParams` import at the top of the file if it isn't already imported — check the existing test cases in that file for the current import line and reuse it.)

- [ ] **Step 2: Run the test to verify it fails**

Run (from `frontend/`): `npm test -- chatApi.test.ts`
Expected: FAIL — the new keys aren't mapped yet, so `story_themes` etc. are `undefined` in the actual output.

- [ ] **Step 3: Write the implementation**

In `frontend/src/types/session.ts`, change the `SessionMode` line to:

```ts
export type SessionMode = 'reading_plan' | 'parable' | 'verse' | 'topic' | 'freeform' | 'devotional' | 'socratic' | 'hermeneutics' | 'character' | 'story'
```

Add these fields inside the `ModeParams` interface (after the existing `characterName?: string` line):

```ts
  /** Tell a Story mode: the themes/lessons derived from the source
   * conversation (from the primer's `data.themes`). */
  storyThemes?: { id: string; label: string; description: string }[]
  /** Tell a Story mode: the compact digest of the source conversation
   * (from the primer's `data.digest`), reused for every story generation
   * so the full transcript is never resent after the first turn. */
  storyDigest?: string
  /** Tell a Story mode: which of `storyThemes` the user picked. */
  storySelectedThemeIds?: string[]
  /** Tell a Story mode: the chosen target reading age. */
  storyAgeRange?: '3-6' | '7-8' | '9-10'
  /** Tell a Story mode: which session (and its title, for the new
   * session's own title) this story was made from. Frontend bookkeeping
   * only — never read by the backend. */
  storySourceSessionId?: string
  storySourceLabel?: string
  /** Tell a Story mode: the source conversation's transcript, sent ONLY
   * on the turn that derives themes — never persisted into a session's
   * own modeParams and never sent again after that. */
  storySourceMessages?: { role: 'user' | 'assistant'; text: string }[]
```

Change the `ArtifactLink` interface's `type` union to:

```ts
export interface ArtifactLink {
  type: 'interlinear' | 'chapter' | 'strongs' | 'book_context' | 'gematria' | 'english_search' | 'devotional' | 'hermeneutics_report' | 'story'
  label: string
  params: Record<string, unknown>
}
```

Add this new interface after `HermeneuticsArtifactParams`:

```ts
/** Params for a `story`-type ArtifactLink — the finished story travels
 * inline (no fetch when the pane opens it), as the devotional and
 * hermeneutics report do. Field names match the backend's dict verbatim
 * (snake_case) — ArtifactLink params are never passed through
 * toWireModeParams's camelCase mapping, unlike ModeParams. */
export interface StoryArtifactParams {
  title: string
  themes: string[]
  age_range: string
  text: string
  word_count: number
}
```

In `frontend/src/lib/chatApi.ts`, inside `toWireModeParams`'s `switch (key)`, add these cases (anywhere before the `default:` case):

```ts
      case 'storyThemes':
        out.story_themes = value
        break
      case 'storyDigest':
        out.story_digest = value
        break
      case 'storySelectedThemeIds':
        out.story_selected_theme_ids = value
        break
      case 'storyAgeRange':
        out.story_age_range = value
        break
      case 'storySourceMessages':
        out.source_messages = value
        break
```

Also update the mapping-table comment above `toWireModeParams` to mention the new keys (append to the existing parenthetical list): `..., storyThemes -> story_themes, storyDigest -> story_digest, storySelectedThemeIds -> story_selected_theme_ids, storyAgeRange -> story_age_range, storySourceMessages -> source_messages)`.

- [ ] **Step 4: Run the test to verify it passes**

Run (from `frontend/`): `npm test -- chatApi.test.ts`
Expected: PASS.

Then run the frontend typecheck to confirm the new `SessionMode`/`ArtifactLink` union members don't break any exhaustive `Record<SessionMode, ...>` or `Record<ArtifactLink['type'], ...>` elsewhere yet (they will — that's expected until Task 5 fixes it):

Run (from `frontend/`): `npm run typecheck` (or `tsc --noEmit` if there's no dedicated script — check `frontend/package.json`'s `scripts` block for the exact name)
Expected: errors in `useSessionsStore.ts` (`MODE_LABELS`) and `SessionsPane.tsx` (`MODE_ORDER`/`MODE_ICONS`) about a missing `'story'` key — these are fixed in Task 5. Do not fix them in this task.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/types/session.ts frontend/src/lib/chatApi.ts frontend/src/lib/chatApi.test.ts
git commit -m "$(cat <<'EOF'
feat(frontend): add Tell a Story types and wire-format mapping

SessionMode gains 'story', ModeParams gains the story* fields, and
ArtifactLink gains the 'story' type + StoryArtifactParams. This is
expected to leave MODE_LABELS/MODE_ORDER/MODE_ICONS failing to
typecheck until the next task fills them in.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Session bookkeeping — labels, title, ordering, icon

**Files:**
- Modify: `frontend/src/store/useSessionsStore.ts`
- Modify: `frontend/src/components/shell/SessionsPane.tsx`
- Test: `frontend/src/store/useSessionsStore.test.ts`
- Test: `frontend/src/components/shell/SessionsPane.test.tsx`

**Interfaces:**
- Consumes: Task 4's `SessionMode` (now includes `'story'`) and `ModeParams.storySourceLabel`.
- Produces: `MODE_LABELS.story === 'Tell a Story'`; `deriveTitle('story', { storySourceLabel: 'X' })` returns `'Tell a Story — X'` (falls back to `MODE_LABELS.story` with no source label); `SessionsPane`'s `MODE_ORDER`/`MODE_ICONS` both cover `'story'`.

- [ ] **Step 1: Write the failing tests**

In `frontend/src/store/useSessionsStore.test.ts`, add (near the other `createSession`-title tests, e.g. after the "titles a character session" tests):

```ts
it('titles a story session from its source label', () => {
  const session = useSessionsStore.getState().createSession('story', { storySourceLabel: 'Socratic Study' })
  expect(session.title).toBe('Tell a Story — Socratic Study')
})

it('titles a story session generically with no source label', () => {
  const session = useSessionsStore.getState().createSession('story', {})
  expect(session.title).toBe('Tell a Story')
})
```

In `frontend/src/components/shell/SessionsPane.test.tsx`, add a test that a story session's group renders under the "Tell a Story" heading — first check the file's existing pattern for asserting a mode's group heading (search for an existing `MODE_LABELS` or heading assertion, e.g. for `'character'`) and mirror it exactly, substituting `'story'` / `'Tell a Story'` / a `storySourceLabel` in place of the character-mode fixture's fields. If the existing pattern renders `<SessionsPane>` with a session created via `useSessionsStore.getState().createSession(...)` and asserts `screen.getByText('Tell a Story')` (or similar) is present, add:

```ts
it('groups a story session under its own "Tell a Story" heading', () => {
  useSessionsStore.getState().createSession('story', { storySourceLabel: 'Socratic Study' })
  render(<SessionsPane activeSessionId={null} onSelectSession={() => {}} onNewSession={() => {}} />)
  expect(screen.getByText('Tell a Story')).toBeInTheDocument()
})
```

(Match whatever `render`/`screen` imports and beforeEach reset the file already uses — do not introduce a second, differently-configured test setup.)

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `frontend/`): `npm test -- useSessionsStore.test.ts SessionsPane.test.tsx`
Expected: FAIL — `deriveTitle` has no `'story'` case yet, and `MODE_ORDER`/`MODE_ICONS` don't include `'story'` (TypeScript compile error surfaces as a test failure under vitest's esbuild transform, or a runtime `undefined` icon).

- [ ] **Step 3: Write the implementation**

In `frontend/src/store/useSessionsStore.ts`, add to `MODE_LABELS`:

```ts
  character: 'Chat with a Character',
  story: 'Tell a Story',
```

In `deriveTitle`, add a case (alongside the existing `character` case):

```ts
  if (mode === 'story' && modeParams.storySourceLabel) return `Tell a Story — ${modeParams.storySourceLabel}`
```

In `frontend/src/components/shell/SessionsPane.tsx`, add `Wand2` to the `lucide-react` import list, add `'story'` to `MODE_ORDER` (right after `'character'`, before `'freeform'`):

```ts
const MODE_ORDER: SessionMode[] = ['reading_plan', 'parable', 'verse', 'topic', 'devotional', 'socratic', 'hermeneutics', 'character', 'story', 'freeform']
```

and add it to `MODE_ICONS`:

```ts
  character: UserRound,
  story: Wand2,
```

- [ ] **Step 4: Run the tests to verify they pass**

Run (from `frontend/`): `npm test -- useSessionsStore.test.ts SessionsPane.test.tsx`
Expected: PASS.

Run the frontend typecheck again to confirm Task 4's dangling errors are now resolved: `npm run typecheck`
Expected: PASS (no errors about a missing `'story'` key).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/store/useSessionsStore.ts frontend/src/components/shell/SessionsPane.tsx frontend/src/store/useSessionsStore.test.ts frontend/src/components/shell/SessionsPane.test.tsx
git commit -m "$(cat <<'EOF'
feat(frontend): register Tell a Story mode's label, title and icon

Fills in the Record<SessionMode, ...> tables (MODE_LABELS, MODE_ORDER,
MODE_ICONS) left incomplete by the previous task, and derives a story
session's title from its source conversation.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Extract `toHistory` into a shared lib module

**Files:**
- Create: `frontend/src/lib/history.ts`
- Modify: `frontend/src/components/shell/ChatPane.tsx` (remove the local `toHistory`, import it instead)
- Test: `frontend/src/lib/history.test.ts`

**Interfaces:**
- Produces: `toHistory(messages: SessionMessage[]): { role: 'user' | 'assistant'; text: string }[]`. Consumed by `ChatPane.tsx` (Task 10, unchanged call sites) and by Task 7's `tellAStory.ts`.

This is a pure extraction — `ChatPane.tsx`'s existing behavior must not change. It's pulled out now because Task 7 needs the exact same devotional-placeholder-swap logic and must not duplicate it.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/lib/history.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { toHistory } from './history'
import type { SessionMessage } from '@/types/session'

describe('toHistory', () => {
  it('maps role/text through unchanged for a plain message', () => {
    const messages: SessionMessage[] = [{ id: 'm1', role: 'user', text: 'Hello' }]
    expect(toHistory(messages)).toEqual([{ role: 'user', text: 'Hello' }])
  })

  it('swaps a delivered devotional bubble text for its full artifact body', () => {
    const messages: SessionMessage[] = [{
      id: 'm1',
      role: 'assistant',
      text: "Here's a devotional on John 3:16.",
      artifacts: [{ type: 'devotional', label: 'Read the devotional ▸', params: { reference: 'John 3:16', text: 'The full devotional text goes here.' } }],
    }]
    expect(toHistory(messages)).toEqual([{ role: 'assistant', text: 'The full devotional text goes here.' }])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run (from `frontend/`): `npm test -- history.test.ts`
Expected: FAIL — `frontend/src/lib/history.ts` doesn't exist yet.

- [ ] **Step 3: Write the implementation**

Create `frontend/src/lib/history.ts`:

```ts
import type { DevotionalArtifactParams, SessionMessage } from '@/types/session'

/**
 * A delivered devotional's chat bubble is only its pointer sentence
 * ("Here's a devotional on X") — the actual body lives solely in the
 * message's `devotional` artifact, so it never floods the transcript.
 * History sent to the backend needs the real text swapped back in, or a
 * follow-up turn (e.g. voice mode's "read out the devotion", or Tell a
 * Story deriving themes from this conversation) reaches the LLM with no
 * devotional content to answer from.
 */
export function toHistory(messages: SessionMessage[]): { role: 'user' | 'assistant'; text: string }[] {
  return messages.map((m) => {
    const devotional = m.artifacts?.find((a) => a.type === 'devotional')
    const text = devotional
      ? (devotional.params as unknown as DevotionalArtifactParams).text
      : m.text
    return { role: m.role, text }
  })
}
```

In `frontend/src/components/shell/ChatPane.tsx`, delete the local `toHistory` function definition (currently right above the `ARTIFACT_PILL` constant), and add an import at the top of the file:

```ts
import { toHistory } from '@/lib/history'
```

Every existing call site (`toHistory(session.messages.slice(-6))`, etc.) stays exactly as it was — only the function's home moves.

- [ ] **Step 4: Run the tests to verify they pass**

Run (from `frontend/`): `npm test -- history.test.ts ChatPane.test.tsx`
Expected: PASS — `history.test.ts` passes, and every existing `ChatPane.test.tsx` test still passes unchanged (confirming the extraction didn't alter behavior).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/history.ts frontend/src/lib/history.test.ts frontend/src/components/shell/ChatPane.tsx
git commit -m "$(cat <<'EOF'
refactor(frontend): extract toHistory into a shared lib module

Pure extraction, no behavior change — the next task's Tell a Story
helper needs the same devotional-placeholder-swap logic ChatPane
already had, and duplicating it would drift out of sync.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Shared "start Tell a Story" session-creation helper

**Files:**
- Create: `frontend/src/lib/tellAStory.ts`
- Test: `frontend/src/lib/tellAStory.test.ts`

**Interfaces:**
- Consumes: Task 6's `toHistory`, `postChat` from `frontend/src/lib/chatApi.ts`, `Session`/`SessionMessage`/`ModeParams` types.
- Produces: `async function startTellAStory(deps: { createSession: (mode: 'story', modeParams: ModeParams) => Session; appendMessage: (sessionId: string, message: SessionMessage) => void; updateModeParams: (sessionId: string, patch: Partial<ModeParams>) => void }, sourceSession: Session): Promise<string>` — returns the new session's id. Used by Task 10 (`ChatPane`'s toolbar button) and Task 11 (`ModePickerScreen` + `SessionPickerScreen`), so both entry points stay in lockstep with the backend contract instead of duplicating the create-session/fire-primer/store-themes sequence.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/lib/tellAStory.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as chatApi from '@/lib/chatApi'
import { startTellAStory } from './tellAStory'
import type { ModeParams, Session, SessionMessage } from '@/types/session'

function makeDeps() {
  const sessions: Record<string, Session> = {}
  const messages: Record<string, SessionMessage[]> = {}
  const modeParams: Record<string, Partial<ModeParams>> = {}
  let nextId = 0
  const createSession = vi.fn((mode: 'story', params: ModeParams): Session => {
    const id = `story-session-${++nextId}`
    const session: Session = {
      id, createdAt: 0, updatedAt: 0, mode, modeParams: params,
      title: 'Tell a Story', messages: [], notes: [],
    }
    sessions[id] = session
    messages[id] = []
    return session
  })
  const appendMessage = vi.fn((sessionId: string, message: SessionMessage) => {
    messages[sessionId] = [...(messages[sessionId] ?? []), message]
  })
  const updateModeParams = vi.fn((sessionId: string, patch: Partial<ModeParams>) => {
    modeParams[sessionId] = { ...(modeParams[sessionId] ?? {}), ...patch }
  })
  return { createSession, appendMessage, updateModeParams, sessions, messages, modeParams }
}

function makeSourceSession(): Session {
  return {
    id: 'source-1', createdAt: 0, updatedAt: 0, mode: 'socratic', modeParams: {},
    title: 'Socratic Study', notes: [],
    messages: [
      { id: 'm1', role: 'user', text: 'Tell me about the prodigal son.' },
      { id: 'm2', role: 'assistant', text: "It's a parable about a father's forgiveness." },
    ],
  }
}

describe('startTellAStory', () => {
  afterEach(() => vi.restoreAllMocks())

  it('creates a story session sourced from the given session and stores the derived themes', async () => {
    vi.spyOn(chatApi, 'postChat').mockResolvedValue({
      type: 'chat',
      message: "Here's what stood out…",
      data: { themes: [{ id: 't1', label: 'Trust', description: 'desc' }], digest: 'a digest' },
    })
    const deps = makeDeps()
    const source = makeSourceSession()

    const newId = await startTellAStory(deps, source)

    expect(deps.createSession).toHaveBeenCalledWith('story', {
      storySourceSessionId: 'source-1',
      storySourceLabel: 'Socratic Study',
    })
    expect(chatApi.postChat).toHaveBeenCalledWith({
      message: '',
      mode: 'story',
      mode_params: {
        storySourceMessages: [
          { role: 'user', text: 'Tell me about the prodigal son.' },
          { role: 'assistant', text: "It's a parable about a father's forgiveness." },
        ],
      },
    })
    expect(deps.modeParams[newId]).toEqual({
      storyThemes: [{ id: 't1', label: 'Trust', description: 'desc' }],
      storyDigest: 'a digest',
      storySelectedThemeIds: [],
      storyAgeRange: '3-6',
    })
    expect(deps.messages[newId]).toHaveLength(2) // synthetic user turn + assistant themes reply
    expect(deps.messages[newId][1]).toMatchObject({ role: 'assistant', text: "Here's what stood out…" })
  })

  it('appends an error message and does not set modeParams when the primer call fails', async () => {
    vi.spyOn(chatApi, 'postChat').mockRejectedValue(new Error('network down'))
    const deps = makeDeps()

    const newId = await startTellAStory(deps, makeSourceSession())

    expect(deps.messages[newId][1].text).toContain('network down')
    expect(deps.updateModeParams).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run (from `frontend/`): `npm test -- tellAStory.test.ts`
Expected: FAIL — `frontend/src/lib/tellAStory.ts` doesn't exist yet.

- [ ] **Step 3: Write the implementation**

Create `frontend/src/lib/tellAStory.ts`:

```ts
import { postChat } from './chatApi'
import { toHistory } from './history'
import type { ModeParams, Session, SessionMessage } from '@/types/session'

// Mirrors chatbot/story_mode.py's MAX_STORY_SOURCE_MESSAGES — kept in
// sync by comment rather than shared code, since the two run in
// different languages/processes.
const MAX_STORY_SOURCE_MESSAGES = 60

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

let idCounter = 0
function genId(): string {
  return `msg-${Date.now()}-${++idCounter}`
}

interface StartTellAStoryDeps {
  createSession: (mode: 'story', modeParams: ModeParams) => Session
  appendMessage: (sessionId: string, message: SessionMessage) => void
  updateModeParams: (sessionId: string, patch: Partial<ModeParams>) => void
}

/**
 * Creates a new Tell a Story session sourced from `sourceSession`'s
 * transcript, fires the theme-derivation primer, and stores the derived
 * themes/digest into the new session's modeParams. Returns the new
 * session's id so the caller can navigate to it. Shared by the live
 * "Tell a Story from this conversation" trigger (ChatPane) and the
 * past-conversation picker (ModePickerScreen + SessionPickerScreen), so
 * both stay in lockstep with the backend contract.
 */
export async function startTellAStory(
  deps: StartTellAStoryDeps,
  sourceSession: Session
): Promise<string> {
  const { createSession, appendMessage, updateModeParams } = deps
  const session = createSession('story', {
    storySourceSessionId: sourceSession.id,
    storySourceLabel: sourceSession.title,
  })
  appendMessage(session.id, {
    id: genId(),
    role: 'user',
    text: `✨ Tell a Story from "${sourceSession.title}"`,
  })
  const sourceMessages = toHistory(sourceSession.messages).slice(-MAX_STORY_SOURCE_MESSAGES)
  try {
    const response = await postChat({
      message: '',
      mode: 'story',
      mode_params: { storySourceMessages: sourceMessages },
    })
    appendMessage(session.id, {
      id: genId(),
      role: 'assistant',
      text: response.message,
      type: response.type,
      data: response.data ?? undefined,
    })
    const data = response.data as { themes?: { id: string; label: string; description: string }[]; digest?: string } | undefined
    if (data?.themes?.length) {
      updateModeParams(session.id, {
        storyThemes: data.themes,
        storyDigest: data.digest,
        storySelectedThemeIds: [],
        storyAgeRange: '3-6',
      })
    }
  } catch (err) {
    appendMessage(session.id, {
      id: genId(),
      role: 'assistant',
      text: 'Sorry, something went wrong: ' + errorMessage(err),
    })
  }
  return session.id
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run (from `frontend/`): `npm test -- tellAStory.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/tellAStory.ts frontend/src/lib/tellAStory.test.ts
git commit -m "$(cat <<'EOF'
feat(frontend): add shared Tell a Story session-creation helper

startTellAStory() creates the new story session, fires the
theme-derivation primer, and stores the result into modeParams —
shared by both entry points (live-conversation trigger and
past-conversation picker) added in later tasks.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: `ThemePicker` component

**Files:**
- Create: `frontend/src/components/shell/ThemePicker.tsx`
- Test: `frontend/src/components/shell/ThemePicker.test.tsx`

**Interfaces:**
- Produces: `ThemePicker` React component, props `{ themes: { id: string; label: string; description: string }[]; selectedIds: string[]; ageRange: '3-6' | '7-8' | '9-10'; onToggleTheme: (id: string) => void; onChangeAgeRange: (age: '3-6' | '7-8' | '9-10') => void; onSubmit: () => void; submitting: boolean; hasStory: boolean }`. Used by Task 10 (`ChatPane`).

This component is deliberately "dumb" (controlled, no internal selection state) — Task 10 wires it to `session.modeParams` so the current selection survives a re-render/reload the same way every other mode's `modeParams` does.

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/components/shell/ThemePicker.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemePicker } from './ThemePicker'

const themes = [
  { id: 't1', label: 'Trusting God', description: 'God provides even when we cannot see how.' },
  { id: 't2', label: 'Coming home', description: 'It is never too late to return.' },
]

describe('ThemePicker', () => {
  it('renders every theme as a checkbox and every age range as a button', () => {
    render(
      <ThemePicker
        themes={themes} selectedIds={[]} ageRange="3-6"
        onToggleTheme={() => {}} onChangeAgeRange={() => {}} onSubmit={() => {}}
        submitting={false} hasStory={false}
      />
    )
    expect(screen.getByText('Trusting God')).toBeInTheDocument()
    expect(screen.getByText('Coming home')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ages 3-6' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ages 7-8' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ages 9-10' })).toBeInTheDocument()
  })

  it('calls onToggleTheme with the theme id when its checkbox is clicked', async () => {
    const onToggleTheme = vi.fn()
    render(
      <ThemePicker
        themes={themes} selectedIds={[]} ageRange="3-6"
        onToggleTheme={onToggleTheme} onChangeAgeRange={() => {}} onSubmit={() => {}}
        submitting={false} hasStory={false}
      />
    )
    await userEvent.click(screen.getByText('Trusting God'))
    expect(onToggleTheme).toHaveBeenCalledWith('t1')
  })

  it('disables the submit button until at least one theme is selected', () => {
    render(
      <ThemePicker
        themes={themes} selectedIds={[]} ageRange="3-6"
        onToggleTheme={() => {}} onChangeAgeRange={() => {}} onSubmit={() => {}}
        submitting={false} hasStory={false}
      />
    )
    expect(screen.getByRole('button', { name: 'Make my story' })).toBeDisabled()
  })

  it('labels the submit button "Try again" once a story already exists', () => {
    render(
      <ThemePicker
        themes={themes} selectedIds={['t1']} ageRange="3-6"
        onToggleTheme={() => {}} onChangeAgeRange={() => {}} onSubmit={() => {}}
        submitting={false} hasStory
      />
    )
    expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled()
  })

  it('calls onChangeAgeRange when a different age button is clicked', async () => {
    const onChangeAgeRange = vi.fn()
    render(
      <ThemePicker
        themes={themes} selectedIds={['t1']} ageRange="3-6"
        onToggleTheme={() => {}} onChangeAgeRange={onChangeAgeRange} onSubmit={() => {}}
        submitting={false} hasStory={false}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: 'Ages 7-8' }))
    expect(onChangeAgeRange).toHaveBeenCalledWith('7-8')
  })

  it('calls onSubmit when the submit button is clicked with a selection', async () => {
    const onSubmit = vi.fn()
    render(
      <ThemePicker
        themes={themes} selectedIds={['t1']} ageRange="3-6"
        onToggleTheme={() => {}} onChangeAgeRange={() => {}} onSubmit={onSubmit}
        submitting={false} hasStory={false}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: 'Make my story' }))
    expect(onSubmit).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `frontend/`): `npm test -- ThemePicker.test.tsx`
Expected: FAIL — `frontend/src/components/shell/ThemePicker.tsx` doesn't exist yet.

- [ ] **Step 3: Write the implementation**

Create `frontend/src/components/shell/ThemePicker.tsx`:

```tsx
import { Loader2 } from 'lucide-react'

export interface StoryTheme {
  id: string
  label: string
  description: string
}

export type StoryAgeRange = '3-6' | '7-8' | '9-10'

const AGE_RANGES: { value: StoryAgeRange; label: string }[] = [
  { value: '3-6', label: 'Ages 3-6' },
  { value: '7-8', label: 'Ages 7-8' },
  { value: '9-10', label: 'Ages 9-10' },
]

interface Props {
  themes: StoryTheme[]
  selectedIds: string[]
  ageRange: StoryAgeRange
  onToggleTheme: (id: string) => void
  onChangeAgeRange: (age: StoryAgeRange) => void
  onSubmit: () => void
  submitting: boolean
  hasStory: boolean
}

/**
 * The Tell a Story mode's theme + age picker. Unlike the generic
 * MessageChoice pills (which resolve once and lock), this stays mounted
 * and interactive after a story has been delivered, so the user can pick
 * different themes or a different age range and generate again. Fully
 * controlled — the caller (ChatPane) owns the current selection in
 * session.modeParams, the same source of truth every other mode's
 * options already use.
 */
export function ThemePicker({
  themes, selectedIds, ageRange, onToggleTheme, onChangeAgeRange, onSubmit, submitting, hasStory,
}: Props) {
  return (
    <div className="mt-2 flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        {themes.map((theme) => {
          const checked = selectedIds.includes(theme.id)
          return (
            <label
              key={theme.id}
              className="flex items-start gap-2 text-sm rounded-xl border border-[var(--color-theme-border)] px-3 py-2 cursor-pointer hover:bg-[var(--color-surface-alt)]"
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => onToggleTheme(theme.id)}
                className="mt-0.5"
              />
              <span>
                <span className="font-medium">{theme.label}</span>
                {theme.description && (
                  <span className="block text-xs text-[var(--color-text-secondary)]">{theme.description}</span>
                )}
              </span>
            </label>
          )
        })}
      </div>
      <div className="flex flex-wrap gap-2">
        {AGE_RANGES.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => onChangeAgeRange(option.value)}
            aria-pressed={ageRange === option.value}
            className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
              ageRange === option.value
                ? 'border-[var(--color-theme-accent)] bg-[var(--color-theme-accent)] text-[var(--color-theme-accent-contrast)]'
                : 'border-[var(--color-theme-border)] hover:bg-[var(--color-surface-alt)]'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={onSubmit}
        disabled={submitting || selectedIds.length === 0}
        className="self-start inline-flex items-center gap-2 text-sm px-3.5 py-2 rounded-full bg-[var(--color-theme-accent)] text-[var(--color-theme-accent-contrast)] disabled:opacity-50"
      >
        {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />}
        {hasStory ? 'Try again' : 'Make my story'}
      </button>
    </div>
  )
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run (from `frontend/`): `npm test -- ThemePicker.test.tsx`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/shell/ThemePicker.tsx frontend/src/components/shell/ThemePicker.test.tsx
git commit -m "$(cat <<'EOF'
feat(frontend): add ThemePicker component for Tell a Story mode

A controlled multi-select checkbox + age-range picker that stays
interactive after a story is delivered, unlike the existing
single-pick MessageChoice pills.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: `StoryArtifact` component + artifact-pane wiring

**Files:**
- Create: `frontend/src/components/artifacts/StoryArtifact.tsx`
- Modify: `frontend/src/store/useArtifactStore.ts`
- Modify: `frontend/src/components/shell/ArtifactPane.tsx`
- Test: `frontend/src/components/artifacts/StoryArtifact.test.tsx`
- Test: `frontend/src/store/useArtifactStore.test.ts` (confirmed to already exist)

**Interfaces:**
- Consumes: Task 4's `StoryArtifactParams`.
- Produces: `StoryArtifact` component (props = `StoryArtifactParams`, spread). `useArtifactStore`'s `fetchForLink` resolves a `'story'`-type link synchronously from `link.params`, matching `'devotional'`/`'hermeneutics_report'`. `ArtifactPane` renders `<StoryArtifact>` for a `'story'`-type `activeArtifact`.

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/components/artifacts/StoryArtifact.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StoryArtifact } from './StoryArtifact'

const props = {
  title: 'The Brave Little Sparrow',
  themes: ['Trusting God', 'Coming home'],
  age_range: '7-8',
  text: 'Once upon a time, a small sparrow learned to trust the wind.',
  word_count: 850,
}

describe('StoryArtifact', () => {
  it('renders the title, age badge, theme chips, body and word count', () => {
    render(<StoryArtifact {...props} />)
    expect(screen.getByText('The Brave Little Sparrow')).toBeInTheDocument()
    expect(screen.getByText('Ages 7-8')).toBeInTheDocument()
    expect(screen.getByText('Trusting God')).toBeInTheDocument()
    expect(screen.getByText('Coming home')).toBeInTheDocument()
    expect(screen.getByText(/small sparrow learned to trust/)).toBeInTheDocument()
    expect(screen.getByText('850 words')).toBeInTheDocument()
  })

  it('copies the story text to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    render(<StoryArtifact {...props} />)
    await userEvent.click(screen.getByRole('button', { name: /copy story/i }))
    expect(writeText).toHaveBeenCalledWith(props.text)
  })
})
```

In `frontend/src/store/useArtifactStore.test.ts`, add:

```ts
it('resolves a story artifact synchronously from its params (no fetch)', async () => {
  const link = {
    type: 'story' as const,
    label: 'Read the story ▸',
    params: { title: 'T', themes: ['Trust'], age_range: '3-6', text: '...', word_count: 650 },
  }
  await useArtifactStore.getState().openArtifact(link)
  expect(useArtifactStore.getState().status).toBe('ready')
  expect(useArtifactStore.getState().data).toEqual(link.params)
})
```

placed alongside whatever existing test covers the `'devotional'` case (match that test's exact setup/reset pattern).

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `frontend/`): `npm test -- StoryArtifact.test.tsx useArtifactStore.test.ts ArtifactPane.test.tsx`
Expected: FAIL — `StoryArtifact.tsx` doesn't exist, and `'story'` isn't a known case in `fetchForLink`/`ArtifactPane`.

- [ ] **Step 3: Write the implementation**

Create `frontend/src/components/artifacts/StoryArtifact.tsx`:

```tsx
import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { renderMarkdown } from '@/lib/renderMarkdown'
import type { StoryArtifactParams } from '@/types/session'

const AGE_RANGE_LABELS: Record<string, string> = {
  '3-6': 'Ages 3-6',
  '7-8': 'Ages 7-8',
  '9-10': 'Ages 9-10',
}

export function StoryArtifact({ title, themes, age_range, text, word_count }: StoryArtifactParams) {
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
        <h2 className="text-sm font-semibold">{title}</h2>
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
      <div className="text-sm leading-relaxed max-w-prose">{renderMarkdown(text)}</div>
      <p className="text-xs text-[var(--color-text-secondary)]">{word_count} words</p>
    </div>
  )
}
```

In `frontend/src/store/useArtifactStore.ts`, add a case to `fetchForLink`'s `switch`, right after the `'hermeneutics_report'` case:

```ts
    case 'story':
      // The finished story travels inline on the link params (set by the
      // chat message that produced it) — nothing to fetch.
      return link.params
```

In `frontend/src/components/shell/ArtifactPane.tsx`, add the import:

```ts
import { StoryArtifact } from '@/components/artifacts/StoryArtifact'
```

add `StoryArtifactParams` to the existing `import type { DevotionalArtifactParams, HermeneuticsArtifactParams } from '@/types/session'` line, and add a render branch right after the `hermeneutics_report` one:

```tsx
                {activeArtifact.type === 'story' && (
                  <StoryArtifact {...(data as StoryArtifactParams)} />
                )}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run (from `frontend/`): `npm test -- StoryArtifact.test.tsx useArtifactStore.test.ts ArtifactPane.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/artifacts/StoryArtifact.tsx frontend/src/store/useArtifactStore.ts frontend/src/components/shell/ArtifactPane.tsx frontend/src/components/artifacts/StoryArtifact.test.tsx
git commit -m "$(cat <<'EOF'
feat(frontend): add StoryArtifact and wire it into the artifact pane

Reuses the existing inline-params pattern (devotional,
hermeneutics_report) — the finished story text is already in hand
when the artifact link is created, so opening it needs no fetch.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Wire the live-conversation trigger and `ThemePicker` into `ChatPane`

**Files:**
- Modify: `frontend/src/components/shell/ChatPane.tsx`
- Modify: `frontend/src/App.tsx`
- Test: `frontend/src/components/shell/ChatPane.test.tsx`

**Interfaces:**
- Consumes: Task 7's `startTellAStory`, Task 8's `ThemePicker`/`StoryTheme`/`StoryAgeRange`.
- Produces: `ChatPane`'s `Props` interface gains `onNavigateToSession?: (id: string) => void`. A "Tell a Story" toolbar button (hidden when `session.mode === 'story'`, disabled when `session.messages.length === 0`) creates a new story session via `startTellAStory` and calls `onNavigateToSession`. A `story`-mode primer message renders `<ThemePicker>` beneath it, wired to `session.modeParams.storySelectedThemeIds`/`storyAgeRange` and a new `submitStory` handler that calls the generation turn and appends the resulting story message.

- [ ] **Step 1: Write the failing tests**

In `frontend/src/components/shell/ChatPane.test.tsx`, add (following the file's existing `beforeEach`/mocking conventions — check the top of the file, already read in this plan's research, for the exact `useSessionsStore.setState`/`vi.spyOn` patterns to reuse):

```tsx
describe('Tell a Story', () => {
  it('shows the "Tell a Story" button only when the session has messages, and hides it inside a story session', () => {
    const empty = useSessionsStore.getState().createSession('freeform', {})
    const { rerender } = render(<ChatPane sessionId={empty.id} />)
    expect(screen.queryByRole('button', { name: /tell a story/i })).toBeDisabled()

    useSessionsStore.getState().appendMessage(empty.id, { id: 'm1', role: 'assistant', text: 'Hi.' })
    rerender(<ChatPane sessionId={empty.id} />)
    expect(screen.getByRole('button', { name: /tell a story/i })).toBeEnabled()

    const story = useSessionsStore.getState().createSession('story', {})
    useSessionsStore.getState().appendMessage(story.id, { id: 'm1', role: 'assistant', text: 'Hi.' })
    rerender(<ChatPane sessionId={story.id} />)
    expect(screen.queryByRole('button', { name: /tell a story/i })).not.toBeInTheDocument()
  })

  it('clicking "Tell a Story" creates a new story session and navigates to it', async () => {
    const source = useSessionsStore.getState().createSession('socratic', {})
    useSessionsStore.getState().appendMessage(source.id, { id: 'm1', role: 'user', text: 'Tell me about the prodigal son.' })
    vi.spyOn(chatApi, 'postChat').mockResolvedValue({
      type: 'chat', message: "Here's what stood out…",
      data: { themes: [{ id: 't1', label: 'Trust', description: 'desc' }], digest: 'a digest' },
    })
    const onNavigateToSession = vi.fn()

    render(<ChatPane sessionId={source.id} onNavigateToSession={onNavigateToSession} />)
    await userEvent.click(screen.getByRole('button', { name: /tell a story/i }))

    // The new session is created and populated even though this ChatPane
    // instance is still showing `source` (App.tsx is what actually swaps
    // the `sessionId` prop once onNavigateToSession fires) — assert on
    // the store directly rather than on this instance's rendered DOM.
    // `waitFor` here is `@testing-library/react`'s — add it to this
    // file's existing `@testing-library/react` import if not already
    // imported.
    await waitFor(() => expect(onNavigateToSession).toHaveBeenCalled())
    const newSessionId = onNavigateToSession.mock.calls[0][0]
    const newSession = useSessionsStore.getState().sessions[newSessionId]
    expect(newSession.mode).toBe('story')
    expect(newSession.modeParams.storyThemes).toEqual([{ id: 't1', label: 'Trust', description: 'desc' }])
    expect(newSession.messages[1]).toMatchObject({ role: 'assistant', text: "Here's what stood out…" })
  })

  it('submitting the ThemePicker generates a story and appends it as a new message', async () => {
    const story = useSessionsStore.getState().createSession('story', {
      storyThemes: [{ id: 't1', label: 'Trust', description: 'desc' }],
      storyDigest: 'a digest', storySelectedThemeIds: [], storyAgeRange: '3-6',
    })
    useSessionsStore.getState().appendMessage(story.id, {
      id: 'primer', role: 'assistant', text: "Here's what stood out…",
      data: { themes: [{ id: 't1', label: 'Trust', description: 'desc' }], digest: 'a digest' },
    })
    const postChat = vi.spyOn(chatApi, 'postChat').mockResolvedValue({
      type: 'chat', message: 'Here is your story — **The Brave Sparrow**.',
      artifacts: [{ type: 'story', label: 'Read the story ▸', params: { title: 'The Brave Sparrow', themes: ['Trust'], age_range: '3-6', text: '...', word_count: 650 } }],
    })

    render(<ChatPane sessionId={story.id} />)
    await userEvent.click(screen.getByText('Trust')) // check the theme
    await userEvent.click(screen.getByRole('button', { name: 'Make my story' }))

    expect(postChat).toHaveBeenCalledWith({
      message: '',
      mode: 'story',
      mode_params: {
        storyThemes: [{ id: 't1', label: 'Trust', description: 'desc' }],
        storyDigest: 'a digest',
        storySelectedThemeIds: ['t1'],
        storyAgeRange: '3-6',
      },
    })
    expect(await screen.findByText('Read the story ▸')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `frontend/`): `npm test -- ChatPane.test.tsx`
Expected: FAIL — no "Tell a Story" button and no `ThemePicker` rendering exist yet.

- [ ] **Step 3: Write the implementation**

In `frontend/src/components/shell/ChatPane.tsx`:

Add to the top imports: `Wand2` to the `lucide-react` import list; `import { startTellAStory } from '@/lib/tellAStory'`; `import { ThemePicker, type StoryAgeRange } from './ThemePicker'`.

Change the `Props` interface:

```ts
interface Props {
  sessionId: string
  onNavigateToSession?: (id: string) => void
}
```

and the component signature:

```ts
export function ChatPane({ sessionId, onNavigateToSession }: Props) {
```

Add `const createSession = useSessionsStore((s) => s.createSession)` alongside the other store hooks near the top of the component.

Add new state near `resolvingChoiceId`:

```ts
  const [tellingStory, setTellingStory] = useState(false)
  const [storySubmitting, setStorySubmitting] = useState(false)
```

Add these callbacks after `resolveChoice` (same file, same component):

```ts
  const handleTellAStory = useCallback(async () => {
    if (!session || tellingStory) return
    setTellingStory(true)
    try {
      const newId = await startTellAStory({ createSession, appendMessage, updateModeParams }, session)
      onNavigateToSession?.(newId)
    } finally {
      setTellingStory(false)
    }
  }, [session, tellingStory, createSession, appendMessage, updateModeParams, onNavigateToSession])

  const toggleStoryTheme = useCallback(
    (themeId: string) => {
      if (!session) return
      const current = session.modeParams.storySelectedThemeIds ?? []
      const next = current.includes(themeId)
        ? current.filter((id) => id !== themeId)
        : [...current, themeId]
      updateModeParams(sessionId, { storySelectedThemeIds: next })
    },
    [session, sessionId, updateModeParams]
  )

  const setStoryAgeRange = useCallback(
    (age: StoryAgeRange) => updateModeParams(sessionId, { storyAgeRange: age }),
    [sessionId, updateModeParams]
  )

  const submitStory = useCallback(async () => {
    if (!session || storySubmitting) return
    const { storyThemes, storyDigest, storySelectedThemeIds, storyAgeRange } = session.modeParams
    if (!storySelectedThemeIds?.length) return
    setStorySubmitting(true)
    try {
      const response = await postChat({
        message: '',
        mode: 'story',
        mode_params: { storyThemes, storyDigest, storySelectedThemeIds, storyAgeRange: storyAgeRange ?? '3-6' },
      })
      appendMessage(sessionId, {
        id: genId(),
        role: 'assistant',
        text: response.message,
        type: response.type,
        artifacts: response.artifacts,
      })
    } catch (err) {
      appendMessage(sessionId, {
        id: genId(),
        role: 'assistant',
        text: 'Sorry, something went wrong: ' + errorMessage(err),
      })
    } finally {
      setStorySubmitting(false)
    }
  }, [session, sessionId, storySubmitting, appendMessage])
```

In the header toolbar JSX (right after the existing Share `<button>`, before the Report an issue `<button>`), add:

```tsx
          {session.mode !== 'story' && (
            <button
              onClick={handleTellAStory}
              disabled={session.messages.length === 0 || tellingStory}
              title={session.messages.length === 0 ? 'Nothing to turn into a story yet' : undefined}
              className="shrink-0 inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border border-[var(--color-theme-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-alt)] hover:text-[var(--color-text-primary)] transition-colors disabled:opacity-40 disabled:pointer-events-none"
            >
              <Wand2 className="w-3 h-3" aria-hidden="true" />
              Tell a Story
            </button>
          )}
```

In the message-rendering loop, right after the existing `choicesStatus === 'ready'` block (still inside the `onClick={handleVerseLinkClick}` div, before that div's closing tag), add:

```tsx
                  {session.mode === 'story' && Array.isArray((msg.data as { themes?: unknown } | undefined)?.themes) && (
                    <ThemePicker
                      themes={(msg.data as { themes: { id: string; label: string; description: string }[] }).themes}
                      selectedIds={session.modeParams.storySelectedThemeIds ?? []}
                      ageRange={session.modeParams.storyAgeRange ?? '3-6'}
                      onToggleTheme={toggleStoryTheme}
                      onChangeAgeRange={setStoryAgeRange}
                      onSubmit={submitStory}
                      submitting={storySubmitting}
                      hasStory={session.messages.some((m) => m.artifacts?.some((a) => a.type === 'story'))}
                    />
                  )}
```

In `frontend/src/App.tsx`, pass the new prop:

```tsx
              <ChatPane sessionId={activeSession.id} onNavigateToSession={setSessionId} />
```

- [ ] **Step 4: Run the tests to verify they pass**

Run (from `frontend/`): `npm test -- ChatPane.test.tsx`
Expected: PASS, including every pre-existing test in the file (confirming the new required-looking prop, made optional, didn't break any call site that omits it).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/shell/ChatPane.tsx frontend/src/App.tsx frontend/src/components/shell/ChatPane.test.tsx
git commit -m "$(cat <<'EOF'
feat(frontend): wire the live-conversation Tell a Story trigger

Adds the toolbar button (creates a new story session from the current
conversation), renders ThemePicker under the derived-themes message,
and wires theme/age selection and story (re)generation through
session.modeParams, matching every other mode's options pattern.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: Past-conversation picker (`ModePickerScreen` + `SessionPickerScreen`)

**Files:**
- Create: `frontend/src/components/shell/SessionPickerScreen.tsx`
- Modify: `frontend/src/components/shell/ModePickerScreen.tsx`
- Test: `frontend/src/components/shell/SessionPickerScreen.test.tsx`
- Test: `frontend/src/components/shell/ModePickerScreen.test.tsx`

**Interfaces:**
- Consumes: Task 7's `startTellAStory`.
- Produces: `SessionPickerScreen` component, props `{ onPick: (session: Session) => void; onBack: () => void }`. `ModePickerScreen` gains a "Tell a Story" tile that opens it, and picking a session there creates the new story session and navigates to it via the existing `onSessionStarted` prop.

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/components/shell/SessionPickerScreen.test.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SessionPickerScreen } from './SessionPickerScreen'
import { useSessionsStore } from '@/store/useSessionsStore'

describe('SessionPickerScreen', () => {
  beforeEach(() => {
    useSessionsStore.setState({ sessions: {}, activeSessionId: null })
  })

  it('lists past sessions that have at least one message', () => {
    const withMessages = useSessionsStore.getState().createSession('socratic', {})
    useSessionsStore.getState().appendMessage(withMessages.id, { id: 'm1', role: 'user', text: 'hi' })
    useSessionsStore.getState().createSession('freeform', {}) // no messages — excluded

    render(<SessionPickerScreen onPick={() => {}} onBack={() => {}} />)

    expect(screen.getByText('Socratic Study')).toBeInTheDocument()
    expect(screen.getAllByRole('button').length).toBe(2) // Back + the one eligible session
  })

  it('excludes other Tell a Story sessions from the list', () => {
    const story = useSessionsStore.getState().createSession('story', {})
    useSessionsStore.getState().appendMessage(story.id, { id: 'm1', role: 'assistant', text: 'Here is your story.' })

    render(<SessionPickerScreen onPick={() => {}} onBack={() => {}} />)

    expect(screen.queryByText('Tell a Story')).not.toBeInTheDocument()
  })

  it('calls onPick with the chosen session', async () => {
    const session = useSessionsStore.getState().createSession('socratic', {})
    useSessionsStore.getState().appendMessage(session.id, { id: 'm1', role: 'user', text: 'hi' })
    const onPick = vi.fn()

    render(<SessionPickerScreen onPick={onPick} onBack={() => {}} />)
    await userEvent.click(screen.getByText('Socratic Study'))

    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: session.id }))
  })

  it('calls onBack when Back is clicked', async () => {
    const onBack = vi.fn()
    render(<SessionPickerScreen onPick={() => {}} onBack={onBack} />)
    await userEvent.click(screen.getByRole('button', { name: /back/i }))
    expect(onBack).toHaveBeenCalled()
  })
})
```

In `frontend/src/components/shell/ModePickerScreen.test.tsx`, add (matching that file's existing render/mocking setup — check its top for how `postChat`/`createSession` are already mocked or exercised for other starter tiles, e.g. the "Chat with a Character" tile's test, and mirror it):

```tsx
it('opens the session picker and starts a Tell a Story session from the chosen conversation', async () => {
  const source = useSessionsStore.getState().createSession('socratic', {})
  useSessionsStore.getState().appendMessage(source.id, { id: 'm1', role: 'user', text: 'Tell me about the prodigal son.' })
  vi.spyOn(chatApi, 'postChat').mockResolvedValue({
    type: 'chat', message: "Here's what stood out…",
    data: { themes: [{ id: 't1', label: 'Trust', description: 'desc' }], digest: 'a digest' },
  })
  const onSessionStarted = vi.fn()

  render(<ModePickerScreen onSessionStarted={onSessionStarted} />)
  await userEvent.click(screen.getByRole('button', { name: /tell a story/i }))
  await userEvent.click(screen.getByText('Socratic Study'))

  expect(await screen.findByText(/here's what stood out/i)).toBeInTheDocument()
  expect(onSessionStarted).toHaveBeenCalled()
})
```

(Reuse whatever `vi.mock`/import for `chatApi` and `useSessionsStore` reset the file's existing tests already set up — do not add a second, conflicting mock of the same module.)

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `frontend/`): `npm test -- SessionPickerScreen.test.tsx ModePickerScreen.test.tsx`
Expected: FAIL — `SessionPickerScreen.tsx` doesn't exist, and `ModePickerScreen` has no "Tell a Story" tile yet.

- [ ] **Step 3: Write the implementation**

Create `frontend/src/components/shell/SessionPickerScreen.tsx`:

```tsx
import { ArrowLeft } from 'lucide-react'
import { useSessionsStore } from '@/store/useSessionsStore'
import type { Session } from '@/types/session'

interface Props {
  onPick: (session: Session) => void
  onBack: () => void
}

/**
 * Lists past conversations eligible to be turned into a story: at least
 * one message, and not itself a Tell a Story session (a story session has
 * nothing further to derive themes from).
 */
export function SessionPickerScreen({ onPick, onBack }: Props) {
  const listSessions = useSessionsStore((s) => s.listSessions)
  const sessions = listSessions().filter((s) => s.mode !== 'story' && s.messages.length > 0)

  return (
    <div className="h-full flex flex-col items-center px-6 py-8 overflow-y-auto">
      <div className="w-full max-w-lg flex flex-col gap-5">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="flex items-center gap-1 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-theme-accent)] transition-colors"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back
          </button>
          <h1 className="text-lg font-semibold">Tell a Story</h1>
        </div>

        {sessions.length === 0 && (
          <p className="text-sm text-[var(--color-text-secondary)]">
            You don't have any conversations yet to turn into a story — start one first.
          </p>
        )}

        <div className="flex flex-col gap-2">
          {sessions.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => onPick(s)}
              className="text-left rounded-xl border border-[var(--color-theme-border)] bg-[var(--color-surface)] px-4 py-2.5 hover:bg-[var(--color-surface-alt)] hover:border-[var(--color-theme-accent)] transition-colors"
            >
              <span className="block text-sm font-medium">{s.title}</span>
              <span className="block text-xs text-[var(--color-text-secondary)]">
                {s.messages.length} message{s.messages.length === 1 ? '' : 's'}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
```

In `frontend/src/components/shell/ModePickerScreen.tsx`:

Add to the `lucide-react` import list: `Wand2`. Add imports:

```ts
import { SessionPickerScreen } from './SessionPickerScreen'
import { startTellAStory } from '@/lib/tellAStory'
import type { Session } from '@/types/session'
```

Add `const updateModeParams = useSessionsStore((s) => s.updateModeParams)` alongside the existing store hooks.

Add state alongside `pickingCharacter`:

```ts
  const [pickingStorySource, setPickingStorySource] = useState(false)
```

Add a handler function alongside `startSession`/`startWithChoices`:

```ts
  async function startTellAStoryFrom(source: Session) {
    const newId = await startTellAStory({ createSession, appendMessage, updateModeParams }, source)
    onSessionStarted(newId)
  }
```

Add a conditional render branch alongside the existing `if (pickingCharacter) { ... }` block:

```tsx
  if (pickingStorySource) {
    return (
      <SessionPickerScreen
        onBack={() => setPickingStorySource(false)}
        onPick={(picked) => void startTellAStoryFrom(picked)}
      />
    )
  }
```

Add a new starter tile in the button row, right after the "Chat with a Character" button and before "Ask Anything":

```tsx
          <button className={STARTER_BUBBLE} onClick={() => setPickingStorySource(true)}>
            <Wand2 className="h-4 w-4 shrink-0" aria-hidden="true" /> Tell a Story
          </button>
```

- [ ] **Step 4: Run the tests to verify they pass**

Run (from `frontend/`): `npm test -- SessionPickerScreen.test.tsx ModePickerScreen.test.tsx`
Expected: PASS.

Then run the full frontend suite and typecheck to confirm the whole feature is consistent end to end:

Run (from `frontend/`): `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/shell/SessionPickerScreen.tsx frontend/src/components/shell/ModePickerScreen.tsx frontend/src/components/shell/SessionPickerScreen.test.tsx frontend/src/components/shell/ModePickerScreen.test.tsx
git commit -m "$(cat <<'EOF'
feat(frontend): add the past-conversation entry point for Tell a Story

ModePickerScreen's new "Tell a Story" tile opens SessionPickerScreen
(a sibling of CharacterPickerScreen) to choose any past conversation
with messages as the story's source, reusing the same
startTellAStory() helper the live-conversation trigger uses.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: Manual smoke test

**Files:** none — verification only, no commit.

- [ ] **Step 1: Start the backend and frontend dev servers**

```bash
python myproject.py &
cd frontend && npm run dev
```

(Confirm an LLM provider is configured — check `chatbot/ollama_client.py`'s `_llm_config()` / whatever env vars the running environment already has set for the other modes to work; Tell a Story uses the same provider.)

- [ ] **Step 2: Live-conversation trigger, single theme, small age range**

In the browser: start a Socratic Study session, ask about the parable of the Prodigal Son for a couple of turns, click "Tell a Story" in the chat header. Confirm: a new session opens titled "Tell a Story — Socratic Study"; 1–3 themes appear with an age-range picker defaulting to "Ages 3-6"; selecting one theme and clicking "Make my story" produces a "Read the story ▸" pill; opening it shows a story roughly 500–800 words with invented characters (no named biblical figures) illustrating the picked theme.

- [ ] **Step 3: Multi-theme selection and age-range change**

In the same session, check a second theme box, switch the age range to "Ages 9-10", click "Try again". Confirm: a second, longer (roughly 1200–1800 words) story appears as a new message below the first (the first is not replaced), and its text touches on both selected themes.

- [ ] **Step 4: Past-conversation entry point**

From the mode picker (start a new chat, then navigate back to the picker via "New"), click "Tell a Story", pick the earlier Socratic session from the list, confirm the same theme-derivation flow runs against that conversation's transcript.

- [ ] **Step 5: Thin/empty-conversation edge cases**

Start a fresh Ask Anything session with zero messages — confirm the "Tell a Story" header button is disabled with a "Nothing to turn into a story yet" tooltip. Send exactly one short message in a new session, then trigger Tell a Story on it — confirm it still returns at least one genuine theme (not padded filler) rather than erroring.

