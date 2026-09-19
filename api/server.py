"""
DevSoul API Server
==================
FastAPI server bridging the React frontend with the Python pipeline modules.

Run:
  pip install fastapi uvicorn pyyaml python-dotenv
  python api/server.py
"""
from __future__ import annotations

import asyncio
import json
import os
import subprocess
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, AsyncIterator

import yaml
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import re

# ── AI Questions ──────────────────────────────────────────────────────────────
AI_QUESTIONS = [
    {"key": "frontend_core", "category": "Frontend", "prompt": "What is the primary frontend approach? (e.g. SPA, SSR, MPA, PWA)"},
    {"key": "frontend_framework", "category": "Frontend", "prompt": "Which frontend framework will you use? (e.g. React, Vue, Angular, Next.js, SvelteKit)"},
    {"key": "frontend_state", "category": "Frontend", "prompt": "How will client-side state be managed? (e.g. Redux, Zustand, Pinia, React Query, none)"},
    {"key": "backend_runtime", "category": "Backend", "prompt": "Which backend runtime / language? (e.g. Node.js, Python, Go, Java, Ruby)"},
    {"key": "backend_api", "category": "Backend", "prompt": "Which API style / framework? (e.g. Express, FastAPI, Gin, Spring Boot, Django REST)"},
    {"key": "db_relational", "category": "Database", "prompt": "Primary relational / SQL database? (e.g. PostgreSQL, MySQL, SQLite, none)"},
    {"key": "db_nonrelational", "category": "Database", "prompt": "Any NoSQL / document store? (e.g. MongoDB, DynamoDB, Firestore, none)"},
    {"key": "db_caching", "category": "Database", "prompt": "Caching layer? (e.g. Redis, Memcached, none)"},
    {"key": "auth", "category": "Auth", "prompt": "Authentication strategy? (e.g. JWT, OAuth2 / OIDC, Session-based, Firebase Auth, none)"},
    {"key": "devops_cloud", "category": "DevOps", "prompt": "Cloud / hosting platform? (e.g. AWS, GCP, Azure, Vercel, Railway, DigitalOcean)"},
    {"key": "devops_containers", "category": "DevOps", "prompt": "Container / orchestration strategy? (e.g. Docker, Kubernetes, none)"},
    {"key": "devops_cicd", "category": "DevOps", "prompt": "CI/CD pipeline? (e.g. GitHub Actions, GitLab CI, CircleCI, Jenkins, none)"},
    {"key": "devops_iac", "category": "DevOps", "prompt": "Infrastructure-as-code tooling? (e.g. Terraform, Pulumi, AWS CDK, none)"},
    {"key": "monitoring_error", "category": "Monitoring", "prompt": "Error tracking / APM? (e.g. Sentry, Datadog, New Relic, none)"},
    {"key": "monitoring_logs", "category": "Monitoring", "prompt": "Log aggregation? (e.g. Datadog Logs, Elastic Stack, Loki/Grafana, CloudWatch, none)"},
]

def _parse_ai_options(prompt: str) -> list[str]:
    match = re.search(r'\(e\.g\.\s+(.*?)\)', prompt)
    if match:
        options = [o.strip() for o in match.group(1).split(',')]
        return options
    return []

# ── Paths ─────────────────────────────────────────────────────────────────────
API_DIR      = Path(__file__).parent.resolve()
REPO_ROOT    = API_DIR.parent
RI_DIR       = REPO_ROOT / "requirement-intelligence"
AI_DIR       = REPO_ROOT / "architecture-intelligence"
FACTORY_DIR  = REPO_ROOT / "agent-factory"
PIPELINE_DIR = REPO_ROOT / "pipeline"
DEVOS_DIR    = REPO_ROOT / ".devos"

sys.path.insert(0, str(RI_DIR))

try:
    from dotenv import load_dotenv
    load_dotenv(REPO_ROOT / ".env")
except ImportError:
    pass

_gemini_key = os.environ.get("GEMINI_API_KEY", "")
if _gemini_key:
    os.environ["GOOGLE_API_KEY"] = _gemini_key

