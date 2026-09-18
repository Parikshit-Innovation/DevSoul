#!/usr/bin/env python3
"""
DevSoul — Full Intelligence Pipeline Orchestrator
=================================================

Runs all three modules end-to-end:
  1. Requirement Intelligence  (Python, in-process)
  2. Architecture Intelligence (TypeScript/Node, subprocess)
  3. Agent Factory             (TypeScript/Node, subprocess via HTTP)

Usage:
    python pipeline/run_pipeline.py "Your project idea here"
    python pipeline/run_pipeline.py "..." --mock          # offline, no API key
    python pipeline/run_pipeline.py "..." --out .devos    # custom output dir
    python pipeline/run_pipeline.py "..." --task "Custom Factory task"

The shared artifact dir is .devos/ at the project root (configurable via --out).
All three modules write/read from that directory.

Pipeline statuses:
    COMPLETED                  — all three stages succeeded
    COMPLETED_WITH_PARTIAL_OUTPUT — user stopped RI or AI early; Factory not run
    CANCELLED                  — user explicitly cancelled
    FAILED                     — technical error in one stage
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

# ── Resolve repo root (this script lives in pipeline/ at the repo root) ──────
PIPELINE_DIR = Path(__file__).parent.resolve()
REPO_ROOT    = PIPELINE_DIR.parent
RI_DIR       = REPO_ROOT / "requirement-intelligence"
AI_DIR       = REPO_ROOT / "architecture-intelligence"
FACTORY_DIR  = REPO_ROOT / "agent-factory"

# ── Add RI to Python path so we can import it directly ───────────────────────
sys.path.insert(0, str(RI_DIR))

# Load root .env then force both Google key env vars to the same value so
# the google-genai SDK always uses our key, regardless of what GOOGLE_API_KEY
# was previously set to in the Windows environment.
try:
    from dotenv import load_dotenv
    load_dotenv(REPO_ROOT / ".env")
except ImportError:
    pass

_gemini_key = os.environ.get("GEMINI_API_KEY", "")
if _gemini_key:
    os.environ["GOOGLE_API_KEY"] = _gemini_key  # SDK prefers this name

# ── Windows: .cmd shims for npm executables ───────────────────────────────────
_IS_WINDOWS = sys.platform == "win32"

def _npm_cmd(name: str) -> str:
    """Return 'name.cmd' on Windows so subprocess can find npm shims."""
    return f"{name}.cmd" if _IS_WINDOWS else name


# ─── Pipeline State ───────────────────────────────────────────────────────────

class PipelineStatus:
    RUNNING   = "RUNNING"
    COMPLETED = "COMPLETED"
    COMPLETED_WITH_PARTIAL_OUTPUT = "COMPLETED_WITH_PARTIAL_OUTPUT"
    CANCELLED = "CANCELLED"
    FAILED    = "FAILED"


class PipelineState:
    def __init__(self, idea: str, out_dir: Path, task: str):
        self.pipeline_id     = f"pipe-{int(time.time())}"
        self.idea            = idea
        self.out_dir         = out_dir
        self.task            = task
        self.status          = PipelineStatus.RUNNING
        self.started_at      = datetime.now(timezone.utc).isoformat()
        self.completed_at: str | None = None
        self.current_stage   = ""
        self.error: str | None = None

        # Artifact paths
        self.ri_requirements_path: Path | None = None
        self.ri_project_path: Path | None = None
        self.ai_architecture_path: Path | None = None
        self.factory_agents_path: Path | None = None

        # Stage results
        self.ri_result: dict  = {}
        self.ai_result: dict  = {}
        self.factory_result: dict = {}


# ─── Logging helpers ──────────────────────────────────────────────────────────

_BOLD   = "\033[1m"
_GREEN  = "\033[32m"
_YELLOW = "\033[33m"
_RED    = "\033[31m"
_CYAN   = "\033[36m"
_RESET  = "\033[0m"


def _event(name: str, msg: str = "", color: str = _CYAN) -> None:
    ts = datetime.now(timezone.utc).strftime("%H:%M:%S")
    print(f"{color}{_BOLD}[{ts}] {name}{_RESET}  {msg}", flush=True)


def _info(msg: str) -> None:
    print(f"  {msg}", flush=True)


def _warn(msg: str) -> None:
    print(f"  {_YELLOW}⚠  {msg}{_RESET}", flush=True)


def _ok(msg: str) -> None:
    print(f"  {_GREEN}✓  {msg}{_RESET}", flush=True)


def _err(msg: str) -> None:
    print(f"  {_RED}✗  {msg}{_RESET}", flush=True)


# ─── Cancellation helpers ─────────────────────────────────────────────────────

# Words/phrases that indicate explicit user stop intent
_STOP_PHRASES = {
    "stop", "done", "quit", "exit", "cancel",
    "stop here", "that's enough", "thats enough",
    "don't continue", "dont continue",
    "finish with what we have", "finish here",
    "cancel the pipeline", "abort",
}


def _is_stop_request(text: str) -> bool:
    """Return True if the user's text is clearly a pipeline cancellation request."""
    return text.strip().lower() in _STOP_PHRASES


