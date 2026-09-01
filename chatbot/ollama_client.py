"""Ollama cloud client for AI-powered chat responses with tool use.

Uses deepseek-v4-pro:cloud model for biblical research assistance.
"""

import json
import os
import re
from typing import Any, Dict, List, Optional, AsyncIterator

import httpx

from chatbot.tools import fetch_verse_translations, fetch_scripture_study, fetch_strongs

# Verse reference pattern
VERSE_REF_PATTERN = re.compile(
    r"\b((?:Genesis|Exodus|Leviticus|Numbers|Deuteronomy|Joshua|Judges|Ruth|"
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
    r"1PE|2PE|1JN|2JN|3JN|JUD|REV))\s*(\d+):(\d+)",
    re.IGNORECASE,
)


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


async def _fetch_research_data(
    message: str,
    conversation_history: Optional[List[Dict]] = None,
    page_context: Optional[str] = None,
) -> str:
    """Fetch relevant research data from mybibletoolbox-code for the query."""
    data_parts = []

    # Collect all text to scan for verse refs: current message, then whatever
    # verse is currently on screen in the Explorer, then conversation history.
    scan_texts = [message]
    if page_context:
        scan_texts.append(page_context)
    if conversation_history:
        for m in reversed(conversation_history):
            scan_texts.append(m.get("content", ""))

    # Deduplicate refs across all texts, preserving order (current message first)
    seen_refs: set = set()
    all_matches = []
    for text in scan_texts:
        for match in VERSE_REF_PATTERN.finditer(text):
            ref_key = f"{match.group(1)} {match.group(2)}:{match.group(3)}"
            if ref_key not in seen_refs:
                seen_refs.add(ref_key)
                all_matches.append(match)

    # Find verse references
    for match in all_matches:
        book = match.group(1)
        chapter = match.group(2)
        verse = match.group(3)
        usfm = _usfm_from_name(book)
        ref = f"{usfm} {chapter}:{verse}"

        # Fetch verse translations
        try:
            translations = await fetch_verse_translations(ref, languages=["eng"])
            if translations:
                data_parts.append(f"\n=== {ref} - TRANSLATIONS ===")
                # Include a few key translations
                for version in ["eng-KJV", "eng-ESV", "eng-NIV", "grc-NESTLE-1904"]:
                    if version in translations:
                        data_parts.append(f"{version}: {translations[version][:200]}")
        except Exception:
            pass

        # Fetch scripture study data with Greek/Hebrew analysis
        try:
            study = await fetch_scripture_study(ref, depth="full")
            if study and "verses" in study:
                for verse_data in study["verses"]:
                    # Words are in commentary.words
                    commentary = verse_data.get("commentary", {})
                    if "words" in commentary:
                        data_parts.append(f"\n=== {ref} - GREEK/HEBREW WORDS ===")
                        for word in commentary["words"][:15]:  # First 15 words
                            word_info = []
                            if word.get("text"):
                                word_info.append(f"Text: {word['text']}")
                            if word.get("lemma"):
                                word_info.append(f"Lemma: {word['lemma']}")
                            if word.get("lexical", {}).get("strong"):
                                word_info.append(f"Strong's: {word['lexical']['strong']}")
                            if word.get("translation", {}).get("gloss"):
                                word_info.append(f"Gloss: {word['translation']['gloss']}")
                            if word.get("morphology", {}).get("morph"):
                                word_info.append(f"Morph: {word['morphology']['morph']}")
                            if word_info:
                                data_parts.append(" | ".join(word_info))
        except Exception:
            pass

    if data_parts:
        return "\n".join(data_parts)
    return "No specific verse data retrieved."

# Ollama configuration
# Default to local Ollama instance; set OLLAMA_API_URL to use cloud
OLLAMA_API_URL = os.environ.get("OLLAMA_API_URL", "http://localhost:11434")
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "deepseek-v4-pro:cloud")
OLLAMA_API_KEY = os.environ.get("OLLAMA_API_KEY")  # Optional for local Ollama

_SYSTEM_PROMPT_BASE = """You are a biblical research assistant for the Bible Gematria Explorer project.

You have access to the mybibletoolbox-code project data which includes:
1. Bible verse translations from multiple English versions (KJV, NIV, ESV, NASB, etc.)
2. Greek and Hebrew text with morphological analysis from Macula and Treebank
3. Strong's Concordance entries for Greek and Hebrew words
4. Commentary and semantic analysis from tbta (Treebank for Biblical Texts Analysis)

When answering questions:
- Be concise but thorough
- Cite specific translations or sources when relevant
- For Greek/Hebrew word studies, include the Strong's numbers and lemmas
- Follow conservative Protestant Christian orthodoxy for theological topics
- Base your answers on the actual biblical data provided below

---
RESEARCH DATA FOR THIS QUERY:
"""


