import json

from chatbot import api


def test_buffered_endpoint_dispatches_to_hermeneutics(client, monkeypatch):
    captured = {}

    async def fake_answer(reference, message, history=None, run_digest=None, scope_chapter=None):
        captured.update(reference=reference, message=message, run_digest=run_digest)
        return {"type": "chat", "message": "report", "data": None, "route": "hermeneutics → x"}

    monkeypatch.setattr(api.hermeneutics, "answer", fake_answer)
    response = client.post("/chat", json={
        "message": "run it",
        "mode": "hermeneutics",
        "mode_params": {"reference": "ROM 8:1", "run_digest": "prior findings"},
    })
    assert response.status_code == 200
    assert response.json()["message"] == "report"
    assert captured["reference"] == "ROM 8:1"
    assert captured["run_digest"] == "prior findings"
