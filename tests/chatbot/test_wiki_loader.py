from pathlib import Path

import pytest

from chatbot.wiki_loader import load_library

FIXTURE_PATH = str(Path(__file__).parent / "fixtures" / "sample_wiki")

MANIFEST = [
    {
        "id": "sample",
        "title": "Sample Series",
        "speaker": "Test Speaker",
        "description": "A fixture series for tests.",
        "path": FIXTURE_PATH,
    }
]


def test_load_library_parses_concepts_and_entities():
    library = load_library(MANIFEST)
    assert "sample" in library
    pages = library["sample"]["pages"]
    assert pages["grace"]["kind"] == "concept"
    assert pages["grace"]["title"] == "Grace"
    assert pages["grace"]["tags"] == ["grace", "core"]
    assert pages["joseph-prince"]["kind"] == "entity"
    assert pages["joseph-prince"]["title"] == "Joseph Prince"


def test_load_library_renders_wikilinks_and_scripture_refs_to_html():
    library = load_library(MANIFEST)
    grace_html = library["sample"]["pages"]["grace"]["body_html"]
    assert '<a href="/topic-wiki?series=sample&amp;page=holiness">Holiness</a>' in grace_html
    assert '<a href="/explorer?reference=ROM%206%3A14">Rom 6:14</a>' in grace_html
    assert "<strong>undeserved favor</strong>" in grace_html


def test_load_library_skips_entry_with_unresolvable_path():
    bad_manifest = [{**MANIFEST[0], "id": "missing", "path": "/no/such/directory"}]
    library = load_library(bad_manifest)
    assert "missing" not in library


def test_load_library_skips_unreadable_page_without_failing_whole_series(monkeypatch):
    import pathlib

    real_read_text = pathlib.Path.read_text

    def flaky_read_text(self, *args, **kwargs):
        if self.name == "grace.md":
            raise OSError("simulated unreadable file")
        return real_read_text(self, *args, **kwargs)

    monkeypatch.setattr(pathlib.Path, "read_text", flaky_read_text)
    library = load_library(MANIFEST)
    pages = library["sample"]["pages"]
    assert "grace" not in pages
    assert "holiness" in pages  # the rest of the series still loads


def test_load_library_renders_markdown_tables_to_html_tables(tmp_path):
    wiki_dir = tmp_path / "wiki" / "concepts"
    wiki_dir.mkdir(parents=True)
    (wiki_dir / "offerings.md").write_text(
        "---\ntype: concept\nstatus: established\ntags: []\n---\n\n"
        "# Offerings\n\n"
        "| Offering | Meaning |\n"
        "| --- | --- |\n"
        "| Burnt | Total surrender |\n",
        encoding="utf-8",
    )
    manifest = [
        {
            "id": "tables",
            "title": "Tables Series",
            "speaker": "Test Speaker",
            "description": "fixture",
            "path": str(tmp_path),
        }
    ]
    library = load_library(manifest)
    html = library["tables"]["pages"]["offerings"]["body_html"]
    assert "<table>" in html
    assert "<th>Offering</th>" in html
    assert "<td>Burnt</td>" in html
    # A literal pipe-table row must not survive as plain text.
    assert "| Burnt | Total surrender |" not in html


def test_load_library_does_not_duplicate_title_as_leading_h1_in_body(tmp_path):
    wiki_dir = tmp_path / "wiki" / "concepts"
    wiki_dir.mkdir(parents=True)
    (wiki_dir / "grace.md").write_text(
        "---\ntype: concept\nstatus: established\ntags: []\n---\n\n"
        "# Grace\n\nDefined as undeserved favor.\n\n## A later heading called Grace\n",
        encoding="utf-8",
    )
    manifest = [
        {
            "id": "dedup",
            "title": "Dedup Series",
            "speaker": "Test Speaker",
            "description": "fixture",
            "path": str(tmp_path),
        }
    ]
    library = load_library(manifest)
    page = library["dedup"]["pages"]["grace"]
    assert page["title"] == "Grace"
    # The leading `# Grace` title line must not be re-rendered as an <h1>
    # in the body — the title is already surfaced separately by the API.
    assert "<h1>" not in page["body_html"]
    assert "Defined as undeserved favor." in page["body_html"]
    # A later, differently-shaped heading that happens to mention "Grace"
    # must be left alone.
    assert "A later heading called Grace" in page["body_html"]