# ─── Schema Adapters ──────────────────────────────────────────────────────────

def _adapt_ri_for_ai(ri_reqs_raw: dict, project_name: str) -> dict:
    """
    Convert RI requirements.yaml format to the format Architecture Intelligence
    expects in its .devos/requirements.yaml.

    RI format:
        requirements:
          - id: REQ-001
            project_id: <uuid>
            title: ...
            description: ...
            type: feature
            priority: high
            status: draft
            acceptance_criteria: [...]

    AI expected format (from .devos-sample/requirements.yaml):
        project: <name>
        requirements:
          - id: REQ-001
            text: <title or description>
            category: <type>
            status: <status>
    """
    adapted_reqs = []
    for req in ri_reqs_raw.get("requirements", []):
        text = req.get("title") or req.get("description") or ""
        # Append acceptance criteria to the text for richer context
        criteria = req.get("acceptance_criteria", [])
        if criteria:
            text += " — " + "; ".join(criteria)

        adapted_reqs.append({
            "id":       req.get("id", "REQ-???"),
            "text":     text,
            "category": req.get("type", "feature"),
            "status":   req.get("status", "proposed"),
        })

    return {
        "project":      project_name,
        "requirements": adapted_reqs,
    }


def _adapt_ai_for_factory(
    ai_arch: dict,
    ri_reqs_raw: dict,
    project_id: str,
    project_name: str,
    project_summary: str,
) -> tuple[dict, dict]:
    """
    Produce (ri_input, ai_input) dicts in the exact format Agent Factory expects.

    Factory RI input shape (RequirementIntelligenceOutput):
        project_id, project_name, summary, requirements[], constraints{}

    Factory AI input shape (ArchitectureIntelligenceOutput):
        project_id, architecture_summary, technology_stack{}, components[], ...
    """
    # ── Build RI input for Factory ────────────────────────────────────────────
    factory_requirements = []
    for req in ri_reqs_raw.get("requirements", []):
        criteria = req.get("acceptance_criteria", [])
        if not criteria:
            criteria = ["Must meet core functionality described."]

        factory_requirements.append({
            "id":          req.get("id", "REQ-???"),
            "description": req.get("title") or req.get("description") or req.get("text", ""),
            "priority":    req.get("priority", "medium"),
            "acceptance_criteria": criteria,
        })

    factory_ri = {
        "project_id":   project_id,
        "project_name": project_name,
        "summary":      project_summary,
        "requirements": factory_requirements,
        "constraints": {
            "max_agents":          5,
            "max_planning_tokens": 3000,
            "max_agent_steps":     8,
            "allowed_tools":       ["read_file"],
            "project_root":        ".",
        },
    }

    # ── Build AI input for Factory ────────────────────────────────────────────
    factory_ai = {
        "project_id":            project_id,
        "architecture_summary":  ai_arch.get("architecture_summary", ""),
        "technology_stack":      ai_arch.get("technology_stack", {}),
        "components":            ai_arch.get("components", []),
        "design_constraints":    ai_arch.get("design_constraints", []),
        "project_files":         ai_arch.get("project_files", []),
    }

    return factory_ri, factory_ai


