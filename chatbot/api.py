"""FastAPI routes for the Bible chatbot."""

import asyncio
from typing import AsyncIterator, Optional, Tuple

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse

from chatbot.schemas import (
    BookContextResponse,
    ChatRequest,
    ChatResponse,
    PassageResponse,
    PassageVerse,
    ParablesResponse,
    StrongsResponse,
    StudyResponse,
    StudyWikisResponse,
    VerseResponse,
    WikiPageResponse,
)
from chatbot.tools import (
    fetch_verse_translations,
    fetch_scripture_study,
    fetch_strongs,
    list_passage_verses,
)
from chatbot.book_context import get_book_context
from chatbot.data.parables import PARABLES
from chatbot import wiki_loader
from chatbot.router import build_mode_primer, route_deterministic, route_claude, _generate_follow_ups, _usfm_from_name
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


def _parse_passage_reference(reference: str) -> Tuple[str, int, Optional[int], Optional[int]]:
    """Parse a full-book-name passage reference into (book, chapter, start_verse, end_verse).

    Accepts a bare chapter ("Job 1"), a single verse ("Matthew 13:44"), or a
    verse range ("Luke 15:11-32"). Raises ValueError on anything else.
    """
    reference = reference.strip()
    verse_part = None
    if ":" in reference:
        reference, verse_part = reference.split(":", 1)
        reference = reference.strip()
        verse_part = verse_part.strip()

    if " " not in reference:
        raise ValueError(f"Invalid reference: {reference!r}")
    book, chapter_str = reference.rsplit(" ", 1)
    if not chapter_str.isdigit():
        raise ValueError(f"Invalid reference: {reference!r}")
    chapter = int(chapter_str)

    start_verse = end_verse = None
    if verse_part:
        if "-" in verse_part:
            start_str, end_str = verse_part.split("-", 1)
        else:
            start_str = end_str = verse_part
        if not start_str.isdigit() or not end_str.isdigit():
            raise ValueError(f"Invalid reference: {reference!r}")
        start_verse, end_verse = int(start_str), int(end_str)

    return book.strip(), chapter, start_verse, end_verse


@router.get("/passage", response_model=PassageResponse)
async def get_passage(
    reference: str,
    fast: bool = Query(
        False,
        description=(
            "Skip the external multi-translation fetch and return only the "
            "KJV text already sitting in Complete.db — near-instant, no "
            "network calls. Meant for an initial paint the caller follows "
            "up with a non-fast request to fill in the rest of the "
            "translations in the background."
        ),
    ),
):
    """Fetch every verse in a chapter or verse range, each hydrated with
    multiple translations. The verse list itself comes from a fast local
    Complete.db lookup; translation text for each verse is then fetched
    concurrently via fetch_verse_translations (the same multi-version
    source Verse of the Day uses), so a Parable Study or Bible in a Year
    reading offers the same translation choice as a single verse lookup.

    That external fetch is what's slow — each verse is its own web request.
    `fast=true` skips it entirely and returns just the local KJV text
    (Complete.db already has it, no network needed), so a caller can paint
    something readable immediately and fetch the rest of the translations
    afterward without blocking on it."""
    try:
        book, chapter, start_verse, end_verse = _parse_passage_reference(reference)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid reference")

    verse_list = await list_passage_verses(book, chapter, start_verse, end_verse)
    if not verse_list:
        raise HTTPException(status_code=404, detail="Passage not found")

    if fast:
        verses = [
            PassageVerse(
                versenumber=v["versenumber"],
                vnum=v["vnum"],
                ref=v["ref"],
                translations={"eng-KJV": v["kjv"]} if v.get("kjv") else {},
            )
            for v in verse_list
        ]
        return PassageResponse(book=book, chapter=chapter, verseCount=len(verses), verses=verses)

    usfm = _usfm_from_name(book)

    async def hydrate(v: dict) -> PassageVerse:
        ref = f"{usfm} {chapter}:{v['vnum']}"
        try:
            translations = await fetch_verse_translations(ref, languages=["eng"])
        except Exception:
            translations = {}
        return PassageVerse(versenumber=v["versenumber"], vnum=v["vnum"], ref=v["ref"], translations=translations)

    verses = await asyncio.gather(*(hydrate(v) for v in verse_list))
    return PassageResponse(book=book, chapter=chapter, verseCount=len(verses), verses=list(verses))


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


@router.get("/study-wikis", response_model=StudyWikisResponse)
async def list_study_wikis():
    """List the registered study-wiki series available for Topical Study mode."""
    return StudyWikisResponse(study_wikis=wiki_loader.list_series())


@router.get("/study-wikis/{series_id}/pages/{slug}", response_model=WikiPageResponse)
async def get_wiki_page(series_id: str, slug: str):
    """Fetch one rendered concept/entity/source page from a registered study wiki."""
    manifest = wiki_loader.get_manifest(series_id)
    if not manifest:
        raise HTTPException(status_code=404, detail="Unknown study wiki series")
    page = wiki_loader.get_page(series_id, slug)
    if not page:
        raise HTTPException(status_code=404, detail="Unknown page")
    return WikiPageResponse(
        series_id=series_id,
        slug=slug,
        title=page["title"],
        kind=page["kind"],
        body_html=page["body_html"],
        citation=f"{manifest['speaker']} — {manifest['title']}",
    )


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
