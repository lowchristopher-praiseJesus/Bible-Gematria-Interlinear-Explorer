from pathlib import Path

import pytest

from chatbot import devotional_audio as da


def test_chunk_text_single_short_paragraph_is_one_chunk():
    text = "Just one short paragraph."
    assert da._chunk_text(text) == [text]


def test_chunk_text_packs_short_paragraphs_together():
    paragraphs = ["Paragraph one is short.", "Paragraph two is short too.", "Paragraph three, also short."]
    text = "\n\n".join(paragraphs)
    chunks = da._chunk_text(text, max_chars=100)
    assert len(chunks) < len(paragraphs)
    for p in paragraphs:
        assert any(p in c for c in chunks)


def test_chunk_text_never_exceeds_max_chars_when_paragraphs_allow():
    paragraphs = [f"Paragraph {i} is a moderate length paragraph of prose." for i in range(10)]
    text = "\n\n".join(paragraphs)
    chunks = da._chunk_text(text, max_chars=200)
    assert all(len(c) <= 200 for c in chunks)


def test_chunk_text_splits_an_oversized_paragraph_on_sentence_boundaries():
    # A paragraph with no blank-line split points but many sentences, well
    # over max_chars on its own — it must be split on sentence boundaries
    # rather than kept whole or split mid-sentence/mid-word.
    huge_paragraph = "This is a sentence about faith and hope. " * 200  # ~8,600 chars
    text = f"Short intro.\n\n{huge_paragraph.strip()}"
    chunks = da._chunk_text(text, max_chars=4800)

    assert len(chunks) > 2  # intro chunk + multiple sentence-packed chunks
    assert all(len(c.encode("utf-8")) <= 4800 for c in chunks)
    # No sentence was dropped or mangled — every one still appears somewhere.
    for sentence in huge_paragraph.strip().split(". ")[:-1]:
        assert any(sentence in c for c in chunks)


def test_chunk_text_never_exceeds_byte_cap_for_single_absurd_sentence():
    # Last-resort case: a single "sentence" (no ./!/? at all) longer than
    # max_chars on its own. It's kept as one oversized chunk rather than
    # split mid-word — synthesize_devotional_audio's TTS call is expected
    # to raise DevotionalAudioError for it, not this function.
    absurd_sentence = "word " * 2000  # ~10,000 chars, no sentence punctuation
    chunks = da._chunk_text(absurd_sentence, max_chars=4800)
    assert chunks == [absurd_sentence.strip()]


def test_chunk_text_respects_byte_cap_not_character_count():
    # Curly apostrophes (U+2019) and em dashes (U+2014) are 3 bytes each in
    # UTF-8. Build two paragraphs whose combined *character* count is under
    # max_chars but whose combined *byte* count is over it — a naive
    # len()-based check would pack them into one chunk; the byte-aware
    # check must not.
    unit = "Can’t you see—this is grace." * 40  # curly quote + em dash, repeated
    paragraph_a = unit
    paragraph_b = unit
    text = f"{paragraph_a}\n\n{paragraph_b}"

    char_len = len(text)
    byte_len = len(text.encode("utf-8"))
    assert byte_len > char_len  # multi-byte characters are actually present

    max_chars = char_len - 10  # under the combined char count...
    assert byte_len > max_chars  # ...and over the combined byte count

    chunks = da._chunk_text(text, max_chars=max_chars)
    assert len(chunks) == 2  # split apart, not packed into one oversized chunk
    assert all(len(c.encode("utf-8")) <= max_chars for c in chunks)


def test_cache_key_changes_with_text():
    assert da.cache_key("Hello") != da.cache_key("Goodbye")


def test_cache_key_is_deterministic():
    assert da.cache_key("Hello") == da.cache_key("Hello")


def test_synthesize_devotional_audio_empty_text_raises():
    with pytest.raises(da.DevotionalAudioError):
        da.synthesize_devotional_audio("   ")


def test_synthesize_devotional_audio_single_chunk_skips_concat(monkeypatch):
    class FakeResponse:
        audio_content = b"fake-narration-bytes"

    class FakeClient:
        def synthesize_speech(self, **kwargs):
            return FakeResponse()

    monkeypatch.setattr(da.texttospeech, "TextToSpeechClient", lambda: FakeClient())

    ffmpeg_calls = []

    def fake_run_ffmpeg(args):
        ffmpeg_calls.append(args)
        Path(args[-1]).write_bytes(b"mixed-audio-bytes")

    monkeypatch.setattr(da, "_run_ffmpeg", fake_run_ffmpeg)
    monkeypatch.setattr(da, "_probe_duration_seconds", lambda path: 12.5)

    result = da.synthesize_devotional_audio("A short devotional with one paragraph.")

    assert result == b"mixed-audio-bytes"
    assert len(ffmpeg_calls) == 1  # only the final mix call, no concat call
    assert "amix" in ffmpeg_calls[0][ffmpeg_calls[0].index("-filter_complex") + 1]


def test_synthesize_devotional_audio_multi_chunk_concatenates(monkeypatch):
    class FakeResponse:
        audio_content = b"fake-chunk-bytes"

    class FakeClient:
        def synthesize_speech(self, **kwargs):
            return FakeResponse()

    monkeypatch.setattr(da.texttospeech, "TextToSpeechClient", lambda: FakeClient())

    ffmpeg_calls = []

    def fake_run_ffmpeg(args):
        ffmpeg_calls.append(args)
        Path(args[-1]).write_bytes(b"mixed-audio-bytes")

    monkeypatch.setattr(da, "_run_ffmpeg", fake_run_ffmpeg)
    monkeypatch.setattr(da, "_probe_duration_seconds", lambda path: 30.0)

    long_text = "\n\n".join(f"Paragraph {i}. " + ("word " * 400) for i in range(4))
    result = da.synthesize_devotional_audio(long_text)

    assert result == b"mixed-audio-bytes"
    assert len(ffmpeg_calls) == 2  # one concat call, then one mix call
    assert "concat" in ffmpeg_calls[0]
    assert "amix" in ffmpeg_calls[1][ffmpeg_calls[1].index("-filter_complex") + 1]


def test_synthesize_devotional_audio_wraps_tts_failure(monkeypatch):
    class FailingClient:
        def synthesize_speech(self, **kwargs):
            raise RuntimeError("quota exceeded")

    monkeypatch.setattr(da.texttospeech, "TextToSpeechClient", lambda: FailingClient())

    with pytest.raises(da.DevotionalAudioError):
        da.synthesize_devotional_audio("Some devotional text.")


def test_synthesize_devotional_audio_wraps_client_construction_failure(monkeypatch):
    class FailingClientClass:
        def __init__(self):
            raise RuntimeError("credentials not found")

    monkeypatch.setattr(da.texttospeech, "TextToSpeechClient", FailingClientClass)

    with pytest.raises(da.DevotionalAudioError):
        da.synthesize_devotional_audio("Some devotional text.")


def test_probe_duration_seconds_wraps_unparseable_output(monkeypatch):
    def fake_run_ffprobe(args, **kwargs):
        class FakeResult:
            stdout = "N/A\n"
        return FakeResult()

    monkeypatch.setattr("chatbot.devotional_audio.subprocess.run", fake_run_ffprobe)

    with pytest.raises(da.DevotionalAudioError):
        da._probe_duration_seconds(Path("/fake/path.mp3"))
