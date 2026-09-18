"""FastAPI server for the VS Code extension / gateway.

All handlers are plain `def` (not async) because Gemini calls block the GIL.
Sessions are stored in a module-level dict + persisted to session.json.

Endpoints:
  GET  /health
  POST /session/start
  POST /session/{id}/answer
  GET  /session/{id}
"""
from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from ri.schemas import AnswerItem, AnswerPayload

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    import ri.config as cfg
    out = cfg.RI_OUTPUT_DIR
    if out.exists():
        for f in out.glob("session.json"):
            try:
                data = json.loads(f.read_text(encoding="utf-8"))
                logger.info("[ri/server] found persisted session: %s", data.get("session_id"))
            except Exception as exc:
                logger.warning("[ri/server] could not reload session from %s: %s", f, exc)
    yield


app = FastAPI(
    title="Requirement Intelligence API",
    description="Interviews the developer and produces structured requirements for Project Brain.",
    version="1.0.0",
    lifespan=lifespan,
)

# In-memory session store (persisted to output/session.json for reload safety)
_sessions: dict[str, Any] = {}


# ── Request / Response models ──────────────────────────────────────────────────

class StartRequest(BaseModel):
    idea: str
    mock: bool = False
    out: str = "output"


class StartResponse(BaseModel):
    session_id: str
    project_id: str
    name: str
    project_type: str
    status: str
    round: int
    schema_version: str
    progress: dict
    fallbacks_used: int
    questions: list


class AnswerResponse(BaseModel):
    session_id: str
    status: str
    round: int
    project_type: str
    schema_version: str
    progress: dict
    fallbacks_used: int
    questions: list


# ── Endpoints ──────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    """Health check — returns current mode and model."""
    import ri.config as cfg
    return {
        "status": "ok",
        "mode": "mock" if cfg.use_mock() else "gemini",
        "model": cfg.GEMINI_MODEL,
        "api_key_set": cfg.has_api_key(),
        "schema_version": "1.0",
    }


@app.post("/session/start")
def session_start(req: StartRequest) -> dict:
    """Start a new interview session and return the first round of questions."""
    from ri.session import Session

    if not req.idea or not req.idea.strip():
        raise HTTPException(status_code=400, detail="idea must not be empty")

    session = Session(idea=req.idea.strip(), mock=req.mock, out_dir=Path(req.out))
    _sessions[session.session_id] = session

    # Persist immediately for reload safety
    _try_persist(session)

    first_round = session.next_round()

    return {
        "session_id": session.session_id,
        "project_id": session.project_id,
        "name": session.name,
        "project_type": session.project_type,
        **first_round.model_dump(),
    }


@app.post("/session/{session_id}/answer")
def session_answer(session_id: str, payload: AnswerPayload) -> dict:
    """Submit answers and receive the next round of questions (or completion)."""
    session = _sessions.get(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail=f"Session {session_id!r} not found")

    if session.is_complete():
        raise HTTPException(status_code=409, detail="Session is already complete")

    session.apply_answers(payload.answers)
    _try_persist(session)

    next_round = session.next_round()

    return {
        "session_id": session_id,
        **next_round.model_dump(),
    }


@app.get("/session/{session_id}")
def session_get(session_id: str) -> dict:
    """Get the current session snapshot."""
    session = _sessions.get(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail=f"Session {session_id!r} not found")
    return session.snapshot()



# ── Helpers ────────────────────────────────────────────────────────────────────

def _try_persist(session) -> None:
    """Quietly persist session state; never raises."""
    try:
        out = Path(session.out_dir)
        out.mkdir(parents=True, exist_ok=True)
        data = {
            "session_id": session.session_id,
            "project_id": session.project_id,
            "idea": session.idea,
            "name": session.name,
            "project_type": session.project_type,
            "round_number": session.round_number,
            "fallbacks_total": session.fallbacks_total,
            "completed": session.is_complete(),
        }
        (out / "session.json").write_text(json.dumps(data, indent=2), encoding="utf-8")
    except Exception as exc:
        logger.warning("[ri/server] could not persist session: %s", exc)
