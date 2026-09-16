"""FastAPI routes for the Bible chatbot."""

import asyncio
import logging
from typing import AsyncIterator, Optional, Tuple

import httpx
from fastapi import APIRouter, Header, HTTPException, Query
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
    VoiceSessionRequest,
    VoiceSessionResponse,
)
from chatbot.tools import (
    fetch_verse_translations,
    fetch_scripture_study,
    fetch_strongs,
    list_passage_verses,
)
from chatbot.book_context import get_book_context
from chatbot.data.parables import PARABLES
from chatbot import wiki_loader, wiki_qa, socratic, hermeneutics
from chatbot.router import (
    build_mode_primer,
    route_deterministic,
    route_claude,
    _enhance_with_cited_verse,
    _attach_llm_follow_ups,
    _generate_follow_ups,
    _usfm_from_name,
)
from chatbot.streaming import sse_event
from chatbot.trace import TraceRecorder, current_recorder

router = APIRouter()
logger = logging.getLogger(__name__)


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


# ---------------------------------------------------------------------------
# Chat endpoint (non-streaming)
# ---------------------------------------------------------------------------

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

        # A free-text message inside a Topical Study session that has
        # already resolved to a series is a question about that series,
        # not a generic Bible question — answer it from the wiki instead
        # of falling through to the deterministic/Ollama-fallback path
        # every other mode uses.
        series_id = (request.mode_params or {}).get("series_id") if request.mode == "topic" else None
        if series_id:
            concept_slug = (request.mode_params or {}).get("concept_slug")
            result = await wiki_qa.answer(series_id, request.message, history, concept_slug=concept_slug)
            return _with_trace(result)

        # Every turn in a Socratic Study session — not just the primer —
        # needs the Socratic persona and passage grounding, so it never
        # falls through to the generic deterministic/Ollama-fallback path.
        if request.mode == "socratic":
            reference = (request.mode_params or {}).get("reference")
            result = await socratic.answer(reference, request.message, history)
            return _with_trace(result)

        # Every turn in a Hermeneutics session needs the phase pipeline (or
        # its digest-backed follow-up path) — same special case Socratic
        # Study makes above.
        if request.mode == "hermeneutics":
            params = request.mode_params or {}
            result = await hermeneutics.answer(
                params.get("reference"), request.message, history,
                run_digest=params.get("run_digest"),
            )
            return _with_trace(result)

        result = await route_deterministic(
            request.message, history=history, page_context=request.page_context, mode=request.mode
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


# ---------------------------------------------------------------------------
# Chat endpoint (SSE streaming)
# ---------------------------------------------------------------------------

async def _stream_chat_response(
    recorder: TraceRecorder, request: ChatRequest, openai_key: Optional[str] = None
) -> AsyncIterator[str]:
    """Yield SSE events for a chat response: zero or more `stream` chunk
    events while the LLM is generating (only the AI-fallback path below ever
    emits these — everything else already has its full answer in hand),
    then exactly one `final` event carrying the complete ChatResponse-shaped
    payload, then a terminal `trace` event.

    Mirrors post_chat()'s routing exactly (mode primers, Topical Study's
    wiki Q&A, deterministic matches, then the AI fallback), so switching a
    caller from /chat to /chat/stream never changes *what* answers a
    message — only whether the AI fallback's own generation streams in as
    it's produced instead of arriving all at once after a silent wait.

    `openai_key` is voice mode's BYOK override (from the X-OpenAI-Key
    header — never logged, never part of `request`): when present *and*
    `request.use_openai_llm` is set, the AI-fallback leg below generates the
    answer via OpenAI's gpt-5.4-mini with that key instead of the server's
    configured Ollama/NVIDIA provider. Every other routing path (mode
    primers, wiki Q&A, deterministic matches) ignores it entirely, since
    they never call the LLM.
    """
    current_recorder.set(recorder)
    outcome_type = "chat"
    outcome_route = None
    outcome_error = None

    def _note_outcome(result: dict) -> None:
        nonlocal outcome_type, outcome_route, outcome_error
        outcome_type = result.get("type", "chat")
        outcome_route = result.get("route")
        outcome_error = result.get("message") if outcome_type == "error" else None

    try:
        history = (
            [{"role": m.role, "text": m.text} for m in request.history]
            if request.history else None
        )

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
            _rs, _rc = md.get("rotation_seed"), md.get("rotation_cursor")
            try:
                rotation = (int(_rs), int(_rc)) if _rs is not None and _rc is not None else None
            except (TypeError, ValueError):
                rotation = None
            full_text, reference, translations, stream_error = "", None, {}, None
            try:
                async for ev in stream_devotional(raw or None, source, request.page_context, rotation):
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

        if request.mode and not request.message.strip():
            result = await build_mode_primer(request.mode, request.mode_params)
            _note_outcome(result)
            yield await sse_event("final", {"result": result})
            return

        # A free-text message inside a Topical Study session that has
        # already resolved to a series is a question about that series —
        # same special case post_chat() makes before falling through to
        # the deterministic/AI-fallback path every other mode uses.
        series_id = (request.mode_params or {}).get("series_id") if request.mode == "topic" else None
        if series_id:
            concept_slug = (request.mode_params or {}).get("concept_slug")
            result = await wiki_qa.answer(series_id, request.message, history, concept_slug=concept_slug)
            _note_outcome(result)
            yield await sse_event("final", {"result": result})
            return

        # Same special case as post_chat(): every turn in a Socratic Study
        # session needs the Socratic persona and passage grounding.
        if request.mode == "socratic":
            reference = (request.mode_params or {}).get("reference")
            result = await socratic.answer(reference, request.message, history)
            _note_outcome(result)
            yield await sse_event("final", {"result": result})
            return

        # Same special case, plus the additive `phase` event: each completed
        # phase is pushed as it lands, ahead of the single `final`.
        if request.mode == "hermeneutics":
            params = request.mode_params or {}
            async for event in hermeneutics.stream(
                params.get("reference"), request.message, history,
                run_digest=params.get("run_digest"),
            ):
                if event["kind"] == "phase":
                    yield await sse_event("phase", {"phase": event["phase"]})
                else:
                    _note_outcome(event["result"])
                    yield await sse_event("final", {"result": event["result"]})
            return

        result = await route_deterministic(
            request.message, history=history, page_context=request.page_context, mode=request.mode
        )
        if result:
            _note_outcome(result)
            yield await sse_event("final", {"result": result})
            return

        from chatbot.ollama_client import (
            llm_unconfigured_error,
            active_model_label,
            stream_chat_with_ollama,
            OPENAI_VOICE_MODEL,
        )

        llm_override = (
            {"provider": "openai", "api_key": openai_key, "model": OPENAI_VOICE_MODEL}
            if request.use_openai_llm and openai_key
            else None
        )

        if not llm_override:
            llm_error = llm_unconfigured_error()
            if llm_error:
                result = {
                    "type": "error",
                    "message": f"No matching pattern found and the LLM is not configured. {llm_error}",
                    "data": None,
                    "route": "Error path",
                }
                _note_outcome(result)
                yield await sse_event("final", {"result": result})
                return

        ollama_history = (
            [{"role": h["role"], "content": h["text"]} for h in history]
            if history else None
        )
        text_buffer = ""
        stream_error: Optional[str] = None
        async for event in stream_chat_with_ollama(
            request.message,
            conversation_history=ollama_history,
            page_context=request.page_context,
            llm_override=llm_override,
        ):
            if event.get("type") == "stream":
                chunk = event.get("chunk", "")
                text_buffer += chunk
                yield await sse_event("stream", {"chunk": chunk, "text": text_buffer})
            elif event.get("type") == "error":
                stream_error = event.get("message", "Unknown error")

        if stream_error:
            result = {"type": "error", "message": stream_error, "data": None, "route": "Error path"}
        else:
            result = {
                "type": "chat",
                "message": text_buffer,
                "data": None,
                "route": f"AI Fallback → {active_model_label(llm_override)} → stream_chat_with_ollama()",
            }
            # Same post-processing post_chat() runs on route_claude()'s
            # result: box up any verses the answer cites, ask the LLM for
            # follow-ups grounded in this exchange, then backfill the
            # generic template if that gave us nothing usable.
            result = await _enhance_with_cited_verse(result)
            result = await _attach_llm_follow_ups(result, request.message, request.page_context)
            if not result.get("follow_up_questions"):
                result["follow_up_questions"] = _generate_follow_ups(
                    result.get("type", "chat"), result.get("data"), ""
                )
        _note_outcome(result)
        yield await sse_event("final", {"result": result})
    except Exception as e:  # noqa: BLE001
        outcome_type = "error"
        outcome_error = f"{type(e).__name__}: {e}"
        yield await sse_event("final", {"result": {
            "type": "error",
            "message": f"Server error: {outcome_error}",
            "data": None,
            "route": "Error path",
        }})
    finally:
        trace = recorder.finalize(outcome_type, route=outcome_route, error=outcome_error)
        yield await sse_event("trace", {"trace": trace})


@router.post("/chat/stream")
async def post_chat_stream(
    request: ChatRequest,
    x_openai_key: Optional[str] = Header(None, alias="X-OpenAI-Key"),
):
    """Process a chat message and stream the response via SSE.

    `X-OpenAI-Key` is voice mode's optional BYOK override header (see
    `_stream_chat_response`) — absent for every ordinary typed turn.
    """
    recorder = TraceRecorder(
        "/chat/stream",
        request.message,
        mode=request.mode,
        mode_params=request.mode_params,
        history_length=len(request.history or []),
        page_context=request.page_context,
    )
    return StreamingResponse(
        _stream_chat_response(recorder, request, openai_key=x_openai_key),
        media_type="text/event-stream",
    )


# ---------------------------------------------------------------------------
# Voice mode: GPT-Live WebRTC SDP handshake proxy
# ---------------------------------------------------------------------------

_MAX_VOICE_SDP_BYTES = 64 * 1024
_GPT_LIVE_SESSIONS_URL = "https://api.openai.com/v1/live/sessions"

# GPT-Live runs in `delegation: "client"` mode: it never generates the answer
# itself, only transcribes the user's speech and speaks back whatever text
# this app appends via `session.commentary.append` (the real answer, produced
# by the existing text-chat pipeline in ollama_client.py). `instructions`
# therefore governs delivery style, not content — it must not be confused
# with `_SYSTEM_PROMPT_BASE`, which is the actual answering persona.
_VOICE_SESSION_INSTRUCTIONS = (
    "You are the voice I/O layer for Bible Explorer, a Bible-study app. "
    "You never answer the user's question yourself and never generate your "
    "own reply text. Your only jobs are: transcribe what the user says, and "
    "when text is appended via commentary, speak that exact text back "
    "essentially verbatim — no paraphrasing, no added commentary, no "
    "greeting, and no sign-off of your own. Speak in a warm, calm, natural "
    "voice suited to quiet Bible study."
)
_VOICE_SESSION_INSTRUCTIONS_CONTINUATION = (
    " This voice session continues a conversation the user already started "
    "(by typing and/or speaking) — do not greet the user or introduce "
    "yourself as if this were a new conversation; just continue naturally "
    "from where it left off."
)


def _voice_session_instructions(has_history: bool) -> str:
    if has_history:
        return _VOICE_SESSION_INSTRUCTIONS + _VOICE_SESSION_INSTRUCTIONS_CONTINUATION
    return _VOICE_SESSION_INSTRUCTIONS


@router.post("/voice/session", response_model=VoiceSessionResponse)
async def create_voice_session(
    request: VoiceSessionRequest,
    x_openai_key: str = Header(..., alias="X-OpenAI-Key"),
):
    """Proxy the WebRTC SDP handshake for a GPT-Live voice session.

    Uses the caller-supplied OpenAI key for exactly one outbound call and
    never persists or logs it — see
    docs/superpowers/specs/2026-09-11-voice-mode-design.md.
    """
    if len(request.sdp.encode("utf-8")) > _MAX_VOICE_SDP_BYTES:
        raise HTTPException(status_code=413, detail="SDP offer too large")

    try:
        async with httpx.AsyncClient() as http_client:
            response = await http_client.post(
                _GPT_LIVE_SESSIONS_URL,
                headers={"Authorization": f"Bearer {x_openai_key}"},
                json={
                    "session": {
                        "model": "gpt-live-1",
                        "delegation": {"type": "client"},
                        "instructions": _voice_session_instructions(request.has_history),
                    },
                    "transport": {"type": "webrtc", "sdp": request.sdp},
                },
                timeout=15.0,
            )
    except httpx.HTTPError as exc:
        logger.warning("GPT-Live session request failed: %s", exc)
        raise HTTPException(
            status_code=502, detail="Couldn't reach OpenAI to start a voice session."
        )

    if response.status_code == 401:
        raise HTTPException(
            status_code=401,
            detail="Couldn't start a voice session — check your OpenAI API key in Settings.",
        )
    # A working key that simply lacks access to this model is its own,
    # likely BYOK failure (gpt-live-1 is newly released) — the generic 502
    # below would wrongly point the user at server trouble.
    if response.status_code == 403:
        raise HTTPException(
            status_code=403,
            detail=(
                "This OpenAI key doesn't have access to GPT-Live — "
                "check your OpenAI account's model access."
            ),
        )
    if response.status_code == 429:
        raise HTTPException(status_code=429, detail="OpenAI is rate-limiting this key right now.")
    if response.status_code >= 400:
        # Never seen the caller's key here — this is OpenAI's own response
        # body, safe to log — but it's the one signal that explains *why*
        # a BYOK voice session failed, and the client only ever gets the
        # generic message below.
        logger.warning(
            "GPT-Live session request rejected: status=%s body=%s",
            response.status_code,
            response.text[:2000],
        )
        raise HTTPException(status_code=502, detail="OpenAI couldn't start the voice session.")

    # An unexpected-shape (or non-JSON) 200 must land in this function's own
    # deliberate error mapping, not as an unhandled KeyError/TypeError →
    # FastAPI 500. `response.json()` raises json.JSONDecodeError (a
    # ValueError) on a non-JSON body; the subscripts raise KeyError on a
    # missing field and TypeError when a container isn't the shape assumed.
    try:
        body = response.json()
        session_id = body["session"]["id"]
        answer_sdp = body["transport"]["sdp"]
        if not isinstance(session_id, str) or not isinstance(answer_sdp, str):
            raise TypeError("unexpected field types in the GPT-Live session response")
    except (ValueError, KeyError, TypeError):
        raise HTTPException(status_code=502, detail="OpenAI returned an unexpected response.")

    return VoiceSessionResponse(session_id=session_id, sdp=answer_sdp)
