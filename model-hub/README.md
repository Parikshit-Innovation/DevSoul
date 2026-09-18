# DevOS Model Hub & Intelligent Privacy Router

**Feature 3.5 — DevOS Architecture Blueprint**  
**Role**: Unified model-agnostic control plane exposing cloud models (via OpenRouter) and local models (via Ollama) with deterministic, privacy-first routing, manual overrides, live health discovery, and an interactive Model Hub UI.

---

## 1. Architecture Overview

```text
                               TASK REQUEST / PROMPT
                                         │
                                         ▼
                            ┌────────────────────────┐
                            │    MODEL ROUTER CORE   │
                            └────────────┬───────────┘
                                         │
       ┌─────────────────────────────────┼─────────────────────────────────┐
       ▼                                 ▼                                 ▼
1. CATEGORY DETECTOR            2. PRIVACY DETECTOR             3. OVERRIDE VALIDATOR
(Keywords & Intent Heuristics)  (Secrets, Globs, Aegis Hook)    (Rejects Cloud on Private)
       │                                 │                                 │
       └─────────────────────────────────┼─────────────────────────────────┘
                                         ▼
                               4. ORDERED RULE TABLE
                             (routing.rules.ts matching)
                                         │
                                         ▼
                               5. CONSTRAINT FILTER
                       (Privacy Pruning -> Availability Check)
                                         │
                                         ▼
                               6. SURVIVOR SELECTION
                                         │
                    ┌────────────────────┴────────────────────┐
                    ▼                                         ▼
             🔒 LOCAL INFERENCE                        ☁️ CLOUD INFERENCE
            (Ollama / Local GPUs)                    (OpenRouter / Cloud APIs)
          e.g. Qwen 2.5 Coder 7B                    e.g. Claude 3.5 Sonnet
                    │                                         │
                    └────────────────────┬────────────────────┘
                                         ▼
                            OPENAI-COMPATIBLE ADAPTER
                               (Chat & SSE Stream)
                                         │
                                         ▼
                           PRIVACY-SAFE AUDIT LOG
                      (SHA-256 Prompt Hash, Latency, Cost)
```

---

## 2. Key Privacy Invariants

1. **Hard Privacy Isolation**: Private tasks (sensitive globs, API tokens, private keys, or `privateProject: true`) **NEVER** route or fall back to cloud models.
2. **Zero Cloud Leaks**: If local models are unavailable during a private task, the request is **safely refused** with `NO_LOCAL_MODEL_AVAILABLE` instead of degrading to cloud.
3. **Explicit Override Shield**: A developer attempting to force a cloud model on private code is blocked with `PRIVATE_TO_CLOUD_BLOCKED` unless `confirmPrivateToCloud: true` is explicitly provided and prominently audited.
4. **No Raw Secret Logging**: Audit logs hash prompts with SHA-256 and store only character counts, latencies, and metadata.

---

## 3. Quick Start & Commands

```bash
# 1. Run Complete Automated Test Suite (29 unit tests covering all 12 acceptance cases)
npm test

# 2. Run TypeScript Typecheck (Strict Zero Errors)
npm run typecheck

# 3. Run 2-Minute End-to-End Demonstration Script
npm run demo

# 4. Launch Model Hub Server & Web UI (http://localhost:3000)
npm start
```

---

## 4. Environment Variables

Create `.env` (or copy from `.env.example`):

| Variable | Default | Description |
| :--- | :--- | :--- |
| `OPENROUTER_API_KEY` | `""` | OpenRouter API Key for cloud models |
| `OPENROUTER_BASE_URL` | `https://openrouter.ai/api/v1` | OpenRouter API Base URL |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Ollama local API Base URL |
| `MODEL_HUB_PORT` | `3000` | HTTP Server port for API & Model Hub UI |
| `PRIVATE_PROJECT` | `false` | Global setting: force all project tasks to local models |

---

## 5. How to Configure & Customize

### A. Adding / Modifying Models (`models.config.json`)
Models are dynamically loaded and validated against live `/models` (OpenRouter) and `/api/tags` (Ollama) responses:

```json
{
  "id": "my-custom-model",
  "provider": "ollama",
  "remoteName": "qwen2.5-coder:14b",
  "displayName": "Qwen 2.5 Coder 14B",
  "location": "local",
  "strengths": ["architecture", "refactor_simple", "code_review"],
  "costPer1MInputUsd": 0.0,
  "costPer1MOutputUsd": 0.0,
  "latencyTier": "medium",
  "contextWindow": 32768,
  "enabled": true
}
```

### B. Changing Routing Rules (`routing.rules.ts`)
Rules are evaluated in order; the first matching rule specifies the model priority list:

```typescript
export const DEFAULT_ROUTING_RULES: RoutingRule[] = [
  {
    name: 'Private Code Rule',
    when: { sensitivity: 'private' },
    prefer: ['qwen-2-5-coder-7b', 'deepseek-r1-8b'],
  },
  {
    name: 'Architecture Rule',
    when: { category: 'architecture' },
    prefer: ['claude-3-5-sonnet', 'gpt-4o', 'qwen-2-5-coder-7b'],
  }
];
```

---

## 6. HTTP API Reference (`node:http`)

| Method | Route | Description |
| :--- | :--- | :--- |
| `GET` | `/api/models` | List all configured models and their live availability status |
| `POST` | `/api/models/refresh` | Force live health checks against OpenRouter & Ollama |
| `POST` | `/api/route` | Dry-run routing decision with ordered `reasons` trail (No model call) |
| `POST` | `/api/chat` | Route and execute OpenAI-compatible completion |
| `POST` | `/api/chat/stream` | Stream text deltas via Server-Sent Events (SSE) |
| `GET` | `/api/decisions` | Get recent routing decisions and audit trail |

---

## 7. 2-Minute Demo Script (Stage Walkthrough)

Run `npm run demo` or use the Web UI (`http://localhost:3000`):

1. **Beat 1 (Discovery)**: Show the Model Hub catalogue with cloud models (`claude-3-5-sonnet`, `llama-3-1-8b`) and local models (`qwen-2-5-coder-7b`, `deepseek-r1-8b`) with live health indicators.
2. **Beat 2 (Cloud Routing)**: Run an architecture task (`"Design a scalable microservices architecture"`). Verify it automatically routes to `claude-3-5-sonnet` (cloud reasoning).
3. **Beat 3 (Local Routing)**: Run a refactoring task (`"Refactor and rename these helper variables"`). Verify it automatically routes to `qwen-2-5-coder-7b` (local coder).
4. **Beat 4 (Privacy Constraint)**: Run an architecture prompt with `.env.production` attached. Verify the router overrides the category preference and routes strictly to `qwen-2-5-coder-7b` (local).
5. **Beat 5 (Privacy Shield)**: Simulate Ollama being stopped during a private task. Verify the request throws `NO_LOCAL_MODEL_AVAILABLE` and makes **0 cloud network calls**.
6. **Beat 6 (Manual Override)**:
   - Attempt overriding a private task to `claude-3-5-sonnet` without confirmation -> Blocked (`PRIVATE_TO_CLOUD_BLOCKED`).
   - Add `confirmPrivateToCloud: true` -> Allowed with an explicit audit warning.
