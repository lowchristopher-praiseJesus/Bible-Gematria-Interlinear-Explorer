"""FastAPI routes for the Bible chatbot."""

from typing import AsyncIterator, Optional

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse

from chatbot.schemas import (
    BookContextResponse,
    ChatRequest,
    ChatResponse,
    ParablesResponse,
    StrongsResponse,
    StudyResponse,
    TopicsResponse,
    VerseResponse,
)
from chatbot.tools import (
    fetch_verse_translations,
    fetch_scripture_study,
    fetch_strongs,
)
from chatbot.book_context import get_book_context
from chatbot.data.parables import PARABLES
from chatbot.data.topics import TOPICS
from chatbot.router import build_mode_primer, route_deterministic, route_claude, _generate_follow_ups
from chatbot.streaming import sse_stream, sse_event

router = APIRouter()


# ---------------------------------------------------------------------------
# Direct tool endpoints
# ---------------------------------------------------------------------------

@router.get("/verse/{reference}", response_model=VerseResponse)
async def get_verse(
    reference: str,
    lang: Optional[str] = Query(None, description="Comma-separated ISO-639-3 codes"),
):
    """Fetch verse translations for a reference."""
    languages = [l.strip() for l in lang.split(",")] if lang else None
    translations = await fetch_verse_translations(reference, languages=languages)
    if not translations:
        raise HTTPException(status_code=404, detail="Verse not found")
    return VerseResponse(reference=reference, translations=translations)


@router.get("/study/{reference}", response_model=StudyResponse)
async def get_study(
    reference: str,
    depth: str = Query("medium", enum=["light", "medium", "full"]),
):
    """Fetch merged commentary for a verse reference."""
    result = await fetch_scripture_study(reference, depth=depth)
    return StudyResponse(**result)


@router.get("/strongs/{query}", response_model=StrongsResponse)
async def get_strongs_endpoint(
    query: str,
):
    """Fetch Strong's entries by number or word search."""
    numbers = None
    words = None

    # Detect Strong's number pattern (G1234, H1234)
    import re
    if re.match(r"^[GH]\d{1,4}$", query, re.IGNORECASE):
        numbers = [query.upper()]
    else:
        words = [query]

    result = await fetch_strongs(numbers=numbers, words=words)
    return StrongsResponse(**result)


@router.get("/book_context/{book}", response_model=BookContextResponse)
async def get_book_context_endpoint(book: str):
    """Fetch book-level context (historical setting, themes, etc.) for a NT book."""
    ctx = get_book_context(book)
    if not ctx:
        raise HTTPException(status_code=404, detail="No context available for this book")
    return BookContextResponse(**ctx)


@router.get("/parables", response_model=ParablesResponse)
async def list_parables():
    """List the curated parables available for Parable Study mode."""
    return ParablesResponse(parables=PARABLES)


@router.get("/topics", response_model=TopicsResponse)
async def list_topics():
    """List the curated topics available for Topical Study mode."""
    return TopicsResponse(topics=TOPICS)


# ---------------------------------------------------------------------------
# Chat endpoint (non-streaming)
# ---------------------------------------------------------------------------

@router.post("/chat", response_model=ChatResponse)
async def post_chat(request: ChatRequest):
    """Process a chat message and return a structured response."""
    try:
        if request.mode and not request.message.strip():
            result = await build_mode_primer(request.mode, request.mode_params)
            return ChatResponse(**result)

        history = (
            [{"role": m.role, "text": m.text} for m in request.history]
            if request.history else None
        )
        result = await route_deterministic(
            request.message, history=history, page_context=request.page_context
        )
        if result:
            return ChatResponse(**result)
        result = await route_claude(
            request.message, history=history, page_context=request.page_context
        )
        if "follow_up_questions" not in result or not result["follow_up_questions"]:
            result["follow_up_questions"] = _generate_follow_ups(
                result.get("type", "chat"), result.get("data"), ""
            )
        return ChatResponse(**result)
    except Exception as e:
        return ChatResponse(
            type="error",
            message=f"Server error: {type(e).__name__}: {e}",
            data=None,
            route="Error path",
        )


# ---------------------------------------------------------------------------
# Chat endpoint (SSE streaming)
# ---------------------------------------------------------------------------

async def _stream_chat_response(message: str, page_context: Optional[str] = None) -> AsyncIterator[str]:
    """Yield SSE events for a chat response."""
    # Try deterministic first
    result = await route_deterministic(message, page_context=page_context)
    if result:
        yield await sse_event("deterministic", result)
        return

    # Streaming fallback via Ollama
    from chatbot.ollama_client import OLLAMA_API_URL, OLLAMA_API_KEY, OLLAMA_MODEL, stream_chat_with_ollama

    # Check if Ollama is available (local doesn't require key)
    is_cloud = "api.ollama.com" in OLLAMA_API_URL or OLLAMA_API_URL.startswith("https://")
    if is_cloud and not OLLAMA_API_KEY:
        yield await sse_event(
            "error",
            {
                "message": (
                    "No matching pattern found and Ollama Cloud API is not configured. "
                    "Please set OLLAMA_API_KEY environment variable or ensure local Ollama is running."
                )
            },
        )
        return

    text_buffer = ""
    async for event in stream_chat_with_ollama(message, page_context=page_context):
        if event.get("type") == "stream":
            chunk = event.get("chunk", "")
            text_buffer += chunk
            yield await sse_event("stream", {"chunk": chunk, "text": text_buffer})
        elif event.get("type") == "done":
            yield await sse_event("done", {"message": text_buffer, "route": f"AI Fallback → Ollama ({OLLAMA_MODEL}) → stream_chat_with_ollama()"})
        elif event.get("type") == "error":
            yield await sse_event("error", {"message": event.get("message", "Unknown error")})


@router.post("/chat/stream")
async def post_chat_stream(request: ChatRequest):
    """Process a chat message and stream the response via SSE."""
    return StreamingResponse(
        sse_stream(_stream_chat_response(request.message, page_context=request.page_context)),
        media_type="text/event-stream",
    )
