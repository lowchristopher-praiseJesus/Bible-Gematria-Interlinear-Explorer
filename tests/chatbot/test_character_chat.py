import pytest

from chatbot import character_chat, character_loader


@pytest.fixture
def llm(monkeypatch):
    """Stubs the LLM boundary; records what the chat module sent it."""
    calls = []
    state = {"reply": {"type": "chat", "message": "I was a shepherd.", "data": None}}

    async def fake_call(message, research_data, conversation_history=None, page_context=None, system_prompt=None):
        calls.append({
            "message": message,
            "research_data": research_data,
            "history": conversation_history,
            "system_prompt": system_prompt,
        })
        return dict(state["reply"])

    async def fake_follow_ups(user_message, assistant_message, page_context=None):
        return ["What was Goliath like?"]

    monkeypatch.setattr(character_chat, "call_ollama_with_context", fake_call)
    monkeypatch.setattr(character_chat, "generate_llm_follow_ups", fake_follow_ups)
    calls_and_state = type("LLM", (), {"calls": calls, "state": state})
    return calls_and_state


async def test_unknown_character_is_an_error(llm):
    result = await character_chat.answer("not-a-person", "hello")
    assert result["type"] == "error"
    assert llm.calls == []


async def test_jesus_is_not_available(llm):
    result = await character_chat.answer("jesus", "hello")
    assert result["type"] == "error"
    assert llm.calls == []


async def test_answer_grounds_the_llm_on_that_characters_whole_profile(llm):
    await character_chat.answer("david", "Tell me about the giant.")
    call = llm.calls[0]
    assert call["message"] == "Tell me about the giant."
    assert character_loader.get_character("david")["profile"] in call["research_data"]


async def test_persona_is_first_person_as_the_named_character_and_profile_only(llm):
    await character_chat.answer("ruth", "Who are you?")
    prompt = llm.calls[0]["system_prompt"]
    assert "You are Ruth" in prompt
    assert "first person" in prompt
    assert "Never add" in prompt
    assert "never say you are an ai" in prompt.lower()


async def test_persona_answers_at_length_but_stays_spoken_not_written(llm):
    await character_chat.answer("david", "Who are you?")
    prompt = llm.calls[0]["system_prompt"]
    assert "two to five sentences" not in prompt
    assert "3 to 6 paragraph" in prompt
    assert "Never use bold sub-headers" in prompt
    assert "numbered or bulleted list" in prompt


async def test_persona_speaks_from_lived_experience_never_about_the_bible(llm):
    # The character lived these events: "God told me", never "the Bible
    # tells us God said". The same goes for "the text/record doesn't say".
    await character_chat.answer("adam", "What fruit was it?")
    prompt = llm.calls[0]["system_prompt"]
    assert "not reading a book" in prompt
    assert 'Never mention "the Bible"' in prompt
    assert "God told me" in prompt
    # Gaps are personal ("I do not know"), not "it was not recorded".
    assert "not recorded" not in prompt
    assert "popular ideas" in prompt


async def test_persona_only_cites_references_it_can_name_in_full(llm):
    # The profiles often show bare "(6:14–16)" refs under a book-level
    # paragraph; a guessed book turns into a wrong verse link.
    await character_chat.answer("david", "Tell me about Michal.")
    prompt = llm.calls[0]["system_prompt"]
    assert "book, chapter and verse" in prompt
    assert "leave the reference out" in prompt


async def test_history_is_sent_to_the_llm_as_role_and_content(llm):
    history = [
        {"role": "assistant", "text": "Peace to you."},
        {"role": "user", "text": "Who are you?"},
    ]
    await character_chat.answer("david", "And your father?", history)
    assert llm.calls[0]["history"] == [
        {"role": "assistant", "content": "Peace to you."},
        {"role": "user", "content": "Who are you?"},
    ]


async def test_successful_reply_carries_character_data_and_follow_ups(llm):
    result = await character_chat.answer("david", "Who are you?")
    assert result["type"] == "chat"
    assert result["message"] == "I was a shepherd."
    assert result["data"] == {"character_id": "david", "character_name": "David"}
    assert result["follow_up_questions"] == ["What was Goliath like?"]
    assert result["route"].startswith("character_chat")


async def test_scripture_references_in_the_reply_become_links(llm):
    llm.state["reply"] = {"type": "chat", "message": "I said it in 1 Samuel 17:45.", "data": None}
    result = await character_chat.answer("david", "What did you say to him?")
    assert "[1 Samuel 17:45](" in result["message"]


async def test_llm_error_passes_through_without_follow_ups(llm):
    llm.state["reply"] = {"type": "error", "message": "LLM API error: boom", "data": None}
    result = await character_chat.answer("david", "Hello")
    assert result["type"] == "error"
    assert "follow_up_questions" not in result


async def test_greeting_asks_the_llm_to_greet_in_character(llm):
    llm.state["reply"] = {"type": "chat", "message": "Peace. I am David.", "data": None}
    result = await character_chat.greeting("david")
    assert result["type"] == "chat"
    assert result["message"] == "Peace. I am David."
    assert result["data"] == {"character_id": "david", "character_name": "David"}
    assert "You are David" in llm.calls[0]["system_prompt"]
    assert result["follow_up_questions"] == character_chat.STARTER_QUESTIONS


async def test_greeting_falls_back_to_a_static_line_when_the_llm_fails(llm):
    llm.state["reply"] = {"type": "error", "message": "LLM API error: boom", "data": None}
    result = await character_chat.greeting("david")
    assert result["type"] == "chat"
    assert "David" in result["message"]
    assert "The shepherd boy from Bethlehem" in result["message"]
    assert result["follow_up_questions"] == character_chat.STARTER_QUESTIONS


async def test_greeting_for_unknown_character_is_an_error(llm):
    result = await character_chat.greeting("not-a-person")
    assert result["type"] == "error"
