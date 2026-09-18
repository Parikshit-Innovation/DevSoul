"""Stage 2 – Project Type Detector (Logic).

Keyword-matches the idea text against template keywords to determine
which template to load. Returns primary type, optional secondary types,
and a confidence score. Falls back to "generic" if no match.
"""
from __future__ import annotations

from dataclasses import dataclass, field
import re
from typing import Any

# Built-in keyword map (merged with keywords loaded from templates)
_BUILTIN_KEYWORDS: dict[str, list[str]] = {
    "marketplace": [
        "marketplace", "buy", "sell", "selling", "buying", "listing", "vendor",
        "store", "shop", "auction", "ecommerce", "e-commerce", "product", "item",
    ],
    "saas": [
        "saas", "subscription", "multi-tenant", "tenant", "billing", "workspace",
        "organization", "b2b",
    ],
    "mobile_app": [
        "mobile", "ios", "android", "react native", "flutter", "swift", "kotlin",
        "app store", "phone",
    ],
    "data_ml_app": [
        "ml", "machine learning", "ai", "data science", "training", "inference",
        "model", "prediction", "dataset", "deep learning",
    ],
    "web_app": [
        "web app", "website", "webapp", "dashboard", "portal", "platform",
        "interface", "frontend", "ui", "single page",
    ],
    "api_service": [
        "api", "service", "microservice", "backend", "rest", "graphql",
        "endpoint", "webhook", "integration", "sdk",
    ],
}

_PRIORITY = ["marketplace", "saas", "mobile_app", "data_ml_app", "web_app", "api_service"]


@dataclass
class DetectionResult:
    primary: str
    secondaries: list[str] = field(default_factory=list)
    confidence: float = 1.0
    needs_confirmation: bool = False

    def __str__(self) -> str:
        return self.primary

    def __repr__(self) -> str:
        return f"DetectionResult(primary='{self.primary}', secondaries={self.secondaries}, confidence={self.confidence:.2f}, needs_confirmation={self.needs_confirmation})"

    def __eq__(self, other: Any) -> bool:
        if isinstance(other, str):
            return self.primary == other
        if isinstance(other, DetectionResult):
            return (
                self.primary == other.primary
                and self.secondaries == other.secondaries
            )
        return False


def detect(
    idea: str,
    template_keywords: dict[str, list[str]] | None = None,
) -> DetectionResult:
    """Detect project type from the idea text.

    Args:
        idea:              The raw idea string.
        template_keywords: Extra keywords loaded from template files.

    Returns:
        DetectionResult with primary type, secondaries, confidence score,
        and whether type confirmation is advised.
    """
    text = idea.lower()
    text = re.sub(r"[^\w\s-]", " ", text)

    combined: dict[str, list[str]] = {}
    for ptype in _PRIORITY:
        combined[ptype] = list(_BUILTIN_KEYWORDS.get(ptype, []))
        if template_keywords and ptype in template_keywords:
            for kw in template_keywords[ptype]:
                if kw not in combined[ptype]:
                    combined[ptype].append(kw)

    scores: dict[str, int] = {ptype: 0 for ptype in _PRIORITY}
    for ptype in _PRIORITY:
        for kw in combined[ptype]:
            pattern = r"\b" + re.escape(kw) + r"\b"
            if re.search(pattern, text):
                scores[ptype] += 1

    ranked = sorted(_PRIORITY, key=lambda t: scores[t], reverse=True)
    best = ranked[0]
    best_score = scores[best]

    if best_score == 0:
        return DetectionResult(
            primary="generic",
            secondaries=[],
            confidence=0.2,
            needs_confirmation=True,
        )

    # Secondary types with non-zero scores
    secondaries = [t for t in ranked[1:] if scores[t] > 0 and scores[t] >= 0.5 * best_score]

    total_hits = sum(scores.values())
    confidence = round(min(1.0, (best_score / total_hits) * (0.6 + 0.1 * min(best_score, 4))), 2)

    needs_confirmation = confidence < 0.6 or (len(secondaries) > 0 and scores[secondaries[0]] == best_score)

    return DetectionResult(
        primary=best,
        secondaries=secondaries,
        confidence=confidence,
        needs_confirmation=needs_confirmation,
    )
