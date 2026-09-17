"""Google Cloud TTS (Neural2) + ffmpeg mixing for devotional audio.

Turns a devotional's full text into one finished MP3: Neural2 narration,
split on paragraph boundaries to stay under Google's 5,000-character
per-request cap, concatenated back together, then mixed under a fixed
background music bed at the settings validated by a throwaway spike. See
docs/superpowers/specs/2026-09-17-devotional-audio-design.md. Voice, rate,
and music settings are fixed constants, not user-configurable, for v1.
"""

from __future__ import annotations

import hashlib
import os
import re
import subprocess
import tempfile
from pathlib import Path
from typing import List

from google.cloud import texttospeech

VOICE_NAME = "en-US-Neural2-C"
SPEAKING_RATE = 0.90
MUSIC_TRACK_PATH = Path(__file__).resolve().parent / "data" / "devotional_stillness.mp3"
MUSIC_GAIN = 0.168
MUSIC_FADE_IN_SECONDS = 2
MUSIC_FADE_OUT_SECONDS = 4

# Google's synthesizeSpeech caps the request at 5,000 bytes of UTF-8-encoded
# input, not 5,000 characters — this devotional-writer voice reliably
# produces curly apostrophes (U+2019) and em dashes (U+2014), which are 3
# bytes each in UTF-8, so a character-count budget can silently exceed the
# real byte cap. MAX_CHUNK_CHARS is therefore a byte budget (the name is
# kept for continuity with callers/tests); 4800 leaves headroom under 5,000.
MAX_CHUNK_CHARS = 4800

# Sentence-boundary split used as a fallback when a single paragraph is
# itself over the byte budget (see _split_oversized_paragraph).
_SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?])\s+")


def _byte_len(text: str) -> int:
    return len(text.encode("utf-8"))

AUDIO_CACHE_DIR = Path(os.environ.get("AUDIO_CACHE_DIR", "AUDIO_CACHE"))
AUDIO_CACHE_DIR.mkdir(parents=True, exist_ok=True)


class DevotionalAudioError(Exception):
    """Raised when TTS synthesis or ffmpeg processing fails."""


def cache_key(text: str) -> str:
    """SHA-256 of (text, voice, rate, music track, music gain) — changing
    any of the locked settings later auto-invalidates old cache entries."""
    payload = "\x1f".join([
        text,
        VOICE_NAME,
        f"{SPEAKING_RATE:.2f}",
        MUSIC_TRACK_PATH.name,
        f"{MUSIC_GAIN:.3f}",
    ])
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _split_oversized_paragraph(paragraph: str, max_chars: int) -> List[str]:
    """A single paragraph that's over the byte budget on its own: split on
    sentence boundaries and pack those pieces the same way paragraphs are
    packed in _chunk_text, so no chunk exceeds the byte cap while still
    never splitting mid-sentence. If a single "sentence" is itself over
    budget (last resort — should never happen for devotional prose), it's
    kept as its own oversized chunk; the TTS call for it will fail with a
    clear DevotionalAudioError rather than this function raising anything
    else."""
    sentences = [s.strip() for s in _SENTENCE_SPLIT_RE.split(paragraph) if s.strip()]
    if not sentences:
        return [paragraph]

    chunks: List[str] = []
    current = ""
    for sentence in sentences:
        candidate = f"{current} {sentence}" if current else sentence
        if _byte_len(candidate) > max_chars and current:
            chunks.append(current)
            current = sentence
        else:
            current = candidate
    if current:
        chunks.append(current)
    return chunks


def _chunk_text(text: str, max_chars: int = MAX_CHUNK_CHARS) -> List[str]:
    """Split on blank-line paragraph boundaries, packing consecutive
    paragraphs into chunks up to max_chars UTF-8-encoded bytes (Google's
    synthesizeSpeech cap is byte-based, not a character count, and this
    devotional-writer voice reliably produces multi-byte curly quotes and
    em dashes) without ever splitting a paragraph mid-sentence. A single
    paragraph that's over budget on its own is split on sentence boundaries
    via _split_oversized_paragraph rather than kept whole."""
    paragraphs = [p.strip() for p in text.split("\n\n") if p.strip()]
    if not paragraphs:
        return [text]

    chunks: List[str] = []
    current = ""

    def flush() -> None:
        nonlocal current
        if current:
            chunks.append(current)
            current = ""

    for paragraph in paragraphs:
        if _byte_len(paragraph) > max_chars:
            flush()
            chunks.extend(_split_oversized_paragraph(paragraph, max_chars))
            continue
        candidate = f"{current}\n\n{paragraph}" if current else paragraph
        if _byte_len(candidate) > max_chars and current:
            chunks.append(current)
            current = paragraph
        else:
            current = candidate
    flush()
    return chunks


