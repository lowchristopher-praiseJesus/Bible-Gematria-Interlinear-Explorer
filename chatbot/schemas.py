"""Pydantic schemas for the Bible chatbot API."""

from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field


class HistoryMessage(BaseModel):
    role: str = Field(..., description="'user' or 'assistant'")
    text: str = Field(..., description="Message text content")


class ArtifactLink(BaseModel):
    type: str = Field(..., description="interlinear | chapter | strongs | book_context | gematria | english_search | devotional")
    label: str = Field(..., description="Human-readable link text shown in the chat bubble")
    params: Dict[str, Any] = Field(default_factory=dict, description="Fetch parameters for the artifact panel")


class ChatRequest(BaseModel):
    message: str = Field(..., description="User's biblical question or request")
    conversation_id: Optional[str] = Field(None, description="Optional conversation ID for context")
    history: Optional[List["HistoryMessage"]] = Field(None, description="Recent conversation turns for context")
    page_context: Optional[str] = Field(None, description="Verse reference currently displayed on the Explorer page (e.g. 'John 3:16')")
    mode: Optional[str] = Field(None, description="Study mode: reading_plan, parable, verse, topic, devotional, socratic, hermeneutics, character, freeform")
    mode_params: Optional[Dict[str, Any]] = Field(None, description="Mode-specific parameters, e.g. {'plan': 'chronological', 'day_index': 0} or, for character mode, {'character_id': 'david'}")
    use_openai_llm: Optional[bool] = Field(
        None,
        description=(
            "Voice mode's BYOK override: generate this turn's answer with the "
            "caller's own OpenAI key (sent separately as the X-OpenAI-Key "
            "header, never in the body) instead of the server's configured "
            "Ollama/NVIDIA provider. Ignored if the header is absent."
        ),
    )


class ChatResponse(BaseModel):
    type: str = Field(..., description="Response type: verse, study, strongs, chat, error")
    message: str = Field(..., description="Natural language response")
    data: Optional[Dict[str, Any]] = Field(None, description="Structured data payload")
    route: Optional[str] = Field(None, description="Human-readable description of the routing path taken")
    follow_up_questions: Optional[List[str]] = Field(None, description="Suggested follow-up questions")
    artifacts: Optional[List[ArtifactLink]] = Field(None, description="Links the frontend can open in the artifact panel")
    trace: Optional[Dict[str, Any]] = Field(
        None, description="Per-turn trace of routing/tool/LLM steps (troubleshooting)"
    )


class VerseResponse(BaseModel):
    reference: str = Field(..., description="Verse reference (e.g., JHN.3.16)")
    translations: Dict[str, str] = Field(..., description="Mapping of translation codes to text")


class PassageVerse(BaseModel):
    versenumber: int = Field(..., description="Global sequential verse number (1-31102)")
    vnum: int = Field(..., description="Verse number within the chapter")
    ref: str = Field(..., description="Verse reference (e.g., 'Job 1:1')")
    translations: Dict[str, str] = Field(..., description="Mapping of translation codes to text")


class PassageResponse(BaseModel):
    book: str = Field(..., description="Full book name")
    chapter: int = Field(..., description="Chapter number")
    verseCount: int = Field(..., description="Number of verses returned")
    verses: List[PassageVerse] = Field(..., description="Verses in the requested chapter or verse range")


class StudyResponse(BaseModel):
    verses: List[Dict[str, Any]] = Field(..., description="Commentary data per verse")
    metadata: Dict[str, Any] = Field(..., description="Query metadata")


class StrongsResponse(BaseModel):
    words: Dict[str, Any] = Field(..., description="Strong's entries keyed by number")


class BookContextResponse(BaseModel):
    book: str = Field(..., description="USFM code")
    book_name: str = Field(..., description="Full book name")
    sections: Dict[str, Optional[str]] = Field(..., description="Section key -> content, or null if not available")


class ParableEntry(BaseModel):
    id: str = Field(..., description="Unique identifier for the parable")
    name: str = Field(..., description="Human-readable name")
    reference: str = Field(..., description="Verse reference (e.g., 'Luke 15:11-32')")


class ParablesResponse(BaseModel):
    parables: List[ParableEntry] = Field(..., description="List of available parables")


class StudyWikiEntry(BaseModel):
    id: str = Field(..., description="Unique identifier for the registered study wiki series")
    title: str = Field(..., description="Full series title")
    speaker: str = Field(..., description="The series' speaker/author")
    description: str = Field(..., description="One-line description of the series")


class StudyWikisResponse(BaseModel):
    study_wikis: List[StudyWikiEntry] = Field(..., description="List of registered study wiki series")


class CharacterEntry(BaseModel):
    id: str = Field(..., description="Profile id, e.g. 'david' (the characters/<id>.md file stem)")
    name: str = Field(..., description="Display name, e.g. 'Mary (Mother of Jesus)'")
    testament: str = Field(..., description="'OT' or 'NT'")
    summary: str = Field(..., description="One-line description of who the character is")


class CharactersResponse(BaseModel):
    characters: List[CharacterEntry] = Field(..., description="Characters available for Chat with a Character mode")


class SSEChunk(BaseModel):
    chunk: str = Field(..., description="Streaming text chunk")
    done: bool = Field(False, description="Whether this is the final chunk")


class VoiceSessionRequest(BaseModel):
    sdp: str = Field(..., description="Browser's WebRTC SDP offer")
    has_history: bool = Field(
        False,
        description=(
            "Whether the session this voice turn belongs to already has prior "
            "messages (typed and/or spoken). Used only to pick the session's "
            "`instructions` wording — GPT-Live never sees the message content "
            "itself, since it doesn't generate answers (delegation: client)."
        ),
    )


class VoiceSessionResponse(BaseModel):
    session_id: str = Field(..., description="GPT-Live session id")
    sdp: str = Field(..., description="OpenAI's WebRTC SDP answer")


class PhaseEvent(BaseModel):
    """One `phase` SSE event from a Hermeneutics run — additive to the
    existing stream/final/trace contract, ignored by clients that predate
    it."""
    index: int = Field(..., description="Phase number, 1-8")
    title: str = Field(..., description="Phase title")
    status: str = Field(..., description="running | done | error")
    markdown: str = Field(..., description="The phase's findings as markdown")
    citations: Optional[List[Dict[str, Any]]] = Field(
        None, description="Phase 4 only: verified witness references with their KJV text"
    )
    verdicts: Optional[List[Dict[str, Any]]] = Field(
        None, description="Phase 8 only: the three validation-test verdicts"
    )


class DevotionalAudioRequest(BaseModel):
    reference: str = Field(..., description="Verse reference the devotional is for (cache/debug only — the audio cache key is derived from text alone)")
    text: str = Field(..., description="The devotional's full text to synthesize")


class DevotionalAudioResponse(BaseModel):
    audio_url: str = Field(..., description="Path to the generated/cached MP3, relative to the chatbot service root (e.g. '/devotional-audio/<hash>.mp3')")
