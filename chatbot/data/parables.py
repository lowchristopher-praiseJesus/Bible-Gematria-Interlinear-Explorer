"""Curated list of Jesus's parables for Parable Study mode."""

from typing import Any, Dict, List, Optional

PARABLES: List[Dict[str, Any]] = [
    {"id": "sower", "name": "The Sower", "reference": "Matthew 13:3-9"},
    {"id": "tares", "name": "The Wheat and the Tares", "reference": "Matthew 13:24-30"},
    {"id": "mustard_seed", "name": "The Mustard Seed", "reference": "Matthew 13:31-32"},
    {"id": "leaven", "name": "The Leaven", "reference": "Matthew 13:33"},
    {"id": "hidden_treasure", "name": "The Hidden Treasure", "reference": "Matthew 13:44"},
    {"id": "pearl", "name": "The Pearl of Great Price", "reference": "Matthew 13:45-46"},
    {"id": "net", "name": "The Net", "reference": "Matthew 13:47-50"},
    {"id": "unforgiving_servant", "name": "The Unforgiving Servant", "reference": "Matthew 18:23-35"},
    {"id": "laborers_vineyard", "name": "The Laborers in the Vineyard", "reference": "Matthew 20:1-16"},
    {"id": "two_sons", "name": "The Two Sons", "reference": "Matthew 21:28-32"},
    {"id": "wicked_tenants", "name": "The Wicked Tenants", "reference": "Matthew 21:33-46"},
    {"id": "wedding_feast", "name": "The Wedding Feast", "reference": "Matthew 22:1-14"},
    {"id": "ten_virgins", "name": "The Ten Virgins", "reference": "Matthew 25:1-13"},
    {"id": "talents", "name": "The Talents", "reference": "Matthew 25:14-30"},
    {"id": "sheep_and_goats", "name": "The Sheep and the Goats", "reference": "Matthew 25:31-46"},
    {"id": "wise_foolish_builders", "name": "The Wise and Foolish Builders", "reference": "Matthew 7:24-27"},
    {"id": "new_wine_old_wineskins", "name": "New Wine in Old Wineskins", "reference": "Matthew 9:16-17"},
    {"id": "growing_seed", "name": "The Growing Seed", "reference": "Mark 4:26-29"},
    {"id": "lamp_under_bushel", "name": "The Lamp Under a Bushel", "reference": "Mark 4:21-25"},
    {"id": "good_samaritan", "name": "The Good Samaritan", "reference": "Luke 10:25-37"},
    {"id": "friend_at_midnight", "name": "The Friend at Midnight", "reference": "Luke 11:5-8"},
    {"id": "rich_fool", "name": "The Rich Fool", "reference": "Luke 12:16-21"},
    {"id": "barren_fig_tree", "name": "The Barren Fig Tree", "reference": "Luke 13:6-9"},
    {"id": "great_banquet", "name": "The Great Banquet", "reference": "Luke 14:15-24"},
    {"id": "tower_builder_warring_king", "name": "The Tower Builder and the Warring King", "reference": "Luke 14:28-33"},
    {"id": "lost_sheep", "name": "The Lost Sheep", "reference": "Luke 15:3-7"},
    {"id": "lost_coin", "name": "The Lost Coin", "reference": "Luke 15:8-10"},
    {"id": "prodigal_son", "name": "The Prodigal Son", "reference": "Luke 15:11-32"},
    {"id": "unjust_steward", "name": "The Unjust Steward", "reference": "Luke 16:1-13"},
    {"id": "rich_man_lazarus", "name": "The Rich Man and Lazarus", "reference": "Luke 16:19-31"},
    {"id": "persistent_widow", "name": "The Persistent Widow", "reference": "Luke 18:1-8"},
    {"id": "pharisee_tax_collector", "name": "The Pharisee and the Tax Collector", "reference": "Luke 18:9-14"},
    {"id": "minas", "name": "The Ten Minas", "reference": "Luke 19:11-27"},
    {"id": "two_debtors", "name": "The Two Debtors", "reference": "Luke 7:41-43"},
    {"id": "faithful_wise_servant", "name": "The Faithful and Wise Servant", "reference": "Matthew 24:45-51"},
]


def get_parable(parable_id: str) -> Optional[Dict[str, Any]]:
    return next((p for p in PARABLES if p["id"] == parable_id), None)
