"""Stage 1 – Idea Analyzer (LLM).

Extracts a project name, summary, and seed requirements from the raw idea.
Each seed requirement is tagged with a `topic` (graph node_id) so the graph
can immediately mark that topic answered.

Fallback (no LLM or bad response): returns name from first 5 words, empty seeds.
"""
from __future__ import annotations

import logging
import re
from typing import TYPE_CHECKING

from ri.schemas import SeedRequirement

if TYPE_CHECKING:
    from ri.llm.base import BaseLLM

logger = logging.getLogger(__name__)

# Allowed type and priority values for validation
_VALID_TYPES = {"feature", "bug", "refactor", "chore", "security", "documentation"}
_VALID_PRIORITIES = {"critical", "high", "medium", "low"}


def analyze(idea: str, llm: "BaseLLM", allowed_topics: list[str]) -> dict:
    """Run the idea analysis stage.

    Returns:
        {
            "name": str,
            "summary": str,
            "seed_requirements": list[SeedRequirement],
        }
    """
    from ri.llm.prompts import IDEA_ANALYSIS_PROMPT

    prompt = IDEA_ANALYSIS_PROMPT.format(
        idea=idea,
        allowed_topics=", ".join(allowed_topics) if allowed_topics else "(none yet)",
    )

    raw = llm.complete(prompt, schema={}, task="idea_analysis")

    if raw and isinstance(raw, dict) and "name" in raw:
        try:
            return _parse(raw, allowed_topics)
        except Exception as exc:
            logger.warning("[ri/idea_analyzer] parse error, falling back: %s", exc)

    logger.warning("[ri/idea_analyzer] fell back to default extraction")
    return _fallback(idea)


# ── Helpers ────────────────────────────────────────────────────────────────────

def _parse(raw: dict, allowed_topics: list[str]) -> dict:
    seeds = []
    for item in raw.get("seed_requirements", []):
        topic = item.get("topic", "")
        # Validate topic against allowed list; clear if invalid
        if topic and topic not in allowed_topics:
            logger.debug("[ri/idea_analyzer] ignoring unknown topic %r from LLM", topic)
            topic = ""
        seeds.append(
            SeedRequirement(
                title=str(item.get("title", "Unnamed requirement"))[:256],
                description=str(item.get("description", "")),
                type=item.get("type", "feature") if item.get("type") in _VALID_TYPES else "feature",
                priority=item.get("priority", "medium") if item.get("priority") in _VALID_PRIORITIES else "medium",
                topic=topic,
                source="idea",
            )
        )
    return {
        "name": str(raw.get("name", "Unnamed Project"))[:128],
        "summary": str(raw.get("summary", "")),
        "seed_requirements": seeds,
    }


def _fallback(idea: str) -> dict:
    words = re.sub(r"[^\w\s]", "", idea).split()
    name = " ".join(w.capitalize() for w in words[:5]) or "Unnamed Project"
    return {
        "name": name,
        "summary": idea[:200],
        "seed_requirements": [],
    }
