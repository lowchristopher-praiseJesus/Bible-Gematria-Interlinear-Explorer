"""Hybrid routing: deterministic regex/NLP for common patterns,
Claude API tool-use fallback for complex theological questions.
"""

import json
import os
import re
import sys
from pathlib import Path
from typing import Any, AsyncIterator, Dict, List, Optional, Tuple

project_root = Path(__file__).resolve().parent.parent
if str(project_root) not in sys.path:
    sys.path.insert(0, str(project_root))

from chatbot.tools import fetch_verse_translations, fetch_scripture_study, fetch_strongs, search_gematria, search_english
from chatbot.book_context import get_book_context

# ---------------------------------------------------------------------------
# Deterministic patterns
# ---------------------------------------------------------------------------

# Match verse references like "John 3:16", "JHN 3:16", "Genesis 1:1", etc.
VERSE_REF_PATTERN = re.compile(
    r"\b((?:"
    r"Genesis|Exodus|Leviticus|Numbers|Deuteronomy|Joshua|Judges|Ruth|"
    r"1\s*Samuel|2\s*Samuel|1\s*Kings|2\s*Kings|1\s*Chronicles|2\s*Chronicles|"
    r"Ezra|Nehemiah|Esther|Job|Psalms?|Proverbs|Ecclesiastes|Song\s*of\s*Solomon|"
    r"Isaiah|Jeremiah|Lamentations|Ezekiel|Daniel|Hosea|Joel|Amos|Obadiah|Jonah|"
    r"Micah|Nahum|Habakkuk|Zephaniah|Haggai|Zechariah|Malachi|"
    r"Matthew|Mark|Luke|John|Acts|Romans|1\s*Corinthians|2\s*Corinthians|"
    r"Galatians|Ephesians|Philippians|Colossians|1\s*Thessalonians|2\s*Thessalonians|"
    r"1\s*Timothy|2\s*Timothy|Titus|Philemon|Hebrews|James|1\s*Peter|2\s*Peter|"
    r"1\s*John|2\s*John|3\s*John|Jude|Revelation|"
    r"GEN|EXO|LEV|NUM|DEU|JOS|JDG|RUT|1SA|2SA|1KI|2KI|1CH|2CH|EZR|NEH|EST|JOB|PSA|PRO|ECC|SNG|"
    r"ISA|JER|LAM|EZK|DAN|HOS|JOL|AMO|OBA|JON|MIC|NAM|HAB|ZEP|HAG|ZEC|MAL|"
    r"MAT|MRK|LUK|JHN|ACT|ROM|1CO|2CO|GAL|EPH|PHP|COL|1TH|2TH|1TI|2TI|TIT|PHM|HEB|JAS|"
    r"1PE|2PE|1JN|2JN|3JN|JUD|REV"
    r"))\s*(\d+):(\d+)(?:\s*-\s*(\d+))?",
    re.IGNORECASE,
)

# Keywords that trigger specific tools
QUOTE_KEYWORDS = ["quote", "show me", "what does", "read", "give me", "text of"]
STUDY_KEYWORDS = [
    "study", "explain", "commentary", "what does .* mean", "interpretation of",
    "meaning of", "significance of", "context of", "theme", "other passages",
    "related passages",
]
# Book-level questions answered from book_context data (not verse commentary)
BOOK_LEVEL_KEYWORDS = [
    "who wrote", "author of", "author and", "written by", "wrote the book",
    "theme of", "themes of", "theological theme", "what is the theme",
    "purpose of", "why was", "why did", "intended audience", "audience of",
    "overview of", "introduction to",
    # Historical/cultural queries → book_context is more useful than TBTA analysis
    "historical context", "background", "cultural background", "historical setting",
    "when was", "when did", "literary context",
]
STRONGS_KEYWORDS = ["strong's", "strongs", "greek", "hebrew", "original language", "lemma"]
GEMATRIA_VALUE_PATTERN = re.compile(r"gematria(?:\s+value)?\s+(\d+)", re.IGNORECASE)
ENGLISH_SEARCH_PATTERN = re.compile(r"search\s+(?:for\s+)?[\"']([^\"']+)[\"']", re.IGNORECASE)

