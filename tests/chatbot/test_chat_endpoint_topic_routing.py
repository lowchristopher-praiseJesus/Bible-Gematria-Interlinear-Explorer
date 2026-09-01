"""A free-text message in an already-resolved Topical Study session is
answered from that series' wiki, not the generic deterministic/Ollama
fallback used everywhere else."""


def test_chat_in_topic_mode_routes_to_wiki_qa(client, monkeypatch):
    import chatbot.api as api_module

    async def fake_wiki_qa_answer(series_id, message, conversation_history=None):
        return {
            "type": "chat",
            "message": f"[wiki_qa answered for {series_id}]",
            "data": None,
            "route": "wiki_qa → test",
        }

    monkeypatch.setattr(api_module.wiki_qa, "answer", fake_wiki_qa_answer)

    res = client.post(
        "/chat",
        json={
            "message": "what does this series say about pride?",
            "mode": "topic",
            "mode_params": {"series_id": "present-day-ministry-of-jesus"},
        },
    )
    assert res.status_code == 200
    assert res.json()["message"] == "[wiki_qa answered for present-day-ministry-of-jesus]"


def test_chat_in_topic_mode_without_series_id_falls_through_to_deterministic(client):
    # No series_id yet (still on the picker step) — an ordinary message
    # here isn't a wiki question, so it must not be routed to wiki_qa.
    res = client.post(
        "/chat",
        json={"message": "John 3:16", "mode": "topic", "mode_params": {}},
    )
    assert res.status_code == 200
    assert res.json()["type"] == "verse" or "3:16" in res.json()["message"]
