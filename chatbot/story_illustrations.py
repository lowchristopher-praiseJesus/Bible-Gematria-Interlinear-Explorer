"""Per-page story illustrations via the Gemini API's image generation
model (a Google AI Studio API key — no GCP service account, unlike
chatbot/devotional_audio.py's TTS credential). Mirrors devotional_audio's
content-hash disk cache pattern exactly.
"""

import hashlib
import os
from pathlib import Path

from google import genai
from google.genai import types

IMAGE_MODEL = os.environ.get("STORY_IMAGE_MODEL", "gemini-3.1-flash-lite-image")
IMAGE_ASPECT_RATIO = "4:3"

STORY_IMAGE_CACHE_DIR = Path(os.environ.get("STORY_IMAGE_CACHE_DIR", "STORY_IMAGE_CACHE"))
STORY_IMAGE_CACHE_DIR.mkdir(parents=True, exist_ok=True)

STYLE_PREFIX = (
    "Children's storybook illustration, soft warm watercolor style, "
    "gentle colors, no text or words anywhere in the image. "
)


class StoryIllustrationError(Exception):
    """Raised for any failure generating one illustration. Callers must
    treat this as expected and degrade that one page/cover — never let it
    fail an entire story or request."""


def cache_key(prompt: str) -> str:
    return hashlib.sha256(prompt.encode("utf-8")).hexdigest()


def build_prompt(scene: str, characters: str) -> str:
    parts = [STYLE_PREFIX.strip(), scene.strip(), characters.strip()]
    return " ".join(p for p in parts if p)


def synthesize_illustration(prompt: str) -> bytes:
    """One image's PNG bytes for `prompt`. Raises StoryIllustrationError on
    any failure — client construction, network/API error, or an empty
    response — never returns partial/invalid data silently."""
    try:
        client = genai.Client()
    except Exception as exc:  # noqa: BLE001 — any client/credential failure
        raise StoryIllustrationError(f"Gemini client unavailable: {exc}") from exc

    try:
        response = client.models.generate_content(
            model=IMAGE_MODEL,
            contents=prompt,
            config=types.GenerateContentConfig(
                response_modalities=["IMAGE"],
                image_config=types.ImageConfig(aspect_ratio=IMAGE_ASPECT_RATIO),
            ),
        )
    except Exception as exc:  # noqa: BLE001 — network/API failure
        raise StoryIllustrationError(f"Image generation failed: {exc}") from exc

    for candidate in getattr(response, "candidates", None) or []:
        for part in getattr(candidate.content, "parts", None) or []:
            inline_data = getattr(part, "inline_data", None)
            if inline_data and inline_data.data:
                return inline_data.data
    raise StoryIllustrationError("Gemini returned no image data")
