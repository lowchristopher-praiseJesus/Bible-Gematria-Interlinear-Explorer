# Chat Troubleshooting & Feedback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user report a problem with any chat session, uploading the whole conversation plus a turn-by-turn trace of backend/LLM activity to a database an admin can inspect through a `Design2.png`-style trajectory viewer.

**Architecture:** A per-request trace recorder in the chatbot FastAPI service records each routing branch, tool call, and LLM call for a chat turn and returns a `trace` object in the response. The React frontend stores each turn's trace on its assistant message in the existing `localStorage` session store. A "Report an issue" dialog bundles the session (messages + traces + metadata + description) and POSTs it to a new Flask `POST /api/feedback` endpoint backed by a fresh SQLite `feedback.db`. Basic-auth Flask endpoints and a code-split React `/admin` route provide the list + trajectory viewer.

**Tech Stack:** Python 3.13, FastAPI, Pydantic v2, `httpx`, `dataset` (SQLite), pytest + pytest-asyncio; React 19, TypeScript, Zustand, `@radix-ui/react-dialog`, Vite, Vitest + Testing Library. Flask 3 for the ingest/admin API.

**Spec:** `docs/superpowers/specs/2026-09-02-chat-troubleshooting-feedback-design.md` — read it alongside this plan.

## Global Constraints

