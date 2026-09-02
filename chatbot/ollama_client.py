"""LLM client for AI-powered chat responses with tool use.

Talks to one of two providers, selected by the LLM_PROVIDER env var:
  - "ollama" (default): Ollama native API      -> POST {url}/api/chat
  - "nvidia": NVIDIA NIM, OpenAI-compatible API -> POST {url}/v1/chat/completions

The public functions (call_ollama_with_context, chat_with_ollama,
stream_chat_with_ollama) keep their names regardless of provider.
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

# ---------------------------------------------------------------------------
# LLM provider configuration
#
# LLM_PROVIDER selects the wire protocol:
#   "ollama" (default) -> Ollama native API: POST {url}/api/chat, sampling
#                         params nested under "options", newline-delimited
#                         JSON stream ({"message": {...}, "done": bool}).
#   "nvidia"           -> NVIDIA NIM, OpenAI-compatible: POST
#                         {url}/chat/completions, top-level sampling params,
#                         SSE stream ("data: {...}" / "data: [DONE]").
#
# The OLLAMA_* vars keep their meaning. The NVIDIA_* vars mirror them for the
# hosted build.nvidia.com endpoint. Callers that never set LLM_PROVIDER get
# the unchanged Ollama behaviour.
# ---------------------------------------------------------------------------
LLM_PROVIDER = os.environ.get("LLM_PROVIDER", "ollama").strip().lower()

# --- Ollama (native /api/chat) ---
# Default to a local Ollama instance; set OLLAMA_API_URL to use cloud.
OLLAMA_API_URL = os.environ.get("OLLAMA_API_URL", "http://localhost:11434")
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "deepseek-v4-pro:cloud")
OLLAMA_API_KEY = os.environ.get("OLLAMA_API_KEY")  # Optional for local Ollama

# --- NVIDIA NIM (OpenAI-compatible /v1/chat/completions) ---
NVIDIA_API_URL = os.environ.get("NVIDIA_API_URL", "https://integrate.api.nvidia.com/v1")
NVIDIA_MODEL = os.environ.get("NVIDIA_MODEL", "meta/llama-3.3-70b-instruct")
NVIDIA_API_KEY = os.environ.get("NVIDIA_API_KEY")


def _llm_config():
    """(provider, base_url, model, api_key) for the active LLM provider."""
    if LLM_PROVIDER == "nvidia":
        return ("nvidia", NVIDIA_API_URL.rstrip("/"), NVIDIA_MODEL, NVIDIA_API_KEY)
    return ("ollama", OLLAMA_API_URL.rstrip("/"), OLLAMA_MODEL, OLLAMA_API_KEY)


def llm_unconfigured_error():
    """None if the active provider can serve requests, else a user-facing string."""
    provider, base_url, _model, api_key = _llm_config()
    if provider == "nvidia":
        if not api_key:
            return "NVIDIA_API_KEY required for NVIDIA NIM. Please set your API key."
        return None
    # ollama: a local daemon needs no key; a remote/HTTPS endpoint does.
    is_cloud = "api.ollama.com" in base_url or base_url.startswith("https://")
    if is_cloud and not api_key:
        return "OLLAMA_API_KEY required for Ollama Cloud. Please set your API key."
    return None


def active_model_label():
    """Short 'Provider (model)' label for the response 'route' strings."""
    provider, _base_url, model, _api_key = _llm_config()
    return f"{'NVIDIA' if provider == 'nvidia' else 'Ollama'} ({model})"


def _build_request(messages, *, stream):
    """(provider, url, headers, payload) for a chat call to the active provider."""
    provider, base_url, model, api_key = _llm_config()
    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    if provider == "nvidia":
        # base_url already ends with /v1 (OpenAI-compatible surface).
        url = f"{base_url}/chat/completions"
        payload = {
            "model": model,
            "messages": messages,
            "stream": stream,
            "temperature": 0.7,
            "max_tokens": 2048,
        }
    else:
        url = f"{base_url}/api/chat"
        payload = {
            "model": model,
            "messages": messages,
            "stream": stream,
            "options": {
                "temperature": 0.7,
                "max_tokens": 2048,
            },
        }
    return provider, url, headers, payload


def _extract_content(provider, result):
    """(content, error) from a non-streaming chat response body."""
    if provider == "nvidia":
        choices = result.get("choices") or []
        content = ""
        if choices:
            content = (choices[0].get("message") or {}).get("content", "") or ""
        error = result.get("detail") or result.get("error")
        if not error and not content:
            error = result.get("message")
        return content, error
    content = result.get("message", {}).get("content", "") or ""
    return content, result.get("error")


def _stream_delta(provider, line):
    """Parse one raw stream line.

    Returns ("chunk", text) | ("done", None) | None, where None means the line
    carries no content (blank line, SSE keep-alive comment, unparseable)."""
    line = line.strip()
    if not line:
        return None

    if provider == "nvidia":
        if not line.startswith("data:"):
            return None  # SSE ": comment" keep-alives, "event:" lines, etc.
        data = line[len("data:"):].strip()
        if data == "[DONE]":
            return ("done", None)
        try:
            obj = json.loads(data)
        except json.JSONDecodeError:
            return None
        choices = obj.get("choices") or []
        if not choices:
            return None
        choice = choices[0]
        text = (choice.get("delta") or {}).get("content", "") or ""
        if text:
            return ("chunk", text)
        if choice.get("finish_reason"):
            return ("done", None)
        return ("chunk", "")

    # ollama: every non-empty line is a standalone JSON object
    try:
        obj = json.loads(line)
    except json.JSONDecodeError:
        return None
    if obj.get("done"):
        return ("done", None)
    return ("chunk", obj.get("message", {}).get("content", "") or "")

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
    err = llm_unconfigured_error()
    if err:
        return {"type": "error", "message": err, "data": None}

    messages = []
    system_prompt = _SYSTEM_PROMPT_BASE
    if page_context:
        system_prompt += f"\nThe user is currently viewing {page_context} in the Bible Explorer. Assume questions like \"this verse\" or \"explain this\" refer to it unless the message clearly names a different passage.\n"
    system_prompt += research_data + "\n---\n"

    messages.append({"role": "system", "content": system_prompt})
    if conversation_history:
        messages.extend(conversation_history)
    messages.append({"role": "user", "content": message})

    provider, url, headers, payload = _build_request(messages, stream=False)

    async with httpx.AsyncClient() as client:
        try:
            response = await client.post(
                url,
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
                "message": f"LLM API error: {detail}",
                "data": None,
            }
        except Exception as e:
            return {
                "type": "error",
                "message": f"LLM error: {type(e).__name__}: {e}",
                "data": None,
            }

        content, error = _extract_content(provider, result)
        if not content and error:
            return {
                "type": "error",
                "message": f"LLM error: {error}",
                "data": None,
            }

        return {
            "type": "chat",
            "message": content,
            "data": None,
            "route": f"AI Fallback → {active_model_label()} → call_ollama_with_context()",
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
    err = llm_unconfigured_error()
    if err:
        return {"type": "error", "message": err, "data": None}
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
    err = llm_unconfigured_error()
    if err:
        yield {"type": "error", "message": err}
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

    provider, url, headers, payload = _build_request(messages, stream=True)

    async with httpx.AsyncClient() as client:
        try:
            async with client.stream(
                "POST",
                url,
                headers=headers,
                json=payload,
                timeout=180.0,
            ) as response:
                response.raise_for_status()

                done_sent = False
                async for line in response.aiter_lines():
                    parsed = _stream_delta(provider, line)
                    if parsed is None:
                        continue
                    kind, text = parsed
                    if kind == "done":
                        done_sent = True
                        yield {"type": "done", "message": ""}
                        break
                    if text:
                        yield {"type": "stream", "chunk": text}

                if not done_sent:
                    # Stream ended without an explicit terminator (some NIM
                    # builds omit "data: [DONE]"); close it out anyway.
                    yield {"type": "done", "message": ""}

        except httpx.HTTPError as e:
            detail = str(e) or type(e).__name__
            yield {"type": "error", "message": f"LLM API error: {detail}"}
        except Exception as e:
            yield {"type": "error", "message": f"LLM error: {type(e).__name__}: {e}"}