# Any mention of the original language (however "interpretation"/"insight"/
# "analysis" ends up phrased or misspelled) means the user wants an answer
# grounded in the actual Greek/Hebrew data, not a raw quote/commentary dump.
_LANGUAGE_MENTIONS = ["greek", "hebrew", "original language"]
# Signals analysis intent without naming the language explicitly
# (e.g. "explain the nuances of this verse")
_ANALYSIS_ONLY_TRIGGERS = ["nuances", "word study", "word for word", "word-for-word", "word by word"]


def _wants_word_level_analysis(text_lower: str) -> bool:
    """True when the user wants a synthesized Greek/Hebrew word-level
    interpretation rather than the raw structured commentary/quote dump.

    By the time this runs, the two unambiguous fast paths — an explicit
    Strong's number, and "greek/hebrew word for X" — have already returned
    their own responses (see the Strong's block above). So any remaining
    mention of the original language is a request for insight, not a raw
    lookup: defer to Ollama, which pulls the same word-for-word lemma/
    Strong's/gloss data via fetch_scripture_study() and writes prose from it
    instead of handing back the raw StudyCard/quote.
    """
    return (
        any(kw in text_lower for kw in _LANGUAGE_MENTIONS)
        or any(kw in text_lower for kw in _ANALYSIS_ONLY_TRIGGERS)
    )

_QUOTE_KW_RE = re.compile(
    r"\b(?:" + "|".join(re.escape(kw) for kw in QUOTE_KEYWORDS) + r")\b",
    re.IGNORECASE,
)

# Matches an NT book name standing alone (without chapter:verse)
from chatbot.book_context import NT_NAME_TO_USFM as _NT_NAME_TO_USFM
_BOOK_NAME_ONLY_RE = re.compile(
    r"\b(?:book of\s+)?(" + "|".join(re.escape(n) for n in _NT_NAME_TO_USFM) + r")\b",
    re.IGNORECASE,
)

_SECTION_LABELS = {
    "historical_setting":    "Historical Setting",
    "cultural_background":   "Cultural Background",
    "author_and_audience":   "Author & Audience",
    "literary_context":      "Literary Context",
    "genre_and_style":       "Genre & Style",
    "language_and_translation": "Language & Translation",
    "theological_themes":    "Theological Themes",
    "immediate_purpose":     "Immediate Purpose",
}

def _relevant_sections(text_lower: str) -> List[str]:
    """Map the question text to the most relevant book-context section keys."""
    if any(kw in text_lower for kw in ["who wrote", "author", "written by"]):
        return ["author_and_audience"]
    if any(kw in text_lower for kw in ["theme", "theological"]):
        return ["theological_themes"]
    if any(kw in text_lower for kw in ["purpose", "why was", "why did", "intended"]):
        return ["immediate_purpose"]
    if any(kw in text_lower for kw in ["historical", "setting", "when was", "when did"]):
        return ["historical_setting", "cultural_background"]
    if any(kw in text_lower for kw in ["audience", "who was it written", "written to"]):
        return ["author_and_audience"]
    if any(kw in text_lower for kw in ["genre", "style", "literary"]):
        return ["literary_context", "genre_and_style"]
    # Generic overview: return the four most useful sections
    return ["author_and_audience", "historical_setting", "theological_themes", "immediate_purpose"]


def _book_context_response(usfm: str, text_lower: str) -> Optional[Dict[str, Any]]:
    """Build a chat response from book_context data for a given USFM code."""
    ctx = get_book_context(usfm)
    if not ctx:
        return None
    book_name = ctx["book_name"]
    sections = ctx.get("sections", {})
    keys = _relevant_sections(text_lower)
    parts = [f"**{book_name} — Book Overview**\n"]
    for k in keys:
        val = sections.get(k)
        if val:
            parts.append(f"**{_SECTION_LABELS.get(k, k)}:** {val}")
    if len(parts) == 1:
        return None  # No usable data
    message = "\n\n".join(parts)
    follow_ups = [
        f"What are the theological themes of {book_name}?",
        f"What was the purpose of {book_name}?",
        f"What is the historical setting of {book_name}?",
        f"Show me {usfm} 1:1",
    ]
    return {
        "type": "chat",
        "message": message,
        "data": None,
        "route": f"Deterministic → Book context → get_book_context({usfm})",
        "follow_up_questions": follow_ups,
    }


