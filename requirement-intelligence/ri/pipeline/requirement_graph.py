"""Stage 4 – Requirement Graph (Logic).

Builds a dependency graph (DAG) from the template node definitions.
Marks nodes as answered when seeds or user answers cover them.
Ensures dependency ordering: a child is never surfaced before its parent is answered.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class GraphNode:
    node_id: str
    weight: int = 5
    depends_on: list[str] = field(default_factory=list)
    default_options: list[str] = field(default_factory=list)
    question: str = ""
    required: bool = True
    answered: bool = False
    value: str = ""
    source: str = ""   # "idea" | "interview"
    round: int = 0
    question_asked: str = ""
    raw_answer: str = ""
    confidence: float = 1.0
    model: str = ""

    def to_dict(self) -> dict:
        return {
            "node_id": self.node_id,
            "weight": self.weight,
            "depends_on": self.depends_on,
            "default_options": self.default_options,
            "question": self.question,
            "required": self.required,
            "answered": self.answered,
            "value": self.value,
            "source": self.source,
            "round": self.round,
            "question_asked": self.question_asked,
            "raw_answer": self.raw_answer,
            "confidence": self.confidence,
            "model": self.model,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "GraphNode":
        return cls(**{k: v for k, v in d.items() if k in cls.__dataclass_fields__})  # type: ignore[attr-defined]


class RequirementGraph:
    """DAG of interview topics."""

    def __init__(self, nodes_data: dict[str, Any]) -> None:
        self._nodes: dict[str, GraphNode] = {}
        for node_id, data in nodes_data.items():
            self._nodes[node_id] = GraphNode(
                node_id=node_id,
                weight=int(data.get("weight", 5)),
                depends_on=list(data.get("depends_on", [])),
                default_options=list(data.get("default_options", [])),
                question=str(data.get("question", f"Tell us about {node_id}")),
                required=bool(data.get("required", True)),
            )

    # ── Public API ─────────────────────────────────────────────────────────────

    def all_node_ids(self) -> list[str]:
        return list(self._nodes.keys())

    def mark_answered(
        self,
        node_id: str,
        value: str,
        source: str = "interview",
        round_num: int = 0,
        question_asked: str = "",
        raw_answer: str = "",
        confidence: float = 1.0,
        model: str = "",
    ) -> None:
        if node_id in self._nodes:
            node = self._nodes[node_id]
            node.answered = True
            node.value = value
            node.source = source
            node.round = round_num
            node.question_asked = question_asked
            node.raw_answer = raw_answer
            node.confidence = confidence
            node.model = model

    def get_node(self, node_id: str) -> GraphNode | None:
        return self._nodes.get(node_id)

    def unanswered_nodes(self) -> list[GraphNode]:
        """Return required, unanswered nodes whose dependencies are all answered."""
        answered_ids = {n.node_id for n in self._nodes.values() if n.answered}
        result = []
        for node in self._nodes.values():
            if node.required and not node.answered:
                deps_met = all(dep in answered_ids for dep in node.depends_on)
                if deps_met:
                    result.append(node)
        return result

    def is_complete(self) -> bool:
        return all(n.answered for n in self._nodes.values() if n.required)

    def completeness_pct(self) -> int:
        required = [n for n in self._nodes.values() if n.required]
        if not required:
            return 100
        answered = sum(1 for n in required if n.answered)
        return round(answered / len(required) * 100)

    def total_required(self) -> int:
        return sum(1 for n in self._nodes.values() if n.required)

    def total_answered(self) -> int:
        return sum(1 for n in self._nodes.values() if n.answered)

    def to_dict(self) -> dict:
        return {nid: node.to_dict() for nid, node in self._nodes.items()}

    @classmethod
    def from_dict(cls, data: dict) -> "RequirementGraph":
        g = cls({})
        for nid, nd in data.items():
            g._nodes[nid] = GraphNode.from_dict(nd)
        return g

    def open_gaps(self) -> list[str]:
        return [n.node_id for n in self._nodes.values() if n.required and not n.answered]

    def decisions(self) -> dict[str, dict]:
        """Return answered nodes as {node_id: {answer, source}} for project.yaml."""
        return {
            n.node_id: {"answer": n.value, "source": n.source}
            for n in self._nodes.values()
            if n.answered
        }