# ─── Stage 1: Requirement Intelligence ───────────────────────────────────────

def run_requirement_intelligence(state: PipelineState, mock: bool = False, auto_answer: bool = False) -> bool:
    """
    Run RI in-process using the existing Session API.
    Returns True = completed (full or partial). False = hard failure.
    Sets state.ri_result with summary info.
    Saves artifacts to state.out_dir.
    """
    _event("REQUIREMENT_INTELLIGENCE_STARTED",
           f"project idea: {state.idea[:80]}…" if len(state.idea) > 80 else state.idea)

    try:
        import ri.config as cfg  # type: ignore
        from ri.session import Session  # type: ignore
        from ri.schemas import AnswerItem  # type: ignore
    except ImportError as exc:
        _err(f"Cannot import RI module: {exc}")
        _err("Make sure you have activated the Python venv in requirement-intelligence/")
        _err("and installed its requirements: pip install -r requirement-intelligence/requirements.txt")
        state.status = PipelineStatus.FAILED
        state.error  = f"RI import error: {exc}"
        return False

    # Force the SDK to use OUR key. GOOGLE_API_KEY was already overridden at
    # module startup, but re-confirm here in case RI's own config.py loaded
    # a different GEMINI_API_KEY from requirement-intelligence/.env.
    _our_key = os.environ.get("GEMINI_API_KEY", "")
    if _our_key:
        os.environ["GOOGLE_API_KEY"] = _our_key

    out_dir = state.out_dir
    try:
        session = Session(idea=state.idea, mock=mock, out_dir=out_dir)
    except KeyboardInterrupt:
        _warn("Interrupted during RI startup. Exiting.")
        state.status = PipelineStatus.CANCELLED
        return False

    _info(f"Project type : {session.project_type}")
    _info(f"Project name : {session.name}")
    _info(f"Mode         : {'mock (offline)' if mock else 'Gemini'}")
    _info(f"Tip          : Enter a number (1/2/3) or type your answer. Type 'cancel' to stop.")
    _info(f"Tip          : Type 'auto decide everything' to have AI complete the rest.")
    print()

    cancelled = False

    try:
      for _ in range(cfg.RI_MAX_ROUNDS):
        round_data = session.next_round()

        if round_data.status == "complete":
            _ok("Interview complete.")
            break

        print(f"  --- Round {round_data.round} "
              f"({round_data.progress.answered}/{round_data.progress.total} topics) ---")
        if round_data.fallbacks_used:
            _warn(f"AI degraded — {round_data.fallbacks_used} fallback(s) used this round")
        print()

        answers = []
        done    = False
        for q in round_data.questions:
            print(f"  [{q.node_id}] {q.question}")
            for i, opt in enumerate(q.options, 1):
                print(f"    {i}. {opt}")

            if auto_answer:
                raw = q.options[0] if q.options else "Yes"
                print(f"  > {raw} (auto-answered)")
            else:
                while True:
                    try:
                        raw = input("  > ").strip()
                    except (EOFError, KeyboardInterrupt):
                        print()  # newline after ^C
                        raw = "cancel"

                    if raw == "":
                        # Blank Enter — re-prompt with a hint
                        print("  (Enter a number or type your answer. Type 'cancel' to stop.)")
                        continue
                        
                    if raw.lower() == "auto decide everything":
                        print("  ✔  Auto-deciding all remaining questions...")
                        auto_answer = True
                        raw = q.options[0] if q.options else "Yes"
                        break

                    # Resolve numeric option shortcut
                    if raw.isdigit():
                        idx = int(raw) - 1
                        if 0 <= idx < len(q.options):
                            raw = q.options[idx]
                            print(f"  ✔  Selected: {raw}")

                    break  # valid non-empty input received

            if _is_stop_request(raw):
                _warn("Stop request detected — finalising with answers collected so far.")
                cancelled = True
                done = True
                break

            # Numeric option resolution
            if raw.isdigit():
                idx = int(raw) - 1
                if 0 <= idx < len(q.options):
                    raw = q.options[idx]

            answers.append(AnswerItem(node_id=q.node_id, answer=raw))
            print()

        if answers:
            session.apply_answers(answers)

        if done or session.is_complete():
            session.finalise()
            break
      else:
        _warn(f"Reached max rounds ({cfg.RI_MAX_ROUNDS}). Finalising with current answers.")
        session.finalise()

    except KeyboardInterrupt:
        _warn("\nInterrupted by user — finalising partial answers.")
        try:
            session.finalise()
        except Exception:
            pass
        cancelled = True

    # ── Write outputs ──────────────────────────────────────────────────────────
    summary = session.snapshot()
    ri_reqs_path    = out_dir / "requirements.yaml"
    ri_project_path = out_dir / "project.yaml"

    state.ri_result = {
        "session_id":         session.session_id,
        "project_id":         session.project_id,
        "project_name":       session.name,
        "project_summary":    session.summary,
        "requirements_count": summary.get("completeness", 0),
        "completeness_pct":   summary.get("completeness", 0),
        "open_gaps":          summary.get("open_gaps", []),
        "fallbacks_total":    summary.get("fallbacks_total", 0),
        "cancelled":          cancelled,
    }
    state.ri_requirements_path = ri_reqs_path
    state.ri_project_path      = ri_project_path

    if not ri_reqs_path.exists():
        _err(f"RI did not write {ri_reqs_path}")
        state.status = PipelineStatus.FAILED
        state.error  = "requirements.yaml was not written by RI"
        return False

    _ok(f"requirements.yaml → {ri_reqs_path}")
    _ok(f"project.yaml      → {ri_project_path}")

    if cancelled:
        _event("REQUIREMENT_INTELLIGENCE_CANCELLED",
               "Partial requirements saved. Skipping Architecture Intelligence and Factory.",
               _YELLOW)
        state.status = PipelineStatus.CANCELLED
        return False   # Stop pipeline

    _event("REQUIREMENT_INTELLIGENCE_COMPLETED",
           f"requirements: {len(session._graph.open_gaps())} gaps remaining", _GREEN)
    return True


