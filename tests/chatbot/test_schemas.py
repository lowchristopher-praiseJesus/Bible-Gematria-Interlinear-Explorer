from chatbot.schemas import ArtifactLink, ChatRequest, ChatResponse


def test_artifact_link_shape():
    link = ArtifactLink(type="strongs", label="Strong's ▸", params={"id": "G2657"})
    assert link.type == "strongs"
    assert link.params == {"id": "G2657"}


def test_chat_request_accepts_mode_fields():
    req = ChatRequest(message="", mode="parable", mode_params={"parable_id": "prodigal_son"})
    assert req.mode == "parable"
    assert req.mode_params == {"parable_id": "prodigal_son"}


def test_chat_request_mode_fields_optional():
    req = ChatRequest(message="hello")
    assert req.mode is None
    assert req.mode_params is None


def test_chat_response_accepts_artifacts():
    resp = ChatResponse(
        type="chat",
        message="hi",
        artifacts=[ArtifactLink(type="strongs", label="Strong's", params={"id": "G26"})],
    )
    assert len(resp.artifacts) == 1
    assert resp.artifacts[0].type == "strongs"


def test_chat_response_artifacts_optional():
    resp = ChatResponse(type="chat", message="hi")
    assert resp.artifacts is None