def _find_verse_refs(text: str) -> List[Tuple[str, str, str, Optional[str]]]:
    """Extract verse references from text.

    Returns list of (full_match, book, chapter, verse_start, verse_end)
    """
    matches = []
    for m in VERSE_REF_PATTERN.finditer(text):
        full = m.group(0)
        book = m.group(1)
        chapter = m.group(2)
        verse = m.group(3)
        verse_end = m.group(4)
        matches.append((full, book, chapter, verse, verse_end))
    return matches


def _usfm_from_name(name: str) -> str:
    """Convert a full or partial book name to USFM 3.0 code."""
    name_upper = name.strip().upper().replace(" ", "")

    # Direct USFM code
    if name_upper in {
        "GEN", "EXO", "LEV", "NUM", "DEU", "JOS", "JDG", "RUT",
        "1SA", "2SA", "1KI", "2KI", "1CH", "2CH", "EZR", "NEH", "EST",
        "JOB", "PSA", "PRO", "ECC", "SNG", "ISA", "JER", "LAM", "EZK",
        "DAN", "HOS", "JOL", "AMO", "OBA", "JON", "MIC", "NAM", "HAB",
        "ZEP", "HAG", "ZEC", "MAL", "MAT", "MRK", "LUK", "JHN", "ACT",
        "ROM", "1CO", "2CO", "GAL", "EPH", "PHP", "COL", "1TH", "2TH",
        "1TI", "2TI", "TIT", "PHM", "HEB", "JAS", "1PE", "2PE", "1JN",
        "2JN", "3JN", "JUD", "REV",
    }:
        return name_upper

    # Map full/partial names to USFM
    mapping = {
        "GENESIS": "GEN", "EXODUS": "EXO", "LEVITICUS": "LEV",
        "NUMBERS": "NUM", "DEUTERONOMY": "DEU", "JOSHUA": "JOS",
        "JUDGES": "JDG", "RUTH": "RUT", "1SAMUEL": "1SA",
        "2SAMUEL": "2SA", "1KINGS": "1KI", "2KINGS": "2KI",
        "1CHRONICLES": "1CH", "2CHRONICLES": "2CH", "EZRA": "EZR",
        "NEHEMIAH": "NEH", "ESTHER": "EST", "JOB": "JOB",
        "PSALM": "PSA", "PSALMS": "PSA", "PROVERBS": "PRO",
        "ECCLESIASTES": "ECC", "SONGOFSOLOMON": "SNG",
        "ISAIAH": "ISA", "JEREMIAH": "JER", "LAMENTATIONS": "LAM",
        "EZEKIEL": "EZK", "DANIEL": "DAN", "HOSEA": "HOS",
        "JOEL": "JOL", "AMOS": "AMO", "OBADIAH": "OBA",
        "JONAH": "JON", "MICAH": "MIC", "NAHUM": "NAM",
        "HABAKKUK": "HAB", "ZEPHANIAH": "ZEP", "HAGGAI": "HAG",
        "ZECHARIAH": "ZEC", "MALACHI": "MAL", "MATTHEW": "MAT",
        "MARK": "MRK", "LUKE": "LUK", "JOHN": "JHN", "ACTS": "ACT",
        "ROMANS": "ROM", "1CORINTHIANS": "1CO", "2CORINTHIANS": "2CO",
        "GALATIANS": "GAL", "EPHESIANS": "EPH", "PHILIPPIANS": "PHP",
        "COLOSSIANS": "COL", "1THESSALONIANS": "1TH", "2THESSALONIANS": "2TH",
        "1TIMOTHY": "1TI", "2TIMOTHY": "2TI", "TITUS": "TIT",
        "PHILEMON": "PHM", "HEBREWS": "HEB", "JAMES": "JAS",
        "1PETER": "1PE", "2PETER": "2PE", "1JOHN": "1JN",
        "2JOHN": "2JN", "3JOHN": "3JN", "JUDE": "JUD",
        "REVELATION": "REV",
    }
    return mapping.get(name_upper, name_upper)


def _format_reference(_full: str, book: str, chapter: str, verse: str, verse_end: Optional[str] = None) -> str:
    """Format a reference string for our tools."""
    usfm = _usfm_from_name(book)
    if verse_end:
        return f"{usfm} {chapter}:{verse}-{verse_end}"
    return f"{usfm} {chapter}:{verse}"


# ---------------------------------------------------------------------------
# Follow-up question generator
# ---------------------------------------------------------------------------

