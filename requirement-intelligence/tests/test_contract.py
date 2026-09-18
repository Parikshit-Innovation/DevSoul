"""Contract test — validate generated artifacts against REAL shared schemas.

Fails loudly if ../shared/schemas/requirements.schema.yaml is missing.
"""
from __future__ import annotations

from pathlib import Path
import pytest
import yaml
import jsonschema


def test_contract_real_schemas(tmp_path):
    """Loads REAL shared schemas and validates generated requirements.yaml and project.yaml."""
    repo_root = Path(__file__).resolve().parent.parent.parent
    shared_schemas = repo_root / "shared" / "schemas"
    req_schema_path = shared_schemas / "requirements.schema.yaml"
    proj_schema_path = shared_schemas / "project.schema.yaml"

    # Must fail loudly if the file is missing
    assert req_schema_path.exists(), f"CRITICAL: Schema file not found: {req_schema_path}"
    assert proj_schema_path.exists(), f"CRITICAL: Schema file not found: {proj_schema_path}"

    req_schema = yaml.safe_load(req_schema_path.read_text(encoding="utf-8"))
    proj_schema = yaml.safe_load(proj_schema_path.read_text(encoding="utf-8"))

    from ri.session import Session
    from ri.schemas import AnswerItem
    import ri.config as cfg

    idea = (
        "Build a peer-to-peer textbook marketplace for college students. "
        "Only verified university students should be allowed to list books."
    )
    session = Session(idea=idea, mock=True, out_dir=tmp_path)

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

    # 1. Validate requirements.yaml
    req_file = tmp_path / "requirements.yaml"
    assert req_file.exists(), f"Missing requirements.yaml at {req_file}"
    req_doc = yaml.safe_load(req_file.read_text(encoding="utf-8"))
    assert "requirements" in req_doc
    assert len(req_doc["requirements"]) > 0, "No requirements generated"

    for req in req_doc["requirements"]:
        jsonschema.validate(instance=req, schema=req_schema)

    # 2. Validate project.yaml
    proj_file = tmp_path / "project.yaml"
    assert proj_file.exists(), f"Missing project.yaml at {proj_file}"
    proj_doc = yaml.safe_load(proj_file.read_text(encoding="utf-8"))
    jsonschema.validate(instance=proj_doc, schema=proj_schema)

    # 3. Validate traceability.yaml exists and tracks each REQ
    trace_file = tmp_path / "traceability.yaml"
    assert trace_file.exists(), f"Missing traceability.yaml at {trace_file}"
    trace_doc = yaml.safe_load(trace_file.read_text(encoding="utf-8"))
    assert "traceability" in trace_doc
    assert len(trace_doc["traceability"]) == len(req_doc["requirements"])