# ─── Stage 2: Architecture Intelligence ───────────────────────────────────────

def run_architecture_intelligence(state: PipelineState, mock: bool = False) -> bool:
    """
    Run AI by:
      1. Writing a .devos/requirements.yaml that AI understands (adapted schema)
      2. Invoking the AI TypeScript process (ts-node cli/pipeline.ts)
      3. Reading back the .devos/architecture.yaml it produces
    Returns True on success, False on failure.
    """
    _event("ARCHITECTURE_INTELLIGENCE_STARTED",
           f"devos dir: {state.out_dir}")

    # ── Load RI output ─────────────────────────────────────────────────────────
    import yaml as _yaml
    ri_reqs_path = state.ri_requirements_path
    if not ri_reqs_path or not ri_reqs_path.exists():
        _err("requirements.yaml not found — cannot start Architecture Intelligence.")
        state.status = PipelineStatus.FAILED
        state.error  = "requirements.yaml missing before AI stage"
        return False

    with open(ri_reqs_path, "r", encoding="utf-8") as f:
        ri_reqs_raw = _yaml.safe_load(f) or {}

    project_name = state.ri_result.get("project_name", "DevSoul Project")

    # ── Write adapted requirements.yaml for AI ─────────────────────────────────
    ai_reqs = _adapt_ri_for_ai(ri_reqs_raw, project_name)
    ai_reqs_path = state.out_dir / "requirements.yaml"  # same file — AI reads from same dir
    # We overwrite with the adapted format
    adapted_yaml = _yaml.dump(ai_reqs, default_flow_style=False, allow_unicode=True, sort_keys=False)
    _atomic_write(ai_reqs_path, adapted_yaml)
    _info(f"Adapted requirements.yaml written for AI: {len(ai_reqs['requirements'])} requirements")

    # ── Run AI TypeScript process ──────────────────────────────────────────────
    ai_pipeline_script = AI_DIR / "cli" / "pipeline.ts"

    # Check if the compiled pipeline.js exists (prefer it); fall back to ts-node
    ai_dist_script = AI_DIR / "dist" / "cli" / "pipeline.js"

    env = {
        **os.environ,
        "DEVOS_DIR": str(state.out_dir),
        "PROJECT_ID": state.ri_result.get("project_id", "devos-pipeline"),
        "PIPELINE_MOCK": "true" if mock else "false",
        # Pass RI-derived project summary as context
        "PROJECT_SUMMARY": state.ri_result.get("project_summary", state.idea),
    }

    npx = _npm_cmd("npx")

    if ai_dist_script.exists():
        cmd = ["node", str(ai_dist_script)]
    elif ai_pipeline_script.exists():
        cmd = [npx, "ts-node", "--project", str(AI_DIR / "tsconfig.json"), str(ai_pipeline_script)]
    else:
        # Fall back to ts-node on the demo script with env overrides
        demo_script = AI_DIR / "cli" / "demo.ts"
        cmd = [npx, "ts-node", "--project", str(AI_DIR / "tsconfig.json"), str(demo_script)]
        _warn("pipeline.ts not found — using demo.ts (full interactive interview)")

    _info(f"Running: {' '.join(cmd[:3])}…")

    try:
        result = subprocess.run(
            cmd,
            cwd=str(AI_DIR),
            env=env,
            timeout=600,   # 10-minute timeout for interactive interview
            shell=_IS_WINDOWS,
        )
    except subprocess.TimeoutExpired:
        _err("Architecture Intelligence timed out after 10 minutes.")
        state.status = PipelineStatus.FAILED
        state.error  = "AI stage timed out"
        return False
    except FileNotFoundError as exc:
        _err(f"Could not launch AI process: {exc}")
        _err("Make sure Node.js is installed and dependencies are installed in architecture-intelligence/")
        state.status = PipelineStatus.FAILED
        state.error  = str(exc)
        return False

    # ── Read AI output ─────────────────────────────────────────────────────────
    ai_arch_path = state.out_dir / "architecture.yaml"
    if not ai_arch_path.exists():
        _err(f"Architecture Intelligence did not write {ai_arch_path}")
        if result.returncode != 0:
            _err(f"Process exited with code {result.returncode}")
        state.status = PipelineStatus.FAILED
        state.error  = "architecture.yaml was not written by AI"
        return False

    with open(ai_arch_path, "r", encoding="utf-8") as f:
        ai_arch = _yaml.safe_load(f) or {}

    state.ai_result = {
        "project_id":           ai_arch.get("project_id", ""),
        "architecture_summary": ai_arch.get("architecture_summary", ""),
        "components_count":     len(ai_arch.get("components", [])),
        "technology_stack":     ai_arch.get("technology_stack", {}),
    }
    state.ai_architecture_path = ai_arch_path

    # Check project_id matches (best-effort warning; RI uses UUID, AI uses a string id)
    ai_pid = ai_arch.get("project_id", "")
    ri_pid = state.ri_result.get("project_id", "")
    if ai_pid and ri_pid and ai_pid != ri_pid:
        _warn(f"project_id mismatch: RI={ri_pid[:12]}… AI={ai_pid}. Proceeding with RI project_id.")
        ai_arch["project_id"] = ri_pid
        # Rewrite the corrected architecture.yaml
        _atomic_write(ai_arch_path, _yaml.dump(ai_arch, default_flow_style=False, allow_unicode=True, sort_keys=False))

    _ok(f"architecture.yaml → {ai_arch_path}")
    _event("ARCHITECTURE_INTELLIGENCE_COMPLETED",
           f"{state.ai_result['components_count']} components | "
           f"{ai_arch.get('technology_stack', {})}", _GREEN)
    return True


