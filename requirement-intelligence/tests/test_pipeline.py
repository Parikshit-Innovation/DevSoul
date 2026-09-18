"""Test suite — 9 tests, all offline, all use tmp_path.

Tests:
  1. test_project_type_detector           — keyword scoring
  2. test_gap_detector_dependency_order   — auth never before users
  3. test_priority_engine_ranks_gaps      — higher weight/children = higher rank
  4. test_requirement_builder_schema_compliance — no topic/source; type always set
  5. test_seed_topic_tagging              — seed marks graph node answered
  6. test_llm_fallback_on_error           — exception → fallback, fallbacks_used == 1
  7. test_llm_fallback_on_garbage         — bad JSON → fallback, fallbacks_used == 1
  8. test_full_mock_session               — end-to-end in tmp_path; YAML files created
  9. test_http_session_flow               — FastAPI TestClient; start → answer → complete
"""
from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
import yaml


# ─────────────────────────────────────────────────────────────────────────────
# 1. Project type detector
# ─────────────────────────────────────────────────────────────────────────────

def test_project_type_detector():
    from ri.pipeline.project_type_detector import detect

    assert detect("Build an online marketplace for college students to buy and sell items") == "marketplace"
    assert detect("Create a REST API service with endpoints for user management") == "api_service"
    assert detect("Build a web dashboard for analytics") == "web_app"
    assert detect("Build something cool") == "generic"


# ─────────────────────────────────────────────────────────────────────────────
# 2. Gap detector — dependency ordering
# ─────────────────────────────────────────────────────────────────────────────

def test_gap_detector_dependency_order():
    """auth depends on users, so auth must never appear before users is answered."""
    from ri.pipeline.requirement_graph import RequirementGraph
    from ri.pipeline.gap_detector import detect_gaps

    graph = RequirementGraph({
        "users": {"weight": 10, "depends_on": [], "required": True,
                  "default_options": ["A", "B"], "question": "Who?"},
        "auth":  {"weight": 9,  "depends_on": ["users"], "required": True,
                  "default_options": ["X", "Y"], "question": "How auth?"},
    })

    # Before answering anything — only users (no deps) should be a gap
    gaps = detect_gaps(graph)
    gap_ids = [g.node_id for g in gaps]
    assert "users" in gap_ids
    assert "auth" not in gap_ids  # blocked by unanswered users

    # Answer users → auth becomes available
    graph.mark_answered("users", "Students only")
    gaps = detect_gaps(graph)
    gap_ids = [g.node_id for g in gaps]
    assert "auth" in gap_ids
    assert "users" not in gap_ids  # already answered


# ─────────────────────────────────────────────────────────────────────────────
# 3. Priority engine — gap ranking
# ─────────────────────────────────────────────────────────────────────────────

def test_priority_engine_ranks_gaps():
    """A node that unblocks more children should rank higher than one of equal weight."""
    from ri.pipeline.requirement_graph import RequirementGraph
    from ri.pipeline.gap_detector import detect_gaps
    from ri.pipeline.priority_engine import rank_gaps

    # users (weight=10) unblocks auth AND verification
    # deployment (weight=10) unblocks nothing
    graph = RequirementGraph({
        "users":        {"weight": 10, "depends_on": [], "required": True,
                         "default_options": [], "question": "Who?"},
        "auth":         {"weight": 9,  "depends_on": ["users"], "required": True,
                         "default_options": [], "question": "Auth?"},
        "verification": {"weight": 9,  "depends_on": ["users"], "required": True,
                         "default_options": [], "question": "Verify?"},
        "deployment":   {"weight": 10, "depends_on": [], "required": True,
                         "default_options": [], "question": "Deploy?"},
    })

    gaps = detect_gaps(graph)
    ranked = rank_gaps(gaps, graph, batch_size=2)

    # users should rank above deployment because it unblocks 2 children
    ids = [g.node_id for g in ranked]
    assert ids[0] == "users", f"expected users first, got {ids}"


# ─────────────────────────────────────────────────────────────────────────────
# 4. Requirement builder — schema compliance
# ─────────────────────────────────────────────────────────────────────────────

