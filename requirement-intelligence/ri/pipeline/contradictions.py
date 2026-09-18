"""Rule-based contradiction detection between developer answers."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass
class Contradiction:
    topic_a: str
    val_a: str
    topic_b: str
    val_b: str
    message: str


# Set of defined contradiction rules
_CONTRADICTION_RULES = [
    {
        "topic_a": "auth",
        "matches_a": ["no auth", "none", "public", "no login"],
        "topic_b": "seller_type",
        "matches_b": ["verified", "students only", "account"],
        "message": "Verification requires authentication, but 'No authentication' was selected.",
    },
    {
        "topic_a": "auth",
        "matches_a": ["no auth", "none", "public"],
        "topic_b": "multi_tenancy",
        "matches_b": ["tenant", "isolated", "workspace"],
        "message": "Multi-tenant workspaces require user authentication.",
    },
    {
        "topic_a": "scale",
        "matches_a": ["large", "100k+"],
        "topic_b": "deployment",
        "matches_b": ["self-hosted server", "single server", "localhost"],
        "message": "Scale of 100k+ users conflicts with single self-hosted server deployment.",
    },
    {
        "topic_a": "payments",
        "matches_a": ["cash on meetup", "cash only"],
        "topic_b": "payments",  # internal value conflict
        "matches_b": ["online payments only"],
        "message": "Conflicting payment methods selected.",
    },
]


def detect_contradictions(answered_topics: dict[str, str]) -> list[Contradiction]:
    """Scan answered topics for logical contradictions."""
    found: list[Contradiction] = []

    for rule in _CONTRADICTION_RULES:
        ta = rule["topic_a"]
        tb = rule["topic_b"]
        if ta not in answered_topics or tb not in answered_topics:
            continue

        va = str(answered_topics[ta]).lower()
        vb = str(answered_topics[tb]).lower()

        match_a = any(m in va for m in rule["matches_a"])
        match_b = any(m in vb for m in rule["matches_b"])

        if match_a and match_b and (ta != tb or va != vb):
            found.append(
                Contradiction(
                    topic_a=ta,
                    val_a=answered_topics[ta],
                    topic_b=tb,
                    val_b=answered_topics[tb],
                    message=rule["message"],
                )
            )

    return found
