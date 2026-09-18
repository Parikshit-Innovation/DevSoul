# Gateway

**Owner**: All members (built together once standalone modules are ready)  
**Purpose**: Central API gateway that routes requests between the VS Code Extension and all backend services (Agent Factory, Aegis, Requirement Intelligence, Project Brain).

---

## Responsibilities

- Authentication & authorisation (JWT / API keys)
- Route incoming requests to the correct backend service
- Apply Aegis security checks on every request
- WebSocket support for streaming agent output to the Extension
- Rate limiting, logging, and health checks

---

## Getting Started

```bash
# Install dependencies
# (add your command here)

# Run in dev mode
# (add your command here)
```

---

## Environment Variables

Copy `.env.example` at the repo root and fill in:
- `GATEWAY_PORT`
- `GATEWAY_SECRET`
- Service URLs for each backend module

---

## Route Map

| Method | Path | Forwards To |
|---|---|---|
| `POST` | `/api/requirements/analyse` | Requirement Intelligence |
| `GET/POST` | `/api/agents/*` | Agent Factory |
| `POST` | `/api/security/evaluate` | Aegis |
| `POST` | `/api/brain/query` | Project Brain |
| `WS` | `/ws/stream` | Agent Factory (streaming) |

---

## Directory Structure (suggested)

```
gateway/
├── README.md       ← you are here
├── src/
│   ├── server.py (or server.ts)
│   ├── auth.py
│   ├── router.py
│   └── middleware/
├── tests/
└── requirements.txt (or package.json)
```
