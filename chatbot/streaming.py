"""SSE (Server-Sent Events) streaming helpers for the chatbot."""

import json
from typing import Any, AsyncIterator, Dict, Optional


async def sse_stream(text_iterator: AsyncIterator[str]) -> AsyncIterator[str]:
    """Wrap an async text iterator in SSE format."""
    async for chunk in text_iterator:
        yield f"data: {json.dumps({'chunk': chunk, 'done': False})}\n\n"
    yield f"data: {json.dumps({'chunk': '', 'done': True})}\n\n"


async def sse_event(event_type: str, payload: Dict[str, Any]) -> str:
    """Format a single SSE event."""
    data = {"type": event_type, **payload}
    return f"data: {json.dumps(data)}\n\n"
