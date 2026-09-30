import numpy as np
import pytest

from chatbot import passage_embed

pytest.importorskip("fastembed")


def test_embed_queries_shape_and_unit_norm():
    out = passage_embed.embed_queries(["caught up in the clouds", "light"])
    assert out.shape == (2, passage_embed.EMBED_DIM)
    assert out.dtype == np.float32
    assert np.allclose(np.linalg.norm(out, axis=1), 1.0, atol=1e-4)


def test_related_text_scores_higher_than_unrelated():
    q = passage_embed.embed_queries(["believers will be caught up together in the clouds to meet the Lord"])[0]
    near, far = passage_embed.embed_passages([
        "Then we which are alive and remain shall be caught up together with them in the clouds, to meet the Lord in the air",
        "And God said, Let there be light: and there was light.",
    ])
    assert float(q @ near) > float(q @ far)


def test_embed_queries_returns_none_on_failure(monkeypatch):
    def boom():
        raise RuntimeError("model missing")
    monkeypatch.setattr(passage_embed, "_model", boom)
    assert passage_embed.embed_queries(["x"]) is None


def test_embed_queries_returns_none_for_no_text():
    assert passage_embed.embed_queries([]) is None
