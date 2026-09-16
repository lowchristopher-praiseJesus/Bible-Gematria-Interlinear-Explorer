"""Curated idiom and phrase rulings for Hermeneutics mode.

Each entry records how a biblical phrase is to be read under the
methodology this mode implements, the reading it explicitly rejects, and
the proof texts that carry it. `rulings_for()` returns only the rulings a
passage actually triggers, so a run pays tokens for the rulings that apply
rather than for the whole list.

Editing this list changes the mode's doctrinal output. Every proof text is
verified against Complete.db by
tests/chatbot/test_hermeneutic_rulings.py::test_every_proof_text_resolves_against_complete_db.
"""

import re
from typing import Any, Dict, List

RULINGS: List[Dict[str, Any]] = [
    {
        "id": "thorn_in_the_flesh",
        "triggers": ["thorn in the flesh", "thorn in the side", "thorns in your sides"],
        "reading": "harassing persons or adversaries (e.g. Judaizers, persecutors)",
        "rejects": "physical sickness or disease",
        "proofs": ["NUM 33:55", "2CO 12:7"],
    },
    {
        "id": "fear_and_trembling",
        "triggers": ["fear and trembling", "fear and tremble"],
        "reading": "overwhelming awe and reverence produced by God's goodness and prosperity",
        "rejects": "terror of divine judgement or fear of losing salvation",
        "proofs": ["JER 33:8-9", "MRK 5:33", "PHP 2:12"],
    },
    {
        "id": "single_eye",
        "triggers": ["single eye", "evil eye", "good eye", "bountiful eye"],
        "reading": "a Hebrew idiom for financial generosity ('good'/'single') versus stinginess ('evil')",
        "rejects": "spiritual focus, purity of gaze, or the occult",
        "proofs": ["MAT 6:22", "PRO 22:9"],
    },
    {
        "id": "overcomer",
        "triggers": ["overcometh", "overcomer", "him that overcometh"],
        "reading": "anyone who believes that Jesus is the Son of God",
        "rejects": "an elite subclass of especially victorious Christians",
        "proofs": ["1JN 5:4", "1JN 5:5"],
    },
    {
        "id": "certain_man",
        "triggers": ["a certain man", "a certain disciple"],
        "reading": "in Luke/Acts usage, 'a certain man' designates a non-believer while 'a certain disciple' designates a born-again believer",
        "rejects": "treating the two phrases as interchangeable narrative filler",
        "proofs": ["LUK 10:30", "ACT 9:10"],
    },
    {
        "id": "falling_from_grace",
        "triggers": ["fallen from grace", "fall from grace", "falling from grace"],
        "reading": "attempting to be justified by law, performance, or self-righteousness",
        "rejects": "moral failure or the loss of salvation",
        "proofs": ["GAL 5:4", "GAL 2:21"],
    },
    {
        "id": "sowing_and_reaping",
        "triggers": ["soweth", "sowing and reaping", "whatsoever a man soweth"],
        "reading": "in its Galatians 6 context, financial stewardship and the support of gospel teachers",
        "rejects": "God resurrecting forgiven sins to punish a believer",
        "proofs": ["GAL 6:6", "GAL 6:7"],
    },
    {
        "id": "lord_gave_and_took_away",
        "triggers": ["the lord gave, and the lord hath taken away", "lord hath taken away"],
        "reading": "a faithfully recorded statement of Job's own erroneous understanding",
        "rejects": "a divine doctrinal statement about how God operates",
        "proofs": ["JOB 1:21", "JAS 1:17", "JHN 10:10"],
    },
]


def rulings_for(text: str) -> List[Dict[str, Any]]:
    """The rulings whose trigger phrases appear in `text`, in RULINGS order.

    Matching is case-insensitive and whole-phrase: a trigger must appear on
    word boundaries, so "the flesh" alone never triggers the thorn ruling.
    """
    haystack = text.lower()
    matched = []
    for ruling in RULINGS:
        for trigger in ruling["triggers"]:
            if re.search(rf"\b{re.escape(trigger.lower())}\b", haystack):
                matched.append(ruling)
                break
    return matched


def render_rulings(rulings: List[Dict[str, Any]]) -> str:
    """Format matched rulings as prompt text. Empty string for no rulings,
    so callers can concatenate unconditionally."""
    if not rulings:
        return ""
    lines = ["STANDARD RULINGS that apply to this passage (these are settled — apply them):"]
    for r in rulings:
        proofs = ", ".join(r["proofs"])
        lines.append(f"- {r['triggers'][0]!r} means {r['reading']}, NOT {r['rejects']} ({proofs}).")
    return "\n".join(lines)