# ── In-memory session store ───────────────────────────────────────────────────
sessions: dict[str, dict[str, Any]] = {}


def _get_session(pipeline_id: str) -> dict[str, Any]:
    if pipeline_id not in sessions:
        raise HTTPException(status_code=404, detail=f"Pipeline {pipeline_id} not found")
    return sessions[pipeline_id]


# ── App ───────────────────────────────────────────────────────────────────────
app = FastAPI(title="DevSoul API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Models ────────────────────────────────────────────────────────────────────
class StartRequest(BaseModel):
    idea: str

class AnswerRequest(BaseModel):
    node_id: str
    value: str  # Frontend sends "value", we map to AnswerItem.answer


# ── POST /api/pipeline/start ──────────────────────────────────────────────────
@app.post("/api/pipeline/start")
async def start_pipeline(req: StartRequest):
    pipeline_id = str(uuid.uuid4())
    out_dir = DEVOS_DIR / pipeline_id
    out_dir.mkdir(parents=True, exist_ok=True)

    try:
        from ri.session import Session  # type: ignore
    except ImportError as e:
        raise HTTPException(status_code=500, detail=f"Cannot import RI: {e}")

    def _create_session():
        # Session.__init__ runs the full idea analysis synchronously
        return Session(idea=req.idea, mock=False, out_dir=out_dir)

    loop = asyncio.get_event_loop()
    try:
        session = await loop.run_in_executor(None, _create_session)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Idea analysis failed: {e}")

    sessions[pipeline_id] = {
        "pipeline_id": pipeline_id,
        "idea": req.idea,
        "session": session,
        "out_dir": out_dir,
        "stage": "ri",
        "ri_completed": False,
        "ai_answers": {},
        "ai_interview_completed": False,
        "architecture": None,
        "agents": [],
        "events": [],
    }

    return {
        "pipeline_id": pipeline_id,
        "project_name": getattr(session, "name", req.idea[:50]),
        "summary": getattr(session, "summary", ""),
    }


# ── GET /api/pipeline/{id}/status ────────────────────────────────────────────
@app.get("/api/pipeline/{pipeline_id}/status")
async def get_status(pipeline_id: str):
    s = _get_session(pipeline_id)
    stage_progress = {
        "ri": 15, "ri_interview": 30, "ri_done": 33,
        "ai": 50, "ai_done": 66, "factory": 80, "done": 100
    }
    return {
        "pipeline_id": pipeline_id,
        "stage": s["stage"],
        "status": "running",
        "progress": stage_progress.get(s["stage"], 0),
    }


# ── GET /api/pipeline/{id}/requirements ──────────────────────────────────────
@app.get("/api/pipeline/{pipeline_id}/requirements")
async def get_requirements(pipeline_id: str):
    s = _get_session(pipeline_id)
    session = s["session"]
    requirements = []

    # Try requirements.yaml first (written after finalise())
    reqs_yaml = s["out_dir"] / "requirements.yaml"
    if reqs_yaml.exists():
        try:
            with open(reqs_yaml, encoding="utf-8") as f:
                data = yaml.safe_load(f) or {}
            raw_reqs = data.get("requirements", [])
            if raw_reqs:
                return [
                    {
                        "id": r.get("id", f"REQ-{i+1:03d}"),
                        "title": r.get("title", r.get("description", "")),
                        "description": r.get("description", ""),
                        "priority": r.get("priority", "medium"),
                        "type": r.get("type", "feature"),
                        "acceptance_criteria": r.get("acceptance_criteria", ["Must meet core functionality described."]),
                    }
                    for i, r in enumerate(raw_reqs)
                ]
        except Exception:
            pass

    # Fall back: seeds from idea analysis
    try:
        seeds = getattr(session, "seeds", [])
        for i, seed in enumerate(seeds):
            requirements.append({
                "id": f"REQ-{i+1:03d}",
                "title": getattr(seed, "title", str(seed)),
                "description": getattr(seed, "description", ""),
                "priority": getattr(seed, "priority", "medium"),
                "type": getattr(seed, "type", "feature"),
                "acceptance_criteria": ["Must meet core functionality described."],
            })
    except Exception:
        pass

    return requirements


# ── GET /api/pipeline/{id}/interview/round ───────────────────────────────────
@app.get("/api/pipeline/{pipeline_id}/interview/round")
async def get_interview_round(pipeline_id: str):
    s = _get_session(pipeline_id)

    if s.get("ri_completed"):
        return {"questions": [], "topics_covered": 6, "total_topics": 6, "completed": True, "round_number": 999}

    session = s["session"]

    # Check if already complete
    if session.is_complete():
        s["ri_completed"] = True
        s["stage"] = "ri_done"
        return {"questions": [], "topics_covered": 6, "total_topics": 6, "completed": True, "round_number": 999}

    loop = asyncio.get_event_loop()
    try:
        round_data = await loop.run_in_executor(None, session.next_round)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"next_round failed: {e}")

    if round_data.status == "complete":
        s["ri_completed"] = True
        s["stage"] = "ri_done"
        return {"questions": [], "topics_covered": round_data.progress.answered, "total_topics": round_data.progress.total, "completed": True, "round_number": round_data.round}

    questions = [
        {
            "node_id": q.node_id,
            "question": q.question,
            "options": q.options,
            "allow_free_text": q.allow_free_text,
        }
        for q in round_data.questions
    ]

    return {
        "questions": questions,
        "topics_covered": round_data.progress.answered,
        "total_topics": round_data.progress.total,
        "completed": False,
        "round_number": round_data.round,
    }