_USFM_TO_BOOK = {
    "GEN": "Genesis", "EXO": "Exodus", "LEV": "Leviticus", "NUM": "Numbers",
    "DEU": "Deuteronomy", "JOS": "Joshua", "JDG": "Judges", "RUT": "Ruth",
    "1SA": "1 Samuel", "2SA": "2 Samuel", "1KI": "1 Kings", "2KI": "2 Kings",
    "1CH": "1 Chronicles", "2CH": "2 Chronicles", "EZR": "Ezra", "NEH": "Nehemiah",
    "EST": "Esther", "JOB": "Job", "PSA": "Psalm", "PRO": "Proverbs",
    "ECC": "Ecclesiastes", "SNG": "Song of Solomon", "ISA": "Isaiah", "JER": "Jeremiah",
    "LAM": "Lamentations", "EZK": "Ezekiel", "DAN": "Daniel", "HOS": "Hosea",
    "JOL": "Joel", "AMO": "Amos", "OBA": "Obadiah", "JON": "Jonah", "MIC": "Micah",
    "NAM": "Nahum", "HAB": "Habakkuk", "ZEP": "Zephaniah", "HAG": "Haggai",
    "ZEC": "Zechariah", "MAL": "Malachi", "MAT": "Matthew", "MRK": "Mark",
    "LUK": "Luke", "JHN": "John", "ACT": "Acts", "ROM": "Romans",
    "1CO": "1 Corinthians", "2CO": "2 Corinthians", "GAL": "Galatians",
    "EPH": "Ephesians", "PHP": "Philippians", "COL": "Colossians",
    "1TH": "1 Thessalonians", "2TH": "2 Thessalonians", "1TI": "1 Timothy",
    "2TI": "2 Timothy", "TIT": "Titus", "PHM": "Philemon", "HEB": "Hebrews",
    "JAS": "James", "1PE": "1 Peter", "2PE": "2 Peter", "1JN": "1 John",
    "2JN": "2 John", "3JN": "3 John", "JUD": "Jude", "REV": "Revelation",
}


def _generate_follow_ups(response_type: str, data: Optional[Dict], ref: str = "") -> List[str]:
    book = _USFM_TO_BOOK.get(ref.split(" ")[0].upper(), ref.split(" ")[0]) if ref else ""

    if response_type == "verse" and ref:
        return [
            f"Explain the commentary for {ref}",
            f"What do the original language words mean in {ref}?",
            f"Show me related verses on this topic",
            f"What is the historical context of {ref}?",
            f"Who wrote the book of {book} and why?",
        ]
    if response_type == "study" and ref:
        return [
            f"Show me {ref} in the original Hebrew or Greek",
            f"What are the key Strong's words in {ref}?",
            f"What other passages discuss this theme?",
            f"Compare different translations of {ref}",
        ]
    if response_type == "strongs":
        words_dict = (data or {}).get("words", {})
        num = next(iter(words_dict), None)
        if num:
            entry = words_dict.get(num, {})
            lemma = entry.get("lemma", num)
            return [
                f"Show me verses where {num} ({lemma}) appears",
                f"What is the root meaning of {num}?",
                f"Are there related Strong's words with similar meaning?",
                f"How is {num} translated differently across verses?",
            ]
    return [
        "Show me a relevant Bible verse on this topic",
        "What does the original language say about this?",
        "Can you elaborate on that?",
    ]


# ---------------------------------------------------------------------------
# History helpers
# ---------------------------------------------------------------------------

def _ref_from_history(history: List[Dict]) -> Optional[str]:
    """Return the most recent verse reference found in conversation history."""
    for msg in reversed(history):
        found = _find_verse_refs(msg.get("text", ""))
        if found:
            return _format_reference(*found[0])
    return None


# ---------------------------------------------------------------------------
# Deterministic router
# ---------------------------------------------------------------------------