# ─── Stage 3: Agent Factory ────────────────────────────────────────────────────

def run_agent_factory(state: PipelineState) -> bool:
    """
    Run Agent Factory by:
      1. Loading RI requirements.yaml and AI architecture.yaml from .devos/
      2. Calling the Factory's pipeline directly via subprocess (node)
      3. Recording agents.yaml location
    """
    _event("AGENT_FACTORY_STARTED", f"task: {state.task[:80]}")

    import yaml as _yaml

    # Load actual RI requirements
    ri_reqs_path = state.ri_requirements_path
    if not ri_reqs_path or not ri_reqs_path.exists():
        _err("requirements.yaml not found for Factory.")
        state.status = PipelineStatus.FAILED
        state.error  = "requirements.yaml missing before Factory stage"
        return False

    ai_arch_path = state.ai_architecture_path
    if not ai_arch_path or not ai_arch_path.exists():
        _err("architecture.yaml not found for Factory.")
        state.status = PipelineStatus.FAILED
        state.error  = "architecture.yaml missing before Factory stage"
        return False

    # ── Re-load the original (RI-format) requirements for Factory ─────────────
    # We need to load the RI raw format, not the AI-adapted format.
    # RI also writes session.json which has the original data; use that if available.
    session_json = state.out_dir / "session.json"
    original_ri_reqs: dict | None = None

    if session_json.exists():
        with open(session_json, "r", encoding="utf-8") as f:
            session_data = json.load(f)
        # We still need requirements.yaml in RI format; use the session to get project_id
        # The actual requirements.yaml should have the RI format from finalise()
        # BUT we adapted it for AI. We need to restore from session.json or traceability.yaml
        pass

    # Load the current requirements.yaml (adapted for AI format)
    with open(ri_reqs_path, "r", encoding="utf-8") as f:
        current_reqs = _yaml.safe_load(f) or {}

    # Load architecture.yaml
    with open(ai_arch_path, "r", encoding="utf-8") as f:
        ai_arch = _yaml.safe_load(f) or {}

    project_id   = state.ri_result.get("project_id", ai_arch.get("project_id", "devos-pipeline"))
    project_name = state.ri_result.get("project_name", current_reqs.get("project", "DevSoul Project"))
    summary      = state.ri_result.get("project_summary", state.idea)

    # Rebuild RI requirements in Factory format from whatever we have
    factory_requirements = []
    for req in current_reqs.get("requirements", []):
        desc = req.get("title") or req.get("text") or req.get("description") or ""
        criteria = req.get("acceptance_criteria", [])
        if not criteria:
            criteria = ["Must meet core functionality described."]
        factory_requirements.append({
            "id":          req.get("id", "REQ-???"),
            "description": desc,
            "priority":    req.get("priority", "medium"),
            "acceptance_criteria": criteria,
        })

    factory_ri = {
        "project_id":   project_id,
        "project_name": project_name,
        "summary":      summary,
        "requirements": factory_requirements,
        "constraints": {
            "max_agents":          5,
            "max_planning_tokens": 3000,
            "max_agent_steps":     8,
            "allowed_tools":       ["read_file"],
            "project_root":        ".",
        },
    }

    factory_ai = {
        "project_id":           project_id,
        "architecture_summary": ai_arch.get("architecture_summary", ""),
        "technology_stack":     ai_arch.get("technology_stack", {}),
        "components":           ai_arch.get("components", []),
        "design_constraints":   ai_arch.get("design_constraints", []),
        "project_files":        ai_arch.get("project_files", []),
    }

    # ── Write pipeline request JSON for the Factory process ───────────────────
    pipeline_request = {
        "task":                      state.task,
        "requirementIntelligence":   factory_ri,
        "architectureIntelligence":  factory_ai,
        "outputPath":                str(state.out_dir / "agents.yaml"),
    }

    request_path = state.out_dir / "pipeline-request.json"
    _atomic_write(request_path, json.dumps(pipeline_request, indent=2))
    _info(f"Pipeline request written: {request_path}")

    # ── Run Factory via its run-pipeline script ───────────────────────────────
    factory_runner = FACTORY_DIR / "pipeline" / "run.mjs"

    if not factory_runner.exists():
        # Create a minimal runner script now
        factory_runner.parent.mkdir(parents=True, exist_ok=True)

    # Use tsx to run the factory pipeline directly from TypeScript
    factory_runner_ts = PIPELINE_DIR / "run_factory.ts"

    agents_yaml_path = state.out_dir / "agents.yaml"

    env = {
        **os.environ,
        "PIPELINE_REQUEST_PATH": str(request_path),
        "AGENTS_YAML_PATH":      str(agents_yaml_path),
    }

    cmd = [
        _npm_cmd("npx"), _npm_cmd("tsx"),
        str(factory_runner_ts),
    ]

    _info(f"Running Agent Factory pipeline…")

    try:
        result = subprocess.run(
            cmd,
            cwd=str(FACTORY_DIR),
            env=env,
            timeout=300,
            shell=_IS_WINDOWS,
        )
    except subprocess.TimeoutExpired:
        _err("Agent Factory timed out after 5 minutes.")
        state.status = PipelineStatus.FAILED
        state.error  = "Factory stage timed out"
        return False
    except FileNotFoundError as exc:
        _err(f"Could not launch Factory: {exc}")
        state.status = PipelineStatus.FAILED
        state.error  = str(exc)
        return False

    if result.returncode != 0:
        _err(f"Agent Factory exited with code {result.returncode}")
        state.status = PipelineStatus.FAILED
        state.error  = f"Factory process exited with code {result.returncode}"
        return False

    if not agents_yaml_path.exists():
        _err(f"agents.yaml was not written to {agents_yaml_path}")
        state.status = PipelineStatus.FAILED
        state.error  = "agents.yaml missing after Factory stage"
        return False

    state.factory_agents_path = agents_yaml_path
    _ok(f"agents.yaml → {agents_yaml_path}")

    # Read result summary
    result_path = state.out_dir / "pipeline-result.json"
    if result_path.exists():
        with open(result_path, "r", encoding="utf-8") as f:
            factory_result = json.load(f)
        state.factory_result = factory_result
        agents_count = len((factory_result.get("agentsYamlContents") or "").split("id:")) - 1
        _event("AGENT_FACTORY_COMPLETED",
               f"agents.yaml saved | validation: {'passed' if factory_result.get('success') else 'failed'}",
               _GREEN)
    else:
        _event("AGENT_FACTORY_COMPLETED", f"agents.yaml saved → {agents_yaml_path}", _GREEN)

    return True