# ── POST /api/pipeline/{id}/interview/answer ─────────────────────────────────
@app.post("/api/pipeline/{pipeline_id}/interview/answer")
async def submit_answer(pipeline_id: str, req: AnswerRequest):
    s = _get_session(pipeline_id)
    session = s["session"]

    from ri.schemas import AnswerItem  # type: ignore
    answer_item = AnswerItem(node_id=req.node_id, answer=req.value)

    loop = asyncio.get_event_loop()
    try:
        await loop.run_in_executor(None, session.apply_answers, [answer_item])
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"apply_answers failed: {e}")

    if session.is_complete():
        s["ri_completed"] = True
        s["stage"] = "ri_done"
        await loop.run_in_executor(None, session.finalise)
        _refresh_requirements(s)
        return {"completed": True, "next_round": None}

    try:
        next_rd = await loop.run_in_executor(None, session.next_round)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"next_round failed: {e}")

    if next_rd.status == "complete":
        s["ri_completed"] = True
        s["stage"] = "ri_done"
        _refresh_requirements(s)
        return {"completed": True, "next_round": None}

    return {
        "completed": False,
        "next_round": {
            "questions": [{"node_id": q.node_id, "question": q.question, "options": q.options, "allow_free_text": q.allow_free_text} for q in next_rd.questions],
            "topics_covered": next_rd.progress.answered,
            "total_topics": next_rd.progress.total,
            "completed": False,
            "round_number": next_rd.round,
        }
    }


# ── POST /api/pipeline/{id}/interview/auto-decide ────────────────────────────
@app.post("/api/pipeline/{pipeline_id}/interview/auto-decide")
async def auto_decide(pipeline_id: str):
    s = _get_session(pipeline_id)
    session = s["session"]

    def _run_auto():
        from ri.schemas import AnswerItem  # type: ignore
        for _ in range(20):
            if session.is_complete():
                break
            try:
                round_data = session.next_round()
                if round_data.status == "complete":
                    break
                answers = []
                for q in round_data.questions:
                    value = q.options[0] if q.options else "you choose"
                    answers.append(AnswerItem(node_id=q.node_id, answer=value))
                if answers:
                    session.apply_answers(answers)
            except Exception:
                break
        try:
            session.finalise()
        except Exception:
            pass

    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, _run_auto)
    s["ri_completed"] = True
    s["stage"] = "ri_done"
    _refresh_requirements(s)
    return {"completed": True}


def _refresh_requirements(s: dict):
    """After RI completes, cache requirements from file."""
    reqs_yaml = s["out_dir"] / "requirements.yaml"
    if reqs_yaml.exists():
        try:
            with open(reqs_yaml, encoding="utf-8") as f:
                data = yaml.safe_load(f) or {}
            s["_requirements_cache"] = data.get("requirements", [])
        except Exception:
            pass