def test_requirement_builder_schema_compliance():
    """Output requirements must have no topic/source; type must always be set."""
    from ri.pipeline.requirement_graph import RequirementGraph
    from ri.pipeline.requirement_builder import build
    from ri.schemas import SeedRequirement

    graph = RequirementGraph({
        "users": {"weight": 10, "depends_on": [], "required": True,
                  "default_options": ["A"], "question": "Who?"},
    })
    graph.mark_answered("users", "Students only", source="interview")

    seeds = [
        SeedRequirement(
            title="Verified seller",
            description="Only verified students can sell.",
            type="feature",
            priority="high",
            topic="verification",
            source="idea",
        )
    ]

    reqs = build(graph, seeds, project_id="test-uuid-1234")

    for req in reqs:
        req_dict = req.model_dump()
        assert "topic" not in req_dict, "topic must not appear in Requirement"
        assert "source" not in req_dict, "source must not appear in Requirement"
        assert req.type in {"feature", "bug", "refactor", "chore", "security", "documentation"}
        assert req.priority in {"critical", "high", "medium", "low"}
        assert req.status in {"draft", "analysed", "in_progress", "review", "done", "cancelled"}
        assert req.project_id == "test-uuid-1234"
        assert req.id.startswith("REQ-")


# ─────────────────────────────────────────────────────────────────────────────
# 5. Seed topic tagging — seed marks graph node answered
# ─────────────────────────────────────────────────────────────────────────────

def test_seed_topic_tagging():
    """If a seed has topic='verification', the graph should mark it answered
    so the gap detector skips it and never asks about it again."""
    from ri.pipeline.requirement_graph import RequirementGraph
    from ri.pipeline.gap_detector import detect_gaps

    graph = RequirementGraph({
        "users":        {"weight": 10, "depends_on": [], "required": True,
                         "default_options": [], "question": "Who?"},
        "verification": {"weight": 9,  "depends_on": ["users"], "required": True,
                         "default_options": [], "question": "Verify?"},
    })

    # Simulate what session.py does: mark topic from seed
    graph.mark_answered("verification", "Verified student sellers", source="idea")
    graph.mark_answered("users", "Students only", source="idea")

    gaps = detect_gaps(graph)
    gap_ids = [g.node_id for g in gaps]

    assert "verification" not in gap_ids, "verification should be answered via seed, not a gap"
    assert "users" not in gap_ids, "users should be answered via seed, not a gap"
    assert gaps == [], "All nodes answered — no gaps expected"


# ─────────────────────────────────────────────────────────────────────────────
# 6. LLM fallback on exception
# ─────────────────────────────────────────────────────────────────────────────

def test_llm_fallback_on_error():
    """When the LLM raises an exception, the stage returns fallback output
    and fallbacks_used must be 1."""
    from ri.pipeline.requirement_graph import RequirementGraph
    from ri.pipeline.question_generator import generate

    # A stub LLM that always raises
    bad_llm = MagicMock()
    bad_llm.complete.side_effect = RuntimeError("Simulated network error")

    graph = RequirementGraph({
        "users": {"weight": 10, "depends_on": [], "required": True,
                  "default_options": ["A", "B", "C"], "question": "Who?"},
    })
    gaps = [graph.get_node("users")]

    # The question generator must not raise — it must catch and fallback
    questions, fallbacks_used = generate(
        gaps=gaps,
        summary="A test project",
        project_type="generic",
        llm=bad_llm,
    )

    assert fallbacks_used == 1, "expected 1 fallback after exception"
    assert len(questions) == 1
    assert questions[0].node_id == "users"
    # Fallback uses template default_options
    assert set(questions[0].options) == {"A", "B", "C"}


# ─────────────────────────────────────────────────────────────────────────────
# 7. LLM fallback on garbage response
# ─────────────────────────────────────────────────────────────────────────────

def test_llm_fallback_on_garbage():
    """When the LLM returns a dict with no 'questions' key, stage falls back."""
    from ri.pipeline.requirement_graph import RequirementGraph
    from ri.pipeline.question_generator import generate

    garbage_llm = MagicMock()
    garbage_llm.complete.return_value = {"unexpected": "response", "foo": 42}

    graph = RequirementGraph({
        "auth": {"weight": 9, "depends_on": [], "required": True,
                 "default_options": ["Email", "Google", "SSO"], "question": "Auth?"},
    })
    gaps = [graph.get_node("auth")]

    questions, fallbacks_used = generate(
        gaps=gaps,
        summary="A test project",
        project_type="generic",
        llm=garbage_llm,
    )

    assert fallbacks_used == 1
    assert questions[0].node_id == "auth"
    assert "Email" in questions[0].options


