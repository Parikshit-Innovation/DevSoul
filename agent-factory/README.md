# Agent Factory

**Owner**: Member A  
**Purpose**: Dynamically spawns, configures, routes, and manages AI agents across the DevSoul system.

---

## Responsibilities

- Register agent definitions (from `shared/schemas/agents.schema.yaml`)
- Instantiate agents on-demand based on task requirements
- Manage agent lifecycle (create → run → idle → destroy)
- Route tasks to the correct agent(s)
- Expose a REST/gRPC API consumed by the Gateway

---

## Getting Started

```bash
# Install dependencies (add your preferred stack below)
# e.g. for Python:
pip install -r requirements.txt

# e.g. for Node:
npm install

# Run in dev mode
# (add your command here)
```

---

## API Contract

All requests/responses must conform to `shared/schemas/agents.schema.yaml`.

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/agents/spawn` | Spawn a new agent instance |
| `GET` | `/agents/:id` | Get agent status |
| `DELETE` | `/agents/:id` | Terminate an agent |
| `GET` | `/agents` | List all active agents |

---

## Directory Structure (suggested)

```
agent-factory/
├── README.md       ← you are here
├── src/
│   ├── factory.py  (or factory.ts)
│   ├── registry.py
│   ├── router.py
│   └── models/
├── tests/
└── requirements.txt (or package.json)
```
