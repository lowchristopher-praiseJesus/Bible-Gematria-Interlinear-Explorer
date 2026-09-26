"""Per-page story illustrations. IMAGE_PROVIDER picks the backend:
gemini (default) calls the Gemini API's image generation model directly (a
Google AI Studio API key — no GCP service account, unlike
chatbot/devotional_audio.py's TTS credential); abacus calls the same kind of
image-capable model through Abacus.ai's RouteLLM gateway (an OpenAI-compatible
/chat/completions API with modalities=["image"] and an image_config block),
used on hosted deployments that carry an Abacus.ai API key instead of a
Gemini one. Both return PNG bytes. Mirrors devotional_audio's content-hash
disk cache pattern exactly.
"""

import base64
import hashlib
import os
import re
from pathlib import Path

import httpx
from google import genai
from google.genai import types

IMAGE_PROVIDER = os.environ.get("IMAGE_PROVIDER", "gemini").strip().lower()

GEMINI_IMAGE_MODEL = os.environ.get("STORY_IMAGE_MODEL", "gemini-3.1-flash-lite-image")
IMAGE_ASPECT_RATIO = "4:3"

# nano_banana_pro is Abacus.ai's RouteLLM name for Google's own Gemini image
# model family, so it takes the same "W:H" aspect_ratio string and produces
# PNG output like the direct Gemini path above — the lowest-risk default
# when swapping gateways rather than swapping models.
ABACUS_AI_BASE_URL = os.environ.get("ABACUS_AI_BASE_URL", "https://routellm.abacus.ai/v1").rstrip("/")
ABACUS_AI_API_KEY = os.environ.get("ABACUS_AI_API_KEY", "")
ABACUS_IMAGE_MODEL = os.environ.get("ABACUS_IMAGE_MODEL", "nano_banana_pro")

STORY_IMAGE_CACHE_DIR = Path(os.environ.get("STORY_IMAGE_CACHE_DIR", "STORY_IMAGE_CACHE"))
STORY_IMAGE_CACHE_DIR.mkdir(parents=True, exist_ok=True)

STYLE_PREFIX = (
    "Children's storybook illustration, soft warm watercolor style, "
    "gentle colors, no text or words anywhere in the image. "
)

_DATA_URI_RE = re.compile(r"^data:image/(\w+);base64,(.+)$", re.DOTALL)


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
    """One image's PNG bytes for `prompt`, via whichever backend
    IMAGE_PROVIDER selects. Raises StoryIllustrationError on any failure —
    client/credential setup, network/API error, or an empty response —
    never returns partial/invalid data silently."""
    if IMAGE_PROVIDER == "abacus":
        return _synthesize_illustration_abacus(prompt)
    return _synthesize_illustration_gemini(prompt)


def _synthesize_illustration_gemini(prompt: str) -> bytes:
    try:
        client = genai.Client()
    except Exception as exc:  # noqa: BLE001 — any client/credential failure
        raise StoryIllustrationError(f"Gemini client unavailable: {exc}") from exc

    try:
        response = client.models.generate_content(
            model=GEMINI_IMAGE_MODEL,
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


def _synthesize_illustration_abacus(prompt: str) -> bytes:
    if not ABACUS_AI_API_KEY:
        raise StoryIllustrationError("ABACUS_AI_API_KEY is not set")

    payload = {
        "model": ABACUS_IMAGE_MODEL,
        "modalities": ["image", "text"],
        "messages": [{"role": "user", "content": [{"type": "text", "text": prompt}]}],
        "image_config": {"aspect_ratio": IMAGE_ASPECT_RATIO},
    }
    try:
        response = httpx.post(
            f"{ABACUS_AI_BASE_URL}/chat/completions",
            headers={"Authorization": f"Bearer {ABACUS_AI_API_KEY}"},
            json=payload,
            timeout=120.0,
        )
        response.raise_for_status()
        data = response.json()
    except httpx.HTTPError as exc:
        raise StoryIllustrationError(f"Abacus.ai image request failed: {exc}") from exc

    choices = data.get("choices") or []
    images = (choices[0].get("message") or {}).get("images") if choices else None
    for image in images or []:
        url = (image.get("image_url") or {}).get("url") or image.get("url") or ""
        match = _DATA_URI_RE.match(url)
        if match:
            return base64.b64decode(match.group(2))
    raise StoryIllustrationError("Abacus.ai returned no image data")