def _synthesize_chunk(client: "texttospeech.TextToSpeechClient", text: str) -> bytes:
    try:
        response = client.synthesize_speech(
            input=texttospeech.SynthesisInput(text=text),
            voice=texttospeech.VoiceSelectionParams(language_code="en-US", name=VOICE_NAME),
            audio_config=texttospeech.AudioConfig(
                audio_encoding=texttospeech.AudioEncoding.MP3,
                speaking_rate=SPEAKING_RATE,
            ),
        )
    except Exception as exc:  # noqa: BLE001 — any TTS failure becomes a clean app error
        raise DevotionalAudioError(f"TTS synthesis failed: {exc}") from exc
    return response.audio_content


def _run_ffmpeg(args: List[str]) -> None:
    try:
        subprocess.run(args, check=True, capture_output=True)
    except (subprocess.CalledProcessError, FileNotFoundError) as exc:
        raise DevotionalAudioError(f"ffmpeg failed: {exc}") from exc


def _probe_duration_seconds(path: Path) -> float:
    try:
        result = subprocess.run(
            [
                "ffprobe", "-v", "error", "-show_entries", "format=duration",
                "-of", "default=noprint_wrappers=1:nokey=1", str(path),
            ],
            check=True, capture_output=True, text=True,
        )
        return float(result.stdout.strip())
    except (subprocess.CalledProcessError, FileNotFoundError) as exc:
        raise DevotionalAudioError(f"ffprobe failed: {exc}") from exc
    except ValueError as exc:
        raise DevotionalAudioError(f"ffprobe returned an unparseable duration: {exc}") from exc


def synthesize_devotional_audio(text: str) -> bytes:
    """Full devotional text -> final mixed MP3 bytes (Neural2 narration +
    background bed). Raises DevotionalAudioError on any TTS/ffmpeg
    failure."""
    if not text.strip():
        raise DevotionalAudioError("Cannot synthesize audio for empty text")

    try:
        client = texttospeech.TextToSpeechClient()
    except Exception as exc:  # noqa: BLE001 — credential/config errors become clean app errors
        raise DevotionalAudioError(f"TTS client initialization failed: {exc}") from exc
    chunks = _chunk_text(text)

    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        chunk_paths = []
        for i, chunk in enumerate(chunks):
            audio_bytes = _synthesize_chunk(client, chunk)
            chunk_path = tmp_path / f"chunk_{i}.mp3"
            chunk_path.write_bytes(audio_bytes)
            chunk_paths.append(chunk_path)

        if len(chunk_paths) == 1:
            narration_path = chunk_paths[0]
        else:
            narration_path = tmp_path / "narration.mp3"
            concat_list = tmp_path / "concat.txt"
            concat_list.write_text("\n".join(f"file '{p.name}'" for p in chunk_paths))
            _run_ffmpeg([
                "ffmpeg", "-y", "-f", "concat", "-safe", "0",
                "-i", str(concat_list), "-c", "copy", str(narration_path),
            ])

        narration_duration = _probe_duration_seconds(narration_path)
        fade_out_start = max(0.0, narration_duration - MUSIC_FADE_OUT_SECONDS)

        out_path = tmp_path / "mixed.mp3"
        _run_ffmpeg([
            "ffmpeg", "-y",
            "-i", str(narration_path),
            "-i", str(MUSIC_TRACK_PATH),
            "-filter_complex",
            (
                f"[1:a]atrim=0:{narration_duration},"
                f"afade=t=in:st=0:d={MUSIC_FADE_IN_SECONDS},"
                f"afade=t=out:st={fade_out_start}:d={MUSIC_FADE_OUT_SECONDS},"
                f"volume={MUSIC_GAIN}[music];"
                "[0:a][music]amix=inputs=2:duration=first:dropout_transition=2[out]"
            ),
            "-map", "[out]", "-ac", "2", "-b:a", "192k", str(out_path),
        ])
        return out_path.read_bytes()
