# chatbot/passage_embed.py
"""Local query/passage embeddings for "Find passages" — a small ONNX model
run through fastembed, so the chatbot image needs no PyTorch. The model
name is stored in passage_index_meta.json; a mismatch makes the index
unavailable (see passage_index.load_index)."""

import logging
import threading
from typing import Optional, Sequence

import numpy as np

logger = logging.getLogger(__name__)

MODEL_NAME = "BAAI/bge-small-en-v1.5"
EMBED_DIM = 384

_MODEL = None
_LOCK = threading.Lock()


def _model():
    global _MODEL
    with _LOCK:
        if _MODEL is None:
            from fastembed import TextEmbedding
            _MODEL = TextEmbedding(model_name=MODEL_NAME)
        return _MODEL


def _normalise(rows) -> np.ndarray:
    array = np.asarray(list(rows), dtype=np.float32)
    norms = np.linalg.norm(array, axis=1, keepdims=True)
    return array / np.maximum(norms, 1e-9)


def embed_queries(texts: Sequence[str]) -> Optional[np.ndarray]:
    if not texts:
        return None
    try:
        return _normalise(_model().query_embed(list(texts)))
    except Exception:  # noqa: BLE001 — semantic search is optional; callers fall back to keywords
        logger.warning("passages: query embedding failed", exc_info=True)
        return None


def embed_passages(texts: Sequence[str]) -> np.ndarray:
    return _normalise(_model().passage_embed(list(texts)))
