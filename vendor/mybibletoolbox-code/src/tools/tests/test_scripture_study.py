"""Tests for scripture_study.py path resolution and file discovery."""

import pytest
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).parent.parent.parent))
sys.path.insert(0, str(Path(__file__).parent.parent.parent / 'lib'))

from lib.scripture_study import get_commentary_files, parse_verse_reference, list_available_tools


@pytest.fixture
def commentary_root(tmp_path):
    """Create STANDARDIZATION.md-compliant directory + files for LUK 16:8."""
    verse_dir = tmp_path / "LUK" / "016" / "008"
    verse_dir.mkdir(parents=True)
    (verse_dir / "LUK-016-008-tbta.yaml").write_text("verse: LUK 16:8\n")
    (verse_dir / "LUK-016-008-macula.yaml").write_text("verse: LUK 16:8\n")
    (verse_dir / "LUK-016-008-translations-ebible.yaml").write_text("verse: LUK 16:8\n")
    return tmp_path


def test_get_commentary_files_finds_standard_format(commentary_root):
    """get_commentary_files must find BOOK-chapter-verse-tool.yaml in padded verse subdir."""
    files = get_commentary_files("LUK", 16, 8, "full", commentary_root, {})
    assert len(files) == 3, f"Expected 3 files, got {len(files)}: {files}"


def test_get_commentary_files_chapter_padded(commentary_root):
    """Chapter directory must use zero-padded format (016, not 16)."""
    files = get_commentary_files("LUK", 16, 8, "full", commentary_root, {})
    assert all("016" in str(f) for f in files), "Chapter dir must be zero-padded"


def test_get_commentary_files_verse_subdir(commentary_root):
    """Files must be found inside the verse subdirectory (008/), not directly in chapter dir."""
    files = get_commentary_files("LUK", 16, 8, "full", commentary_root, {})
    assert all("008" in str(f) for f in files), "Files must be in verse subdir"


def test_get_commentary_files_hyphen_format(commentary_root):
    """Filename format must be BOOK-chapter-verse-tool.yaml (hyphens, not underscores)."""
    files = get_commentary_files("LUK", 16, 8, "full", commentary_root, {})
    assert all("LUK-016-008-" in f.name for f in files), f"Wrong filename format: {[f.name for f in files]}"


def test_list_available_tools_finds_tools(commentary_root):
    """list_available_tools must return tool names from standard filenames."""
    result = list_available_tools([("LUK", 16, 8)], commentary_root)
    assert "LUK.016.008" in result
    tools = result["LUK.016.008"]
    assert sorted(tools) == ["macula", "tbta", "translations-ebible"]


def test_parse_verse_reference_single():
    """Parse single verse reference."""
    result = parse_verse_reference("LUK 16:8")
    assert result == [("LUK", 16, 8)]


def test_parse_verse_reference_range():
    """Parse verse range."""
    result = parse_verse_reference("LUK 16:8-10")
    assert result == [("LUK", 16, 8), ("LUK", 16, 9), ("LUK", 16, 10)]
