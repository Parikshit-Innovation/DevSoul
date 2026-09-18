# Requirement Intelligence (DevOS)

Turns a vague idea into a structured, reviewed specification by interviewing the developer one small round at a time.
Output goes to **Project Brain** as `requirements.yaml` + `project.yaml`.

**Branch**: `harshini` | **Owner**: Harshini
**Scope rule**: everything for this engine lives in `requirement-intelligence/`. Nothing here edits other folders.
If a shared contract must change (e.g. the `Requirement` schema), propose it to the team, then edit `shared/`.

---

## Hybrid architecture (LLM vs Logic)

```
User Idea
  -> Idea Analyzer            (LLM  – Gemini)   ri/pipeline/idea_analyzer.py
  -> Project Type Detector    (Logic)            ri/pipeline/project_type_detector.py
  -> Template Loader          (Logic)            ri/pipeline/template_loader.py
  -> Requirement Graph        (Logic)            ri/pipeline/requirement_graph.py
  -> Gap Detector             (Logic)            ri/pipeline/gap_detector.py
  -> Priority Engine          (Logic)            ri/pipeline/priority_engine.py
  -> Question Generator       (LLM  – Gemini)   ri/pipeline/question_generator.py
  -> User answers
  -> Answer Extractor         (LLM  – Gemini)   ri/pipeline/answer_extractor.py
  -> Requirement Builder      (Logic)            ri/pipeline/requirement_builder.py
  -> Project Brain            (requirements.yaml + project.yaml)
```

`ri/session.py` runs the loop until every required topic is answered (or `RI_MAX_ROUNDS` is hit).
Every LLM stage has a logic fallback — a bad Gemini response never stalls the interview.

---

## Folder structure

```
requirement-intelligence/
├── README.md
├── requirements.txt
├── .env.example            # copy to .env and add GEMINI_API_KEY
├── .gitignore
├── ri/
│   ├── __init__.py
│   ├── __main__.py         # python -m ri check|demo|run
│   ├── cli.py
│   ├── config.py
│   ├── schemas.py          # Pydantic data contracts
│   ├── session.py          # orchestrates the pipeline loop
│   ├── server.py           # FastAPI for VS Code extension / gateway
│   ├── llm/
│   │   ├── __init__.py     # get_llm(task) factory
│   │   ├── base.py
│   │   ├── gemini_client.py
│   │   ├── mock_client.py
│   │   └── prompts.py
│   └── pipeline/
│       ├── idea_analyzer.py
│       ├── project_type_detector.py
│       ├── template_loader.py
│       ├── requirement_graph.py
│       ├── gap_detector.py
│       ├── priority_engine.py
│       ├── question_generator.py
│       ├── answer_extractor.py
│       └── requirement_builder.py
├── templates/
│   ├── base.yaml           # shared nodes: users, auth, scale, deployment, data_model
│   ├── marketplace.yaml
│   ├── web_app.yaml
│   ├── api_service.yaml
│   └── generic.yaml
├── tests/
│   └── test_pipeline.py    # 9 tests, all offline, all use tmp_path
└── output/                 # generated YAML (git-ignored)
```

---

## Setup

Needs Python 3.10+. All commands run from `requirement-intelligence/`.

### Windows (PowerShell)
```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

### macOS / Linux
```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
```

---

## Run (step by step)

### 1 – Verify offline (no API key needed)
```bash
python -m pytest tests/ -q          # expect: 9 passed
python -m ri demo                   # offline mock run → output/demo/
```

### 2 – Plug in Gemini
```powershell
copy .env.example .env              # then open .env and set GEMINI_API_KEY
python -m ri check                  # pings Gemini
```
Get a key from [Google AI Studio](https://aistudio.google.com).

### 3 – Run the real interview
```bash
python -m ri run "Build an online marketplace for college students."
# type option numbers or free text; press Enter to skip; type 'done' to finish early
# output: output/requirements.yaml + output/project.yaml
```

### 4 – API server (for VS Code extension)
```bash
uvicorn ri.server:app --port 8001 --reload
```

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/health` | — | mode, model, key status |
| POST | `/session/start` | `{"idea":"...","mock":false,"out":"output"}` | first questions |
| POST | `/session/{id}/answer` | `{"answers":[{"node_id":"...","answer":"..."}]}` | next questions or `complete` |
| GET | `/session/{id}` | — | current snapshot |

Interactive docs: http://localhost:8001/docs

---

## Input / output contract

### Round JSON (what the extension renders as buttons)
```json
{
  "status": "questions",
  "round": 1,
  "project_type": "marketplace",
  "schema_version": "1.0",
  "progress": {"answered": 1, "total": 9},
  "fallbacks_used": 0,
  "questions": [
    {
      "node_id": "verification",
      "question": "How will sellers be verified?",
      "options": ["College email domain check", "Manual admin review", "No verification"],
      "allow_free_text": true
    }
  ]
}
```
> `fallbacks_used > 0` means the AI degraded this round and logic defaults were used.

### `output/requirements.yaml` (what Project Brain receives)
```yaml
requirements:
  - id: REQ-001
    project_id: "550e8400-e29b-41d4-a716-446655440000"
    title: Verified student sellers
    description: Only verified college students can sell products
    type: feature
    priority: high
    status: draft
    acceptance_criteria:
      - Seller must use a .edu email address
    linked_files: []
    agent_assignments: []
    created_at: "2026-09-18T17:00:00Z"
```

### `output/project.yaml` (Project Brain sidecar)
```yaml
id: "550e8400-e29b-41d4-a716-446655440000"
name: "College Marketplace"
version: "0.1.0"
description: "An online marketplace for verified college students"
created_at: "2026-09-18T17:00:00Z"
_ri:
  project_type: marketplace
  completeness: 87
  open_gaps: [payments]
  fallbacks_total: 1
  schema_version: "1.0"
  decisions:
    users: {answer: "Students only", source: idea}
    verification: {answer: "College email domain check", source: interview}
```

---

## Handoff to Project Brain
Point `--out` at the brain folder (agree the path with its owner):
```bash
python -m ri run "..." --out ../project-brain/.devos
```

---

## Add a new project type
Create `templates/<type>.yaml` with `keywords` and `nodes` (each node needs `weight`, `depends_on`, `default_options`, `question`). It is picked up automatically.

---

## Git workflow (harshini branch only)
```bash
git add requirement-intelligence/
git status   # verify shared/ does NOT appear
git commit -m "feat(requirement-intelligence): <what you did>"
git push -u origin harshini
```
Never commit `.env`.

---

## Troubleshooting
- **`GEMINI_API_KEY is not set`** – copy `.env.example` to `.env`, or use `--mock` flag.
- **`[ri…] fell back …` warnings** – Gemini returned unusable output; run continues with logic defaults. Check `python -m ri check` for the real error.
- **`fallbacks_used > 0` in round JSON** – AI degraded; answers are using template defaults, which are still valid.
- **PowerShell blocks activation** – run `Set-ExecutionPolicy -Scope Process Bypass` first.
- **Sessions reset on server restart** – by design (v1). `output/session.json` is loaded on startup if present.