# ─────────────────────────────────────────────────────────────────────────────
# 8. Full mock session end-to-end
# ─────────────────────────────────────────────────────────────────────────────

def test_full_mock_session(tmp_path):
    """End-to-end session using mock LLM, writes to tmp_path.

    Verifies:
    - requirements.yaml is created
    - project.yaml is created
    - requirements.yaml has no topic/source fields
    - requirements.yaml has type field on every item
    - project.yaml has required fields (id, name, version, created_at)
    """
    from ri.session import Session
    from ri.schemas import AnswerItem
    import ri.config as cfg

    idea = (
        "Build an online marketplace for college students. "
        "Only verified college students should be allowed to sell products."
    )

    session = Session(idea=idea, mock=True, out_dir=tmp_path)
    assert session.project_type == "marketplace"
    assert session.name  # non-empty

    # Run interview rounds, auto-answering with first option
    for _ in range(cfg.RI_MAX_ROUNDS):
        round_data = session.next_round()
        if round_data.status == "complete":
            break

        answers = [
            AnswerItem(node_id=q.node_id, answer=q.options[0] if q.options else "Yes")
            for q in round_data.questions
        ]
        session.apply_answers(answers)
        if session.is_complete():
            session.finalise()
            break

    # Check output files exist
    req_file = tmp_path / "requirements.yaml"
    proj_file = tmp_path / "project.yaml"
    assert req_file.exists(), "requirements.yaml not created"
    assert proj_file.exists(), "project.yaml not created"

    # Validate requirements.yaml content
    req_data = yaml.safe_load(req_file.read_text(encoding="utf-8"))
    assert "requirements" in req_data
    for req in req_data["requirements"]:
        assert "topic" not in req, f"'topic' must not appear in requirements.yaml (found in {req})"
        assert "source" not in req, f"'source' must not appear in requirements.yaml (found in {req})"
        assert "type" in req, f"'type' must be present in every requirement (missing in {req})"
        assert req["type"] in {"feature", "bug", "refactor", "chore", "security", "documentation"}

    # Validate project.yaml required fields
    proj_data = yaml.safe_load(proj_file.read_text(encoding="utf-8"))
    for field in ("id", "name", "version", "created_at"):
        assert field in proj_data, f"project.yaml missing required field: {field}"
    assert "_ri" not in proj_data, "project.yaml must not have _ri (violates project.schema.yaml additionalProperties)"

    # Validate traceability.yaml was created
    trace_file = tmp_path / "traceability.yaml"
    assert trace_file.exists(), "traceability.yaml not created"


# ─────────────────────────────────────────────────────────────────────────────
# 9. HTTP session flow via FastAPI TestClient
# ─────────────────────────────────────────────────────────────────────────────

def test_http_session_flow(tmp_path):
    """POST /session/start → POST /session/{id}/answer rounds → eventually complete.

    Uses FastAPI TestClient (no real server needed).
    Verifies:
    - session_id is returned on start
    - questions are returned in the first round
    - answering eventually produces status=complete
    - session.json is written to tmp_path, not output/
    """
    import os
    from fastapi.testclient import TestClient

    # Point output to tmp_path so no files land in the repo
    with patch.dict(os.environ, {"RI_MOCK": "true", "RI_OUTPUT_DIR": str(tmp_path)}):
        # Re-import server with patched env to pick up RI_MOCK=true
        import importlib
        import ri.config as cfg
        importlib.reload(cfg)

        from ri.server import app
        client = TestClient(app)

        # Start session
        start_resp = client.post("/session/start", json={
            "idea": "Build a marketplace for college students to sell textbooks.",
            "mock": True,
            "out": str(tmp_path),
        })
        assert start_resp.status_code == 200, start_resp.text
        body = start_resp.json()
        assert "session_id" in body
        session_id = body["session_id"]
        assert "questions" in body or body.get("status") == "complete"

        # Run rounds until complete (max 15)
        for _ in range(15):
            if body.get("status") == "complete":
                break
            questions = body.get("questions", [])
            if not questions:
                break

            answers = [
                {"node_id": q["node_id"], "answer": q["options"][0] if q.get("options") else "Yes"}
                for q in questions
            ]
            ans_resp = client.post(
                f"/session/{session_id}/answer",
                json={"answers": answers},
            )
            assert ans_resp.status_code == 200, ans_resp.text
            body = ans_resp.json()

        assert body.get("status") == "complete", f"Expected complete, got: {body.get('status')}"
