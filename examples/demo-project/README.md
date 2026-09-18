# Demo Project — DevSoul Example

This is the sample repository that the DevSoul agents work on during the team demo.  
It represents a minimal real-world project that exercises all system components end-to-end.

---

## Purpose

- **Validate** that Agent Factory, Aegis, Requirement Intelligence, and Project Brain all work together
- **Demonstrate** the full DevSoul workflow: intent → requirement → agent → code change
- **Serve as a template** for onboarding new projects to DevSoul

---

## The `.devos/` directory

The `.devos/` folder at the root of this demo project contains actual instances of the shared schemas:

| File | Schema |
|---|---|
| `.devos/project.yaml` | `shared/schemas/project.schema.yaml` |
| `.devos/requirements.yaml` | `shared/schemas/requirements.schema.yaml` |
| `.devos/agents.yaml` | `shared/schemas/agents.schema.yaml` |
| `.devos/policy.yaml` | `shared/schemas/policy.schema.yaml` |

These files are what the DevSoul system reads and writes when operating on this project.

---

## Demo Script (placeholder)

1. Open this folder in VS Code with DevSoul extension active
2. Type a requirement in the side panel
3. Watch Requirement Intelligence parse it → Project Brain add context → Agent Factory assign an agent → agent produces a code change