def test_search_ranks_by_keyword_overlap():
    from chatbot.wiki_loader import search as _search

    library = load_library(MANIFEST)
    results = _search_against(library, "sample", "grace favor")
    assert results
    assert results[0]["slug"] == "grace"


def _search_against(library, series_id, query, top_n=3):
    """Test helper mirroring wiki_loader.search()'s scoring against an
    explicit library dict, so this test doesn't depend on module-level
    state built from the real STUDY_WIKI_LIBRARY."""
    import re

    series = library.get(series_id)
    if not series:
        return []
    terms = set(re.findall(r"[a-z0-9']+", query.lower()))
    scored = []
    for slug, page in series["pages"].items():
        haystack = f"{page['title']} {' '.join(page['tags'])} {page['body']}".lower()
        haystack_terms = set(re.findall(r"[a-z0-9']+", haystack))
        score = len(terms & haystack_terms)
        if score:
            scored.append((score, slug, page))
    scored.sort(key=lambda t: t[0], reverse=True)
    return [{"slug": s, "title": p["title"], "kind": p["kind"], "body": p["body"]} for _, s, p in scored[:top_n]]


def test_search_returns_no_matches_for_genuinely_off_topic_query():
    # Regression test for the missing relevance floor / stopword handling:
    # before the fix these off-topic queries scored spurious matches
    # (raw overlap >= 1 against incidental shared words) instead of
    # tripping wiki_qa's no-match fallback.
    from chatbot import wiki_loader

    assert wiki_loader.search("present-day-ministry-of-jesus", "what is quantum computing?") == []
    assert wiki_loader.search("present-day-ministry-of-jesus", "how do I bake sourdough bread?") == []


def test_search_filters_stopwords_from_query_and_pages(monkeypatch):
    from chatbot import wiki_loader

    library = load_library(MANIFEST)
    monkeypatch.setattr(wiki_loader, "_LIBRARY", library)
    # A query built entirely of stopwords (plus the series name, which is
    # itself in the stopword list) has no real content terms left, so it
    # must not match anything.
    assert wiki_loader.search("sample", "what does this series say about") == []


def test_search_normalizes_score_by_page_length(monkeypatch):
    # A short, precisely on-topic page should outrank a long page that
    # shares the same raw overlap count but is mostly unrelated filler —
    # regression test for the raw-count scoring that used to favor
    # whichever page was simply longest.
    from chatbot import wiki_loader

    filler = " ".join(f"otherword{i}" for i in range(20))
    library = {
        "s": {
            "manifest": {"id": "s"},
            "pages": {
                "long-page": {
                    "kind": "concept",
                    "title": "Long page",
                    "tags": [],
                    "body": f"grace mercy {filler}",
                },
                "short-page": {
                    "kind": "concept",
                    "title": "Short page",
                    "tags": [],
                    "body": "grace mercy defined simply.",
                },
            },
        }
    }
    monkeypatch.setattr(wiki_loader, "_LIBRARY", library)
    results = wiki_loader.search("s", "grace mercy")
    assert [r["slug"] for r in results] == ["short-page", "long-page"]


def test_module_level_wrappers_use_real_registered_library():
    # Sanity check against the real STUDY_WIKI_LIBRARY (Task 1) rather than
    # the fixture — confirms the module-level singleton actually loaded the
    # registered series at import time.
    from chatbot import wiki_loader

    series = wiki_loader.list_series()
    ids = [s["id"] for s in series]
    assert "present-day-ministry-of-jesus" in ids
    concepts = wiki_loader.list_concepts("present-day-ministry-of-jesus")
    assert len(concepts) > 50  # the series has ~80 concept pages
    slugs = {c["slug"] for c in concepts}
    assert "grace" in slugs
    page = wiki_loader.get_page("present-day-ministry-of-jesus", "grace")
    assert page is not None
    assert page["title"] == "Grace"
    assert wiki_loader.get_page("present-day-ministry-of-jesus", "not-a-real-slug") is None
    assert wiki_loader.get_manifest("present-day-ministry-of-jesus")["speaker"] == "Joseph Prince"
