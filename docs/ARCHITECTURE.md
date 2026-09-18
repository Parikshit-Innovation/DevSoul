# DevSoul — Architecture Overview

> **DevSoul** is an AI Development Operating System that orchestrates agents, models, context, tools, security, testing, and deployment across the full software lifecycle — from idea to production.

---

## System Components

```
┌──────────────────────────────────────────────────────────────┐
│                        VS Code Extension                     │  ← MEMBER D
│                  (extension/)                                │
└───────────────────────────┬──────────────────────────────────┘
                            │  HTTP / WebSocket
┌───────────────────────────▼──────────────────────────────────┐
│                          Gateway                             │  ← built together
│              routes, auth middleware, websockets             │
└──┬──────────────┬────────────────┬───────────────────────────┘
   │              │                │
   ▼              ▼                ▼
┌──────┐   ┌───────────┐   ┌──────────────────────┐
│Aegis │   │  Agent    │   │  Requirement Intel.  │  ← MEMBER B / A / C
│(sec) │   │  Factory  │   │  + Project Brain     │
└──────┘   └───────────┘   └──────────────────────┘
   │              │                │
   └──────────────┴────────────────┘
                  │
         shared/schemas/  ← frozen contract (YAML schemas)
```

---

## Module Responsibilities

| Module | Owner | Purpose |
|---|---|---|
| `agent-factory/` | Member A | Dynamically spawns, configures, and manages AI agents |
| `aegis/` | Member B | Security control plane — policy enforcement, sandboxing, audit |
| `requirement-intelligence/` | Member C | Parses requirements, extracts intent, links to code |
| `project-brain/` | Member C | Long-term context store, vector memory, knowledge graph |
| `gateway/` | All | API gateway that wires all services together |
| `extension/` | Member D | VS Code UI, commands, side-panel, auth flows |
| `shared/schemas/` | All | Agreed YAML schemas — **frozen before development starts** |

---

## Data Flow

1. Developer opens a repo in VS Code → **Extension** activates.
2. Extension sends intent/requirements → **Gateway**.
3. Gateway authenticates & routes through **Aegis**.
4. **Requirement Intelligence** parses the request → emits a structured `requirement` object (see `requirements.schema.yaml`).
5. **Project Brain** fetches relevant context (code, history, docs).
6. **Agent Factory** spins up the right agent(s) with the context.
7. Agents execute tasks, results flow back through Gateway → Extension.

---

## Shared Schema Contract

All services serialize data against schemas in `shared/schemas/`.  
**Do not change a schema without team agreement** — treat them as a versioned API contract.

| Schema | Purpose |
|---|---|
| `project.schema.yaml` | Top-level project metadata |
| `requirements.schema.yaml` | Structured requirement objects |
| `agents.schema.yaml` | Agent definitions and capabilities |
| `policy.schema.yaml` | Aegis security policies |

---

## Getting Started

See the root `README.md` and each module's own `README.md` for setup instructions.
