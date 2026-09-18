"""Stage 9b – Derived Requirements Rule Engine (Logic).

Applies deterministic rules from templates/rules.yaml to answered topics,
generating essential security, privacy, compliance, and performance requirements.
"""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Any
import yaml

from ri.schemas import Requirement

logger = logging.getLogger(__name__)

_RULES_FILE = Path(__file__).resolve().parent.parent.parent / "templates" / "rules.yaml"
_CACHED_RULES: list[dict[str, Any]] | None = None


def load_rules() -> list[dict[str, Any]]:
    """Load and cache rules from templates/rules.yaml."""
    global _CACHED_RULES
    if _CACHED_RULES is not None:
        return _CACHED_RULES

    if not _RULES_FILE.exists():
        logger.warning("[ri/rule_engine] rules file not found: %s", _RULES_FILE)
        _CACHED_RULES = []
        return _CACHED_RULES

    try:
        data = yaml.safe_load(_RULES_FILE.read_text(encoding="utf-8")) or {}
        _CACHED_RULES = data.get("rules", [])
        return _CACHED_RULES
    except Exception as exc:
        logger.error("[ri/rule_engine] failed loading %s: %s", _RULES_FILE, exc)
        return []


def evaluate_rules(
    answered_topics: dict[str, str],
    project_id: str,
    start_counter: int = 100,
    existing_titles: set[str] | None = None,
) -> list[Requirement]:
    """Evaluate rules against answered topic values.

    Args:
        answered_topics: Mapping of topic_id -> answer_value.
        project_id:      Project UUID.
        start_counter:   Sequential ID counter starting point.
        existing_titles: Set of requirement titles to deduplicate against.

    Returns:
        List of derived Requirement objects with schema-compliant types.
    """
    rules = load_rules()
    seen_titles = set(t.lower() for t in (existing_titles or set()))
    derived: list[Requirement] = []
    counter = start_counter

    for r in rules:
        cond = r.get("condition", {})
        topic = cond.get("topic")
        matches = cond.get("matches", [])
        req_spec = r.get("requirement", {})

        if not topic or topic not in answered_topics:
            continue

        ans_lower = str(answered_topics[topic]).lower()
        matched = any(m.lower() in ans_lower for m in matches)
        if not matched:
            continue

        title = req_spec.get("title", "")
        if not title or title.lower() in seen_titles:
            continue
        seen_titles.add(title.lower())

        req = Requirement(
            id=f"REQ-{counter:03d}",
            project_id=project_id,
            title=title[:256],
            description=req_spec.get("description", ""),
            type=req_spec.get("type", "chore"),
            priority=req_spec.get("priority", "medium"),
            status="draft",
        )
        req._trace_info = {
            "topic": topic,
            "source": "rule_engine",
            "round": 0,
            "question_asked": None,
            "raw_answer": f"Triggered by rule '{r.get('id')}' matching '{answered_topics[topic]}'",
            "confidence": 1.0,
            "model": "logic_rules",
        }
        derived.append(req)
        counter += 1

    return derived
