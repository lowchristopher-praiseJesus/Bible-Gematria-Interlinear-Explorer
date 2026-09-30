import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def _script():
    spec = importlib.util.spec_from_file_location("eval_passages", ROOT / "scripts" / "eval_passages.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _res(route, verified=None):
    r = {"type": "chat", "route": route}
    if verified is not None:
        r["artifacts"] = [{"params": {"verified": verified, "passages": []}}]
    return r


def test_classify_off_topic():
    s = _script()
    assert s._classify_off_topic(_res("passages → JEV filtered all (12 candidates)")) == "quiet"
    assert s._classify_off_topic(_res("passages → no candidates")) == "quiet"
    assert s._classify_off_topic(_res("passages → JEV (5 candidates)", True)) == "returned"
    for route in ("passages → unavailable", "passages → scope", "passages → input too long", "passages → empty input"):
        assert s._classify_off_topic(_res(route)) == "other"


def test_verified_counts():
    s = _script()
    results = [_res("a", True), _res("b", False), _res("c", True), _res("passages → no candidates")]
    assert s._verified_counts(results) == (2, 3)
    assert s._verified_counts([]) == (0, 0)
