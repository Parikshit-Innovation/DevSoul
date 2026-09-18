"""Session orchestrator — runs the full interview loop.

Flow per round:
  1. gap_detector  → open nodes (dep-safe)
  2. priority_engine → top N gaps
  3. question_generator (LLM) → Round JSON
  4. [caller renders questions]
  5. answer_extractor (LLM) per answer → updates graph
  6. repeat until complete or RI_MAX_ROUNDS hit

Final:
  requirement_builder → requirements.yaml
  write_outputs       → requirements.yaml + project.yaml + session.json
"""
from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import yaml

import ri.config as cfg
from ri.llm import get_llm
from ri.pipeline import (
    answer_extractor,
    gap_detector,
    idea_analyzer,
    priority_engine,
    project_type_detector,
    question_generator,
    requirement_builder,
    template_loader,
)
from ri.pipeline.requirement_graph import RequirementGraph
from ri.schemas import AnswerItem, Round, ProgressInfo, SessionState

logger = logging.getLogger(__name__)


class Session:
    """A single interview session."""

    def __init__(self, idea: str, mock: bool = False, out_dir: Path | None = None) -> None:
        # Guard input length
        if len(idea) > cfg.IDEA_MAX_CHARS:
            idea = idea[: cfg.IDEA_MAX_CHARS]
            logger.warning("[ri/session] idea truncated to %d chars", cfg.IDEA_MAX_CHARS)

        self.session_id = str(uuid.uuid4())
        self.project_id = str(uuid.uuid4())
        self.idea = idea
        self.mock = mock
        self.out_dir = out_dir or cfg.RI_OUTPUT_DIR
        self.round_number = 0
        self.fallbacks_total = 0
        self.completed = False

        self._llm = get_llm(mock=mock)

        # ── Stage 1: idea analysis ──────────────────────────────────────────
        template_kws = template_loader.list_template_keywords()
        detection = project_type_detector.detect(idea, template_keywords=template_kws)
        template = template_loader.load(
            detection.primary,
            secondary_types=detection.secondaries,
            needs_confirmation=detection.needs_confirmation,
        )

        analysis = idea_analyzer.analyze(
            idea=idea,
            llm=self._llm,
            allowed_topics=list(template["nodes"].keys()),
        )

        self.name: str = analysis["name"]
        self.summary: str = analysis["summary"]
        self.seeds = analysis["seed_requirements"]
        self.project_type = str(detection.primary)
        self.created_at = datetime.now(timezone.utc).isoformat()

        # ── Stage 2–4: build graph, mark seeds ─────────────────────────────
        self._graph = RequirementGraph(template["nodes"])
        for seed in self.seeds:
            if seed.topic and self._graph.get_node(seed.topic):
                self._graph.mark_answered(
                    seed.topic,
                    seed.title,
                    source="idea",
                    round_num=0,
                    raw_answer=seed.description,
                    confidence=1.0,
                    model="mock" if self.mock else cfg.GEMINI_MODEL,
                )

    # ── Public API ─────────────────────────────────────────────────────────────

    def next_round(self) -> Round:
        """Generate the next question round."""
        self.round_number += 1
        fallbacks = 0

        gaps = gap_detector.detect_gaps(self._graph)
        if not gaps or gap_detector.is_complete(self._graph):
            self.completed = True
            return self._complete_round()

        top_gaps = priority_engine.rank_gaps(gaps, self._graph)

        questions, fb = question_generator.generate(
            gaps=top_gaps,
            summary=self.summary,
            project_type=self.project_type,
            llm=self._llm,
        )
        fallbacks += fb
        self.fallbacks_total += fallbacks

        return Round(
            status="questions",
            round=self.round_number,
            project_type=self.project_type,
            progress=ProgressInfo(
                answered=self._graph.total_answered(),
                total=self._graph.total_required(),
            ),
            fallbacks_used=fallbacks,
            questions=questions,
        )

    def apply_answers(self, answers: list[AnswerItem]) -> int:
        """Apply user answers to the graph. Returns fallbacks_used."""
        fallbacks = 0
        for answer in answers:
            node = self._graph.get_node(answer.node_id)
            if node is None:
                logger.warning("[ri/session] unknown node_id in answer: %s", answer.node_id)
                continue

            # Use answer directly if it's a clean string; otherwise run extractor
            extracted, fb = answer_extractor.extract(
                node=node,
                raw_answer=answer.answer,
                llm=self._llm,
            )
            fallbacks += fb
            self._graph.mark_answered(
                extracted.node_id,
                extracted.answer,
                source="interview",
                round_num=self.round_number,
                question_asked=node.question,
                raw_answer=answer.answer,
                confidence=0.95,
                model="mock" if self.mock else cfg.GEMINI_MODEL,
            )

        self.fallbacks_total += fallbacks
        return fallbacks

    def is_complete(self) -> bool:
        return self.completed or self._graph.is_complete()

    def finalise(self) -> dict:
        """Build and write outputs. Returns summary dict."""
        requirements = requirement_builder.build(
            graph=self._graph,
            seeds=self.seeds,
            project_id=self.project_id,
            max_requirements=cfg.MAX_REQUIREMENTS,
        )

        out = Path(self.out_dir)
        out.mkdir(parents=True, exist_ok=True)

        _write_requirements_yaml(requirements, out)
        _write_project_yaml(self, out)
        _write_traceability_yaml(self, requirements, out)
        _write_session_json(self, requirements, out)

        return {
            "session_id": self.session_id,
            "requirements_count": len(requirements),
            "completeness": self._graph.completeness_pct(),
            "open_gaps": self._graph.open_gaps(),
            "fallbacks_used": self.fallbacks_total,
            "degraded": self.fallbacks_total > 0,
            "out_dir": str(out),
        }

    def snapshot(self) -> dict:
        """Current state dict (for GET /session/{id})."""
        return {
            "session_id": self.session_id,
            "project_id": self.project_id,
            "name": self.name,
            "project_type": self.project_type,
            "round_number": self.round_number,
            "completeness": self._graph.completeness_pct(),
            "open_gaps": self._graph.open_gaps(),
            "fallbacks_total": self.fallbacks_total,
            "fallbacks_used": self.fallbacks_total,
            "degraded": self.fallbacks_total > 0,
            "completed": self.is_complete(),
        }

    # ── Private ────────────────────────────────────────────────────────────────

    def _complete_round(self) -> Round:
        self.finalise()
        return Round(
            status="complete",
            round=self.round_number,
            project_type=self.project_type,
            progress=ProgressInfo(
                answered=self._graph.total_answered(),
                total=self._graph.total_required(),
            ),
            fallbacks_used=0,
            questions=[],
        )


