"""Pydantic data contracts for the Requirement Intelligence pipeline.

These models are used internally; the final output is validated against
shared/schemas/requirements.schema.yaml before being written to disk.

NOTE: The shared schema has `additionalProperties: false`.
      Fields `topic` and `source` are NOT allowed in requirements.yaml.
      They are stored in project.yaml under `_ri.decisions[topic]`.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal, Optional

from pydantic import BaseModel, Field, PrivateAttr


# ── Requirement (matches shared/schemas/requirements.schema.yaml) ─────────────

RequirementType = Literal["feature", "bug", "refactor", "chore", "security", "documentation"]
RequirementPriority = Literal["critical", "high", "medium", "low"]
RequirementStatus = Literal["draft", "analysed", "in_progress", "review", "done", "cancelled"]


class Requirement(BaseModel):
    """Conforms exactly to shared/schemas/requirements.schema.yaml.

    WARNING: Do not add fields not in that schema — it uses additionalProperties: false.
    """
    id: str                                          # REQ-001 … REQ-NNN (RI sequential)
    project_id: str                                  # UUID of the session
    title: str = Field(min_length=1, max_length=256)
    description: str = ""
    type: RequirementType = "feature"
    priority: RequirementPriority = "medium"
    status: RequirementStatus = "draft"
    acceptance_criteria: list[str] = Field(default_factory=list)
    linked_files: list[str] = Field(default_factory=list)
    agent_assignments: list[str] = Field(default_factory=list)
    created_at: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )
    updated_at: Optional[str] = None
    _trace_info: dict = PrivateAttr(default_factory=dict)


# ── Question ──────────────────────────────────────────────────────────────────

class Question(BaseModel):
    node_id: str
    question: str
    options: list[str]
    allow_free_text: bool = True


# ── Round (what the extension / CLI renders) ──────────────────────────────────

class ProgressInfo(BaseModel):
    answered: int
    total: int


class Round(BaseModel):
    status: Literal["questions", "complete"]
    round: int
    project_type: str
    schema_version: str = "1.0"
    progress: ProgressInfo
    fallbacks_used: int = 0       # count of LLM stages that used fallback this round
    questions: list[Question] = Field(default_factory=list)


# ── Answer ────────────────────────────────────────────────────────────────────

class AnswerItem(BaseModel):
    node_id: str
    answer: str


class AnswerPayload(BaseModel):
    answers: list[AnswerItem]


# ── Seed requirement (internal, from idea_analyzer) ───────────────────────────

class SeedRequirement(BaseModel):
    """Internal only — topic/source live here then get moved to project.yaml decisions."""
    title: str
    description: str
    type: RequirementType = "feature"
    priority: RequirementPriority = "medium"
    topic: str = ""       # graph node_id this seed answers; "" = unknown
    source: str = "idea"  # always "idea" for seeds


# ── Decision (stored in project.yaml _ri.decisions) ──────────────────────────

class Decision(BaseModel):
    answer: str
    source: Literal["idea", "interview"] = "interview"


# ── Session state ─────────────────────────────────────────────────────────────

class SessionState(BaseModel):
    session_id: str
    project_id: str         # UUID — stamped on every Requirement
    idea: str
    name: str               # human-readable project name from idea_analyzer
    project_type: str
    graph: dict             # node_id → GraphNode dict (serialised)
    seeds: list[SeedRequirement] = Field(default_factory=list)
    requirements: list[Requirement] = Field(default_factory=list)
    decisions: dict[str, Decision] = Field(default_factory=dict)
    round_number: int = 0
    fallbacks_total: int = 0
    mock: bool = False
    out_dir: str = "output"
    completed: bool = False
