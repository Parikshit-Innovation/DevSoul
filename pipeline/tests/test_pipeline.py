"""
DevSoul — Pipeline Integration Tests
=====================================

Tests the three-stage pipeline orchestration logic WITHOUT:
 - Real LLM API calls (uses RI mock mode)
 - Real AI subprocess (stubs writeArchitecture)
 - Real Agent Factory subprocess (uses a mocked pipeline-result.json)

All tests run offline. No API keys required.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest  # type: ignore
import yaml

# Add repo root to path for orchestrator imports
PIPELINE_DIR = Path(__file__).parent.parent.resolve()
REPO_ROOT    = PIPELINE_DIR.parent
RI_DIR       = REPO_ROOT / "requirement-intelligence"
sys.path.insert(0, str(PIPELINE_DIR))
sys.path.insert(0, str(RI_DIR))

from run_pipeline import (
    PipelineState,
    PipelineStatus,
    _adapt_ri_for_ai,
    _adapt_ai_for_factory,
    _atomic_write,
    _is_stop_request,
    run_requirement_intelligence,
)


# ─── Fixtures ─────────────────────────────────────────────────────────────────

SAMPLE_RI_REQS = {
    "requirements": [
        {
            "id": "REQ-001",
            "project_id": "test-uuid",
            "title": "Students can view events",
            "description": "A list of campus events is shown",
            "type": "feature",
            "priority": "high",
            "status": "draft",
            "acceptance_criteria": ["Display event title, date, venue"],
        },
        {
            "id": "REQ-002",
            "project_id": "test-uuid",
            "title": "Students can register for events",
            "description": "Registration with duplicate prevention",
            "type": "feature",
            "priority": "high",
            "status": "draft",
            "acceptance_criteria": ["Prevent duplicate registrations"],
        },
    ]
}

SAMPLE_AI_ARCH = {
    "project_id": "devos-demo",
    "architecture_summary": "A web app with React frontend and Node.js API.",
    "technology_stack": {"frontend": "React", "backend": "Node.js", "database": "PostgreSQL"},
    "components": [
        {"name": "frontend", "description": "Student-facing UI."},
        {"name": "backend", "description": "Event and registration API."},
        {"name": "database", "description": "Stores users, events, and registrations."},
    ],
    "design_constraints": ["Prevent duplicate registrations."],
    "project_files": ["src/frontend/", "src/backend/", "database/"],
}


# ─── A. Schema adapter tests ───────────────────────────────────────────────────

class TestAdaptRiForAi:
    def test_converts_requirements_to_ai_format(self):
        result = _adapt_ri_for_ai(SAMPLE_RI_REQS, "Campus Events")
        assert result["project"] == "Campus Events"
        assert len(result["requirements"]) == 2
        assert result["requirements"][0]["id"] == "REQ-001"

    def test_merges_title_and_acceptance_criteria_into_text(self):
        result = _adapt_ri_for_ai(SAMPLE_RI_REQS, "Campus Events")
        text = result["requirements"][0]["text"]
        assert "Students can view events" in text
        assert "Display event title" in text

    def test_maps_type_to_category(self):
        result = _adapt_ri_for_ai(SAMPLE_RI_REQS, "Campus Events")
        assert result["requirements"][0]["category"] == "feature"

    def test_empty_requirements_list(self):
        result = _adapt_ri_for_ai({"requirements": []}, "Empty Project")
        assert result["requirements"] == []
        assert result["project"] == "Empty Project"


class TestAdaptAiForFactory:
    def test_builds_factory_ri_input(self):
        factory_ri, factory_ai = _adapt_ai_for_factory(
            SAMPLE_AI_ARCH, SAMPLE_RI_REQS, "devos-demo", "Campus Events", "A campus app"
        )
        assert factory_ri["project_id"] == "devos-demo"
        assert factory_ri["project_name"] == "Campus Events"
        assert len(factory_ri["requirements"]) == 2
        assert factory_ri["constraints"]["max_agents"] == 5
        assert "read_file" in factory_ri["constraints"]["allowed_tools"]

    def test_builds_factory_ai_input(self):
        factory_ri, factory_ai = _adapt_ai_for_factory(
            SAMPLE_AI_ARCH, SAMPLE_RI_REQS, "devos-demo", "Campus Events", "A campus app"
        )
        assert factory_ai["project_id"] == "devos-demo"
        assert factory_ai["architecture_summary"] != ""
        assert len(factory_ai["components"]) == 3
        assert factory_ai["technology_stack"]["frontend"] == "React"

    def test_no_secrets_in_factory_inputs(self):
        factory_ri, factory_ai = _adapt_ai_for_factory(
            SAMPLE_AI_ARCH, SAMPLE_RI_REQS, "devos-demo", "Campus Events", "A campus app"
        )
        combined = json.dumps(factory_ri) + json.dumps(factory_ai)
        assert "api_key" not in combined.lower()
        assert "secret" not in combined.lower()


# ─── B. Cancellation detection tests ──────────────────────────────────────────

class TestCancellationDetection:
    @pytest.mark.parametrize("phrase", [
        "stop", "done", "quit", "exit", "cancel",
        "STOP", "Done", "CANCEL THE PIPELINE",
        "stop here", "that's enough", "finish with what we have",
    ])
    def test_stop_phrases_are_detected(self, phrase):
        assert _is_stop_request(phrase), f"Expected '{phrase}' to be a stop request"

    @pytest.mark.parametrize("non_stop", [
        "stop duplicate registrations",
        "done button required",
        "stop loading spinner",
        "React",
        "Node.js",
        "yes",
        "no",
        "1",
        "College email domain check",
    ])
    def test_project_instructions_are_not_stop_requests(self, non_stop):
        assert not _is_stop_request(non_stop), f"Expected '{non_stop}' NOT to be a stop request"


# ─── C. Atomic write test ─────────────────────────────────────────────────────

class TestAtomicWrite:
    def test_atomic_write_creates_file(self, tmp_path):
        target = tmp_path / "subdir" / "test.yaml"
        _atomic_write(target, "hello: world\n")
        assert target.exists()
        assert target.read_text() == "hello: world\n"

    def test_atomic_write_replaces_existing(self, tmp_path):
        target = tmp_path / "test.yaml"
        target.write_text("old content")
        _atomic_write(target, "new content")
        assert target.read_text() == "new content"

    def test_no_tmp_file_left_behind(self, tmp_path):
        target = tmp_path / "test.yaml"
        _atomic_write(target, "data")
        tmp_files = list(tmp_path.glob(".tmp_*"))
        assert len(tmp_files) == 0, f"Temp file left behind: {tmp_files}"


# ─── D. RI integration test (mock mode, offline) ─────────────────────────────

class TestRequirementIntelligence:
    def test_ri_runs_in_mock_mode_and_writes_outputs(self, tmp_path):
        """Full RI run in mock mode — no LLM, no API key needed."""
        state = PipelineState(
            idea="Build a campus event management web app for students.",
            out_dir=tmp_path,
            task="Implement campus events.",
        )

        # Run RI — mock=True means it auto-answers questions
        ok = run_requirement_intelligence(state, mock=True, auto_answer=True)

        assert ok is True, f"RI failed with state: {state.error}"
        assert (tmp_path / "requirements.yaml").exists(), "requirements.yaml not written"
        assert (tmp_path / "project.yaml").exists(), "project.yaml not written"

        # Validate YAML is parseable
        with open(tmp_path / "requirements.yaml", "r") as f:
            data = yaml.safe_load(f)
        assert "requirements" in data
        assert len(data["requirements"]) > 0

    def test_ri_sets_project_id_in_state(self, tmp_path):
        state = PipelineState(
            idea="Build a task management app.",
            out_dir=tmp_path,
            task="Implement tasks.",
        )
        ok = run_requirement_intelligence(state, mock=True, auto_answer=True)
        assert ok is True
        assert state.ri_result.get("project_id") is not None
        assert state.ri_result.get("project_name") is not None

    def test_ri_result_has_no_secrets(self, tmp_path):
        state = PipelineState(
            idea="Build an e-commerce platform.",
            out_dir=tmp_path,
            task="Implement e-commerce.",
        )
        run_requirement_intelligence(state, mock=True, auto_answer=True)
        result_str = json.dumps(state.ri_result)
        assert "api_key" not in result_str.lower()
        assert "gemini_api_key" not in result_str.lower()


# ─── E. Pipeline state tests ──────────────────────────────────────────────────

class TestPipelineState:
    def test_initial_status_is_running(self, tmp_path):
        state = PipelineState(idea="Test idea", out_dir=tmp_path, task="Test task")
        assert state.status == PipelineStatus.RUNNING

    def test_pipeline_id_is_set(self, tmp_path):
        state = PipelineState(idea="Test idea", out_dir=tmp_path, task="Test task")
        assert state.pipeline_id.startswith("pipe-")

    def test_started_at_is_iso_format(self, tmp_path):
        from datetime import datetime
        state = PipelineState(idea="Test idea", out_dir=tmp_path, task="Test task")
        # Should parse without error
        datetime.fromisoformat(state.started_at)
