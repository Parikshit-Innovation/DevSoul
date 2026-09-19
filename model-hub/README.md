# DevOS Model Hub & Intelligent Privacy Router

**Feature 3.5 — DevOS Architecture Blueprint**  
**Role**: Unified model-agnostic control plane exposing cloud models (via OpenRouter) and local models (via Ollama) with deterministic, privacy-first routing, manual overrides, live health discovery, and an interactive Model Hub UI.

---

## 1. Prerequisites & Node Version

- **Node.js**: Requires Node **v22.0.0+** (`node --experimental-strip-types`).
- **Dependencies**: Zero third-party runtime dependencies. Uses native Node.js (`node:http`, `node:crypto`, `node:fs`, `node:path`, `node:test`, `node:assert`, `fetch`, `AbortController`).

---

## 2. Architecture Overview

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

## 3. Key Privacy & Security Invariants

1. **Hard Privacy Isolation**: Private tasks (sensitive globs, API tokens, private keys, or `privateProject: true`) **NEVER** route or fall back to cloud models.
2. **Zero Cloud Leaks**: If local models are unavailable during a private task, the request is **safely refused** with `NO_LOCAL_MODEL_AVAILABLE` instead of degrading to cloud.
3. **Explicit Override Shield**: A developer attempting to force a cloud model on private code is blocked with `PRIVATE_TO_CLOUD_BLOCKED` unless `confirmPrivateToCloud: true` is explicitly provided and prominently audited.
4. **No Raw Secret Logging**: Audit logs hash prompts with SHA-256 and store only character counts, latencies, and metadata.
5. **Server Hardening**: Binds to `127.0.0.1` by default with loud warnings if exposed elsewhere, enforces DNS-rebinding (Host check), CSRF/CORS (no wildcard Origin), `2MB` max payload size (413), and strict security headers (`CSP`, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`).
6. **XSS Protection**: Web UI renders all dynamic text (reasons, errors, model names, outputs) via `textContent`, eliminating DOM injection risks.

---

## 4. Quick Start & Commands

```bash
# 1. Run Complete Automated Test Suite (68 passing unit & integration tests)
npm test

# 2. Run TypeScript Typecheck (Strict Zero Errors)
npm run typecheck

# 3. Run Live Catalog Smoke Test against OpenRouter & Ollama
npm run smoke

# 4. Run End-to-End Demonstration Script ([LIVE] and [MOCKED] indicators)
npm run demo

# 5. Launch Model Hub Server & Web UI (http://127.0.0.1:3000)
npm start
```

---

## 5. Environment Variables

Create `.env` (or copy from `.env.example`):

| Variable | Default | Description |
| :--- | :--- | :--- |
| `OPENROUTER_API_KEY` | `""` | OpenRouter API Key for cloud models |
| `OPENROUTER_BASE_URL` | `https://openrouter.ai/api/v1` | OpenRouter API Base URL |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Ollama local API Base URL |
| `MODEL_HUB_HOST` | `127.0.0.1` | Local address to bind (defaults to localhost) |
| `MODEL_HUB_PORT` | `3000` | HTTP Server port for API & Model Hub UI |
| `MODEL_HUB_TOKEN` | `""` | Optional Bearer authentication token for `/api/*` endpoints |
| `PRIVATE_PROJECT` | `false` | Global setting: force all project tasks to local models |

---

## 6. Integrating with DevOS Modules

### A. Integrating with `gateway/` (HTTP Client)

Teammates building the DevOS Gateway or Orchestrator can call the Model Hub over HTTP using either the exported `ModelHubClient` or native `fetch`:

```typescript
import { ModelHubClient } from '../model-hub/src/client.ts';

// 1. Initialize client
const modelHub = new ModelHubClient({
  baseUrl: process.env.MODEL_HUB_URL || 'http://127.0.0.1:3000',
  token: process.env.MODEL_HUB_TOKEN, // Optional bearer token
});

// 2. Dry-run preview routing decision
const decision = await modelHub.route({
  messages: [{ role: 'user', content: 'Design event-driven payment system' }],
  category: 'architecture',
});
console.log(`Routed to model: ${decision.modelId} (${decision.location})`);

// 3. Execute chat completion
const result = await modelHub.chat({
  messages: [{ role: 'user', content: 'Generate unit tests for login.ts' }],
  category: 'test_generation',
});
console.log(result.content);
console.log(`Tokens: ${result.usage?.totalTokens}, Est Cost: $${result.estimatedCostUsd || 'Free'}`);

// 4. Stream response
for await (const delta of modelHub.chatStream({
  messages: [{ role: 'user', content: 'Write a quick refactoring function' }],
})) {
  process.stdout.write(delta);
}
```

### B. Integrating with `extension/` (VS Code Extension)

In the VS Code extension, route and execute tasks directly:

```typescript
import { ModelHubClient } from '../../model-hub/src/client.ts';

const client = new ModelHubClient({ baseUrl: 'http://127.0.0.1:3000' });

export async function onUserPrompt(prompt: string, activeFilePath?: string) {
  // If user opens a sensitive file like .env or secrets/keys.json, pass it in filePaths
  const response = await client.chat({
    messages: [{ role: 'user', content: prompt }],
    filePaths: activeFilePath ? [activeFilePath] : undefined,
  });

  return response.content;
}
```

### C. Integrating with `aegis/` (Security Control Plane)

Use `AegisAdapter` to seamlessly bridge Aegis's Resource Classifier & Payload Scanner into Model Hub routing:

```typescript
import { createModelHub } from '../model-hub/src/index.ts';
import { createAegisIntegration } from '../model-hub/src/integrations/aegis.ts';
import aegisInstance from '../aegis/src/index.ts';

// 1. Create adapter
const aegisAdapter = createAegisIntegration(aegisInstance);

// 2. Initialize Model Hub with Aegis as SensitivityProvider and AuditSink
const hub = createModelHub();
hub.privacyDetector.setSensitivityProvider(aegisAdapter);
hub.auditLogger.setExternalSink(aegisAdapter);
```

---

## 7. Model Hub UI

Open `http://127.0.0.1:3000` in any modern browser to view the interactive management console:
- **Catalogue & Live Badges**: Shows all configured models with live health checks (`READY` vs `OFFLINE`), cost per 1M tokens, latency tier, and context window size.
- **Dry-run Router Preview**: Test prompts in real time and inspect the deterministic decision trail explaining why a specific model was chosen.
- **Privacy Override Safety**: Selecting a Cloud Model for Private tasks renders a prominent warning and requires an explicit confirmation checkbox.
- **Live Auditing**: Inspect recent routing decisions with latency and token metrics.

---

## 8. How to Configure & Customize

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