# ── POST /api/pipeline/{id}/architecture/init ────────────────────────────────
@app.post("/api/pipeline/{pipeline_id}/architecture/init")
async def init_architecture(pipeline_id: str):
    s = _get_session(pipeline_id)
    s["stage"] = "ai"
    return {"status": "initialized"}


# ── GET /api/pipeline/{id}/architecture/interview/round ──────────────────────
@app.get("/api/pipeline/{pipeline_id}/architecture/interview/round")
async def get_ai_interview_round(pipeline_id: str):
    s = _get_session(pipeline_id)
    if s.get("ai_interview_completed"):
        return {"questions": [], "topics_covered": len(AI_QUESTIONS), "total_topics": len(AI_QUESTIONS), "completed": True, "round_number": 999}
    
    answered_keys = s.get("ai_answers", {}).keys()
    unanswered = [q for q in AI_QUESTIONS if q["key"] not in answered_keys]
    
    if not unanswered:
        s["ai_interview_completed"] = True
        return {"questions": [], "topics_covered": len(AI_QUESTIONS), "total_topics": len(AI_QUESTIONS), "completed": True, "round_number": 999}
    
    current_q = unanswered[0]
    questions = [{
        "node_id": current_q["key"],
        "question": f"({current_q['category']}) {current_q['prompt']}",
        "options": _parse_ai_options(current_q["prompt"]),
        "allow_free_text": True
    }]
    
    return {
        "questions": questions,
        "topics_covered": len(answered_keys),
        "total_topics": len(AI_QUESTIONS),
        "completed": False,
        "round_number": len(answered_keys) + 1,
    }


# ── POST /api/pipeline/{id}/architecture/interview/answer ────────────────────
@app.post("/api/pipeline/{pipeline_id}/architecture/interview/answer")
async def submit_ai_answer(pipeline_id: str, req: AnswerRequest):
    s = _get_session(pipeline_id)
    answers = s.get("ai_answers", {})
    answers[req.node_id] = req.value
    s["ai_answers"] = answers
    
    # Check if this was the last question
    answered_keys = answers.keys()
    if len(answered_keys) >= len(AI_QUESTIONS):
        s["ai_interview_completed"] = True
        return {"completed": True, "next_round": None}
    
    unanswered = [q for q in AI_QUESTIONS if q["key"] not in answered_keys]
    current_q = unanswered[0]
    next_round = {
        "questions": [{
            "node_id": current_q["key"],
            "question": f"({current_q['category']}) {current_q['prompt']}",
            "options": _parse_ai_options(current_q["prompt"]),
            "allow_free_text": True
        }],
        "topics_covered": len(answered_keys),
        "total_topics": len(AI_QUESTIONS),
        "completed": False,
        "round_number": len(answered_keys) + 1,
    }
    
    return {"completed": False, "next_round": next_round}


# ── POST /api/pipeline/{id}/architecture/start ───────────────────────────────
@app.post("/api/pipeline/{pipeline_id}/architecture/start")
async def start_architecture(pipeline_id: str):
    s = _get_session(pipeline_id)
    s["stage"] = "ai"

    def _run_ai():
        try:
            reqs_yaml = s["out_dir"] / "requirements.yaml"
            arch_yaml = s["out_dir"] / "architecture.yaml"
            if not reqs_yaml.exists():
                _generate_default_architecture(s)
                return

            ai_cli = AI_DIR / "cli" / "pipeline.ts"
            if ai_cli.exists():
                npx_cmd = "npx.cmd" if sys.platform == "win32" else "npx"
                env = {**os.environ, "DEVOS_DIR": str(s["out_dir"]), "PIPELINE_ANSWERS": json.dumps(s.get("ai_answers", {}))}
                subprocess.run(
                    [npx_cmd, "tsx", str(ai_cli)],
                    cwd=str(AI_DIR), env=env, capture_output=True, text=True, timeout=120
                )

            if arch_yaml.exists():
                with open(arch_yaml, encoding="utf-8") as f:
                    s["architecture"] = yaml.safe_load(f) or {}
                s["stage"] = "ai_done"
            else:
                _generate_default_architecture(s)
        except Exception:
            _generate_default_architecture(s)

    loop = asyncio.get_event_loop()
    asyncio.ensure_future(loop.run_in_executor(None, _run_ai))
    return {"status": "started"}