# ─── Summary Printer ──────────────────────────────────────────────────────────

def print_summary(state: PipelineState) -> None:
    divider = "─" * 64
    print(f"\n{divider}")
    print(f"{_BOLD}  DevSoul Pipeline Summary{_RESET}")
    print(divider)
    print(f"  Pipeline ID : {state.pipeline_id}")
    print(f"  Status      : {_color_status(state.status)}")
    print(f"  Started     : {state.started_at}")
    print(f"  Completed   : {state.completed_at or 'n/a'}")
    print(f"  Idea        : {state.idea[:60]}{'…' if len(state.idea) > 60 else ''}")
    print()

    if state.ri_result:
        ri = state.ri_result
        print(f"  Stage 1 — Requirement Intelligence")
        print(f"    Project name : {ri.get('project_name', '–')}")
        print(f"    Project ID   : {ri.get('project_id', '–')}")
        print(f"    Completeness : {ri.get('completeness_pct', '–')}%")
        if ri.get("open_gaps"):
            print(f"    Open gaps    : {', '.join(ri['open_gaps'])}")
        print(f"    Cancelled    : {ri.get('cancelled', False)}")
        if state.ri_requirements_path:
            print(f"    Output       : {state.ri_requirements_path}")
        print()

    if state.ai_result:
        ai = state.ai_result
        print(f"  Stage 2 — Architecture Intelligence")
        print(f"    Components   : {ai.get('components_count', '–')}")
        ts = ai.get("technology_stack", {})
        if ts:
            print(f"    Tech stack   : {ts}")
        if state.ai_architecture_path:
            print(f"    Output       : {state.ai_architecture_path}")
        print()

    if state.factory_result or state.factory_agents_path:
        print(f"  Stage 3 — Agent Factory")
        if state.factory_agents_path:
            print(f"    agents.yaml  : {state.factory_agents_path}")
        fr = state.factory_result
        if fr:
            print(f"    Success      : {fr.get('success', '–')}")
            if fr.get("validation"):
                v = fr["validation"]
                print(f"    Validation   : {'passed' if v.get('valid') else 'failed'}")
                if v.get("errors"):
                    for e in v["errors"]:
                        print(f"      ✗ {e}")
                if v.get("warnings"):
                    for w in v["warnings"]:
                        print(f"      ⚠ {w}")
        print()

    if state.error:
        print(f"  {_RED}Error: {state.error}{_RESET}")
        print()

    print(divider)