async def call_ollama_with_context(
    message: str,
    research_data: str,
    conversation_history: Optional[List[Dict]] = None,
    page_context: Optional[str] = None,
) -> Dict[str, Any]:
    """Send `message` to Ollama with `research_data` as grounding context in
    the system prompt. Shared by chat_with_ollama() (verse-reference-scanned
    research data) and chatbot.wiki_qa.answer() (wiki-search research data)
    so the HTTP call and its error handling exist in exactly one place."""
    is_cloud = "api.ollama.com" in OLLAMA_API_URL or OLLAMA_API_URL.startswith("https://")
    if is_cloud and not OLLAMA_API_KEY:
        return {
            "type": "error",
            "message": "OLLAMA_API_KEY required for Ollama Cloud. Please set your API key.",
            "data": None,
        }

    messages = []
    system_prompt = _SYSTEM_PROMPT_BASE
    if page_context:
        system_prompt += f"\nThe user is currently viewing {page_context} in the Bible Explorer. Assume questions like \"this verse\" or \"explain this\" refer to it unless the message clearly names a different passage.\n"
    system_prompt += research_data + "\n---\n"

    messages.append({"role": "system", "content": system_prompt})
    if conversation_history:
        messages.extend(conversation_history)
    messages.append({"role": "user", "content": message})

    headers = {"Content-Type": "application/json"}
    if OLLAMA_API_KEY:
        headers["Authorization"] = f"Bearer {OLLAMA_API_KEY}"

    async with httpx.AsyncClient() as client:
        payload = {
            "model": OLLAMA_MODEL,
            "messages": messages,
            "stream": False,
            "options": {
                "temperature": 0.7,
                "max_tokens": 2048,
            },
        }

        try:
            response = await client.post(
                f"{OLLAMA_API_URL}/api/chat",
                headers=headers,
                json=payload,
                timeout=180.0,
            )
            response.raise_for_status()
            result = response.json()
        except httpx.HTTPError as e:
            detail = str(e) or type(e).__name__
            return {
                "type": "error",
                "message": f"Ollama API error: {detail}",
                "data": None,
            }
        except Exception as e:
            return {
                "type": "error",
                "message": f"Ollama error: {type(e).__name__}: {e}",
                "data": None,
            }

        content = result.get("message", {}).get("content", "")
        if not content and result.get("error"):
            return {
                "type": "error",
                "message": f"Ollama error: {result['error']}",
                "data": None,
            }

        return {
            "type": "chat",
            "message": content,
            "data": None,
            "route": f"AI Fallback → Ollama ({OLLAMA_MODEL}) → call_ollama_with_context()",
        }


async def chat_with_ollama(
    message: str,
    conversation_history: Optional[List[Dict]] = None,
    use_tools: bool = True,
    page_context: Optional[str] = None,
) -> Dict[str, Any]:
    """Send a message to Ollama with mybibletoolbox-code research data.

    Returns a dict with 'type', 'message', and 'data'.
    """
    research_data = await _fetch_research_data(message, conversation_history, page_context)
    return await call_ollama_with_context(
        message,
        research_data=research_data,
        conversation_history=conversation_history,
        page_context=page_context,
    )


async def stream_chat_with_ollama(
    message: str,
    conversation_history: Optional[List[Dict]] = None,
    page_context: Optional[str] = None,
) -> AsyncIterator[Dict[str, Any]]:
    """Stream responses from Ollama with mybibletoolbox-code research data.

    Yields dicts with 'type' and content (chunk, done, or error).
    """
    # Check if using cloud API (requires key) or local Ollama
    is_cloud = "api.ollama.com" in OLLAMA_API_URL or OLLAMA_API_URL.startswith("https://")
    if is_cloud and not OLLAMA_API_KEY:
        yield {"type": "error", "message": "OLLAMA_API_KEY required for Ollama Cloud"}
        return

    # Fetch research data from mybibletoolbox-code
    research_data = await _fetch_research_data(message, conversation_history, page_context)

    # Build system prompt with research data
    system_prompt = _SYSTEM_PROMPT_BASE
    if page_context:
        system_prompt += f"\nThe user is currently viewing {page_context} in the Bible Explorer. Assume questions like \"this verse\" or \"explain this\" refer to it unless the message clearly names a different passage.\n"
    system_prompt += research_data + "\n---\n"

    messages = [{"role": "system", "content": system_prompt}]

    if conversation_history:
        messages.extend(conversation_history)

    messages.append({"role": "user", "content": message})

    # Build headers - local Ollama doesn't require auth
    headers = {"Content-Type": "application/json"}
    if OLLAMA_API_KEY:
        headers["Authorization"] = f"Bearer {OLLAMA_API_KEY}"

    async with httpx.AsyncClient() as client:
        payload = {
            "model": OLLAMA_MODEL,
            "messages": messages,
            "stream": True,
            "options": {
                "temperature": 0.7,
                "max_tokens": 2048,
            },
        }

        try:
            async with client.stream(
                "POST",
                f"{OLLAMA_API_URL}/api/chat",
                headers=headers,
                json=payload,
                timeout=180.0,
            ) as response:
                response.raise_for_status()

                async for line in response.aiter_lines():
                    if not line.strip():
                        continue

                    try:
                        data = json.loads(line)
                        message_data = data.get("message", {})
                        content = message_data.get("content", "")
                        done = data.get("done", False)

                        if done:
                            yield {"type": "done", "message": content}
                        else:
                            yield {"type": "stream", "chunk": content}
                    except json.JSONDecodeError:
                        continue

        except httpx.HTTPError as e:
            detail = str(e) or type(e).__name__
            yield {"type": "error", "message": f"Ollama API error: {detail}"}
        except Exception as e:
            yield {"type": "error", "message": f"Ollama error: {type(e).__name__}: {e}"}