def _generate_default_architecture(s: dict):
    arch = {
        "architecture_summary": f"A modern web application for: {s['idea'][:80]}.",
        "technology_stack": {"frontend": "React", "backend": "Node.js", "database": "PostgreSQL"},
        "components": [
            {"name": "frontend", "description": "React SPA with responsive UI"},
            {"name": "backend", "description": "Node.js REST API"},
            {"name": "database", "description": "PostgreSQL relational database"},
        ],
        "design_constraints": ["RESTful API design", "JWT authentication", "Mobile-responsive"],
        "project_files": ["src/frontend/", "src/backend/", "database/"],
    }
    s["architecture"] = arch
    s["stage"] = "ai_done"
    arch_yaml = s["out_dir"] / "architecture.yaml"
    with open(arch_yaml, "w", encoding="utf-8") as f:
        yaml.dump(arch, f, allow_unicode=True)


# ── GET /api/pipeline/{id}/architecture ──────────────────────────────────────
@app.get("/api/pipeline/{pipeline_id}/architecture")
async def get_architecture(pipeline_id: str):
    s = _get_session(pipeline_id)
    if s.get("architecture"):
        return s["architecture"]
    arch_yaml = s["out_dir"] / "architecture.yaml"
    if arch_yaml.exists():
        with open(arch_yaml, encoding="utf-8") as f:
            data = yaml.safe_load(f) or {}
        s["architecture"] = data
        s["stage"] = "ai_done"
        return data
    raise HTTPException(status_code=404, detail="Architecture not yet available")


# ── POST /api/pipeline/{id}/factory/start ────────────────────────────────────
@app.post("/api/pipeline/{pipeline_id}/factory/start")
async def start_factory(pipeline_id: str):
    s = _get_session(pipeline_id)
    s["stage"] = "factory"

    def _run_factory():
        try:
            arch = s.get("architecture") or {}
            reqs_yaml = s["out_dir"] / "requirements.yaml"
            factory_reqs = []
            if reqs_yaml.exists():
                with open(reqs_yaml, encoding="utf-8") as f:
                    ri_data = yaml.safe_load(f) or {}
                for i, r in enumerate(ri_data.get("requirements", [])):
                    criteria = r.get("acceptance_criteria", [])
                    if not criteria:
                        criteria = ["Must meet core functionality described."]
                    factory_reqs.append({
                        "id": r.get("id", f"REQ-{i+1:03d}"),
                        "description": r.get("title", r.get("description", "")),
                        "priority": r.get("priority", "medium"),
                        "acceptance_criteria": criteria,
                    })
            if not factory_reqs:
                factory_reqs = [{"id": "REQ-001", "description": s["idea"], "priority": "high", "acceptance_criteria": ["Must meet core functionality."]}]

            project_id = str(uuid.uuid4())
            session_obj = s.get("session")
            project_name = getattr(session_obj, "name", "DevSoul Project") if session_obj else "DevSoul Project"

            request = {
                "task": f"Implement the complete application described by the following project idea: {s['idea']}",
                "requirementIntelligence": {
                    "project_id": project_id,
                    "project_name": project_name,
                    "summary": s["idea"],
                    "requirements": factory_reqs,
                    "constraints": {"max_agents": 5, "max_planning_tokens": 3000, "max_agent_steps": 8, "allowed_tools": ["read_file"], "project_root": "."},
                },
                "architectureIntelligence": {
                    "project_id": project_id,
                    "architecture_summary": arch.get("architecture_summary", ""),
                    "technology_stack": arch.get("technology_stack", {}),
                    "components": arch.get("components", []),
                    "design_constraints": arch.get("design_constraints", []),
                    "project_files": arch.get("project_files", []),
                },
                "outputPath": str(s["out_dir"] / "agents.yaml"),
            }

            req_path = s["out_dir"] / "pipeline-request.json"
            with open(req_path, "w", encoding="utf-8") as f:
                json.dump(request, f, indent=2)

            factory_ts = PIPELINE_DIR / "run_factory.ts"
            env = {
                **os.environ,
                "PIPELINE_REQUEST_PATH": str(req_path),
                "AGENTS_YAML_PATH": str(s["out_dir"] / "agents.yaml"),
            }
            npx_cmd = "npx.cmd" if sys.platform == "win32" else "npx"
            subprocess.run(
                [npx_cmd, "tsx", str(factory_ts)],
                cwd=str(FACTORY_DIR), env=env, capture_output=True, text=True, timeout=180,
            )

            agents_yaml = s["out_dir"] / "agents.yaml"
            if agents_yaml.exists():
                with open(agents_yaml, encoding="utf-8") as f:
                    data = yaml.safe_load(f) or {}
                s["agents"] = [
                    {
                        "id": a.get("id", f"agent-{i}"),
                        "role": a.get("role", "Developer"),
                        "task": a.get("task", ""),
                        "tools": a.get("tools", []),
                        "requirement_ids": a.get("requirement_ids", []),
                        "architecture_components": a.get("architecture_components", []),
                        "depends_on": a.get("depends_on", []),
                        "lifecycle": {"state": a.get("lifecycle", {}).get("state", "ready") if isinstance(a.get("lifecycle"), dict) else "ready"},
                        "success_criteria": a.get("success_criteria", []),
                    }
                    for i, a in enumerate(data.get("agents", []))
                ]
                s["stage"] = "done"
        except Exception as e:
            s["factory_error"] = str(e)

    loop = asyncio.get_event_loop()
    asyncio.ensure_future(loop.run_in_executor(None, _run_factory))
    return {"status": "started"}


