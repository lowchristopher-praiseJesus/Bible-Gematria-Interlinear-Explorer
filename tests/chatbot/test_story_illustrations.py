import pytest

from chatbot import story_illustrations as si


def test_cache_key_changes_with_prompt():
    assert si.cache_key("A fox in a garden") != si.cache_key("A sparrow in a tree")


def test_cache_key_is_deterministic():
    assert si.cache_key("A fox in a garden") == si.cache_key("A fox in a garden")


def test_build_prompt_includes_style_scene_and_characters():
    prompt = si.build_prompt(
        "Amara finds a ribbon in the clover.",
        "Amara: curly black hair, yellow raincoat.",
    )
    assert si.STYLE_PREFIX.strip() in prompt
    assert "Amara finds a ribbon in the clover." in prompt
    assert "Amara: curly black hair, yellow raincoat." in prompt


def test_build_prompt_omits_blank_characters():
    prompt = si.build_prompt("The cover scene.", "")
    assert "The cover scene." in prompt
    assert "  " not in prompt  # no doubled-up whitespace from the empty field


class _FakeInlineData:
    def __init__(self, data):
        self.data = data


class _FakePart:
    def __init__(self, data):
        self.inline_data = _FakeInlineData(data) if data else None


class _FakeContent:
    def __init__(self, parts):
        self.parts = parts


class _FakeCandidate:
    def __init__(self, parts):
        self.content = _FakeContent(parts)


class _FakeResponse:
    def __init__(self, parts):
        self.candidates = [_FakeCandidate(parts)]


def test_synthesize_illustration_returns_image_bytes(monkeypatch):
    class FakeModels:
        def generate_content(self, **kwargs):
            return _FakeResponse([_FakePart(b"fake-png-bytes")])

    class FakeClient:
        def __init__(self):
            self.models = FakeModels()

    monkeypatch.setattr(si.genai, "Client", FakeClient)

    assert si.synthesize_illustration("a prompt") == b"fake-png-bytes"


def test_synthesize_illustration_raises_when_no_image_returned(monkeypatch):
    class FakeModels:
        def generate_content(self, **kwargs):
            return _FakeResponse([_FakePart(None)])

    class FakeClient:
        def __init__(self):
            self.models = FakeModels()

    monkeypatch.setattr(si.genai, "Client", FakeClient)

    with pytest.raises(si.StoryIllustrationError):
        si.synthesize_illustration("a prompt")


def test_synthesize_illustration_wraps_api_failure(monkeypatch):
    class FakeModels:
        def generate_content(self, **kwargs):
            raise RuntimeError("rate limited")

    class FakeClient:
        def __init__(self):
            self.models = FakeModels()

    monkeypatch.setattr(si.genai, "Client", FakeClient)

    with pytest.raises(si.StoryIllustrationError):
        si.synthesize_illustration("a prompt")


def test_synthesize_illustration_wraps_client_construction_failure(monkeypatch):
    class FailingClient:
        def __init__(self):
            raise RuntimeError("credentials not found")

    monkeypatch.setattr(si.genai, "Client", FailingClient)

    with pytest.raises(si.StoryIllustrationError):
        si.synthesize_illustration("a prompt")