- **The chatbot service stays stateless.** No database in `chatbot/`. The trace is computed in-request and returned; it reaches a DB only via a user report through Flask.
- **`ChatRequest` is not modified.** No `conversation_id` plumbing. Each `trace` is self-contained per turn.
- **Trace field names are a fixed wire contract** shared by `chatbot/`, the frontend store, and the admin viewer. Use exactly: `turnId`, `requestPath`, `startedAt`, `endedAt`, `durationMs`, `input` (`message`, `mode`, `modeParams`, `historyLength`, `pageContext`), `steps`, `outcome` (`type`, `route`, `error`), `totals` (`toolCalls`, `llmCalls`, `llmTokens`, `durationMs`). Each `Step`: `index`, `kind` (`"routing" | "context" | "tool" | "llm"`), `label`, `startedAt`, `endedAt`, `durationMs`, `status` (`"completed" | "error" | "skipped"`), `request`, `response`, `tokens` (`prompt`, `completion`, `total`) or `null`, `error`.
- **Step `request`/`response` payloads:** redact first, then deep-truncate every string to 16384 bytes; store the whole payload's untruncated JSON byte length. `request` is stored as the (redacted, truncated) object; `response` is stored as `{ "preview": <redacted, truncated value>, "bytesTotal": <int> }` for **all** step kinds (this is the single shape the admin viewer reads — it supersedes the spec's prose that named an llm `content` key).
- **Redaction is mandatory:** drop any dict key equal to `authorization` (case-insensitive); replace any substring equal to a non-empty env value whose name ends `_API_KEY`, `_TOKEN`, or `_SECRET` with `"[redacted]"`.
- **`category` enum** (exact strings, used by DB, ingest validation, and the dialog): `wrong_answer`, `error`, `slow`, `ui`, `other`.
- **`status` enum** for a report row: `new`, `triaged`, `resolved`. Default `new`.
- **Ingest body cap:** reject `POST /api/feedback` bodies larger than 5 MB with HTTP 413. `description` capped at 8192 chars, `admin_notes` at 16384 chars.
- **Admin auth:** HTTP Basic from env vars `ADMIN_USER` / `ADMIN_PASSWORD`. Both unset or blank ⇒ admin endpoints return HTTP 503. Compare with `hmac.compare_digest`. On mismatch return 401 with header `WWW-Authenticate: Basic realm="admin"`.
- **No nginx change.** All new endpoints live under `/api/`; `/admin` is served by the SPA fallback.
- **`feedback.db` path** comes from env `FEEDBACK_DB_URL`, default `sqlite:///feedback.db` (relative to the Flask working dir / `/app` in Docker).
- **Commits:** one per task minimum (each task's final step). Conventional-commit style, matching the repo (`feat:`, `test:`, `chore:`, `docs:`).
- Run Python tests with `python -m pytest` from the repo root. Run frontend tests with `npm test` (i.e. `vitest run`) from `frontend/`.

---

## File Structure

**Created — chatbot service:**
- `chatbot/trace.py` — `TraceRecorder`, `current_recorder` ContextVar, `redact()`, module-level `record_tool/record_llm/record_context/record_routing` helpers. One responsibility: capture and shape trace data.

**Modified — chatbot service:**
- `chatbot/schemas.py` — add `trace` field to `ChatResponse`.
- `chatbot/tools.py` — wrap each public tool body in a `record_tool(...)` step.
- `chatbot/ollama_client.py` — wrap LLM HTTP calls in `record_llm(...)`; add `_extract_tokens()`.
- `chatbot/router.py` — `record_routing(...)` at each `route_deterministic` branch and at fall-through; instrument `build_mode_primer`.
- `chatbot/api.py` — create/finalize the recorder in `post_chat` and `post_chat_stream`; emit a terminal `trace` SSE event.

**Created — Flask:**
- `feedback_store.py` — `dataset`-backed helpers: `init_db()`, `insert_report()`, `list_reports()`, `get_report()`, `update_report()`.

**Modified — Flask:**
- `myproject.py` — `require_admin` decorator; routes `POST /api/feedback`, `GET /api/admin/feedback`, `GET /api/admin/feedback/<rid>`, `PATCH /api/admin/feedback/<rid>`.

**Created — frontend:**
- `frontend/src/types/trace.ts` — `Trace`, `TraceStep` TS types.
- `frontend/src/lib/clientId.ts` — `getClientId()`.
- `frontend/src/lib/feedbackApi.ts` — `submitReport()`, `ReportForm` type.
- `frontend/src/lib/adminApi.ts` — `listReports()`, `getReport()`, `updateReport()`.
- `frontend/src/components/shell/ReportIssueDialog.tsx` — the report modal.
- `frontend/src/components/admin/AdminApp.tsx` — `/admin` shell (list ⇄ detail via `?id=`).
- `frontend/src/components/admin/AdminListView.tsx` — reports table + filters.
- `frontend/src/components/admin/AdminReportView.tsx` — one report: transcript + triage + `<TrajectoryView>`.
- `frontend/src/components/admin/TrajectoryView.tsx` — timeline bands + step tree + detail drawer (the `Design2.png` core).

**Modified — frontend:**
- `frontend/src/types/session.ts` — `SessionMessage.trace?: Trace`.
- `frontend/src/components/chatbot/types.ts` — `ChatMessage.trace?: Trace`.
- `frontend/src/lib/chatApi.ts` — `ChatApiResponse.trace?`, pass through in `postChat`.
- `frontend/src/store/useSessionsStore.ts` — bump `version` 1 → 2.
- `frontend/src/components/shell/ChatPane.tsx` — header "Report an issue" button; store `response.trace` on every appended assistant message.
- `frontend/src/components/chatbot/BibleChatWidget.tsx` — handle terminal `trace` SSE event + non-stream passthrough; add a report affordance.
- `frontend/src/main.tsx` — mount `<AdminApp>` (lazy) when `location.pathname` starts with `/admin`.

**Modified — deployment:**
- `docker-compose.yml`, `.env.example`, `.gitignore`, `DEPLOYMENT.md`.

---

## Task 1: Trace recorder core (`chatbot/trace.py`)

**Files:**
- Create: `chatbot/trace.py`
- Test: `tests/chatbot/test_trace_recorder.py`

**Interfaces:**
- Consumes: nothing (stdlib only).
- Produces:
  - `current_recorder: contextvars.ContextVar[Optional[TraceRecorder]]` (default `None`).
  - `class TraceRecorder(request_path: str, message: str, mode: Optional[str] = None, mode_params: Optional[dict] = None, history_length: int = 0, page_context: Optional[str] = None)`.
    - `.add_routing(label: str, status: str = "completed") -> None`
    - `.tool_step(label: str, request: Any) -> ContextManager[_StepBox]`
    - `.llm_step(label: str, request: Any) -> ContextManager[_StepBox]`
    - `.context_step(label: str, request: Any = None) -> ContextManager[_StepBox]`
    - `.finalize(outcome_type: str, route: Optional[str] = None, error: Optional[str] = None) -> dict`
  - `_StepBox` with `.set_response(value: Any) -> None`, `.set_tokens(prompt: Optional[int], completion: Optional[int]) -> None`, `.set_error(msg: str) -> None`.
  - Module helpers that no-op when `current_recorder.get() is None`:
    - `record_tool(label, request)`, `record_llm(label, request)`, `record_context(label, request=None)` → context managers yielding a `_StepBox` (real or no-op).
    - `record_routing(label, status="completed")` → `None`.
  - `redact(obj: Any) -> Any`.

- [ ] **Step 1: Write the failing test**

```python
# tests/chatbot/test_trace_recorder.py
import os
import pytest

from chatbot.trace import TraceRecorder, redact, current_recorder, record_tool, record_routing


def test_finalize_shapes_the_trace_contract():
    rec = TraceRecorder("/chat", "hello", mode="freeform", history_length=2)
    rec.add_routing("deterministic: quote keyword")
    with rec.tool_step("fetch_verse_translations", {"args": {"reference": "JHN 3:16"}}) as step:
        step.set_response({"eng-KJV": "For God so loved the world"})
    trace = rec.finalize("verse", route="Deterministic -> Quote keyword")

    assert trace["requestPath"] == "/chat"
    assert trace["input"] == {
        "message": "hello", "mode": "freeform", "modeParams": None,
        "historyLength": 2, "pageContext": None,
    }
    assert [s["kind"] for s in trace["steps"]] == ["routing", "tool"]
    assert [s["index"] for s in trace["steps"]] == [0, 1]
    tool = trace["steps"][1]
    assert tool["status"] == "completed"
    assert tool["request"] == {"args": {"reference": "JHN 3:16"}}
    assert tool["response"]["preview"] == {"eng-KJV": "For God so loved the world"}
    assert isinstance(tool["response"]["bytesTotal"], int)
    assert tool["durationMs"] >= 0
    assert trace["outcome"] == {"type": "verse", "route": "Deterministic -> Quote keyword", "error": None}
    assert trace["totals"]["toolCalls"] == 1
    assert trace["totals"]["llmCalls"] == 0
    assert trace["totals"]["llmTokens"] is None


def test_tool_step_records_exception_and_reraises():
    rec = TraceRecorder("/chat", "x")
    with pytest.raises(RuntimeError):
        with rec.tool_step("boom", None):
            raise RuntimeError("kaboom")
    step = rec.finalize("error", error="RuntimeError: kaboom")["steps"][0]
    assert step["status"] == "error"
    assert step["error"] == "RuntimeError: kaboom"


def test_llm_step_token_totals_feed_finalize():
    rec = TraceRecorder("/chat", "x")
    with rec.llm_step("Ollama (m)", {"system": "s", "messages": []}) as step:
        step.set_response("answer")
        step.set_tokens(100, 25)
    trace = rec.finalize("chat")
    assert trace["steps"][0]["tokens"] == {"prompt": 100, "completion": 25, "total": 125}
    assert trace["totals"]["llmTokens"] == 125


def test_redact_removes_authorization_and_key_values(monkeypatch):
    monkeypatch.setenv("SOME_API_KEY", "sk-supersecret")
    out = redact({"Authorization": "Bearer sk-supersecret", "note": "uses sk-supersecret here", "n": 1})
    assert out["Authorization"] == "[redacted]"
    assert out["note"] == "uses [redacted] here"
    assert out["n"] == 1


def test_deep_truncation_keeps_bytes_total():
    rec = TraceRecorder("/chat", "x")
    big = "z" * 40000
    with rec.tool_step("t", {"blob": big}) as step:
        step.set_response({"blob": big})
    step_rec = rec.finalize("chat")["steps"][0]
    assert len(step_rec["request"]["blob"]) == 16384
    assert step_rec["response"]["bytesTotal"] > 40000
    assert len(step_rec["response"]["preview"]["blob"]) == 16384


def test_module_helpers_noop_without_a_recorder():
    assert current_recorder.get() is None
    record_routing("ignored")            # must not raise
    with record_tool("ignored", {"a": 1}) as step:
        step.set_response({"ok": True})  # no-op box, must not raise
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python -m pytest tests/chatbot/test_trace_recorder.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'chatbot.trace'`.

- [ ] **Step 3: Write the implementation**

```python
# chatbot/trace.py
"""Per-request trace capture for a single chat turn.

A TraceRecorder is created at the top of a chat request, published on the
`current_recorder` ContextVar, and read by thin `record_*` helpers wrapped
around every routing decision, tool call, and LLM call. It never raises into
the request path: a step that errors is recorded with status "error" and the
exception re-raised for the caller's own handling; a completely absent
recorder makes every helper a no-op.

Field names here are a fixed wire contract shared with the frontend store and
the admin viewer — see the plan's Global Constraints.
"""

from __future__ import annotations

import contextlib
import contextvars
import json
import os
import time
import uuid
from typing import Any, Iterator, Optional

_MAX_PREVIEW_BYTES = 16384

current_recorder: "contextvars.ContextVar[Optional[TraceRecorder]]" = contextvars.ContextVar(
    "current_recorder", default=None
)


# --------------------------------------------------------------------------- #
# Redaction + truncation
# --------------------------------------------------------------------------- #
def _secret_values() -> list[str]:
    out: list[str] = []
    for name, value in os.environ.items():
        if not value:
            continue
        if name.endswith(("_API_KEY", "_TOKEN", "_SECRET")):
            out.append(value)
    return out


def redact(obj: Any) -> Any:
    """Drop `authorization` keys and mask known secret env values, recursively."""
    secrets = _secret_values()

    def scrub(node: Any) -> Any:
        if isinstance(node, str):
            for s in secrets:
                if s and s in node:
                    node = node.replace(s, "[redacted]")
            return node
        if isinstance(node, dict):
            return {
                k: ("[redacted]" if str(k).lower() == "authorization" else scrub(v))
                for k, v in node.items()
            }
        if isinstance(node, (list, tuple)):
            return [scrub(v) for v in node]
        return node

    return scrub(obj)


def _truncate(node: Any) -> Any:
    if isinstance(node, str):
        encoded = node.encode("utf-8")
        if len(encoded) > _MAX_PREVIEW_BYTES:
            return encoded[:_MAX_PREVIEW_BYTES].decode("utf-8", "ignore")
        return node
    if isinstance(node, dict):
        return {k: _truncate(v) for k, v in node.items()}
    if isinstance(node, list):
        return [_truncate(v) for v in node]
    return node


def _capture(value: Any) -> tuple[Any, int]:
    """Return (redacted+truncated value, untruncated JSON byte length)."""
    red = redact(value)
    try:
        raw = json.dumps(red, default=str)
    except (TypeError, ValueError):
        raw = str(red)
        red = raw
    return _truncate(red), len(raw.encode("utf-8"))


def _now_ms() -> float:
    return time.time() * 1000.0


# --------------------------------------------------------------------------- #
# Step handle
# --------------------------------------------------------------------------- #
class _StepBox:
    def __init__(self, record: dict) -> None:
        self._record = record

    def set_response(self, value: Any) -> None:
        preview, total = _capture(value)
        self._record["response"] = {"preview": preview, "bytesTotal": total}

    def set_tokens(self, prompt: Optional[int], completion: Optional[int]) -> None:
        p = int(prompt or 0)
        c = int(completion or 0)
        self._record["tokens"] = {"prompt": p, "completion": c, "total": p + c}

    def set_error(self, msg: str) -> None:
        self._record["status"] = "error"
        self._record["error"] = msg


class _NoopBox:
    def set_response(self, value: Any) -> None: ...
    def set_tokens(self, prompt: Optional[int], completion: Optional[int]) -> None: ...
    def set_error(self, msg: str) -> None: ...


# --------------------------------------------------------------------------- #
# Recorder
# --------------------------------------------------------------------------- #
class TraceRecorder:
    def __init__(
        self,
        request_path: str,
        message: str,
        mode: Optional[str] = None,
        mode_params: Optional[dict] = None,
        history_length: int = 0,
        page_context: Optional[str] = None,
    ) -> None:
        self.turn_id = str(uuid.uuid4())
        self.request_path = request_path
        self.input = {
            "message": message,
            "mode": mode,
            "modeParams": mode_params,
            "historyLength": history_length,
            "pageContext": page_context,
        }
        self.started_at = _now_ms()
        self._steps: list[dict] = []
        self._counter = 0

    def _next_index(self) -> int:
        i = self._counter
        self._counter += 1
        return i

    def add_routing(self, label: str, status: str = "completed") -> None:
        now = _now_ms()
        self._steps.append(
            {
                "index": self._next_index(),
                "kind": "routing",
                "label": label,
                "startedAt": now,
                "endedAt": now,
                "durationMs": 0,
                "status": status,
                "request": None,
                "response": None,
                "tokens": None,
                "error": None,
            }
        )

    @contextlib.contextmanager
    def _step(self, kind: str, label: str, request: Any) -> Iterator[_StepBox]:
        start = _now_ms()
        captured_request = _capture(request)[0] if request is not None else None
        record = {
            "index": self._next_index(),
            "kind": kind,
            "label": label,
            "startedAt": start,
            "endedAt": start,
            "durationMs": 0,
            "status": "completed",
            "request": captured_request,
            "response": None,
            "tokens": None,
            "error": None,
        }
        self._steps.append(record)
        try:
            yield _StepBox(record)
        except Exception as exc:  # noqa: BLE001 - recorded, then re-raised
            record["status"] = "error"
            record["error"] = f"{type(exc).__name__}: {exc}"
            raise
        finally:
            record["endedAt"] = _now_ms()
            record["durationMs"] = record["endedAt"] - record["startedAt"]

    def tool_step(self, label: str, request: Any):
        return self._step("tool", label, request)

    def llm_step(self, label: str, request: Any):
        return self._step("llm", label, request)

    def context_step(self, label: str, request: Any = None):
        return self._step("context", label, request)

    def finalize(
        self, outcome_type: str, route: Optional[str] = None, error: Optional[str] = None
    ) -> dict:
        ended = _now_ms()
        token_totals = [
            s["tokens"]["total"] for s in self._steps if s.get("tokens")
        ]
        return {
            "turnId": self.turn_id,
            "requestPath": self.request_path,
            "startedAt": self.started_at,
            "endedAt": ended,
            "durationMs": ended - self.started_at,
            "input": self.input,
            "steps": self._steps,
            "outcome": {"type": outcome_type, "route": route, "error": error},
            "totals": {
                "toolCalls": sum(1 for s in self._steps if s["kind"] == "tool"),
                "llmCalls": sum(1 for s in self._steps if s["kind"] == "llm"),
                "llmTokens": sum(token_totals) if token_totals else None,
                "durationMs": ended - self.started_at,
            },
        }


# --------------------------------------------------------------------------- #
# Module-level helpers (no-op when no recorder is active)
# --------------------------------------------------------------------------- #
@contextlib.contextmanager
def _noop() -> Iterator[_NoopBox]:
    yield _NoopBox()


def record_tool(label: str, request: Any):
    rec = current_recorder.get()
    return rec.tool_step(label, request) if rec is not None else _noop()


def record_llm(label: str, request: Any):
    rec = current_recorder.get()
    return rec.llm_step(label, request) if rec is not None else _noop()


def record_context(label: str, request: Any = None):
    rec = current_recorder.get()
    return rec.context_step(label, request) if rec is not None else _noop()


def record_routing(label: str, status: str = "completed") -> None:
    rec = current_recorder.get()
    if rec is not None:
        rec.add_routing(label, status)
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python -m pytest tests/chatbot/test_trace_recorder.py -q`
Expected: PASS (6 passed).

- [ ] **Step 5: Commit**

```bash
git add chatbot/trace.py tests/chatbot/test_trace_recorder.py
git commit -m "feat(chatbot): add TraceRecorder for per-turn chat trace capture"
```

---

## Task 2: Add `trace` to the `ChatResponse` schema

**Files:**
- Modify: `chatbot/schemas.py`
- Test: `tests/chatbot/test_schemas.py` (append)

**Interfaces:**
- Consumes: nothing new.
- Produces: `ChatResponse.trace: Optional[Dict[str, Any]] = None`.

- [ ] **Step 1: Write the failing test**

```python
# tests/chatbot/test_schemas.py  (append)
def test_chat_response_accepts_optional_trace():
    from chatbot.schemas import ChatResponse

    resp = ChatResponse(type="chat", message="hi", trace={"turnId": "abc", "steps": []})
    assert resp.trace == {"turnId": "abc", "steps": []}
    assert ChatResponse(type="chat", message="hi").trace is None
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `python -m pytest tests/chatbot/test_schemas.py::test_chat_response_accepts_optional_trace -q`
Expected: FAIL — `TypeError`/`ValidationError` on unexpected `trace` kwarg (extra fields forbidden by default is not set, but the assertion `resp.trace` raises `AttributeError`).

- [ ] **Step 3: Add the field**

In `chatbot/schemas.py`, inside `class ChatResponse`, after the `artifacts` field:

```python
    trace: Optional[Dict[str, Any]] = Field(
        None, description="Per-turn trace of routing/tool/LLM steps (troubleshooting)"
    )
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `python -m pytest tests/chatbot/test_schemas.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add chatbot/schemas.py tests/chatbot/test_schemas.py
git commit -m "feat(chatbot): add optional trace field to ChatResponse"
```

---

## Task 3: Instrument `chatbot/tools.py`

**Files:**
- Modify: `chatbot/tools.py`
- Test: `tests/chatbot/test_tools_trace.py`

**Interfaces:**
- Consumes: `chatbot.trace.record_tool`, `chatbot.trace.TraceRecorder`, `chatbot.trace.current_recorder`.
- Produces: each public tool emits exactly one `tool` step (label = function name) when a recorder is active; `step.set_response(result)` before returning. No behavior change when no recorder is active.

- [ ] **Step 1: Write the failing test**

```python
# tests/chatbot/test_tools_trace.py
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python -m pytest tests/chatbot/test_tools_trace.py -q`
Expected: FAIL — `trace["steps"]` is empty (`[] != ["search_gematria"]`).

- [ ] **Step 3: Instrument each tool**

At the top of `chatbot/tools.py`, add to the imports block:

```python
from chatbot.trace import record_tool
```

Wrap each public async tool's body. Apply this pattern to **every** one of
`fetch_verse_translations`, `fetch_scripture_study`, `fetch_strongs`,
`search_gematria`, `search_english`, `random_verse`, `list_passage_verses`.
Full replacements:

```python
async def fetch_verse_translations(
    reference: str,
    languages: Optional[List[str]] = None,
) -> Dict[str, str]:
    """Fetch verse translations for a reference string (e.g. 'JHN 3:16')."""
    with record_tool("fetch_verse_translations", {"args": {"reference": reference, "languages": languages}}) as _step:
        book, chapter, verse = _parse_reference(reference)
        translations = await _run_in_thread(_fetch_verse, book, chapter, verse)
        if languages:
            translations = await _run_in_thread(_filter_by_languages, translations, languages)
        _step.set_response(translations)
        return translations


async def fetch_scripture_study(
    reference: str,
    depth: str = "medium",
    filters: Optional[List[str]] = None,
    excludes: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """Fetch merged commentary for a verse reference."""
    with record_tool("fetch_scripture_study", {"args": {"reference": reference, "depth": depth}}) as _step:
        verses = await _run_in_thread(_parse_verse_reference, reference)
        tool_registry = await _run_in_thread(_load_tool_registry, TOOL_REGISTRY_PATH)
        result = await _run_in_thread(
            _merge_commentary, verses, depth, COMMENTARY_DIR, tool_registry, filters, excludes,
        )
        _step.set_response(result)
        return result


async def fetch_strongs(
    numbers: Optional[List[str]] = None,
    words: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """Fetch Strong's entries by numbers or English word search."""
    with record_tool("fetch_strongs", {"args": {"numbers": numbers, "words": words}}) as _step:
        result = await _run_in_thread(
            _fetch_strongs, numbers=numbers or None, words=words or None, case_sensitive=False,
        )
        _step.set_response(result)
        return result


async def search_gematria(value: int) -> Dict[str, Any]:
    with record_tool("search_gematria", {"args": {"value": value}}) as _step:
        result = await _run_in_thread(search_gematria_sync, value)
        _step.set_response(result)
        return result


async def search_english(query: str) -> Dict[str, Any]:
    with record_tool("search_english", {"args": {"query": query}}) as _step:
        result = await _run_in_thread(search_english_sync, query)
        _step.set_response(result)
        return result


async def random_verse() -> tuple:
    with record_tool("random_verse", None) as _step:
        result = await _run_in_thread(random_verse_sync)
        _step.set_response(list(result))
        return result


async def list_passage_verses(
    book_name: str,
    chapter: int,
    start_verse: Optional[int] = None,
    end_verse: Optional[int] = None,
) -> List[Dict[str, Any]]:
    with record_tool(
        "list_passage_verses",
        {"args": {"book_name": book_name, "chapter": chapter, "start_verse": start_verse, "end_verse": end_verse}},
    ) as _step:
        result = await _run_in_thread(list_passage_verses_sync, book_name, chapter, start_verse, end_verse)
        _step.set_response(result)
        return result
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python -m pytest tests/chatbot/test_tools_trace.py tests/chatbot/test_tools_search_wrappers.py -q`
Expected: PASS (new file + existing wrapper tests still green).

- [ ] **Step 5: Commit**

```bash
git add chatbot/tools.py tests/chatbot/test_tools_trace.py
git commit -m "feat(chatbot): record a trace step per tool call"
```

---

## Task 4: Instrument `chatbot/ollama_client.py`

**Files:**
- Modify: `chatbot/ollama_client.py`
- Test: `tests/chatbot/test_ollama_client_trace.py`

**Interfaces:**
- Consumes: `chatbot.trace.record_llm`.
- Produces:
  - `_extract_tokens(provider: str, result: dict) -> tuple[Optional[int], Optional[int]]` — `(prompt_tokens, completion_tokens)`; Ollama reads `prompt_eval_count`/`eval_count`, NVIDIA reads `usage.prompt_tokens`/`usage.completion_tokens`.
  - `call_ollama_with_context` emits one `llm` step: `request = {"system": <system_prompt>, "messages": <messages>, "params": <payload minus messages>}`, `response = <content>`, `tokens` from `_extract_tokens`.
  - `stream_chat_with_ollama` emits one `llm` step spanning the stream; `response = <accumulated text>`; `tokens = null` (the streamed line parser discards the token-bearing final object — acceptable per spec).

- [ ] **Step 1: Write the failing test**

```python
# tests/chatbot/test_ollama_client_trace.py
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python -m pytest tests/chatbot/test_ollama_client_trace.py -q`
Expected: FAIL — `AttributeError: module 'chatbot.ollama_client' has no attribute '_extract_tokens'`.

- [ ] **Step 3: Implement**

In `chatbot/ollama_client.py` imports, add:

```python
from chatbot.trace import record_llm
```

Add the helper near `_extract_content`:

```python
def _extract_tokens(provider, result):
    """(prompt_tokens, completion_tokens) from a non-streaming response body."""
    if provider == "nvidia":
        usage = result.get("usage") or {}
        return usage.get("prompt_tokens"), usage.get("completion_tokens")
    return result.get("prompt_eval_count"), result.get("eval_count")
```

In `call_ollama_with_context`, wrap the HTTP call. Replace the block from
`provider, url, headers, payload = _build_request(messages, stream=False)`
through the `return {...}` success dict with:

```python
    provider, url, headers, payload = _build_request(messages, stream=False)
    llm_request = {
        "system": system_prompt,
        "messages": messages,
        "params": {k: v for k, v in payload.items() if k != "messages"},
    }

    with record_llm(active_model_label(), llm_request) as _step:
        async with httpx.AsyncClient() as client:
            try:
                response = await client.post(url, headers=headers, json=payload, timeout=180.0)
                response.raise_for_status()
                result = response.json()
            except httpx.HTTPError as e:
                detail = str(e) or type(e).__name__
                _step.set_error(f"LLM API error: {detail}")
                return {"type": "error", "message": f"LLM API error: {detail}", "data": None}
            except Exception as e:  # noqa: BLE001
                _step.set_error(f"{type(e).__name__}: {e}")
                return {"type": "error", "message": f"LLM error: {type(e).__name__}: {e}", "data": None}

            content, error = _extract_content(provider, result)
            if not content and error:
                _step.set_error(str(error))
                return {"type": "error", "message": f"LLM error: {error}", "data": None}

            prompt_tok, completion_tok = _extract_tokens(provider, result)
            _step.set_tokens(prompt_tok, completion_tok)
            _step.set_response(content)
            return {
                "type": "chat",
                "message": content,
                "data": None,
                "route": f"AI Fallback → {active_model_label()} → call_ollama_with_context()",
            }
```

In `stream_chat_with_ollama`, wrap the streaming call. Replace the block from
`provider, url, headers, payload = _build_request(messages, stream=True)`
through the end of the function with:

```python
    provider, url, headers, payload = _build_request(messages, stream=True)
    llm_request = {
        "system": system_prompt,
        "messages": messages,
        "params": {k: v for k, v in payload.items() if k != "messages"},
    }

    with record_llm(active_model_label(), llm_request) as _step:
        accumulated = ""
        async with httpx.AsyncClient() as client:
            try:
                async with client.stream("POST", url, headers=headers, json=payload, timeout=180.0) as response:
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
                            yield {"type": "done", "message": ""}
                            break
                        if text:
                            accumulated += text
                            yield {"type": "stream", "chunk": text}
                    if not done_sent:
                        _step.set_response(accumulated)
                        yield {"type": "done", "message": ""}
            except httpx.HTTPError as e:
                detail = str(e) or type(e).__name__
                _step.set_error(f"LLM API error: {detail}")
                yield {"type": "error", "message": f"LLM API error: {detail}"}
            except Exception as e:  # noqa: BLE001
                _step.set_error(f"{type(e).__name__}: {e}")
                yield {"type": "error", "message": f"LLM error: {type(e).__name__}: {e}"}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python -m pytest tests/chatbot/test_ollama_client_trace.py tests/chatbot/test_ollama_client_nvidia.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add chatbot/ollama_client.py tests/chatbot/test_ollama_client_trace.py
git commit -m "feat(chatbot): record an llm trace step with token counts"
```

---

## Task 5: Instrument `chatbot/router.py`

**Files:**
- Modify: `chatbot/router.py`
- Test: `tests/chatbot/test_router_trace.py`

**Interfaces:**
- Consumes: `chatbot.trace.record_routing`.
- Produces: every terminating branch of `route_deterministic` calls `record_routing(<branch label>)` before returning its dict; the final `return None` calls `record_routing("fell through to LLM")`. `build_mode_primer` calls `record_routing(f"mode primer: {mode}")` as its first statement.

- [ ] **Step 1: Write the failing test**

```python
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python -m pytest tests/chatbot/test_router_trace.py -q`
Expected: FAIL — no routing steps recorded (`[] != [...]`).

- [ ] **Step 3: Implement**

In `chatbot/router.py` imports (near `from chatbot.tools import ...`), add:

```python
from chatbot.trace import record_routing
```

In `route_deterministic`, add a `record_routing(...)` call immediately before
**each** `return {...}` / `return resp` that yields a handled response, and one
before the final `return None`. Use these exact labels, matched to the
existing branches:

| Branch (existing code marker) | Label |
|---|---|
| `_RANDOM_VERSE_RE` random pick | `"deterministic: random verse keyword"` |
| `gematria_match` | `"deterministic: gematria value match"` |
| `english_match` | `"deterministic: english search match"` |
| Strong's explicit number (`strongs_match`) | `"deterministic: strongs number match"` |
| Strong's word search (`word_match`) | `"deterministic: strongs word search"` |
| `_book_context_response` (no-ref branch) | `"deterministic: book context"` |
| study keyword w/ context ref | `"deterministic: study keyword (context ref)"` |
| quote keyword w/ context ref | `"deterministic: quote keyword (context ref)"` |
| quote keyword w/ explicit ref | `"deterministic: quote keyword"` |
| book-level keyword w/ ref | `"deterministic: book context"` |
| study keyword w/ explicit ref | `"deterministic: study keyword"` |
| default verse lookup | `"deterministic: default verse lookup"` |
| every `return None` (including `_wants_word_level_analysis`, `_has_question_beyond_refs`, and end of function) | `"fell through to LLM"` |

Concretely, for the gematria branch the edit is:

```python
    gematria_match = GEMATRIA_VALUE_PATTERN.search(message)
    if gematria_match:
        value = int(gematria_match.group(1))
        result = await search_gematria(value)
        word_count = len(result.get("wordResults", []))
        verse_count = len(result.get("verseResults", []))
        record_routing("deterministic: gematria value match")
        return {
            "type": "gematria",
            ...
        }
```

Apply the analogous one-line insertion at every other branch and `return None`
site listed above. (There are three `return None` sites: after
`_wants_word_level_analysis`, after `_has_question_beyond_refs`, and the
function's final line — each gets `record_routing("fell through to LLM")`
directly above it. The no-`refs` block that ends `return None` after the
context-ref attempts also gets one.)

In `build_mode_primer`, make the first line of the body:

```python
async def build_mode_primer(mode: str, mode_params: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """Build the seeded first assistant turn for a newly created mode session."""
    record_routing(f"mode primer: {mode}")
    mode_params = mode_params or {}
    ...
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python -m pytest tests/chatbot/test_router_trace.py tests/chatbot/test_router_deterministic.py tests/chatbot/test_mode_primers.py -q`
Expected: PASS (new + existing router/primer tests green).

- [ ] **Step 5: Commit**

```bash
git add chatbot/router.py tests/chatbot/test_router_trace.py
git commit -m "feat(chatbot): record routing decisions in the turn trace"
```

---

## Task 6: Wire the recorder into `POST /chat` (non-streaming)

**Files:**
- Modify: `chatbot/api.py`
- Test: `tests/chatbot/test_chat_endpoint_trace.py`

**Interfaces:**
- Consumes: `chatbot.trace.TraceRecorder`, `chatbot.trace.current_recorder`.
- Produces: `post_chat` sets a `TraceRecorder` on `current_recorder`, and every `ChatResponse` it returns (success, wiki path, primer path, and the `except` handler) carries `trace=recorder.finalize(...)`.

- [ ] **Step 1: Write the failing test**

```python
# tests/chatbot/test_chat_endpoint_trace.py
import pytest


def test_deterministic_chat_turn_returns_a_trace(client, monkeypatch):
    async def fake_fetch(reference, languages=None):
        return {"eng-KJV": "For God so loved the world"}

    monkeypatch.setattr("chatbot.router.fetch_verse_translations", fake_fetch)

    resp = client.post("/chat", json={"message": "quote John 3:16"})
    assert resp.status_code == 200
    body = resp.json()
    trace = body["trace"]
    assert trace["requestPath"] == "/chat"
    assert trace["input"]["message"] == "quote John 3:16"
    kinds = [s["kind"] for s in trace["steps"]]
    assert "routing" in kinds and "tool" in kinds
    assert "llm" not in kinds
    assert trace["outcome"]["type"] == body["type"]


def test_llm_fallback_turn_trace_has_an_llm_step(client, monkeypatch):
    async def fake_route_claude(message, history=None, page_context=None):
        return {"type": "chat", "message": "A thoughtful answer.", "data": None, "route": "AI Fallback"}

    # force deterministic to fall through, then stub the LLM path
    async def fake_deterministic(*a, **k):
        return None

    monkeypatch.setattr("chatbot.api.route_deterministic", fake_deterministic)
    monkeypatch.setattr("chatbot.api.route_claude", fake_route_claude)

    resp = client.post("/chat", json={"message": "what is the meaning of grace?"})
    body = resp.json()
    assert body["trace"]["outcome"]["type"] == "chat"
    # routing fall-through recorded even though route_claude is stubbed
    assert any(s["kind"] == "routing" for s in body["trace"]["steps"])


def test_server_error_still_returns_a_finalized_trace(client, monkeypatch):
    async def boom(*a, **k):
        raise RuntimeError("kaboom")

    monkeypatch.setattr("chatbot.api.route_deterministic", boom)

    resp = client.post("/chat", json={"message": "anything"})
    body = resp.json()
    assert body["type"] == "error"
    assert body["trace"]["outcome"]["type"] == "error"
    assert "kaboom" in body["trace"]["outcome"]["error"]
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python -m pytest tests/chatbot/test_chat_endpoint_trace.py -q`
Expected: FAIL — `body["trace"]` is `None` (`KeyError`/`TypeError` on subscript).

- [ ] **Step 3: Implement**

In `chatbot/api.py` imports, add:

```python
from chatbot.trace import TraceRecorder, current_recorder
```

Replace the whole body of `post_chat` with:

```python
@router.post("/chat", response_model=ChatResponse)
async def post_chat(request: ChatRequest):
    """Process a chat message and return a structured response."""
    recorder = TraceRecorder(
        "/chat",
        request.message,
        mode=request.mode,
        mode_params=request.mode_params,
        history_length=len(request.history or []),
        page_context=request.page_context,
    )
    current_recorder.set(recorder)

    def _with_trace(result: dict) -> ChatResponse:
        trace = recorder.finalize(
            result.get("type", "chat"),
            route=result.get("route"),
            error=result.get("message") if result.get("type") == "error" else None,
        )
        return ChatResponse(**result, trace=trace)

    try:
        if request.mode and not request.message.strip():
            result = await build_mode_primer(request.mode, request.mode_params)
            return _with_trace(result)

        history = (
            [{"role": m.role, "text": m.text} for m in request.history]
            if request.history else None
        )

        series_id = (request.mode_params or {}).get("series_id") if request.mode == "topic" else None
        if series_id:
            concept_slug = (request.mode_params or {}).get("concept_slug")
            result = await wiki_qa.answer(series_id, request.message, history, concept_slug=concept_slug)
            return _with_trace(result)

        result = await route_deterministic(
            request.message, history=history, page_context=request.page_context
        )
        if result:
            return _with_trace(result)
        result = await route_claude(
            request.message, history=history, page_context=request.page_context
        )
        if "follow_up_questions" not in result or not result["follow_up_questions"]:
            result["follow_up_questions"] = _generate_follow_ups(
                result.get("type", "chat"), result.get("data"), ""
            )
        return _with_trace(result)
    except Exception as e:
        return _with_trace({
            "type": "error",
            "message": f"Server error: {type(e).__name__}: {e}",
            "data": None,
            "route": "Error path",
        })
```

Note: `ChatResponse(**result, trace=trace)` — `result` never contains a
`trace` key, so there is no collision.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python -m pytest tests/chatbot/test_chat_endpoint_trace.py tests/chatbot/test_chat_endpoint_topic_routing.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add chatbot/api.py tests/chatbot/test_chat_endpoint_trace.py
git commit -m "feat(chatbot): return a per-turn trace from POST /chat"
```

---

## Task 7: Emit a terminal `trace` SSE event from `POST /chat/stream`

**Files:**
- Modify: `chatbot/api.py`
- Test: `tests/chatbot/test_chat_stream_trace.py`

**Interfaces:**
- Consumes: `chatbot.trace.TraceRecorder`, `current_recorder`.
- Produces: `_stream_chat_response(recorder, message, page_context)` — new leading `recorder` param; sets `current_recorder`; after the existing `done`/`error` events, yields one more SSE frame `data: {"type": "trace", "trace": <finalize(...)>}`. `post_chat_stream` builds the recorder and passes it in.

- [ ] **Step 1: Write the failing test**

```python
# tests/chatbot/test_chat_stream_trace.py
import json


def _events(raw: str):
    out = []
    for chunk in raw.strip().split("\n\n"):
        line = chunk.strip()
        if line.startswith("data: "):
            out.append(json.loads(line[len("data: "):]))
    return out


def test_stream_ends_with_a_trace_event_for_a_deterministic_turn(client, monkeypatch):
    async def fake_fetch(reference, languages=None):
        return {"eng-KJV": "Jesus wept."}

    monkeypatch.setattr("chatbot.router.fetch_verse_translations", fake_fetch)

    resp = client.post("/chat/stream", json={"message": "quote John 11:35"})
    assert resp.status_code == 200
    events = _events(resp.text)
    assert events[-1]["type"] == "trace"
    trace = events[-1]["trace"]
    assert trace["requestPath"] == "/chat/stream"
    assert any(s["kind"] == "routing" for s in trace["steps"])
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `python -m pytest tests/chatbot/test_chat_stream_trace.py -q`
Expected: FAIL — last event `type` is `"deterministic"` / `"done"`, not `"trace"`.

- [ ] **Step 3: Implement**

Replace `_stream_chat_response` and `post_chat_stream` in `chatbot/api.py`:

```python
async def _stream_chat_response(
    recorder: TraceRecorder, message: str, page_context: Optional[str] = None
) -> AsyncIterator[str]:
    """Yield SSE events for a chat response, then a terminal trace event."""
    current_recorder.set(recorder)
    outcome_type = "chat"
    outcome_route = None
    outcome_error = None
    try:
        result = await route_deterministic(message, page_context=page_context)
        if result:
            outcome_type = result.get("type", "chat")
            outcome_route = result.get("route")
            yield await sse_event("deterministic", result)
        else:
            from chatbot.ollama_client import (
                llm_unconfigured_error,
                active_model_label,
                stream_chat_with_ollama,
            )

            llm_error = llm_unconfigured_error()
            if llm_error:
                outcome_type = "error"
                outcome_error = llm_error
                yield await sse_event(
                    "error",
                    {"message": f"No matching pattern found and the LLM is not configured. {llm_error}"},
                )
            else:
                text_buffer = ""
                async for event in stream_chat_with_ollama(message, page_context=page_context):
                    if event.get("type") == "stream":
                        chunk = event.get("chunk", "")
                        text_buffer += chunk
                        yield await sse_event("stream", {"chunk": chunk, "text": text_buffer})
                    elif event.get("type") == "done":
                        outcome_route = f"AI Fallback → {active_model_label()} → stream_chat_with_ollama()"
                        yield await sse_event("done", {"message": text_buffer, "route": outcome_route})
                    elif event.get("type") == "error":
                        outcome_type = "error"
                        outcome_error = event.get("message", "Unknown error")
                        yield await sse_event("error", {"message": outcome_error})
    except Exception as e:  # noqa: BLE001
        outcome_type = "error"
        outcome_error = f"{type(e).__name__}: {e}"
        yield await sse_event("error", {"message": f"Server error: {outcome_error}"})
    finally:
        trace = recorder.finalize(outcome_type, route=outcome_route, error=outcome_error)
        yield await sse_event("trace", {"trace": trace})


@router.post("/chat/stream")
async def post_chat_stream(request: ChatRequest):
    """Process a chat message and stream the response via SSE."""
    recorder = TraceRecorder(
        "/chat/stream",
        request.message,
        mode=request.mode,
        mode_params=request.mode_params,
        history_length=len(request.history or []),
        page_context=request.page_context,
    )
    return StreamingResponse(
        sse_stream(_stream_chat_response(recorder, request.message, page_context=request.page_context)),
        media_type="text/event-stream",
    )
```

Note: `sse_stream` wraps each yielded string as `data: {"chunk": <str>, "done": false}` — the existing helper double-wraps, which the current frontend already tolerates (`BibleChatWidget` parses `event = JSON.parse(json)` then checks `event.type`). The terminal trace frame rides through the same path and is parsed the same way.

- [ ] **Step 4: Run the test to verify it passes**

Run: `python -m pytest tests/chatbot/test_chat_stream_trace.py tests/chatbot/test_smoke.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add chatbot/api.py tests/chatbot/test_chat_stream_trace.py
git commit -m "feat(chatbot): emit a terminal trace SSE event from POST /chat/stream"
```

---

## Task 8: Feedback store (`feedback_store.py`)

**Files:**
- Create: `feedback_store.py`
- Test: `tests/test_feedback_store.py`
- Create: `tests/__init__.py` already exists; no new package file needed.

**Interfaces:**
- Consumes: `dataset` (already a dependency), env `FEEDBACK_DB_URL`.
- Produces:
  - `CATEGORIES = ("wrong_answer", "error", "slow", "ui", "other")`
  - `STATUSES = ("new", "triaged", "resolved")`
  - `get_db(url: str | None = None) -> dataset.Database`
  - `init_db(db) -> None` — ensures the `reports` table + indexes exist.
  - `insert_report(db, *, client_id, email, category, description, session_json, session_mode, session_title, message_count, app_version, user_agent, viewport, page_url) -> str` — returns the new `id` (uuid4). Sets `created_at` (ISO 8601 UTC `Z`) and `status="new"`.
  - `list_reports(db, *, status=None, category=None, limit=50, offset=0) -> dict` — `{"total": int, "items": [ {id, created_at, category, status, session_mode, session_title, message_count, has_email} ]}`; newest first; never includes `session_json`.
  - `get_report(db, rid: str) -> dict | None` — full row; `session_json` parsed to an object.
  - `update_report(db, rid: str, *, status=None, admin_notes=None) -> dict | None` — updates provided fields, returns the updated full row, or `None` if `rid` unknown.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_feedback_store.py
import json

import pytest

import feedback_store as fs


@pytest.fixture
def db(tmp_path):
    database = fs.get_db(f"sqlite:///{tmp_path / 'feedback.db'}")
    fs.init_db(database)
    return database


def _insert(db, **overrides):
    payload = dict(
        client_id="c-1", email=None, category="wrong_answer", description="bad answer",
        session_json={"id": "s1", "mode": "freeform", "title": "Ask Anything",
                      "messages": [{"id": "m1", "role": "user", "text": "hi"}]},
        session_mode="freeform", session_title="Ask Anything", message_count=1,
        app_version="1.2.3", user_agent="UA", viewport="800x600", page_url="http://x/",
    )
    payload.update(overrides)
    return fs.insert_report(db, **payload)


def test_insert_then_get_roundtrips_session_json(db):
    rid = _insert(db)
    row = fs.get_report(db, rid)
    assert row["id"] == rid
    assert row["status"] == "new"
    assert row["created_at"].endswith("Z")
    assert row["session_json"]["messages"][0]["text"] == "hi"


def test_list_excludes_session_json_and_flags_email(db):
    _insert(db, email=None)
    _insert(db, email="a@b.com", category="ui")
    result = fs.list_reports(db)
    assert result["total"] == 2
    assert "session_json" not in result["items"][0]
    assert {i["has_email"] for i in result["items"]} == {True, False}


def test_list_filters_and_paginates(db):
    for _ in range(3):
        _insert(db, category="error")
    _insert(db, category="ui")
    assert fs.list_reports(db, category="error")["total"] == 3
    page = fs.list_reports(db, category="error", limit=2, offset=2)
    assert len(page["items"]) == 1
    assert page["total"] == 3


def test_update_report_sets_status_and_notes(db):
    rid = _insert(db)
    updated = fs.update_report(db, rid, status="triaged", admin_notes="looking into it")
    assert updated["status"] == "triaged"
    assert updated["admin_notes"] == "looking into it"
    assert fs.update_report(db, "nope", status="resolved") is None
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python -m pytest tests/test_feedback_store.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'feedback_store'`.

- [ ] **Step 3: Implement**

```python
# feedback_store.py
"""SQLite-backed store for user-submitted chat troubleshooting reports.

Separate database from the read-only Complete.db: this one is written to.
Opened via the `dataset` library (already used across myproject.py).
"""

from __future__ import annotations

import json
import os
import uuid
from datetime import datetime, timezone

import dataset

CATEGORIES = ("wrong_answer", "error", "slow", "ui", "other")
STATUSES = ("new", "triaged", "resolved")

DEFAULT_DB_URL = os.environ.get("FEEDBACK_DB_URL", "sqlite:///feedback.db")

_LIST_COLUMNS = (
    "id", "created_at", "category", "status",
    "session_mode", "session_title", "message_count",
)


def get_db(url: str | None = None) -> "dataset.Database":
    return dataset.connect(url or DEFAULT_DB_URL)


def init_db(db: "dataset.Database") -> None:
    table = db.create_table("reports", primary_id="id", primary_type=db.types.string(36))
    # Materialize columns so list/filter queries work before the first insert.
    for col in ("created_at", "client_id", "email", "category", "description",
                "session_json", "session_mode", "session_title", "app_version",
                "user_agent", "viewport", "page_url", "status", "admin_notes"):
        table.create_column(col, db.types.text)
    table.create_column("message_count", db.types.integer)
    table.create_index(["status"])
    table.create_index(["category"])
    table.create_index(["created_at"])


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def insert_report(
    db: "dataset.Database",
    *,
    client_id: str,
    email: str | None,
    category: str,
    description: str,
    session_json: dict,
    session_mode: str,
    session_title: str,
    message_count: int,
    app_version: str,
    user_agent: str,
    viewport: str,
    page_url: str,
) -> str:
    rid = str(uuid.uuid4())
    db["reports"].insert(
        {
            "id": rid,
            "created_at": _now_iso(),
            "client_id": client_id,
            "email": email or None,
            "category": category,
            "description": description,
            "session_json": json.dumps(session_json),
            "session_mode": session_mode,
            "session_title": session_title,
            "message_count": int(message_count),
            "app_version": app_version,
            "user_agent": user_agent,
            "viewport": viewport,
            "page_url": page_url,
            "status": "new",
            "admin_notes": None,
        }
    )
    return rid


def list_reports(
    db: "dataset.Database",
    *,
    status: str | None = None,
    category: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> dict:
    table = db["reports"]
    where: dict = {}
    if status:
        where["status"] = status
    if category:
        where["category"] = category

    total = table.count(**where)
    rows = table.find(
        **where,
        order_by="-created_at",
        _limit=max(1, min(int(limit), 200)),
        _offset=max(0, int(offset)),
    )
    items = []
    for row in rows:
        item = {k: row.get(k) for k in _LIST_COLUMNS}
        item["has_email"] = bool(row.get("email"))
        items.append(item)
    return {"total": total, "items": items}


def _hydrate(row: dict | None) -> dict | None:
    if row is None:
        return None
    row = dict(row)
    raw = row.get("session_json")
    try:
        row["session_json"] = json.loads(raw) if raw else None
    except (TypeError, ValueError):
        row["session_json"] = None
    return row


def get_report(db: "dataset.Database", rid: str) -> dict | None:
    return _hydrate(db["reports"].find_one(id=rid))


def update_report(
    db: "dataset.Database",
    rid: str,
    *,
    status: str | None = None,
    admin_notes: str | None = None,
) -> dict | None:
    table = db["reports"]
    if table.find_one(id=rid) is None:
        return None
    patch: dict = {"id": rid}
    if status is not None:
        patch["status"] = status
    if admin_notes is not None:
        patch["admin_notes"] = admin_notes
    table.update(patch, ["id"])
    return _hydrate(table.find_one(id=rid))
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python -m pytest tests/test_feedback_store.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add feedback_store.py tests/test_feedback_store.py
git commit -m "feat: add SQLite feedback store for troubleshooting reports"
```

---

## Task 9: `POST /api/feedback` ingest route

**Files:**
- Modify: `myproject.py`
- Test: `tests/test_feedback_api.py`

**Interfaces:**
- Consumes: `feedback_store` (`get_db`, `init_db`, `insert_report`, `CATEGORIES`), Flask `request`, `jsonify`.
- Produces: `POST /api/feedback` → `201 {"id": "<uuid>"}` on success; `413` if `Content-Length` > 5 MB or body bytes > 5 MB; `400 {"error": "<code>"}` on validation failure (`bad_category`, `empty_description`, `bad_session`); `429 {"error": "rate_limited"}` when a per-IP token bucket (5 tokens, refill 1/12s) is empty; `500 {"error": "store_unavailable"}` if the DB write raises.
- Module-level in `myproject.py`: `_feedback_db` lazy handle via `_get_feedback_db()`; `_feedback_buckets: dict[str, list]` for rate limiting.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_feedback_api.py
import json

import pytest

import myproject
import feedback_store as fs


@pytest.fixture
def app_client(tmp_path, monkeypatch):
    url = f"sqlite:///{tmp_path / 'feedback.db'}"
    monkeypatch.setenv("FEEDBACK_DB_URL", url)
    monkeypatch.setattr(myproject, "_FEEDBACK_DB_URL", url, raising=False)
    monkeypatch.setattr(myproject, "_feedback_db", None, raising=False)
    myproject.app.config.update(TESTING=True)
    return myproject.app.test_client()


def _body(**overrides):
    payload = dict(
        category="wrong_answer",
        description="the answer was wrong",
        email="a@b.com",
        client_id="c-1",
        app_version="1.0.0",
        user_agent="UA",
        viewport="800x600",
        page_url="http://localhost/",
        session_json={
            "id": "s1", "mode": "freeform", "title": "Ask Anything",
            "messages": [{"id": "m1", "role": "user", "text": "hi"},
                         {"id": "m2", "role": "assistant", "text": "hello"}],
        },
    )
    payload.update(overrides)
    return payload


def test_happy_path_inserts_and_returns_id(app_client, tmp_path):
    resp = app_client.post("/api/feedback", json=_body())
    assert resp.status_code == 201
    rid = resp.get_json()["id"]
    db = fs.get_db(f"sqlite:///{tmp_path / 'feedback.db'}")
    row = fs.get_report(db, rid)
    assert row["category"] == "wrong_answer"
    assert row["session_mode"] == "freeform"       # derived server-side
    assert row["message_count"] == 2               # derived server-side
    assert row["session_title"] == "Ask Anything"


def test_rejects_unknown_category(app_client):
    resp = app_client.post("/api/feedback", json=_body(category="nonsense"))
    assert resp.status_code == 400
    assert resp.get_json()["error"] == "bad_category"


def test_rejects_empty_description(app_client):
    resp = app_client.post("/api/feedback", json=_body(description="   "))
    assert resp.status_code == 400
    assert resp.get_json()["error"] == "empty_description"


def test_rejects_malformed_session_json(app_client):
    resp = app_client.post("/api/feedback", json=_body(session_json={"no": "messages"}))
    assert resp.status_code == 400
    assert resp.get_json()["error"] == "bad_session"


def test_rejects_oversize_body(app_client):
    resp = app_client.post(
        "/api/feedback",
        data=b"x" * (5 * 1024 * 1024 + 1),
        content_type="application/json",
    )
    assert resp.status_code == 413
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python -m pytest tests/test_feedback_api.py -q`
Expected: FAIL — `404` (route not registered) for the happy path.

- [ ] **Step 3: Implement**

In `myproject.py`, add near the other imports:

```python
import time
import json as _json
import feedback_store
```

Add module-level state after `CHATBOT_BASE_URL` is defined:

```python
# ---------------------------------------------------------------------------
# Troubleshooting feedback: ingest + admin API (writable feedback.db)
# ---------------------------------------------------------------------------
_FEEDBACK_DB_URL = os.environ.get("FEEDBACK_DB_URL", "sqlite:///feedback.db")
_MAX_FEEDBACK_BYTES = 5 * 1024 * 1024
_feedback_db = None
_feedback_buckets = {}          # ip -> [tokens: float, last_refill: float]


def _get_feedback_db():
    global _feedback_db
    if _feedback_db is None:
        _feedback_db = feedback_store.get_db(_FEEDBACK_DB_URL)
        feedback_store.init_db(_feedback_db)
    return _feedback_db


def _rate_ok(ip, *, capacity=5, refill_seconds=12.0):
    now = time.time()
    tokens, last = _feedback_buckets.get(ip, [float(capacity), now])
    tokens = min(capacity, tokens + (now - last) / refill_seconds)
    if tokens < 1.0:
        _feedback_buckets[ip] = [tokens, now]
        return False
    _feedback_buckets[ip] = [tokens - 1.0, now]
    return True
```

Add the route next to the chatbot proxy routes:

```python
@app.route('/api/feedback', methods=['POST'])
def submit_feedback():
    raw = request.get_data(cache=False)
    if len(raw) > _MAX_FEEDBACK_BYTES:
        return jsonify({'error': 'too_large'}), 413

    if not _rate_ok(request.remote_addr or 'unknown'):
        return jsonify({'error': 'rate_limited'}), 429

    try:
        payload = _json.loads(raw or b'{}')
    except ValueError:
        return jsonify({'error': 'bad_json'}), 400

    category = (payload.get('category') or '').strip()
    if category not in feedback_store.CATEGORIES:
        return jsonify({'error': 'bad_category'}), 400

    description = (payload.get('description') or '').strip()
    if not description:
        return jsonify({'error': 'empty_description'}), 400
    description = description[:8192]

    session_json = payload.get('session_json')
    if not isinstance(session_json, dict) or not isinstance(session_json.get('messages'), list):
        return jsonify({'error': 'bad_session'}), 400

    email = (payload.get('email') or '').strip() or None
    if email and ('@' not in email or len(email) > 254):
        return jsonify({'error': 'bad_email'}), 400

    messages = session_json.get('messages', [])
    session_mode = str(session_json.get('mode') or 'unknown')
    session_title = str(session_json.get('title') or '')[:200]

    try:
        rid = feedback_store.insert_report(
            _get_feedback_db(),
            client_id=str(payload.get('client_id') or 'unknown')[:64],
            email=email,
            category=category,
            description=description,
            session_json=session_json,
            session_mode=session_mode,
            session_title=session_title,
            message_count=len(messages),
            app_version=str(payload.get('app_version') or 'unknown')[:64],
            user_agent=str(payload.get('user_agent') or '')[:512],
            viewport=str(payload.get('viewport') or '')[:32],
            page_url=str(payload.get('page_url') or '')[:2048],
        )
    except Exception as e:                       # noqa: BLE001
        app.logger.exception("feedback insert failed: %s", e)
        return jsonify({'error': 'store_unavailable'}), 500

    return jsonify({'id': rid}), 201
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python -m pytest tests/test_feedback_api.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add myproject.py tests/test_feedback_api.py
git commit -m "feat: add POST /api/feedback ingest endpoint"
```

---

## Task 10: Basic-auth admin API (`GET`/`GET <id>`/`PATCH`)

**Files:**
- Modify: `myproject.py`
- Test: `tests/test_admin_api.py`

**Interfaces:**
- Consumes: `feedback_store` (`list_reports`, `get_report`, `update_report`, `STATUSES`), `hmac`, `base64`.
- Produces:
  - `require_admin(fn)` decorator: 503 when `ADMIN_USER`/`ADMIN_PASSWORD` unset/blank; 401 + `WWW-Authenticate: Basic realm="admin"` on missing/bad creds; else calls `fn`.
  - `GET /api/admin/feedback?status=&category=&limit=&offset=` → `200 {"total", "items"}`.
  - `GET /api/admin/feedback/<rid>` → `200 <full row>` or `404 {"error": "not_found"}`.
  - `PATCH /api/admin/feedback/<rid>` (JSON `{status?, admin_notes?}`) → `200 <updated row>`; `400 {"error": "bad_status"}`; `404 {"error": "not_found"}`.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_admin_api.py
import base64

import pytest

import myproject
import feedback_store as fs


@pytest.fixture
def ctx(tmp_path, monkeypatch):
    url = f"sqlite:///{tmp_path / 'feedback.db'}"
    monkeypatch.setattr(myproject, "_FEEDBACK_DB_URL", url, raising=False)
    monkeypatch.setattr(myproject, "_feedback_db", None, raising=False)
    monkeypatch.setenv("ADMIN_USER", "boss")
    monkeypatch.setenv("ADMIN_PASSWORD", "s3cret")
    myproject.app.config.update(TESTING=True)
    db = fs.get_db(url)
    fs.init_db(db)
    rid = fs.insert_report(
        db, client_id="c", email=None, category="error", description="d",
        session_json={"messages": []}, session_mode="freeform", session_title="t",
        message_count=0, app_version="v", user_agent="UA", viewport="1x1", page_url="u",
    )
    return myproject.app.test_client(), rid


def _auth(user="boss", pw="s3cret"):
    token = base64.b64encode(f"{user}:{pw}".encode()).decode()
    return {"Authorization": f"Basic {token}"}


def test_list_requires_credentials(ctx):
    client, _ = ctx
    resp = client.get("/api/admin/feedback")
    assert resp.status_code == 401
    assert resp.headers["WWW-Authenticate"].startswith("Basic")


def test_list_returns_items_with_valid_credentials(ctx):
    client, _ = ctx
    resp = client.get("/api/admin/feedback", headers=_auth())
    assert resp.status_code == 200
    body = resp.get_json()
    assert body["total"] == 1
    assert "session_json" not in body["items"][0]


def test_get_one_returns_session_json(ctx):
    client, rid = ctx
    resp = client.get(f"/api/admin/feedback/{rid}", headers=_auth())
    assert resp.status_code == 200
    assert resp.get_json()["session_json"] == {"messages": []}
    assert client.get("/api/admin/feedback/nope", headers=_auth()).status_code == 404


def test_patch_updates_status(ctx):
    client, rid = ctx
    resp = client.patch(f"/api/admin/feedback/{rid}", headers=_auth(), json={"status": "resolved"})
    assert resp.status_code == 200
    assert resp.get_json()["status"] == "resolved"
    bad = client.patch(f"/api/admin/feedback/{rid}", headers=_auth(), json={"status": "banana"})
    assert bad.status_code == 400


def test_503_when_admin_not_configured(ctx, monkeypatch):
    client, _ = ctx
    monkeypatch.delenv("ADMIN_USER", raising=False)
    monkeypatch.delenv("ADMIN_PASSWORD", raising=False)
    assert client.get("/api/admin/feedback", headers=_auth()).status_code == 503
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python -m pytest tests/test_admin_api.py -q`
Expected: FAIL — `404` (routes not registered).

- [ ] **Step 3: Implement**

In `myproject.py` imports add:

```python
import hmac
import base64
from functools import wraps
```

Add the decorator + routes after `submit_feedback`:

```python
def require_admin(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        user = os.environ.get('ADMIN_USER') or ''
        pw = os.environ.get('ADMIN_PASSWORD') or ''
        if not user or not pw:
            return jsonify({'error': 'admin_not_configured'}), 503

        header = request.headers.get('Authorization', '')
        ok = False
        if header.startswith('Basic '):
            try:
                decoded = base64.b64decode(header[6:]).decode('utf-8', 'replace')
                got_user, _, got_pw = decoded.partition(':')
                ok = hmac.compare_digest(got_user, user) and hmac.compare_digest(got_pw, pw)
            except Exception:                    # noqa: BLE001
                ok = False
        if not ok:
            resp = jsonify({'error': 'unauthorized'})
            resp.status_code = 401
            resp.headers['WWW-Authenticate'] = 'Basic realm="admin"'
            return resp
        return fn(*args, **kwargs)
    return wrapper


@app.route('/api/admin/feedback', methods=['GET'])
@require_admin
def admin_list_feedback():
    def _int(name, default):
        try:
            return int(request.args.get(name, default))
        except (TypeError, ValueError):
            return default

    result = feedback_store.list_reports(
        _get_feedback_db(),
        status=request.args.get('status') or None,
        category=request.args.get('category') or None,
        limit=_int('limit', 50),
        offset=_int('offset', 0),
    )
    return jsonify(result)


@app.route('/api/admin/feedback/<rid>', methods=['GET'])
@require_admin
def admin_get_feedback(rid):
    row = feedback_store.get_report(_get_feedback_db(), rid)
    if row is None:
        return jsonify({'error': 'not_found'}), 404
    return jsonify(row)


@app.route('/api/admin/feedback/<rid>', methods=['PATCH'])
@require_admin
def admin_patch_feedback(rid):
    payload = request.get_json(silent=True) or {}
    status = payload.get('status')
    if status is not None and status not in feedback_store.STATUSES:
        return jsonify({'error': 'bad_status'}), 400
    notes = payload.get('admin_notes')
    if notes is not None:
        notes = str(notes)[:16384]
    row = feedback_store.update_report(_get_feedback_db(), rid, status=status, admin_notes=notes)
    if row is None:
        return jsonify({'error': 'not_found'}), 404
    return jsonify(row)
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python -m pytest tests/test_admin_api.py tests/test_feedback_api.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add myproject.py tests/test_admin_api.py
git commit -m "feat: add Basic-auth admin API for troubleshooting reports"
```

---

## Task 11: Frontend trace types + store passthrough

**Files:**
- Create: `frontend/src/types/trace.ts`
- Modify: `frontend/src/types/session.ts`, `frontend/src/components/chatbot/types.ts`, `frontend/src/lib/chatApi.ts`, `frontend/src/store/useSessionsStore.ts`
- Test: `frontend/src/store/useSessionsStore.test.ts` (append), `frontend/src/lib/chatApi.test.ts` (append)

**Interfaces:**
- Produces:
  - `frontend/src/types/trace.ts`: `TraceStep`, `Trace` interfaces (mirror the wire contract).
  - `SessionMessage.trace?: Trace`; `ChatMessage.trace?: Trace`.
  - `ChatApiResponse.trace?: Trace`; `postChat` returns it unchanged.
  - `useSessionsStore` persist `version: 2` (migration is the existing `sanitizePersistedState`, unchanged — `trace` is additive/optional).

- [ ] **Step 1: Write the failing tests**

```ts
// frontend/src/store/useSessionsStore.test.ts  (append inside describe)
it('round-trips an assistant message trace through append', () => {
  const session = useSessionsStore.getState().createSession('freeform', {})
  useSessionsStore.getState().appendMessage(session.id, {
    id: 'a1', role: 'assistant', text: 'hi',
    trace: { turnId: 't1', requestPath: '/chat', steps: [], outcome: { type: 'chat', route: null, error: null } } as never,
  })
  const stored = useSessionsStore.getState().sessions[session.id].messages[0]
  expect(stored.trace?.turnId).toBe('t1')
})

it('persists at version 2', () => {
  expect(useSessionsStore.persist.getOptions().version).toBe(2)
})
```

```ts
// frontend/src/lib/chatApi.test.ts  (append)
import { describe, expect, it, vi } from 'vitest'
import { postChat } from './chatApi'

describe('postChat trace passthrough', () => {
  it('returns the trace field from the response body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ type: 'chat', message: 'hi', trace: { turnId: 'x', steps: [] } }),
    }))
    const res = await postChat({ message: 'hi' })
    expect(res.trace).toEqual({ turnId: 'x', steps: [] })
    vi.unstubAllGlobals()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/store/useSessionsStore.test.ts src/lib/chatApi.test.ts`
Expected: FAIL — `version` is `1`; `res.trace` is `undefined`.

- [ ] **Step 3: Implement**

```ts
// frontend/src/types/trace.ts
export interface TraceStepTokens {
  prompt: number
  completion: number
  total: number
}

export interface TraceStep {
  index: number
  kind: 'routing' | 'context' | 'tool' | 'llm'
  label: string
  startedAt: number
  endedAt: number
  durationMs: number
  status: 'completed' | 'error' | 'skipped'
  request: unknown | null
  response: { preview: unknown; bytesTotal: number } | null
  tokens: TraceStepTokens | null
  error: string | null
}

export interface Trace {
  turnId: string
  requestPath: '/chat' | '/chat/stream' | 'primer'
  startedAt: number
  endedAt: number
  durationMs: number
  input: {
    message: string
    mode: string | null
    modeParams: Record<string, unknown> | null
    historyLength: number
    pageContext: string | null
  }
  steps: TraceStep[]
  outcome: { type: string; route: string | null; error: string | null }
  totals: { toolCalls: number; llmCalls: number; llmTokens: number | null; durationMs: number }
}
```

In `frontend/src/types/session.ts`, add the import and field:

```ts
import type { Trace } from '@/types/trace'
// ...
export interface SessionMessage extends ChatMessage {
  artifacts?: ArtifactLink[]
  trace?: Trace
  // ...existing fields unchanged...
}
```

In `frontend/src/components/chatbot/types.ts`:

```ts
import type { Trace } from '../../types/trace'

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  type?: string;
  text: string;
  data?: Record<string, any>;
  route?: string;
  trace?: Trace;
  isStreaming?: boolean;
  followUpQuestions?: string[];
}
```

In `frontend/src/lib/chatApi.ts`, add to `ChatApiResponse`:

```ts
import type { Trace } from '@/types/trace'
// ...
interface ChatApiResponse {
  type: string
  message: string
  data?: Record<string, unknown> | null
  route?: string
  follow_up_questions?: string[]
  artifacts?: ArtifactLink[]
  trace?: Trace
}
```

(`postChat` already does `return parseJsonResponse<ChatApiResponse>(res)` — the
extra field flows through with no code change.)

In `frontend/src/store/useSessionsStore.ts`, change the persist option
`version: 1` → `version: 2`. Leave `migrate`/`merge` as-is.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/store/useSessionsStore.test.ts src/lib/chatApi.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/types/trace.ts frontend/src/types/session.ts frontend/src/components/chatbot/types.ts frontend/src/lib/chatApi.ts frontend/src/store/useSessionsStore.ts frontend/src/store/useSessionsStore.test.ts frontend/src/lib/chatApi.test.ts
git commit -m "feat(frontend): add Trace types and store passthrough"
```

---

## Task 12: `clientId` helper

**Files:**
- Create: `frontend/src/lib/clientId.ts`
- Test: `frontend/src/lib/clientId.test.ts`

**Interfaces:**
- Produces: `getClientId(): string` — returns a stable UUID stored under `localStorage["bible-explorer-client-id"]`; generates + persists one on first call; falls back to a per-tab in-memory UUID if `localStorage` access throws.

- [ ] **Step 1: Write the failing test**

```ts
// frontend/src/lib/clientId.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getClientId } from './clientId'

describe('getClientId', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => vi.unstubAllGlobals())

  it('returns a stable id across calls and persists it', () => {
    const first = getClientId()
    expect(first).toMatch(/[0-9a-f-]{36}/)
    expect(getClientId()).toBe(first)
    expect(localStorage.getItem('bible-explorer-client-id')).toBe(first)
  })

  it('falls back to an in-memory id when storage throws', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('blocked') },
      setItem: () => { throw new Error('blocked') },
    })
    const a = getClientId()
    expect(a).toMatch(/[0-9a-f-]{36}/)
    expect(getClientId()).toBe(a)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run src/lib/clientId.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// frontend/src/lib/clientId.ts
const STORAGE_KEY = 'bible-explorer-client-id'

let memoryFallback: string | null = null

function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  // RFC4122-ish fallback for very old runtimes
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}

export function getClientId(): string {
  try {
    const existing = localStorage.getItem(STORAGE_KEY)
    if (existing) return existing
    const fresh = uuid()
    localStorage.setItem(STORAGE_KEY, fresh)
    return fresh
  } catch {
    if (!memoryFallback) memoryFallback = uuid()
    return memoryFallback
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && npx vitest run src/lib/clientId.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/clientId.ts frontend/src/lib/clientId.test.ts
git commit -m "feat(frontend): add persistent anonymous clientId helper"
```

---

## Task 13: `feedbackApi.submitReport`

**Files:**
- Create: `frontend/src/lib/feedbackApi.ts`
- Test: `frontend/src/lib/feedbackApi.test.ts`

**Interfaces:**
- Consumes: `getClientId` from `@/lib/clientId`; `parseJsonResponse` from `@/lib/chatApi`; `Session` from `@/types/session`.
- Produces:
  - `type ReportCategory = 'wrong_answer' | 'error' | 'slow' | 'ui' | 'other'`
  - `interface ReportForm { category: ReportCategory; description: string; email?: string }`
  - `submitReport(session: Session, form: ReportForm): Promise<{ id: string }>` — POSTs to `/api/feedback` with the documented payload (session reduced to `{id, mode, modeParams, title, messages}`; metadata from `navigator`/`window`/`import.meta.env.VITE_APP_VERSION ?? 'dev'`).

- [ ] **Step 1: Write the failing test**

```ts
// frontend/src/lib/feedbackApi.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { submitReport } from './feedbackApi'
import type { Session } from '@/types/session'

const session: Session = {
  id: 's1', createdAt: 1, updatedAt: 2, mode: 'freeform', modeParams: {},
  title: 'Ask Anything',
  messages: [
    { id: 'm1', role: 'user', text: 'hi' },
    { id: 'm2', role: 'assistant', text: 'hello', trace: { turnId: 't' } as never },
  ],
}

afterEach(() => vi.unstubAllGlobals())

it('POSTs a reduced session plus metadata and returns the id', async () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'r-9' }) })
  vi.stubGlobal('fetch', fetchMock)

  const out = await submitReport(session, { category: 'wrong_answer', description: 'bad' })
  expect(out).toEqual({ id: 'r-9' })

  const [url, init] = fetchMock.mock.calls[0]
  expect(url).toBe('/api/feedback')
  const body = JSON.parse(init.body)
  expect(body.category).toBe('wrong_answer')
  expect(body.description).toBe('bad')
  expect(body.client_id).toMatch(/[0-9a-f-]{36}/)
  expect(body.session_json.messages).toHaveLength(2)
  expect(body.session_json.messages[1].trace.turnId).toBe('t')
  expect(body.session_json).not.toHaveProperty('createdAt')
})

it('throws on a non-ok response', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 413, statusText: 'Payload Too Large' }))
  await expect(submitReport(session, { category: 'other', description: 'x' })).rejects.toThrow(/413/)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run src/lib/feedbackApi.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// frontend/src/lib/feedbackApi.ts
import { getClientId } from '@/lib/clientId'
import { parseJsonResponse } from '@/lib/chatApi'
import type { Session } from '@/types/session'

export type ReportCategory = 'wrong_answer' | 'error' | 'slow' | 'ui' | 'other'

export interface ReportForm {
  category: ReportCategory
  description: string
  email?: string
}

function appVersion(): string {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env
  return env?.VITE_APP_VERSION ?? 'dev'
}

export async function submitReport(session: Session, form: ReportForm): Promise<{ id: string }> {
  const payload = {
    category: form.category,
    description: form.description,
    email: form.email?.trim() || undefined,
    client_id: getClientId(),
    app_version: appVersion(),
    user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
    viewport: typeof window !== 'undefined' ? `${window.innerWidth}x${window.innerHeight}` : '',
    page_url: typeof location !== 'undefined' ? location.href : '',
    session_json: {
      id: session.id,
      mode: session.mode,
      modeParams: session.modeParams,
      title: session.title,
      messages: session.messages,
    },
  }

  const res = await fetch('/api/feedback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  return parseJsonResponse<{ id: string }>(res)
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && npx vitest run src/lib/feedbackApi.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/feedbackApi.ts frontend/src/lib/feedbackApi.test.ts
git commit -m "feat(frontend): add submitReport feedback API client"
```

---

## Task 14: `ReportIssueDialog` component

**Files:**
- Create: `frontend/src/components/shell/ReportIssueDialog.tsx`
- Test: `frontend/src/components/shell/ReportIssueDialog.test.tsx`

**Interfaces:**
- Consumes: `@radix-ui/react-dialog` (already a dep), `submitReport`, `ReportForm`, `ReportCategory` from `@/lib/feedbackApi`, `Session` from `@/types/session`.
- Produces:
  - `interface ReportIssueDialogProps { session: Session; open: boolean; onOpenChange: (open: boolean) => void }`
  - `ReportIssueDialog(props): JSX.Element` — category `<select>`, required description `<textarea>` (maxLength 8192), optional email `<input type="email">`, Submit/Cancel. On submit: disables the form, calls `submitReport`, on success shows "Thanks — your report was sent." for ~1.2s then calls `onOpenChange(false)` and resets fields; on failure shows an inline error and keeps the text.

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/components/shell/ReportIssueDialog.test.tsx
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ReportIssueDialog } from './ReportIssueDialog'
import type { Session } from '@/types/session'

const submitReport = vi.fn()
vi.mock('@/lib/feedbackApi', () => ({ submitReport: (...a: unknown[]) => submitReport(...a) }))

const session: Session = {
  id: 's1', createdAt: 1, updatedAt: 2, mode: 'freeform', modeParams: {},
  title: 'Ask Anything', messages: [{ id: 'm1', role: 'user', text: 'hi' }],
}

describe('ReportIssueDialog', () => {
  beforeEach(() => submitReport.mockReset())

  it('requires a description before it can submit', async () => {
    render(<ReportIssueDialog session={session} open onOpenChange={() => {}} />)
    expect(screen.getByRole('button', { name: /send report/i })).toBeDisabled()
    await userEvent.type(screen.getByLabelText(/what went wrong/i), 'the answer was wrong')
    expect(screen.getByRole('button', { name: /send report/i })).toBeEnabled()
  })

  it('submits the chosen category + description and then closes', async () => {
    submitReport.mockResolvedValue({ id: 'r-1' })
    const onOpenChange = vi.fn()
    render(<ReportIssueDialog session={session} open onOpenChange={onOpenChange} />)
    await userEvent.selectOptions(screen.getByLabelText(/category/i), 'slow')
    await userEvent.type(screen.getByLabelText(/what went wrong/i), 'took 40 seconds')
    await userEvent.click(screen.getByRole('button', { name: /send report/i }))
    await waitFor(() => expect(submitReport).toHaveBeenCalledWith(session, {
      category: 'slow', description: 'took 40 seconds', email: undefined,
    }))
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false), { timeout: 2500 })
  })

  it('keeps the text and shows an error when submit fails', async () => {
    submitReport.mockRejectedValue(new Error('Request failed: 413 Payload Too Large'))
    render(<ReportIssueDialog session={session} open onOpenChange={() => {}} />)
    await userEvent.type(screen.getByLabelText(/what went wrong/i), 'boom')
    await userEvent.click(screen.getByRole('button', { name: /send report/i }))
    expect(await screen.findByText(/couldn.t send/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/what went wrong/i)).toHaveValue('boom')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run src/components/shell/ReportIssueDialog.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```tsx
// frontend/src/components/shell/ReportIssueDialog.tsx
import { useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { submitReport, type ReportCategory } from '@/lib/feedbackApi'
import type { Session } from '@/types/session'

interface ReportIssueDialogProps {
  session: Session
  open: boolean
  onOpenChange: (open: boolean) => void
}

const CATEGORY_OPTIONS: { value: ReportCategory; label: string }[] = [
  { value: 'wrong_answer', label: 'Wrong or misleading answer' },
  { value: 'error', label: 'Error or crash' },
  { value: 'slow', label: 'Too slow' },
  { value: 'ui', label: 'UI problem' },
  { value: 'other', label: 'Other' },
]

type Status = 'idle' | 'sending' | 'sent' | 'error'

export function ReportIssueDialog({ session, open, onOpenChange }: ReportIssueDialogProps) {
  const [category, setCategory] = useState<ReportCategory>('wrong_answer')
  const [description, setDescription] = useState('')
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<Status>('idle')

  function reset() {
    setCategory('wrong_answer')
    setDescription('')
    setEmail('')
    setStatus('idle')
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!description.trim() || status === 'sending') return
    setStatus('sending')
    try {
      await submitReport(session, {
        category,
        description: description.trim(),
        email: email.trim() || undefined,
      })
      setStatus('sent')
      setTimeout(() => {
        onOpenChange(false)
        reset()
      }, 1200)
    } catch {
      setStatus('error')
    }
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (!next) reset()
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 w-[min(92vw,32rem)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-[var(--color-theme-border)] bg-[var(--color-surface)] p-5 shadow-xl">
          <Dialog.Title className="text-sm font-semibold">Report an issue with this chat</Dialog.Title>
          <Dialog.Description className="mt-1 text-xs text-[var(--color-text-secondary)]">
            Your conversation and a technical trace of this session are attached so we can diagnose it.
          </Dialog.Description>

          <form className="mt-4 flex flex-col gap-3" onSubmit={handleSubmit}>
            <label className="flex flex-col gap-1 text-xs">
              <span>Category</span>
              <select
                className="rounded border border-[var(--color-theme-border)] bg-[var(--color-surface-alt)] px-2 py-1.5 text-sm"
                value={category}
                onChange={(e) => setCategory(e.target.value as ReportCategory)}
              >
                {CATEGORY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1 text-xs">
              <span>What went wrong?</span>
              <textarea
                className="min-h-24 rounded border border-[var(--color-theme-border)] bg-[var(--color-surface-alt)] px-2 py-1.5 text-sm"
                maxLength={8192}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                required
              />
            </label>

            <label className="flex flex-col gap-1 text-xs">
              <span>Email (optional — if you want a reply)</span>
              <input
                type="email"
                className="rounded border border-[var(--color-theme-border)] bg-[var(--color-surface-alt)] px-2 py-1.5 text-sm"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>

            {status === 'error' && (
              <p className="text-xs text-red-600">Couldn&apos;t send your report. Please try again.</p>
            )}
            {status === 'sent' && (
              <p className="text-xs text-[var(--color-theme-accent)]">Thanks — your report was sent.</p>
            )}

            <div className="mt-1 flex justify-end gap-2">
              <Dialog.Close asChild>
                <button type="button" className="rounded px-3 py-1.5 text-sm border border-[var(--color-theme-border)]">
                  Cancel
                </button>
              </Dialog.Close>
              <button
                type="submit"
                disabled={!description.trim() || status === 'sending' || status === 'sent'}
                className="rounded px-3 py-1.5 text-sm bg-[var(--color-theme-accent)] text-[var(--color-theme-accent-contrast)] disabled:opacity-40"
              >
                {status === 'sending' ? 'Sending…' : 'Send report'}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && npx vitest run src/components/shell/ReportIssueDialog.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/shell/ReportIssueDialog.tsx frontend/src/components/shell/ReportIssueDialog.test.tsx
git commit -m "feat(frontend): add ReportIssueDialog"
```

---

## Task 15: Wire the report button + trace storage into `ChatPane`

**Files:**
- Modify: `frontend/src/components/shell/ChatPane.tsx`
- Test: `frontend/src/components/shell/ChatPane.test.tsx` (append)

**Interfaces:**
- Consumes: `ReportIssueDialog` from `./ReportIssueDialog`; `response.trace` from `postChat`.
- Produces: a header button `Report an issue` that opens `<ReportIssueDialog session={session} .../>`; every place `ChatPane` appends an **assistant** message from a `postChat` response now sets `trace: response.trace` on it (`sendMessage`, `regenerate`, `resolveChoice`'s non-choices branch, `markDayComplete`, `openWikiConcept` leaves `trace` undefined — no backend turn).

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/components/shell/ChatPane.test.tsx  (append)
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ChatPane } from './ChatPane'
import { useSessionsStore } from '@/store/useSessionsStore'
import * as chatApi from '@/lib/chatApi'
import { vi } from 'vitest'

it('stores the response trace on the assistant message', async () => {
  const session = useSessionsStore.getState().createSession('freeform', {})
  vi.spyOn(chatApi, 'postChat').mockResolvedValue({
    type: 'chat', message: 'answer',
    trace: { turnId: 'tt', requestPath: '/chat', steps: [], outcome: { type: 'chat', route: null, error: null } },
  } as never)

  render(<ChatPane sessionId={session.id} />)
  await userEvent.type(screen.getByPlaceholderText(/ask about a verse/i), 'hello')
  await userEvent.click(screen.getByRole('button', { name: /send/i }))

  const msgs = useSessionsStore.getState().sessions[session.id].messages
  const assistant = msgs.find((m) => m.role === 'assistant')
  expect(assistant?.trace?.turnId).toBe('tt')
})

it('opens the report dialog from the header', async () => {
  const session = useSessionsStore.getState().createSession('freeform', {})
  render(<ChatPane sessionId={session.id} />)
  await userEvent.click(screen.getByRole('button', { name: /report an issue/i }))
  expect(await screen.findByText(/report an issue with this chat/i)).toBeInTheDocument()
})
```

(Reuse the file's existing `beforeEach` store/localStorage reset; if the file
has none, add `beforeEach(() => { localStorage.clear(); useSessionsStore.setState({ sessions: {}, activeSessionId: null }) })`.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run src/components/shell/ChatPane.test.tsx`
Expected: FAIL — no "Report an issue" button; `assistant.trace` undefined.

- [ ] **Step 3: Implement**

In `ChatPane.tsx`:

1. Add imports:

```ts
import { useState } from 'react'   // extend existing react import
import { ReportIssueDialog } from './ReportIssueDialog'
```

2. Add dialog state inside `ChatPane` (near the other `useState` calls):

```ts
const [reportOpen, setReportOpen] = useState(false)
```

3. In the header row (the `<div className="flex items-center justify-between ...">` containing the title + mode chip), add a button before the mode-chip `<span>`:

```tsx
<button
  onClick={() => setReportOpen(true)}
  className="shrink-0 text-xs px-2.5 py-1 rounded-full border border-[var(--color-theme-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-alt)]"
>
  Report an issue
</button>
```

4. Just before the closing `</div>` of the component's returned root, render the dialog:

```tsx
<ReportIssueDialog session={session} open={reportOpen} onOpenChange={setReportOpen} />
```

5. In **every** `appendMessage(sessionId, { id: genId(), role: 'assistant', text: response.message, ... })` call that consumes a `postChat` result — in `sendMessage`, `regenerate`, `resolveChoice` (the `else` branch that appends a normal answer), and `markDayComplete` — add `trace: response.trace` to the object literal. Example for `sendMessage`:

```tsx
appendMessage(sessionId, {
  id: genId(),
  role: 'assistant',
  text: response.message,
  type: response.type,
  data: response.data ?? undefined,
  artifacts: response.artifacts,
  followUpQuestions: response.follow_up_questions,
  trace: response.trace,
})
```

Do **not** add `trace` to the `catch`-branch "something went wrong" messages or
to `openWikiConcept` (no backend turn there).

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && npx vitest run src/components/shell/ChatPane.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/shell/ChatPane.tsx frontend/src/components/shell/ChatPane.test.tsx
git commit -m "feat(frontend): report-issue button and trace storage in ChatPane"
```

---

## Task 16: Trace capture + report affordance in `BibleChatWidget`

**Files:**
- Modify: `frontend/src/components/chatbot/BibleChatWidget.tsx`
- Test: `frontend/src/components/chatbot/BibleChatWidget.test.tsx`

**Interfaces:**
- Consumes: terminal `{ type: 'trace', trace }` SSE event; `data.trace` on the non-stream response; `submitReport` (widget builds a synthetic `Session` from its `messages`).
- Produces:
  - Streaming reader: on `event.type === 'trace'`, attach `event.trace` to the current assistant message.
  - Non-stream: set `trace: data.trace` on the assistant message.
  - A small "Report an issue" button in the widget header that calls `submitReport` with a synthetic session `{ id: 'widget', createdAt, updatedAt, mode: 'freeform', modeParams: {}, title, messages }` and shows a transient "sent" / "failed" note. (No dialog — the widget is minimal; a one-click report with a `window.prompt` for the description is acceptable and testable.)

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/components/chatbot/BibleChatWidget.test.tsx
import { describe, expect, it, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BibleChatWidget } from './BibleChatWidget'

const submitReport = vi.fn()
vi.mock('@/lib/feedbackApi', () => ({ submitReport: (...a: unknown[]) => submitReport(...a) }))

afterEach(() => { vi.unstubAllGlobals(); submitReport.mockReset() })

it('attaches a trace from the terminal SSE event and reports it', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    json: async () => ({
      type: 'chat', message: 'hello there', route: 'AI Fallback',
      trace: { turnId: 'w1', requestPath: '/chat', steps: [], outcome: { type: 'chat', route: null, error: null } },
    }),
  }))
  vi.stubGlobal('prompt', () => 'it was wrong')
  submitReport.mockResolvedValue({ id: 'r-1' })

  render(<BibleChatWidget apiUrl="/api/bible-chat" position="inline" />)
  await userEvent.type(screen.getByRole('textbox'), 'hi')
  await userEvent.keyboard('{Enter}')
  await screen.findByText('hello there')

  await userEvent.click(screen.getByRole('button', { name: /report an issue/i }))
  await waitFor(() => expect(submitReport).toHaveBeenCalled())
  const [, form] = submitReport.mock.calls[0]
  expect(form.description).toBe('it was wrong')
})
```

(If the widget renders behind an "open" toggle when `position !== 'inline'`,
the test uses `position="inline"`; adjust the open step to match the file's
actual inline behaviour if needed.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run src/components/chatbot/BibleChatWidget.test.tsx`
Expected: FAIL — no "Report an issue" button.

- [ ] **Step 3: Implement**

1. Imports:

```ts
import { submitReport } from '@/lib/feedbackApi'
import type { Session } from '@/types/session'
```

2. In the streaming reader's event loop, add a branch alongside `stream`/`done`/`deterministic`:

```ts
} else if (event.type === 'trace') {
  setMessages((prev) =>
    prev.map((m) => (m.id === assistantId ? { ...m, trace: event.trace } : m))
  )
}
```

3. In the non-streaming branch, add `trace: data.trace` to the `assistantMsg` object literal.

4. Add report state + handler inside the component:

```ts
const [reportNote, setReportNote] = useState<'idle' | 'sent' | 'error'>('idle')

const reportIssue = useCallback(async () => {
  const description = (typeof prompt === 'function' ? prompt('Describe the problem with this chat:') : '')?.trim()
  if (!description) return
  const now = Date.now()
  const syntheticSession: Session = {
    id: 'widget', createdAt: now, updatedAt: now,
    mode: 'freeform', modeParams: {}, title,
    messages: messages as Session['messages'],
  }
  try {
    await submitReport(syntheticSession, { category: 'other', description })
    setReportNote('sent')
  } catch {
    setReportNote('error')
  }
  setTimeout(() => setReportNote('idle'), 2000)
}, [messages, title])
```

5. In the widget header markup, add:

```tsx
<button type="button" onClick={reportIssue} aria-label="Report an issue" className="bcw-report">
  {reportNote === 'sent' ? 'Sent ✓' : reportNote === 'error' ? 'Failed' : 'Report an issue'}
</button>
```

(Style class `bcw-report` — add a minimal rule to `BibleChatWidget.css`: small, muted text button.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && npx vitest run src/components/chatbot/BibleChatWidget.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/chatbot/BibleChatWidget.tsx frontend/src/components/chatbot/BibleChatWidget.css frontend/src/components/chatbot/BibleChatWidget.test.tsx
git commit -m "feat(frontend): capture trace and add report action in BibleChatWidget"
```

---

## Task 17: `adminApi` client

**Files:**
- Create: `frontend/src/lib/adminApi.ts`
- Test: `frontend/src/lib/adminApi.test.ts`

**Interfaces:**
- Consumes: `parseJsonResponse` from `@/lib/chatApi`; `Trace` from `@/types/trace`.
- Produces:
  - `interface ReportListItem { id: string; created_at: string; category: string; status: string; session_mode: string; session_title: string; message_count: number; has_email: boolean }`
  - `interface ReportListResult { total: number; items: ReportListItem[] }`
  - `interface ReportDetail { id: string; created_at: string; client_id: string; email: string | null; category: string; description: string; status: string; admin_notes: string | null; app_version: string; user_agent: string; viewport: string; page_url: string; session_mode: string; session_title: string; message_count: number; session_json: { id?: string; mode?: string; title?: string; messages: AdminMessage[] } }`
  - `interface AdminMessage { id: string; role: 'user' | 'assistant'; text: string; type?: string; trace?: Trace }`
  - `listReports(params?: { status?: string; category?: string; limit?: number; offset?: number }): Promise<ReportListResult>`
  - `getReport(id: string): Promise<ReportDetail>`
  - `updateReport(id: string, patch: { status?: string; admin_notes?: string }): Promise<ReportDetail>`
  - All calls hit `/api/admin/feedback...` with `credentials: 'include'` (browser supplies Basic auth); a `401` throws `Error('unauthorized')`, a `503` throws `Error('admin_not_configured')`.

- [ ] **Step 1: Write the failing test**

```ts
// frontend/src/lib/adminApi.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { listReports, getReport, updateReport } from './adminApi'

afterEach(() => vi.unstubAllGlobals())

it('lists reports with query params', async () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ total: 0, items: [] }) })
  vi.stubGlobal('fetch', fetchMock)
  await listReports({ status: 'new', limit: 10 })
  expect(fetchMock.mock.calls[0][0]).toBe('/api/admin/feedback?status=new&limit=10')
})

it('maps 401 to an unauthorized error', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, statusText: 'Unauthorized' }))
  await expect(getReport('x')).rejects.toThrow(/unauthorized/)
})

it('maps 503 to admin_not_configured', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503, statusText: 'Service Unavailable' }))
  await expect(listReports()).rejects.toThrow(/admin_not_configured/)
})

it('PATCHes a status update', async () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'r1', status: 'resolved' }) })
  vi.stubGlobal('fetch', fetchMock)
  const out = await updateReport('r1', { status: 'resolved' })
  expect(out.status).toBe('resolved')
  expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'PATCH' })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run src/lib/adminApi.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// frontend/src/lib/adminApi.ts
import type { Trace } from '@/types/trace'

export interface ReportListItem {
  id: string
  created_at: string
  category: string
  status: string
  session_mode: string
  session_title: string
  message_count: number
  has_email: boolean
}

export interface ReportListResult {
  total: number
  items: ReportListItem[]
}

export interface AdminMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  type?: string
  trace?: Trace
}

export interface ReportDetail {
  id: string
  created_at: string
  client_id: string
  email: string | null
  category: string
  description: string
  status: string
  admin_notes: string | null
  app_version: string
  user_agent: string
  viewport: string
  page_url: string
  session_mode: string
  session_title: string
  message_count: number
  session_json: { id?: string; mode?: string; title?: string; messages: AdminMessage[] }
}

async function adminFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: 'include', ...init })
  if (res.status === 401) throw new Error('unauthorized')
  if (res.status === 503) throw new Error('admin_not_configured')
  if (!res.ok) throw new Error(`Request failed: ${res.status} ${res.statusText}`)
  return res.json() as Promise<T>
}

export function listReports(params: {
  status?: string
  category?: string
  limit?: number
  offset?: number
} = {}): Promise<ReportListResult> {
  const q = new URLSearchParams()
  if (params.status) q.set('status', params.status)
  if (params.category) q.set('category', params.category)
  if (params.limit != null) q.set('limit', String(params.limit))
  if (params.offset != null) q.set('offset', String(params.offset))
  const qs = q.toString()
  return adminFetch<ReportListResult>(`/api/admin/feedback${qs ? `?${qs}` : ''}`)
}

export function getReport(id: string): Promise<ReportDetail> {
  return adminFetch<ReportDetail>(`/api/admin/feedback/${encodeURIComponent(id)}`)
}

export function updateReport(
  id: string,
  patch: { status?: string; admin_notes?: string },
): Promise<ReportDetail> {
  return adminFetch<ReportDetail>(`/api/admin/feedback/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && npx vitest run src/lib/adminApi.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/adminApi.ts frontend/src/lib/adminApi.test.ts
git commit -m "feat(frontend): add admin feedback API client"
```

---

## Task 18: `TrajectoryView` — timeline, step tree, detail drawer

**Files:**
- Create: `frontend/src/components/admin/TrajectoryView.tsx`
- Test: `frontend/src/components/admin/TrajectoryView.test.tsx`

**Interfaces:**
- Consumes: `Trace`, `TraceStep` from `@/types/trace`.
- Produces:
  - `interface TrajectoryViewProps { trace: Trace; userMessage: string; assistantText: string }`
  - `TrajectoryView(props): JSX.Element` rendering, per the `Design2.png` layout:
    - a **timeline** with three labelled rows — `Input` (steps `routing` + `context`), `Model` (`llm`), `Tools` (`tool`) — each step a segment positioned left `%` = `(step.startedAt - trace.startedAt) / trace.durationMs`, width `%` = `max(1, step.durationMs / trace.durationMs * 100)`.
    - a **step tree**: `SYSTEM` row (from the first `llm` step's `request.system`, if any), `USER` row (`userMessage`), one row per `context` and `tool` step, `ASSISTANT` row (`assistantText`). Clicking a row selects it.
    - a **detail drawer** for the selected step: `Source` (`step.label`), `Status`, `Tokens` (`prompt`/`completion`/`total` or `—`), `Preview` (pretty-printed `request` and `response.preview`; when `response.bytesTotal` exceeds the preview length show `truncated — {bytesTotal} bytes total`), `Request Timing` (`durationMs` + absolute `startedAt`/`endedAt` as ISO).
  - `formatDuration(ms: number): string` exported helper (`"812 ms"` / `"1.8 s"`).

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/components/admin/TrajectoryView.test.tsx
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TrajectoryView, formatDuration } from './TrajectoryView'
import type { Trace } from '@/types/trace'

const trace: Trace = {
  turnId: 't1', requestPath: '/chat',
  startedAt: 1000, endedAt: 2000, durationMs: 1000,
  input: { message: 'what is grace', mode: 'freeform', modeParams: null, historyLength: 0, pageContext: null },
  steps: [
    { index: 0, kind: 'routing', label: 'fell through to LLM', startedAt: 1000, endedAt: 1005,
      durationMs: 5, status: 'completed', request: null, response: null, tokens: null, error: null },
    { index: 1, kind: 'tool', label: 'fetch_scripture_study', startedAt: 1010, endedAt: 1300,
      durationMs: 290, status: 'completed', request: { args: { reference: 'EPH 2:8' } },
      response: { preview: { ok: true }, bytesTotal: 40000 }, tokens: null, error: null },
    { index: 2, kind: 'llm', label: 'Ollama (m)', startedAt: 1320, endedAt: 1980,
      durationMs: 660, status: 'completed', request: { system: 'You are a research assistant', messages: [] },
      response: { preview: 'Grace is unmerited favour.', bytesTotal: 26 },
      tokens: { prompt: 800, completion: 40, total: 840 }, error: null },
  ],
  outcome: { type: 'chat', route: 'AI Fallback', error: null },
  totals: { toolCalls: 1, llmCalls: 1, llmTokens: 840, durationMs: 1000 },
}

describe('TrajectoryView', () => {
  it('renders the three timeline lanes and the step rows', () => {
    render(<TrajectoryView trace={trace} userMessage="what is grace" assistantText="Grace is unmerited favour." />)
    expect(screen.getByText('Input')).toBeInTheDocument()
    expect(screen.getByText('Model')).toBeInTheDocument()
    expect(screen.getByText('Tools')).toBeInTheDocument()
    expect(screen.getByText('SYSTEM')).toBeInTheDocument()
    expect(screen.getByText('USER')).toBeInTheDocument()
    expect(screen.getByText('ASSISTANT')).toBeInTheDocument()
    expect(screen.getByText('fetch_scripture_study')).toBeInTheDocument()
  })

  it('shows tokens, timing and a truncation note in the detail drawer', async () => {
    render(<TrajectoryView trace={trace} userMessage="what is grace" assistantText="Grace is unmerited favour." />)
    await userEvent.click(screen.getByText('fetch_scripture_study'))
    expect(screen.getByText(/290 ms/)).toBeInTheDocument()
    expect(screen.getByText(/40000 bytes total/)).toBeInTheDocument()

    await userEvent.click(screen.getByText('Ollama (m)'))
    expect(screen.getByText(/840/)).toBeInTheDocument()          // total tokens
  })

  it('formatDuration switches to seconds past 1000ms', () => {
    expect(formatDuration(812)).toBe('812 ms')
    expect(formatDuration(1800)).toBe('1.8 s')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run src/components/admin/TrajectoryView.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```tsx
// frontend/src/components/admin/TrajectoryView.tsx
import { useMemo, useState } from 'react'
import type { Trace, TraceStep } from '@/types/trace'

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`
  return `${(ms / 1000).toFixed(1)} s`
}

interface TrajectoryViewProps {
  trace: Trace
  userMessage: string
  assistantText: string
}

const LANES: { label: string; kinds: TraceStep['kind'][] }[] = [
  { label: 'Input', kinds: ['routing', 'context'] },
  { label: 'Model', kinds: ['llm'] },
  { label: 'Tools', kinds: ['tool'] },
]

function pct(n: number): string {
  return `${Math.max(0, Math.min(100, n))}%`
}

function prettyJson(value: unknown): string {
  try {
    return typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

export function TrajectoryView({ trace, userMessage, assistantText }: TrajectoryViewProps) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)

  const systemPrompt = useMemo(() => {
    const llm = trace.steps.find((s) => s.kind === 'llm')
    const req = llm?.request as { system?: string } | null
    return req?.system ?? null
  }, [trace.steps])

  const span = trace.durationMs || 1
  const selected = selectedIndex == null ? null : trace.steps.find((s) => s.index === selectedIndex) ?? null

  return (
    <div className="flex flex-col gap-4">
      {/* Timeline */}
      <div className="rounded-lg border border-[var(--color-theme-border)] p-3">
        <div className="mb-2 text-xs text-[var(--color-text-secondary)]">
          Duration {formatDuration(trace.durationMs)} · {trace.totals.toolCalls} tool calls ·{' '}
          {trace.totals.llmCalls} model calls
          {trace.totals.llmTokens != null ? ` · ${trace.totals.llmTokens} tok` : ''}
        </div>
        <div className="flex flex-col gap-1.5">
          {LANES.map((lane) => (
            <div key={lane.label} className="flex items-center gap-2">
              <span className="w-14 shrink-0 text-[11px] text-[var(--color-text-secondary)]">{lane.label}</span>
              <div className="relative h-4 flex-1 rounded bg-[var(--color-surface-alt)]">
                {trace.steps
                  .filter((s) => lane.kinds.includes(s.kind))
                  .map((s) => (
                    <button
                      key={s.index}
                      onClick={() => setSelectedIndex(s.index)}
                      title={`${s.label} — ${formatDuration(s.durationMs)}`}
                      className={`absolute top-0 h-4 rounded ${
                        s.status === 'error' ? 'bg-red-500' : 'bg-[var(--color-theme-accent)]'
                      } ${selectedIndex === s.index ? 'ring-2 ring-offset-1' : ''}`}
                      style={{
                        left: pct(((s.startedAt - trace.startedAt) / span) * 100),
                        width: pct(Math.max(1, (s.durationMs / span) * 100)),
                      }}
                    />
                  ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {/* Step tree */}
        <ol className="flex flex-col gap-1 rounded-lg border border-[var(--color-theme-border)] p-2 text-sm">
          {systemPrompt != null && (
            <StepRow label="SYSTEM" detail={truncate(systemPrompt)} onClick={() => {
              const llm = trace.steps.find((s) => s.kind === 'llm')
              if (llm) setSelectedIndex(llm.index)
            }} />
          )}
          <StepRow label="USER" detail={truncate(userMessage)} />
          {trace.steps
            .filter((s) => s.kind === 'context' || s.kind === 'tool')
            .map((s) => (
              <StepRow
                key={s.index}
                label={s.label}
                detail={`${s.kind} · ${formatDuration(s.durationMs)}${s.status === 'error' ? ' · error' : ''}`}
                active={selectedIndex === s.index}
                onClick={() => setSelectedIndex(s.index)}
              />
            ))}
          <StepRow label="ASSISTANT" detail={truncate(assistantText)} onClick={() => {
            const llm = [...trace.steps].reverse().find((s) => s.kind === 'llm')
            if (llm) setSelectedIndex(llm.index)
          }} />
        </ol>

        {/* Detail drawer */}
        <div className="rounded-lg border border-[var(--color-theme-border)] p-3 text-xs">
          {selected == null ? (
            <p className="text-[var(--color-text-secondary)]">Select a step to inspect it.</p>
          ) : (
            <dl className="flex flex-col gap-2">
              <Field term="Source" desc={selected.label} />
              <Field term="Status" desc={selected.status} />
              <Field
                term="Tokens"
                desc={
                  selected.tokens
                    ? `${selected.tokens.prompt} prompt / ${selected.tokens.completion} completion / ${selected.tokens.total} total`
                    : '—'
                }
              />
              <Field
                term="Request Timing"
                desc={`${formatDuration(selected.durationMs)} · ${new Date(selected.startedAt).toISOString()} → ${new Date(
                  selected.endedAt,
                ).toISOString()}`}
              />
              {selected.error && <Field term="Error" desc={selected.error} />}
              {selected.request != null && (
                <div>
                  <dt className="text-[var(--color-text-secondary)]">Request</dt>
                  <pre className="mt-1 max-h-60 overflow-auto rounded bg-[var(--color-surface-alt)] p-2">
                    {prettyJson(selected.request)}
                  </pre>
                </div>
              )}
              {selected.response != null && (
                <div>
                  <dt className="text-[var(--color-text-secondary)]">Response</dt>
                  <pre className="mt-1 max-h-60 overflow-auto rounded bg-[var(--color-surface-alt)] p-2">
                    {prettyJson(selected.response.preview)}
                  </pre>
                  {selected.response.bytesTotal > previewLength(selected.response.preview) && (
                    <p className="mt-1 text-[var(--color-text-secondary)]">
                      truncated — {selected.response.bytesTotal} bytes total
                    </p>
                  )}
                </div>
              )}
            </dl>
          )}
        </div>
      </div>
    </div>
  )
}

function truncate(s: string, n = 120): string {
  return s.length > n ? `${s.slice(0, n)}…` : s
}

function previewLength(value: unknown): number {
  try {
    return (typeof value === 'string' ? value : JSON.stringify(value)).length
  } catch {
    return 0
  }
}

function StepRow({
  label,
  detail,
  active,
  onClick,
}: {
  label: string
  detail: string
  active?: boolean
  onClick?: () => void
}) {
  return (
    <li>
      <button
        onClick={onClick}
        className={`w-full rounded px-2 py-1 text-left ${active ? 'bg-[var(--color-surface-alt)]' : ''} ${
          onClick ? 'hover:bg-[var(--color-surface-alt)]' : 'cursor-default'
        }`}
      >
        <span className="font-mono text-[11px] text-[var(--color-text-secondary)]">{label}</span>
        <span className="ml-2">{detail}</span>
      </button>
    </li>
  )
}

function Field({ term, desc }: { term: string; desc: string }) {
  return (
    <div className="flex gap-2">
      <dt className="w-28 shrink-0 text-[var(--color-text-secondary)]">{term}</dt>
      <dd className="min-w-0 break-words">{desc}</dd>
    </div>
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && npx vitest run src/components/admin/TrajectoryView.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/admin/TrajectoryView.tsx frontend/src/components/admin/TrajectoryView.test.tsx
git commit -m "feat(frontend): add TrajectoryView trace inspector"
```

---

## Task 19: `AdminListView` + `AdminReportView`

**Files:**
- Create: `frontend/src/components/admin/AdminListView.tsx`, `frontend/src/components/admin/AdminReportView.tsx`
- Test: `frontend/src/components/admin/AdminListView.test.tsx`, `frontend/src/components/admin/AdminReportView.test.tsx`

**Interfaces:**
- Consumes: `listReports`, `getReport`, `updateReport`, and their result types from `@/lib/adminApi`; `TrajectoryView` from `./TrajectoryView`.
- Produces:
  - `interface AdminListViewProps { onOpen: (id: string) => void }` — fetches on mount + when the `status`/`category` filter changes; renders a table (created_at, category, status, mode, message_count, "✉" when `has_email`); each row calls `onOpen(id)`. Shows an `unauthorized` / `admin_not_configured` message when the fetch throws with that message.
  - `interface AdminReportViewProps { id: string; onBack: () => void }` — fetches `getReport(id)`; renders the description + metadata, a transcript (`session_json.messages`), and for each assistant message with a `trace` a `<TrajectoryView>`; a `status` `<select>` and `admin_notes` `<textarea>` with a Save button that calls `updateReport` (optimistic; on failure reverts and shows an error).

- [ ] **Step 1: Write the failing tests**

```tsx
// frontend/src/components/admin/AdminListView.test.tsx
import { describe, expect, it, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AdminListView } from './AdminListView'

vi.mock('@/lib/adminApi', () => ({
  listReports: vi.fn(),
}))
import { listReports } from '@/lib/adminApi'

afterEach(() => vi.clearAllMocks())

it('renders rows and opens one', async () => {
  ;(listReports as unknown as vi.Mock).mockResolvedValue({
    total: 1,
    items: [{
      id: 'r1', created_at: '2026-09-02T00:00:00Z', category: 'error', status: 'new',
      session_mode: 'freeform', session_title: 'Ask Anything', message_count: 4, has_email: true,
    }],
  })
  const onOpen = vi.fn()
  render(<AdminListView onOpen={onOpen} />)
  await screen.findByText('Ask Anything')
  await userEvent.click(screen.getByText('Ask Anything'))
  expect(onOpen).toHaveBeenCalledWith('r1')
})

it('shows an auth message when the API says unauthorized', async () => {
  ;(listReports as unknown as vi.Mock).mockRejectedValue(new Error('unauthorized'))
  render(<AdminListView onOpen={() => {}} />)
  expect(await screen.findByText(/sign in as an admin/i)).toBeInTheDocument()
})
```

```tsx
// frontend/src/components/admin/AdminReportView.test.tsx
import { describe, expect, it, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AdminReportView } from './AdminReportView'

vi.mock('@/lib/adminApi', () => ({ getReport: vi.fn(), updateReport: vi.fn() }))
import { getReport, updateReport } from '@/lib/adminApi'

const detail = {
  id: 'r1', created_at: '2026-09-02T00:00:00Z', client_id: 'c', email: null,
  category: 'wrong_answer', description: 'the answer was wrong', status: 'new', admin_notes: null,
  app_version: '1.0', user_agent: 'UA', viewport: '800x600', page_url: 'http://x/',
  session_mode: 'freeform', session_title: 'Ask Anything', message_count: 2,
  session_json: {
    id: 's1', mode: 'freeform', title: 'Ask Anything',
    messages: [
      { id: 'm1', role: 'user', text: 'what is grace' },
      { id: 'm2', role: 'assistant', text: 'Grace is unmerited favour.', trace: {
        turnId: 't', requestPath: '/chat', startedAt: 0, endedAt: 10, durationMs: 10,
        input: { message: 'what is grace', mode: 'freeform', modeParams: null, historyLength: 0, pageContext: null },
        steps: [], outcome: { type: 'chat', route: null, error: null },
        totals: { toolCalls: 0, llmCalls: 0, llmTokens: null, durationMs: 10 },
      } },
    ],
  },
}

afterEach(() => vi.clearAllMocks())

it('renders the transcript and a trajectory per traced turn', async () => {
  ;(getReport as unknown as vi.Mock).mockResolvedValue(detail)
  render(<AdminReportView id="r1" onBack={() => {}} />)
  expect(await screen.findByText('the answer was wrong')).toBeInTheDocument()
  expect(screen.getByText('what is grace')).toBeInTheDocument()
  expect(screen.getByText('USER')).toBeInTheDocument()   // from TrajectoryView
})

it('saves a status change', async () => {
  ;(getReport as unknown as vi.Mock).mockResolvedValue(detail)
  ;(updateReport as unknown as vi.Mock).mockResolvedValue({ ...detail, status: 'resolved' })
  render(<AdminReportView id="r1" onBack={() => {}} />)
  await screen.findByText('the answer was wrong')
  await userEvent.selectOptions(screen.getByLabelText(/status/i), 'resolved')
  await userEvent.click(screen.getByRole('button', { name: /save/i }))
  await waitFor(() => expect(updateReport).toHaveBeenCalledWith('r1', { status: 'resolved', admin_notes: '' }))
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/components/admin/AdminListView.test.tsx src/components/admin/AdminReportView.test.tsx`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

```tsx
// frontend/src/components/admin/AdminListView.tsx
import { useEffect, useState } from 'react'
import { listReports, type ReportListItem } from '@/lib/adminApi'

interface AdminListViewProps {
  onOpen: (id: string) => void
}

const STATUS_FILTERS = ['', 'new', 'triaged', 'resolved']
const CATEGORY_FILTERS = ['', 'wrong_answer', 'error', 'slow', 'ui', 'other']

export function AdminListView({ onOpen }: AdminListViewProps) {
  const [items, setItems] = useState<ReportListItem[]>([])
  const [total, setTotal] = useState(0)
  const [status, setStatus] = useState('')
  const [category, setCategory] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    listReports({ status: status || undefined, category: category || undefined })
      .then((r) => {
        if (cancelled) return
        setItems(r.items)
        setTotal(r.total)
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [status, category])

  if (error === 'unauthorized') {
    return <p className="p-6 text-sm">Please sign in as an admin (HTTP Basic) to view reports.</p>
  }
  if (error === 'admin_not_configured') {
    return <p className="p-6 text-sm">Admin access is not configured on this server.</p>
  }

  return (
    <div className="p-4">
      <div className="mb-3 flex items-center gap-3 text-sm">
        <label className="flex items-center gap-1">
          Status
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded border px-1 py-0.5">
            {STATUS_FILTERS.map((s) => (
              <option key={s} value={s}>{s || 'all'}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1">
          Category
          <select value={category} onChange={(e) => setCategory(e.target.value)} className="rounded border px-1 py-0.5">
            {CATEGORY_FILTERS.map((c) => (
              <option key={c} value={c}>{c || 'all'}</option>
            ))}
          </select>
        </label>
        <span className="text-[var(--color-text-secondary)]">{total} report(s)</span>
      </div>

      {loading ? (
        <p className="text-sm text-[var(--color-text-secondary)]">Loading…</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead className="text-xs text-[var(--color-text-secondary)]">
            <tr>
              <th className="py-1">When</th>
              <th>Category</th>
              <th>Status</th>
              <th>Mode</th>
              <th>Msgs</th>
              <th>Session</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr
                key={it.id}
                onClick={() => onOpen(it.id)}
                className="cursor-pointer border-t border-[var(--color-theme-border)] hover:bg-[var(--color-surface-alt)]"
              >
                <td className="py-1.5">{new Date(it.created_at).toLocaleString()}</td>
                <td>{it.category}</td>
                <td>{it.status}</td>
                <td>{it.session_mode}</td>
                <td>{it.message_count}</td>
                <td>{it.session_title}</td>
                <td>{it.has_email ? '✉' : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
```

```tsx
// frontend/src/components/admin/AdminReportView.tsx
import { useEffect, useState } from 'react'
import { getReport, updateReport, type ReportDetail } from '@/lib/adminApi'
import { TrajectoryView } from './TrajectoryView'

interface AdminReportViewProps {
  id: string
  onBack: () => void
}

const STATUSES = ['new', 'triaged', 'resolved']

export function AdminReportView({ id, onBack }: AdminReportViewProps) {
  const [report, setReport] = useState<ReportDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState('new')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    getReport(id)
      .then((r) => {
        if (cancelled) return
        setReport(r)
        setStatus(r.status)
        setNotes(r.admin_notes ?? '')
      })
      .catch((e: Error) => !cancelled && setError(e.message))
    return () => {
      cancelled = true
    }
  }, [id])

  async function save() {
    setSaving(true)
    setSaveError(null)
    try {
      const updated = await updateReport(id, { status, admin_notes: notes })
      setReport(updated)
    } catch (e) {
      setSaveError((e as Error).message)
      if (report) {
        setStatus(report.status)
        setNotes(report.admin_notes ?? '')
      }
    } finally {
      setSaving(false)
    }
  }

  if (error === 'unauthorized') return <p className="p-6 text-sm">Please sign in as an admin.</p>
  if (error === 'admin_not_configured') return <p className="p-6 text-sm">Admin access is not configured.</p>
  if (error) return <p className="p-6 text-sm text-red-600">{error}</p>
  if (!report) return <p className="p-6 text-sm text-[var(--color-text-secondary)]">Loading…</p>

  const messages = report.session_json?.messages ?? []

  return (
    <div className="flex flex-col gap-4 p-4">
      <button onClick={onBack} className="self-start text-sm text-[var(--color-theme-accent)]">← Back to list</button>

      <header className="rounded-lg border border-[var(--color-theme-border)] p-3 text-sm">
        <p className="font-semibold">{report.category} · {report.session_title}</p>
        <p className="mt-1 whitespace-pre-wrap">{report.description}</p>
        <p className="mt-2 text-xs text-[var(--color-text-secondary)]">
          {new Date(report.created_at).toLocaleString()} · {report.app_version} · {report.viewport} ·{' '}
          {report.email ?? 'no email'} · <span className="break-all">{report.user_agent}</span>
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="flex flex-col text-xs">
            Status
            <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded border px-1 py-0.5">
              {STATUSES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-1 flex-col text-xs">
            Admin notes
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="min-h-16 rounded border px-1 py-0.5"
            />
          </label>
          <button
            onClick={save}
            disabled={saving}
            className="rounded bg-[var(--color-theme-accent)] px-3 py-1.5 text-sm text-[var(--color-theme-accent-contrast)] disabled:opacity-40"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
        {saveError && <p className="mt-1 text-xs text-red-600">Couldn&apos;t save: {saveError}</p>}
      </header>

      <section className="flex flex-col gap-4">
        {messages.map((m, i) => (
          <div key={m.id ?? i} className="rounded-lg border border-[var(--color-theme-border)] p-3">
            <p className="text-xs font-mono text-[var(--color-text-secondary)]">{m.role.toUpperCase()}</p>
            <p className="mt-1 whitespace-pre-wrap text-sm">{m.text}</p>
            {m.role === 'assistant' && m.trace && (
              <div className="mt-3">
                <TrajectoryView
                  trace={m.trace}
                  userMessage={messages[i - 1]?.text ?? ''}
                  assistantText={m.text}
                />
              </div>
            )}
          </div>
        ))}
      </section>
    </div>
  )
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/components/admin/`
Expected: PASS (all admin component tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/admin/AdminListView.tsx frontend/src/components/admin/AdminReportView.tsx frontend/src/components/admin/AdminListView.test.tsx frontend/src/components/admin/AdminReportView.test.tsx
git commit -m "feat(frontend): add admin report list and detail views"
```

---

## Task 20: Mount the admin app on `/admin`

**Files:**
- Create: `frontend/src/components/admin/AdminApp.tsx`
- Modify: `frontend/src/main.tsx`
- Test: `frontend/src/components/admin/AdminApp.test.tsx`

**Interfaces:**
- Consumes: `AdminListView`, `AdminReportView`.
- Produces:
  - `AdminApp(): JSX.Element` — reads `?id=` from `location.search`; renders `<AdminReportView>` when present (Back clears it via `history.pushState`), else `<AdminListView>` (opening a row sets `?id=`). Simple `useState`-mirrored URL, no router dependency.
  - `main.tsx`: when `window.location.pathname.startsWith('/admin')`, render `<Suspense><LazyAdminApp/></Suspense>` (via `React.lazy(() => import('./components/admin/AdminApp'))`) instead of `<App/>`.

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/components/admin/AdminApp.test.tsx
import { describe, expect, it, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AdminApp } from './AdminApp'

vi.mock('@/lib/adminApi', () => ({
  listReports: vi.fn().mockResolvedValue({
    total: 1,
    items: [{
      id: 'r1', created_at: '2026-09-02T00:00:00Z', category: 'error', status: 'new',
      session_mode: 'freeform', session_title: 'Ask Anything', message_count: 1, has_email: false,
    }],
  }),
  getReport: vi.fn().mockResolvedValue({
    id: 'r1', created_at: '2026-09-02T00:00:00Z', client_id: 'c', email: null,
    category: 'error', description: 'boom', status: 'new', admin_notes: null,
    app_version: 'v', user_agent: 'UA', viewport: '1x1', page_url: 'u',
    session_mode: 'freeform', session_title: 'Ask Anything', message_count: 0,
    session_json: { messages: [] },
  }),
  updateReport: vi.fn(),
}))

afterEach(() => {
  window.history.pushState({}, '', '/admin')
})

it('navigates from list to detail and back via the URL', async () => {
  window.history.pushState({}, '', '/admin')
  render(<AdminApp />)
  await userEvent.click(await screen.findByText('Ask Anything'))
  expect(await screen.findByText('boom')).toBeInTheDocument()
  expect(location.search).toContain('id=r1')
  await userEvent.click(screen.getByText(/back to list/i))
  expect(location.search).not.toContain('id=r1')
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run src/components/admin/AdminApp.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```tsx
// frontend/src/components/admin/AdminApp.tsx
import { useCallback, useState } from 'react'
import { AdminListView } from './AdminListView'
import { AdminReportView } from './AdminReportView'

function currentId(): string | null {
  return new URLSearchParams(window.location.search).get('id')
}

export function AdminApp() {
  const [id, setId] = useState<string | null>(() => currentId())

  const open = useCallback((next: string) => {
    const url = new URL(window.location.href)
    url.searchParams.set('id', next)
    window.history.pushState({}, '', url)
    setId(next)
  }, [])

  const back = useCallback(() => {
    const url = new URL(window.location.href)
    url.searchParams.delete('id')
    window.history.pushState({}, '', url)
    setId(null)
  }, [])

  return (
    <div className="min-h-screen bg-[var(--color-surface)] text-[var(--color-text-primary)]">
      <header className="border-b border-[var(--color-theme-border)] px-4 py-2 text-sm font-semibold">
        Troubleshooting reports
      </header>
      {id ? <AdminReportView id={id} onBack={back} /> : <AdminListView onOpen={open} />}
    </div>
  )
}

export default AdminApp
```

In `frontend/src/main.tsx`:

```tsx
import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

const AdminApp = lazy(() => import('./components/admin/AdminApp.tsx'))

const isAdmin = window.location.pathname.startsWith('/admin')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isAdmin ? (
      <Suspense fallback={<div style={{ padding: 24, font: '14px system-ui' }}>Loading…</div>}>
        <AdminApp />
      </Suspense>
    ) : (
      <App />
    )}
  </StrictMode>,
)
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && npx vitest run src/components/admin/AdminApp.test.tsx && npm test`
Expected: PASS (new test + full frontend suite green).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/admin/AdminApp.tsx frontend/src/components/admin/AdminApp.test.tsx frontend/src/main.tsx
git commit -m "feat(frontend): mount admin trajectory app on /admin"
```

---

## Task 21: Deployment wiring

**Files:**
- Modify: `docker-compose.yml`, `.env.example`, `.gitignore`, `DEPLOYMENT.md`
- No automated test — verification is `docker compose config` + a documented manual smoke.

**Interfaces:**
- Produces: a persistent `feedback.db` for the `flask-api` container; `ADMIN_USER` / `ADMIN_PASSWORD` / `FEEDBACK_DB_URL` available to it; ignored DB artefacts; documented setup.

- [ ] **Step 1: `.gitignore`**

Append under the existing SQLite block:

```gitignore
# Writable troubleshooting-feedback DB (created at runtime, never committed)
feedback.db
feedback.db-shm
feedback.db-wal
```

- [ ] **Step 2: `.env.example`**

Append a new section:

```dotenv
# ─── Troubleshooting feedback (Flask: myproject.py) ─────────────────────────
# Where user-submitted chat reports are stored. Default is a file in the app
# working dir; in Docker this is a mounted volume (see docker-compose.yml).
FEEDBACK_DB_URL=sqlite:///feedback.db
# HTTP Basic credentials for the /admin trajectory viewer and /api/admin/*.
# BOTH must be set for admin access; unset ⇒ admin endpoints return 503.
ADMIN_USER=
ADMIN_PASSWORD=
```

- [ ] **Step 3: `docker-compose.yml`** — under the `flask-api` service

Add `env_file` and a `feedback.db` bind mount + the named volume; extend `environment`:

```yaml
  flask-api:
    build:
      context: .
      dockerfile: Dockerfile.flask
    image: bible-explorer/flask-api:latest
    env_file:
      - .env
    environment:
      CHATBOT_BASE_URL: http://chatbot:8020
      FEEDBACK_DB_URL: sqlite:////app/feedback.db
    volumes:
      - ./Complete.db:/app/Complete.db
      - ./CACHED_PAGES:/app/CACHED_PAGES
      # Writable troubleshooting-feedback DB — survives container recreation.
      - feedback-db:/app/feedback-db
```

Wait — `FEEDBACK_DB_URL` points at `/app/feedback.db` but the volume mounts a
directory. Use a directory-scoped path instead. Set:

```yaml
    environment:
      CHATBOT_BASE_URL: http://chatbot:8020
      FEEDBACK_DB_URL: sqlite:////app/feedback-db/feedback.db
```

and at the bottom of the file, under the top-level `volumes:` key (create it if
absent — the file already declares `networks:`), add:

```yaml
volumes:
  feedback-db:
```

- [ ] **Step 4: `DEPLOYMENT.md`**

Add a short subsection near the env-var / volumes discussion:

```markdown
### Troubleshooting feedback (`/admin`)

Users can file a chat report from any session ("Report an issue"). Reports —
conversation + per-turn trace — are written to a **separate SQLite DB**
(`feedback.db`), not `Complete.db`. In Docker it lives on the named
`feedback-db` volume mounted into `flask-api` at `/app/feedback-db/`; set
`FEEDBACK_DB_URL` to relocate it.

The admin trajectory viewer is the SPA route **`/admin`** and the
`GET/PATCH /api/admin/feedback*` API. Both require HTTP Basic auth from
`ADMIN_USER` / `ADMIN_PASSWORD`. If either is unset the admin API returns
`503` and the `/admin` page shows "admin access is not configured".

Pass `VITE_APP_VERSION` when building the frontend (`VITE_APP_VERSION=$(git
describe --tags --always) npm run build`) so reports record which build they
came from; it defaults to `dev`.

No nginx change is needed — `/api/feedback`, `/api/admin/*`, and the `/admin`
SPA route all resolve under existing `location` blocks.
```

- [ ] **Step 5: Verify + commit**

Run: `docker compose config >/dev/null && echo OK`
Expected: `OK` (compose file parses; the `feedback-db` volume and env are accepted).

Manual smoke (documented, run once on a dev box):
1. `ADMIN_USER=a ADMIN_PASSWORD=b python myproject.py` (chatbot + frontend running per `DEPLOYMENT.md`).
2. In the app, send a chat message, click **Report an issue**, submit.
3. `curl -u a:b localhost:5000/api/admin/feedback` → JSON with `total: 1`.
4. Open `localhost:5173/admin` (or the built SPA `/admin`), authenticate, confirm the report opens with a trajectory for the assistant turn.

```bash
git add docker-compose.yml .env.example .gitignore DEPLOYMENT.md
git commit -m "chore(deploy): wire feedback.db volume and admin credentials"
```

---

## Self-Review

**1. Spec coverage**

| Spec section | Task(s) |
|---|---|
| Trace recorder (`chatbot/trace.py`, ContextVar, redaction, truncation) | 1 |
| `ChatResponse.trace` schema | 2 |
| Trace coverage — tools | 3 |
| Trace coverage — LLM calls + tokens (Ollama + NVIDIA) | 4 |
| Trace coverage — routing branches + primers | 5 |
| Non-streaming `/chat` returns trace, incl. error path | 6 |
| Streaming `/chat/stream` terminal `trace` SSE event | 7 |
| `feedback.db` schema + `feedback_store` helpers | 8 |
| `POST /api/feedback` ingest (validation, 5 MB cap, rate limit, derived denorm fields) | 9 |
| Basic-auth `GET`/`GET <id>`/`PATCH` admin API, 503 when unconfigured | 10 |
| Frontend `Trace` types, `SessionMessage.trace`, `ChatMessage.trace`, store v2 | 11 |
| `clientId` persistence + fallback | 12 |
| `feedbackApi.submitReport` payload assembly | 13 |
| `ReportIssueDialog` (category/description/email, states) | 14 |
| Report button + trace storage in `ChatPane` | 15 |
| Trace capture + report action in `BibleChatWidget` (stream `trace` event + non-stream) | 16 |
| `adminApi` client (401→unauthorized, 503→admin_not_configured) | 17 |
| `TrajectoryView` — Input/Model/Tools timeline, step tree, detail drawer, truncation note | 18 |
| `AdminListView` + `AdminReportView` (transcript, per-turn trajectory, triage `status`/`admin_notes`, optimistic PATCH) | 19 |
| `/admin` route mount, code-split | 20 |
| Deployment: volume, env vars, `.gitignore`, `DEPLOYMENT.md`, no nginx change | 21 |
| Out-of-scope items (no artifact-endpoint tracing, no accounts, no export, no pruning, thumbs feedback untouched) | respected — no task touches them |

No gaps.

**2. Placeholder scan** — no `TBD`/`TODO`/"add error handling"/"similar to Task N". Task 5 uses a label table but pairs it with a concrete worked example and exact insertion instructions for every branch. Task 21 is config-only and carries the full file fragments plus a `docker compose config` check.

**3. Type consistency**

- `Trace`/`TraceStep` field names identical across the wire contract (Global Constraints), `chatbot/trace.py` (Task 1), `frontend/src/types/trace.ts` (Task 11), `adminApi` (Task 17), and `TrajectoryView` (Task 18).
- `response` shape is `{ preview, bytesTotal }` everywhere (Global Constraints call out the deviation from the spec's prose `content` key; `_StepBox.set_response`, the TS `TraceStep.response` type, and `TrajectoryView`'s `selected.response.preview` all agree).
- `category` enum `wrong_answer | error | slow | ui | other` — `feedback_store.CATEGORIES` (Task 8), ingest validation (Task 9), `ReportCategory` (Task 13), `CATEGORY_OPTIONS` (Task 14), `CATEGORY_FILTERS` (Task 19).
- `status` enum `new | triaged | resolved` — `feedback_store.STATUSES` (8), PATCH validation (10), `STATUS_FILTERS` (19), `STATUSES` in `AdminReportView` (19).
- `submitReport(session, form)` signature — defined Task 13, called identically in Task 14 and Task 16.
- `listReports` / `getReport` / `updateReport` names + params — defined Task 17, consumed unchanged in Tasks 19–20.
- `_get_feedback_db()` / `_FEEDBACK_DB_URL` / `_feedback_db` — introduced Task 9, reused (and monkeypatched) in Tasks 9 and 10 tests consistently.
- `record_tool` / `record_llm` / `record_context` / `record_routing` — defined Task 1, imported by name in Tasks 3, 4, 5.
- `TraceRecorder(...)` constructor kwargs (`request_path`, `message`, `mode`, `mode_params`, `history_length`, `page_context`) — defined Task 1, called with those exact kwargs in Tasks 6 and 7.

No inconsistencies found.
