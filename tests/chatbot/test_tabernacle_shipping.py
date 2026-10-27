from pathlib import Path

VIEWER = Path(__file__).resolve().parents[2] / "frontend" / "public" / "tabernacle"


def test_viewer_is_in_the_repo():
    for rel in ["index.html", "css/style.css", "js/main.js", "js/model.js", "textures"]:
        assert (VIEWER / rel).exists(), rel


def test_viewer_ships_no_recordings_or_reference_images():
    assert not (VIEWER / "recordings").exists()
    assert not list(VIEWER.glob("*.png")) and not list(VIEWER.glob("*.jpg"))
    assert not (VIEWER / ".claude").exists()


def test_viewer_stays_under_size_budget():
    total = sum(p.stat().st_size for p in VIEWER.rglob("*") if p.is_file())
    assert total <= 10 * 1024 * 1024
