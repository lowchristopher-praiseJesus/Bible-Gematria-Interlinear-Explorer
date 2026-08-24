"""Pydantic schemas for the Bible chatbot API."""

from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field


class HistoryMessage(BaseModel):
    role: str = Field(..., description="'user' or 'assistant'")
    text: str = Field(..., description="Message text content")


class ArtifactLink(BaseModel):
    type: str = Field(..., description="interlinear | strongs | book_context | gematria | english_search")
    label: str = Field(..., description="Human-readable link text shown in the chat bubble")
    params: Dict[str, Any] = Field(default_factory=dict, description="Fetch parameters for the artifact panel")


class ChatRequest(BaseModel):
    message: str = Field(..., description="User's biblical question or request")
    conversation_id: Optional[str] = Field(None, description="Optional conversation ID for context")
    history: Optional[List["HistoryMessage"]] = Field(None, description="Recent conversation turns for context")
    page_context: Optional[str] = Field(None, description="Verse reference currently displayed on the Explorer page (e.g. 'John 3:16')")
    mode: Optional[str] = Field(None, description="Study mode: reading_plan, parable, verse, topic, freeform")
    mode_params: Optional[Dict[str, Any]] = Field(None, description="Mode-specific parameters, e.g. {'plan': 'chronological', 'day_index': 0}")


class ChatResponse(BaseModel):
    type: str = Field(..., description="Response type: verse, study, strongs, chat, error")
    message: str = Field(..., description="Natural language response")
    data: Optional[Dict[str, Any]] = Field(None, description="Structured data payload")
    route: Optional[str] = Field(None, description="Human-readable description of the routing path taken")
    follow_up_questions: Optional[List[str]] = Field(None, description="Suggested follow-up questions")
    artifacts: Optional[List[ArtifactLink]] = Field(None, description="Links the frontend can open in the artifact panel")


class VerseResponse(BaseModel):
    reference: str = Field(..., description="Verse reference (e.g., JHN.3.16)")
    translations: Dict[str, str] = Field(..., description="Mapping of translation codes to text")


class StudyResponse(BaseModel):
    verses: List[Dict[str, Any]] = Field(..., description="Commentary data per verse")
    metadata: Dict[str, Any] = Field(..., description="Query metadata")


class StrongsResponse(BaseModel):
    words: Dict[str, Any] = Field(..., description="Strong's entries keyed by number")


class SSEChunk(BaseModel):
    chunk: str = Field(..., description="Streaming text chunk")
    done: bool = Field(False, description="Whether this is the final chunk")
