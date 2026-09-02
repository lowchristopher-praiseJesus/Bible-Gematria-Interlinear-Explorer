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


def test_study_wiki_entry_round_trips():
    from chatbot.schemas import StudyWikiEntry

    entry = StudyWikiEntry(
        id="present-day-ministry-of-jesus",
        title="The Present-Day Ministry of Jesus and How It Empowers You",
        speaker="Joseph Prince",
        description="10-part series.",
    )
    assert entry.model_dump()["speaker"] == "Joseph Prince"


def test_wiki_page_response_round_trips():
    from chatbot.schemas import WikiPageResponse

    page = WikiPageResponse(
        series_id="s1",
        slug="grace",
        title="Grace",
        kind="concept",
        body_html="<p>Undeserved favor.</p>",
        citation="Joseph Prince — The Present-Day Ministry of Jesus and How It Empowers You",
    )
    assert page.model_dump()["slug"] == "grace"


def test_chat_response_accepts_optional_trace():
    resp = ChatResponse(type="chat", message="hi", trace={"turnId": "abc", "steps": []})
    assert resp.trace == {"turnId": "abc", "steps": []}
    assert ChatResponse(type="chat", message="hi").trace is None
