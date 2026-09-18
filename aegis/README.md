# Aegis — Security Control Plane

**Owner**: Member B  
**Purpose**: Policy enforcement, sandboxing, audit logging, and threat detection for all agent actions.

---

## Responsibilities

- Evaluate every agent action against `shared/schemas/policy.schema.yaml` rules
- Block or allow actions (allow/deny effect)
- Maintain an immutable audit log
- Provide a policy management API
- Optionally: trigger human-approval flows for high-risk actions

---

## Getting Started

```bash
# Install dependencies
# (add your command here)

# Run in dev mode
# (add your command here)
```

---

## API Contract

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/evaluate` | Evaluate whether an action is permitted |
| `GET` | `/policies` | List all policies |
| `POST` | `/policies` | Create a policy |
| `PUT` | `/policies/:id` | Update a policy |
| `GET` | `/audit` | Query audit logs |

---

## Directory Structure (suggested)

```
aegis/
├── README.md       ← you are here
├── src/
│   ├── evaluator.py
│   ├── policy_store.py
│   ├── audit.py
│   └── api.py
├── tests/
└── requirements.txt (or package.json)
```