# ── GET /api/pipeline/{id}/agents ────────────────────────────────────────────
@app.get("/api/pipeline/{pipeline_id}/agents")
async def get_agents(pipeline_id: str):
    s = _get_session(pipeline_id)
    if s.get("agents"):
        return s["agents"]
    agents_yaml = s["out_dir"] / "agents.yaml"
    if agents_yaml.exists():
        with open(agents_yaml, encoding="utf-8") as f:
            data = yaml.safe_load(f) or {}
        raw = data.get("agents", [])
        if raw:
            s["agents"] = [
                {
                    "id": a.get("id", f"agent-{i}"),
                    "role": a.get("role", "Developer"),
                    "task": a.get("task", ""),
                    "tools": a.get("tools", []),
                    "requirement_ids": a.get("requirement_ids", []),
                    "architecture_components": a.get("architecture_components", []),
                    "depends_on": a.get("depends_on", []),
                    "lifecycle": {"state": a.get("lifecycle", {}).get("state", "ready") if isinstance(a.get("lifecycle"), dict) else "ready"},
                    "success_criteria": a.get("success_criteria", []),
                }
                for i, a in enumerate(raw)
            ]
            s["stage"] = "done"
            return s["agents"]
    raise HTTPException(status_code=404, detail="Agents not yet available")


# ── GET /api/pipeline/{id}/events (SSE) ──────────────────────────────────────
@app.get("/api/pipeline/{pipeline_id}/events")
async def sse_events(pipeline_id: str):
    s = _get_session(pipeline_id)

    async def event_stream() -> AsyncIterator[str]:
        last = 0
        while True:
            events = s.get("events", [])
            while last < len(events):
                yield f"data: {json.dumps(events[last])}\n\n"
                last += 1
            await asyncio.sleep(1)

    return StreamingResponse(event_stream(), media_type="text/event-stream")


# ── Main ──────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn
    print("\n  DevSoul API Server")
    print("  " + "-" * 45)
    print("  http://localhost:8000")
    print("  Docs: http://localhost:8000/docs")
    print("  " + "-" * 45 + "\n")
    uvicorn.run(app, host="0.0.0.0", port=8000, reload=False)