def _color_status(status: str) -> str:
    if status == PipelineStatus.COMPLETED:
        return f"{_GREEN}{_BOLD}{status}{_RESET}"
    if status == PipelineStatus.COMPLETED_WITH_PARTIAL_OUTPUT:
        return f"{_YELLOW}{_BOLD}{status}{_RESET}"
    if status == PipelineStatus.CANCELLED:
        return f"{_YELLOW}{_BOLD}{status}{_RESET}"
    if status == PipelineStatus.FAILED:
        return f"{_RED}{_BOLD}{status}{_RESET}"
    return status


# ─── Atomic write ─────────────────────────────────────────────────────────────

def _atomic_write(path: Path, content: str) -> None:
    import uuid as _uuid
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".tmp_{path.name}_{_uuid.uuid4().hex}")
    try:
        tmp.write_text(content, encoding="utf-8")
        os.replace(tmp, path)
    except Exception:
        if tmp.exists():
            tmp.unlink()
        raise


# ─── Main ─────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(
        prog="run_pipeline",
        description="DevSoul — Full Intelligence Pipeline (RI → AI → Factory)",
    )
    parser.add_argument("idea", help="Project idea (quoted string)")
    parser.add_argument(
        "--out", default=str(REPO_ROOT / ".devos"),
        help="Shared artifact directory (default: <repo>/.devos)",
    )
    parser.add_argument(
        "--mock", action="store_true",
        help="Use offline mock LLM for Requirement Intelligence (no API key needed)",
    )
    parser.add_argument(
        "--task",
        help="Custom task description for Agent Factory (default: derived from idea)",
    )
    args = parser.parse_args()

    out_dir = Path(args.out).resolve()
    task    = args.task or (
        f"Implement the complete application described by the following project idea: {args.idea}"
    )

    state = PipelineState(idea=args.idea, out_dir=out_dir, task=task)
    out_dir.mkdir(parents=True, exist_ok=True)

    print()
    print("╔══════════════════════════════════════════════════════════════╗")
    print("║          DevSoul — Full Intelligence Pipeline                ║")
    print("╚══════════════════════════════════════════════════════════════╝")
    print(f"\n  Pipeline ID  : {state.pipeline_id}")
    print(f"  Artifact dir : {out_dir}")
    print(f"  Mock mode    : {args.mock}")
    print()

    _event("PIPELINE_STARTED", f"idea: {args.idea[:60]}")
    print()

    # ── Stage 1: Requirement Intelligence ─────────────────────────────────────
    state.current_stage = "REQUIREMENT_INTELLIGENCE"
    ri_ok = run_requirement_intelligence(state, mock=args.mock)
    print()

    if not ri_ok:
        state.completed_at = datetime.now(timezone.utc).isoformat()
        print_summary(state)
        sys.exit(0 if state.status == PipelineStatus.CANCELLED else 1)

    # ── Stage 2: Architecture Intelligence ────────────────────────────────────
    state.current_stage = "ARCHITECTURE_INTELLIGENCE"
    ai_ok = run_architecture_intelligence(state, mock=args.mock)
    print()

    if not ai_ok:
        state.completed_at = datetime.now(timezone.utc).isoformat()
        print_summary(state)
        sys.exit(0 if state.status == PipelineStatus.CANCELLED else 1)

    # ── Stage 3: Agent Factory ────────────────────────────────────────────────
    state.current_stage = "AGENT_FACTORY"
    factory_ok = run_agent_factory(state)
    print()

    state.completed_at = datetime.now(timezone.utc).isoformat()
    if factory_ok:
        state.status = PipelineStatus.COMPLETED
        _event("PIPELINE_COMPLETED", "All three stages succeeded.", _GREEN)
    else:
        if state.status != PipelineStatus.FAILED:
            state.status = PipelineStatus.FAILED

    print_summary(state)
    sys.exit(0 if state.status == PipelineStatus.COMPLETED else 1)


if __name__ == "__main__":
    main()