# ── Output writers ─────────────────────────────────────────────────────────────

def _write_requirements_yaml(requirements, out: Path) -> None:
    from ri.utils import atomic_write_text
    data = {
        "requirements": [
            {k: v for k, v in req.model_dump().items() if v is not None and v != [] and v != ""}
            for req in requirements
        ]
    }
    atomic_write_text(
        out / "requirements.yaml",
        yaml.dump(data, default_flow_style=False, allow_unicode=True, sort_keys=False),
    )
    logger.info("[ri/session] wrote %s", out / "requirements.yaml")


def _write_project_yaml(session: Session, out: Path) -> None:
    from ri.utils import atomic_write_text
    data: dict[str, Any] = {
        "id": session.project_id,
        "name": session.name,
        "version": "0.1.0",
        "description": session.summary,
        "created_at": session.created_at,
    }
    atomic_write_text(
        out / "project.yaml",
        yaml.dump(data, default_flow_style=False, allow_unicode=True, sort_keys=False),
    )
    logger.info("[ri/session] wrote %s", out / "project.yaml")


def _write_traceability_yaml(session: Session, requirements, out: Path) -> None:
    from ri.utils import atomic_write_text
    import ri.config as cfg
    trace_items = []
    for req in requirements:
        meta = getattr(req, "_trace_info", {})
        trace_items.append({
            "id": req.id,
            "topic": meta.get("topic", "general"),
            "source": meta.get("source", "idea"),
            "round": meta.get("round", 0),
            "question_asked": meta.get("question_asked"),
            "raw_answer": meta.get("raw_answer", req.description),
            "confidence": meta.get("confidence", 1.0),
            "model": meta.get("model", "mock" if session.mock else cfg.GEMINI_MODEL),
        })
    data = {
        "project_id": session.project_id,
        "traceability": trace_items,
    }
    atomic_write_text(
        out / "traceability.yaml",
        yaml.dump(data, default_flow_style=False, allow_unicode=True, sort_keys=False),
    )
    logger.info("[ri/session] wrote %s", out / "traceability.yaml")


def _write_session_json(session: Session, requirements, out: Path) -> None:
    """Persist session for server reload survival."""
    from ri.utils import atomic_write_text
    data = {
        "session_id": session.session_id,
        "project_id": session.project_id,
        "idea": session.idea,
        "name": session.name,
        "project_type": session.project_type,
        "round_number": session.round_number,
        "fallbacks_total": session.fallbacks_total,
        "completed": session.is_complete(),
        "graph": session._graph.to_dict(),
        "requirements_count": len(requirements),
    }
    atomic_write_text(out / "session.json", json.dumps(data, indent=2))