async def route_deterministic(
    message: str,
    history: Optional[List[Dict]] = None,
    page_context: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    """Try to handle the message deterministically.

    Returns a response dict if handled, None if should fall through to Claude.
    """
    text_lower = message.lower()
    refs = _find_verse_refs(message)

    # When there is no verse ref in the current message, fall back to what's
    # currently on screen in the Explorer (most reliable signal for "this
    # verse"), then to the most recent verse ref mentioned in the conversation.
    context_ref: Optional[str] = None
    context_source = ""  # "the Explorer page" or "our conversation", for user-facing copy
    if not refs:
        if page_context:
            page_refs = _find_verse_refs(page_context)
            if page_refs:
                context_ref = _format_reference(*page_refs[0])
                context_source = "the Explorer page"
        if not context_ref and history:
            context_ref = _ref_from_history(history)
            if context_ref:
                context_source = "our conversation"

    # Gematria value / English full-text search (deterministic tool lookups,
    # no verse ref needed) — checked ahead of the Strong's block so a
    # message like `search for "lovingkindness"` isn't shadowed by it.
    gematria_match = GEMATRIA_VALUE_PATTERN.search(message)
    if gematria_match:
        value = int(gematria_match.group(1))
        result = await search_gematria(value)
        word_count = len(result.get("wordResults", []))
        verse_count = len(result.get("verseResults", []))
        return {
            "type": "gematria",
            "message": f"Found {word_count} word{'s' if word_count != 1 else ''} and {verse_count} verse{'s' if verse_count != 1 else ''} with gematria value **{value}**.",
            "data": None,
            "route": "Deterministic → Gematria value match → search_gematria()",
            "artifacts": [
                {"type": "gematria", "label": f"View gematria {value} results ▸", "params": {"value": value}},
            ],
            "follow_up_questions": [
                f"Show me the words with gematria value {value}",
                f"Show me the verses with gematria value {value}",
            ],
        }

    english_match = ENGLISH_SEARCH_PATTERN.search(message)
    if english_match:
        query = english_match.group(1)
        result = await search_english(query)
        result_count = len(result.get("results", []))
        return {
            "type": "english_search",
            "message": f"Found {result_count} verse{'s' if result_count != 1 else ''} containing \"{query}\".",
            "data": None,
            "route": "Deterministic → English search match → search_english()",
            "artifacts": [
                {"type": "english_search", "label": f'View results for "{query}" ▸', "params": {"query": query}},
            ],
            "follow_up_questions": [f'Search for a different word or phrase'],
        }

    # Strong's patterns (no verse ref needed)
    if any(kw in text_lower for kw in STRONGS_KEYWORDS):
        # Check for explicit Strong's number
        strongs_match = re.search(r"(G|H)\s*(\d{1,4})", message, re.IGNORECASE)
        if strongs_match:
            prefix = strongs_match.group(1).upper()
            num = strongs_match.group(2).zfill(4)
            result = await fetch_strongs(numbers=[f"{prefix}{num}"])
            return {
                "type": "strongs",
                "message": f"Here is the Strong's entry for **{prefix}{num}**.",
                "data": result,
                "route": "Deterministic → Strong's number match → fetch_strongs()",
                "follow_up_questions": _generate_follow_ups("strongs", result),
            }

        # Search by English word - only for specific patterns, not generic "Greek" mentions
        word_match = re.search(
            r"(?:greek|hebrew)\s+word\s+(?:for\s+)?['\"]?(\w+)['\"]?",
            text_lower,
        )
        if word_match and not refs:
            # Only do word search if there's no verse reference
            # If there's a verse ref, let Ollama handle it with tools
            word = word_match.group(1)
            # Skip common/generic words that would return too many results
            if word.lower() not in ['greek', 'hebrew', 'word', 'the', 'a', 'in']:
                result = await fetch_strongs(words=[word])
                return {
                    "type": "strongs",
                    "message": f"Here are Strong's entries matching the word **{word}**.",
                    "data": result,
                    "route": "Deterministic → Strong's word search → fetch_strongs()",
                    "follow_up_questions": _generate_follow_ups("strongs", result),
                }

    # Anywhere the user wants a synthesized Greek/Hebrew interpretation rather
    # than a raw lookup, defer to Ollama — regardless of which other keywords
    # (quote/study/book-level) also happen to match (e.g. "give me some
    # insight on this verse based on its greek interpretation" contains
    # "give me", a quote keyword, but the user wants prose, not a raw quote).
    if _wants_word_level_analysis(text_lower):
        return None

    if not refs:
        # ── Book-level questions (authorship, themes, purpose) ────────────────
        # Check message for an NT book name first; fall back to history context.
        if any(kw in text_lower for kw in BOOK_LEVEL_KEYWORDS):
            # Try to resolve the book from the message text directly
            book_match = _BOOK_NAME_ONLY_RE.search(message)
            book_usfm = (
                _NT_NAME_TO_USFM.get(book_match.group(1).title()) or
                _NT_NAME_TO_USFM.get(book_match.group(1))
                if book_match else None
            )
            # Fall back to the book embedded in the history context ref
            if not book_usfm and context_ref:
                book_usfm = context_ref.split(" ")[0].upper()
            if book_usfm:
                resp = _book_context_response(book_usfm, text_lower)
                if resp:
                    return resp

        # ── No verse ref — try keyword routing using history context ref ──────
        if context_ref:
            if any(kw in text_lower for kw in STUDY_KEYWORDS):
                try:
                    result = await fetch_scripture_study(context_ref, depth="medium")
                except Exception:
                    return None
                return {
                    "type": "study",
                    "message": f"Here is the commentary for **{context_ref}** (from {context_source}).",
                    "data": result,
                    "route": f"Deterministic → Study keyword ({context_source}) → fetch_scripture_study()",
                    "follow_up_questions": _generate_follow_ups("study", None, context_ref),
                }
            if _QUOTE_KW_RE.search(text_lower):
                try:
                    result = await fetch_verse_translations(context_ref, languages=["eng"])
                except Exception:
                    return None
                if result:
                    usfm = context_ref.split(" ")[0].upper()
                    return {
                        "type": "verse",
                        "message": f"Here is **{context_ref}** (from {context_source}).",
                        "data": {
                            "reference": context_ref,
                            "translations": result,
                            "book_context": get_book_context(usfm),
                        },
                        "route": f"Deterministic → Quote keyword ({context_source}) → fetch_verse_translations()",
                        "follow_up_questions": _generate_follow_ups("verse", None, context_ref),
                    }
        return None

    # Quote / verse fetch patterns
    if _QUOTE_KW_RE.search(text_lower):
        ref = _format_reference(*refs[0])
        try:
            result = await fetch_verse_translations(ref, languages=["eng"])
        except Exception:
            return None
        if result:
            usfm = ref.split(" ")[0].upper()
            return {
                "type": "verse",
                "message": f"Here is **{ref}** in English translations.",
                "data": {
                    "reference": ref,
                    "translations": result,
                    "book_context": get_book_context(usfm),
                },
                "route": "Deterministic → Quote keyword → fetch_verse_translations()",
                "follow_up_questions": _generate_follow_ups("verse", None, ref),
            }

    # Book-level questions that include a verse ref (e.g. "Who wrote Luke 1:1?")
    if any(kw in text_lower for kw in BOOK_LEVEL_KEYWORDS):
        usfm = _format_reference(*refs[0]).split(" ")[0].upper()
        resp = _book_context_response(usfm, text_lower)
        if resp:
            return resp

    # Study / commentary patterns
    if any(kw in text_lower for kw in STUDY_KEYWORDS):
        ref = _format_reference(*refs[0])

        try:
            result = await fetch_scripture_study(ref, depth="medium")
        except Exception:
            return None
        return {
            "type": "study",
            "message": f"Here is the commentary for **{ref}**.",
            "data": result,
            "route": "Deterministic → Study keyword → fetch_scripture_study()",
            "follow_up_questions": _generate_follow_ups("study", None, ref),
        }

    # Default: if there's a verse ref but no keyword matched, do a verse lookup
    ref = _format_reference(*refs[0])
    try:
        result = await fetch_verse_translations(ref, languages=["eng"])
    except Exception:
        return None
    if result:
        usfm = ref.split(" ")[0].upper()
        return {
            "type": "verse",
            "message": f"Here is **{ref}**.",
            "data": {
                "reference": ref,
                "translations": result,
                "book_context": get_book_context(usfm),
            },
            "route": "Deterministic → Default verse lookup → fetch_verse_translations()",
            "follow_up_questions": _generate_follow_ups("verse", None, ref),
        }

    return None


# ---------------------------------------------------------------------------
# Ollama cloud AI fallback
# ---------------------------------------------------------------------------

from chatbot.ollama_client import chat_with_ollama, stream_chat_with_ollama


async def route_claude(
    message: str,
    history: Optional[List[Dict]] = None,
    page_context: Optional[str] = None,
) -> Dict[str, Any]:
    """Fall back to Ollama cloud AI for complex questions.

    This function name is kept for backwards compatibility,
    but it now uses Ollama instead of Claude.
    """
    ollama_history = (
        [{"role": m["role"], "content": m["text"]} for m in history]
        if history else None
    )
    return await chat_with_ollama(
        message, conversation_history=ollama_history, page_context=page_context
    )


# ---------------------------------------------------------------------------
# Mode primers — seed the first assistant turn of a new mode session
# ---------------------------------------------------------------------------

from chatbot.data.parables import get_parable
from chatbot.data.reading_plans import get_day_reading
from chatbot.data.topics import get_topic
from chatbot.tools import random_verse

_FULL_NAME_TO_USFM = {full: usfm for usfm, full in _USFM_TO_BOOK.items()}


async def build_mode_primer(mode: str, mode_params: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """Build the seeded first assistant turn for a newly created mode session."""
    mode_params = mode_params or {}

    if mode == "reading_plan":
        plan = mode_params.get("plan", "chronological")
        day_index = int(mode_params.get("day_index", 0))
        readings = get_day_reading(plan, day_index)
        refs = [
            f"{_FULL_NAME_TO_USFM.get(r['book'], r['book'])} {r['chapter']}"
            for r in readings
        ]
        message = (
            f"**Day {day_index + 1} — {plan.title()} Reading Plan**\n\n"
            f"Today's reading: {', '.join(refs)}."
        )
        return {
            "type": "chat",
            "message": message,
            "data": {"plan": plan, "day_index": day_index, "readings": readings},
            "route": "Mode primer → reading_plan",
            "artifacts": [
                {"type": "interlinear", "label": f"Read {ref} ▸", "params": {"reference": f"{ref}:1"}}
                for ref in refs
            ],
            "follow_up_questions": [
                "Mark today's reading complete",
                "What happened right before this in the story?",
            ],
        }

    if mode == "parable":
        parable = get_parable(mode_params.get("parable_id", ""))
        if not parable:
            return {
                "type": "error", "message": "Unknown parable.", "data": None,
                "route": "Mode primer → parable → not found",
            }
        message = (
            f"**{parable['name']}** ({parable['reference']})\n\n"
            "Let's study this parable together. Would you like to start with the text itself, "
            "its historical context, or its meaning?"
        )
        return {
            "type": "chat",
            "message": message,
            "data": {"parable": parable},
            "route": "Mode primer → parable",
            "artifacts": [
                {"type": "interlinear", "label": f"Read {parable['reference']} ▸", "params": {"reference": parable["reference"]}},
            ],
            "follow_up_questions": [
                f"What is the meaning of {parable['name']}?",
                f"What is the historical context of {parable['name']}?",
            ],
        }

    if mode == "topic":
        topic = get_topic(mode_params.get("topic_id", ""))
        if not topic:
            return {
                "type": "error", "message": "Unknown topic.", "data": None,
                "route": "Mode primer → topic → not found",
            }
        message = (
            f"**Topical Study: {topic['name']}**\n\n"
            f"Here are some passages to start with: {', '.join(topic['seed_references'])}. "
            "What would you like to explore?"
        )
        return {
            "type": "chat",
            "message": message,
            "data": {"topic": topic},
            "route": "Mode primer → topic",
            "artifacts": [
                {"type": "interlinear", "label": f"Read {ref} ▸", "params": {"reference": ref}}
                for ref in topic["seed_references"]
            ],
            "follow_up_questions": [f"Show me more verses about {topic['name']}"],
        }

    if mode == "verse":
        reference = mode_params.get("reference")
        if reference:
            ref = reference
        else:
            book, chapter, verse = await random_verse()
            ref = _format_reference("", book, str(chapter), str(verse))
        try:
            result = await fetch_verse_translations(ref, languages=["eng"])
        except Exception:
            result = None
        if not result:
            return {
                "type": "error", "message": f"Could not fetch {ref}.", "data": None,
                "route": "Mode primer → verse → fetch failed",
            }
        usfm = ref.split(" ")[0].upper()
        return {
            "type": "verse",
            "message": f"Here is **{ref}**.",
            "data": {"reference": ref, "translations": result, "book_context": get_book_context(usfm)},
            "route": "Mode primer → verse",
            "follow_up_questions": _generate_follow_ups("verse", None, ref),
        }

    return {
        "type": "chat",
        "message": "Ask me anything about the Bible.",
        "data": None,
        "route": "Mode primer → freeform",
        "follow_up_questions": [
            "Show me a relevant Bible verse on a topic I care about",
            "What does the original language say about a verse?",
        ],
    }
