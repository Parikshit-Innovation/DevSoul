"""Stage 7 – Question Generator (LLM).

Turns the top-ranked open gaps into a structured question round for the user.

Fallback (LLM fails): builds questions directly from node.default_options.
"""
from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from ri.pipeline.requirement_graph import GraphNode
from ri.schemas import Question

if TYPE_CHECKING:
    from ri.llm.base import BaseLLM

logger = logging.getLogger(__name__)

_VALID_KEYS = {"node_id", "question", "options", "allow_free_text"}


def generate(
    gaps: list[GraphNode],
    summary: str,
    project_type: str,
    llm: "BaseLLM",
) -> tuple[list[Question], int]:
    """Generate interview questions for the given gap nodes.

    Returns:
        (questions, fallbacks_used)
    """
    from ri.llm.prompts import QUESTION_GEN_PROMPT

    gap_descriptions = "\n".join(
        f"- {g.node_id}: {g.question} (weight={g.weight})" for g in gaps
    )

    prompt = QUESTION_GEN_PROMPT.format(
        summary=summary,
        project_type=project_type,
        open_gaps=gap_descriptions,
    )

    try:
        raw = llm.complete(prompt, schema={}, task="question_gen")
    except Exception as exc:
        logger.warning("[ri/question_generator] LLM raised exception, falling back: %s", exc)
        return _fallback(gaps), 1

    if raw and isinstance(raw, dict):
        q_list = raw.get("questions") or [raw]
        parsed, ok = _parse(q_list, gaps)
        if ok:
            return parsed, 0
    elif raw and isinstance(raw, list):
        parsed, ok = _parse(raw, gaps)
        if ok:
            return parsed, 0

    logger.warning("[ri/question_generator] fell back to template defaults. LLM output: %s", raw)
    return _fallback(gaps), 1


# ── Helpers ────────────────────────────────────────────────────────────────────

def _parse(raw_questions: list, gaps: list[GraphNode]) -> tuple[list[Question], bool]:
    valid_node_ids = {g.node_id for g in gaps}
    questions = []

    for item in raw_questions:
        if not isinstance(item, dict):
            return [], False
        node_id = item.get("node_id", "")
        # Reject if node_id not in our gap list (LLM hallucinated a topic)
        if node_id not in valid_node_ids:
            logger.warning("[ri/question_generator] LLM returned unknown node_id %r, skipping. Valid: %s", node_id, valid_node_ids)
            continue
        options = item.get("options", [])
        if not isinstance(options, list) or len(options) < 2:
            return [], False
        questions.append(
            Question(
                node_id=node_id,
                question=str(item.get("question", f"Tell us about {node_id}"))[:200],
                options=[str(o)[:100] for o in options[:6]],
                allow_free_text=bool(item.get("allow_free_text", True)),
            )
        )

    return questions, bool(questions)


def _fallback(gaps: list[GraphNode]) -> list[Question]:
    return [
        Question(
            node_id=g.node_id,
            question=g.question,
            options=g.default_options or ["Yes", "No", "Undecided"],
            allow_free_text=True,
        )
        for g in gaps
    ]
