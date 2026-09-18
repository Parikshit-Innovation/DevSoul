"""Stage 8 – Answer Extractor (LLM).

Parses a user's raw text answer into a structured AnswerItem.

Fallback (LLM fails or confidence < 0.4): treats raw answer as value,
or uses the first default option if answer is empty.
"""
from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from ri.pipeline.requirement_graph import GraphNode
from ri.schemas import AnswerItem

if TYPE_CHECKING:
    from ri.llm.base import BaseLLM

logger = logging.getLogger(__name__)


def extract(
    node: GraphNode,
    raw_answer: str,
    llm: "BaseLLM",
) -> tuple[AnswerItem, int]:
    """Extract a structured answer from raw user input.

    Returns:
        (AnswerItem, fallbacks_used)
    """
    from ri.llm.prompts import ANSWER_EXTRACT_PROMPT

    if not raw_answer.strip():
        # Empty answer → use first default option
        default = node.default_options[0] if node.default_options else "Undecided"
        return AnswerItem(node_id=node.node_id, answer=default), 0

    prompt = ANSWER_EXTRACT_PROMPT.format(
        node_id=node.node_id,
        question=node.question,
        options=", ".join(node.default_options),
        raw_answer=raw_answer,
    )

    raw = llm.complete(prompt, schema={}, task="answer_extract")

    if raw and isinstance(raw, dict) and "value" in raw and "node_id" in raw:
        confidence = float(raw.get("confidence", 1.0))
        if confidence >= 0.4:
            return AnswerItem(node_id=node.node_id, answer=str(raw["value"])[:200]), 0

        logger.debug(
            "[ri/answer_extractor] low confidence (%.2f) for node=%s, falling back",
            confidence, node.node_id,
        )

    logger.warning("[ri/answer_extractor] fell back for node=%s", node.node_id)
    # Fallback: use raw answer directly (trimmed to 200 chars)
    value = raw_answer.strip()[:200] or (node.default_options[0] if node.default_options else "Undecided")
    return AnswerItem(node_id=node.node_id, answer=value), 1
