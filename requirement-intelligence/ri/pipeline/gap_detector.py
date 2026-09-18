"""Stage 5 – Gap Detector (Logic).

Returns unanswered required nodes in dependency-safe order.
A node is "open" only when all its depends_on nodes are already answered.
"""
from __future__ import annotations

from ri.pipeline.requirement_graph import GraphNode, RequirementGraph


def detect_gaps(graph: RequirementGraph) -> list[GraphNode]:
    """Return unanswered required nodes whose dependencies are satisfied.

    The order is safe for the priority engine to rank — no node appears
    before its parent.
    """
    return graph.unanswered_nodes()


def is_complete(graph: RequirementGraph) -> bool:
    return graph.is_complete()
