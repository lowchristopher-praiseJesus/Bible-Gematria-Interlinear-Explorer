"""Curated, progressively-growing list of topics for Topical Study mode.

Append new entries here as more topics are added — no other code needs
to change when the list grows.
"""

from typing import Any, Dict, List, Optional

TOPICS: List[Dict[str, Any]] = [
    {
        "id": "holiness",
        "name": "Biblical Holiness",
        "seed_references": ["Leviticus 19:2", "1 Peter 1:15-16", "Hebrews 12:14"],
    },
    {
        "id": "forgiveness",
        "name": "Forgiveness",
        "seed_references": ["Matthew 6:14-15", "Ephesians 4:32", "Colossians 3:13"],
    },
    {
        "id": "faith",
        "name": "Faith",
        "seed_references": ["Hebrews 11:1", "Romans 10:17", "James 2:17"],
    },
    {
        "id": "love",
        "name": "Love",
        "seed_references": ["1 Corinthians 13:4-7", "John 13:34-35", "1 John 4:7-8"],
    },
    {
        "id": "suffering",
        "name": "Suffering",
        "seed_references": ["Romans 5:3-5", "James 1:2-4", "1 Peter 4:12-13"],
    },
    {
        "id": "prayer",
        "name": "Prayer",
        "seed_references": ["Matthew 6:9-13", "Philippians 4:6-7", "1 Thessalonians 5:17"],
    },
    {
        "id": "grace",
        "name": "Grace",
        "seed_references": ["Ephesians 2:8-9", "2 Corinthians 12:9", "Titus 2:11"],
    },
    {
        "id": "hope",
        "name": "Hope",
        "seed_references": ["Romans 15:13", "Jeremiah 29:11", "Romans 8:24-25"],
    },
]


def get_topic(topic_id: str) -> Optional[Dict[str, Any]]:
    return next((t for t in TOPICS if t["id"] == topic_id), None)
