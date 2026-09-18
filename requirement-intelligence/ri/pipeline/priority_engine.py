"""Stage 6 – Priority Engine (Logic).

Ranks open GAPS (not requirements) to decide which 2–4 questions to ask next.

Score = node.weight * (1 + number of unanswered children this node unblocks)

Higher score = ask first. This ensures foundational topics (users, auth) are
always asked before dependent topics (verification, payments).
"""
from __future__ import annotations

from ri.pipeline.requirement_graph import GraphNode, RequirementGraph

_DEFAULT_BATCH_SIZE = 3


def rank_gaps(gaps: list[GraphNode], graph: RequirementGraph, batch_size: int = _DEFAULT_BATCH_SIZE) -> list[GraphNode]:
    """Return the top `batch_size` gaps sorted by priority score.

    Args:
        gaps:       Open nodes from gap_detector (deps already satisfied).
        graph:      The full graph (to count children each node unblocks).
        batch_size: How many questions to ask per round.

    Returns:
        Sorted list, highest priority first, length <= batch_size.
    """
    all_nodes = {nid: graph.get_node(nid) for nid in graph.all_node_ids()}

    def _score(node: GraphNode) -> float:
        # Count how many currently-blocked nodes this node's answer would unblock
        unblocked = 0
        for candidate_id, candidate in all_nodes.items():
            if candidate is None or candidate.answered:
                continue
            if node.node_id in candidate.depends_on:
                unblocked += 1
        return node.weight * (1 + unblocked)

    ranked = sorted(gaps, key=_score, reverse=True)
    return ranked[:batch_size]
