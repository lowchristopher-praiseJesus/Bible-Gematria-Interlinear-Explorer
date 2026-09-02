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
