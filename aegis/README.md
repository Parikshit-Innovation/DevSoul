# Aegis — Intelligent AI Security Control Plane

**Part B — DevOS Architecture Blueprint**  
**Role**: Context-Aware Security Enforcement, Threat Prevention, Multi-Factor Risk Assessment, Dynamic Trust Management, Cryptographic Audit Trail, Git-Backed Time Machine, and Human-in-the-Loop Approvals for AI Agents.

---

## 1. System Overview

Aegis is the deterministic security control plane that intercepts and governs every agent action before execution. It ensures agents operate strictly within declared scopes, prevents secret exfiltration, blocks dangerous shell commands, isolates compromised agents via quarantine containment, and provides forensic audit trails backed by SHA-256 hash chaining and Git worktree checkpoints.

```text
                        AGENT ACTION / MCP TOOL CALL
                                     │
                                     ▼
                        ┌────────────────────────┐
                        │      AEGIS ENGINE      │
                        │ check(agent, act, tgt) │
                        └────────────┬───────────┘
                                     │
    ┌────────────────────────────────┼────────────────────────────────┐
    ▼                                ▼                                ▼
IDENTITY BINDING              RESOURCE CLASSIFIER             BEHAVIOR ANALYZER
(Scope globs, MCP allowlist)  (PUBLIC, INTERNAL, SENSITIVE)   (Probing, Exfil, Scope)
    │                                │                                │
    └────────────────────────────────┼────────────────────────────────┘
                                     ▼
                                RISK ENGINE
                       (Multi-Factor Score 0–100 -> LOW / MED / HIGH / CRITICAL)
                                     │
                                     ▼
                              POLICY PRECEDENCE
              ┌──────────────────────┬──────────────────────┐
              ▼                      ▼                      ▼
            ALLOW                 RESTRICT               APPROVE
              │                      │                      │
              │                      │               HUMAN-IN-THE-LOOP
              │                      │               (Single-Use Token)
              │                      │                      │
              └──────────────────────┴──────────────────────┘
                                     │
                                   BLOCK
                                     │
                                     ▼
                            TRUST ENGINE (0–100)
                         (Decay, Probation, Recovery)
                                     │
                                     ▼
                          CRYPTOGRAPHIC AUDIT LOG
                       (SHA-256 Chained JSONL Records)
                                     │
                                     ▼
                            QUARANTINE ENFORCER
                         (Total Containment Lockdown)
                                     │
                                     ▼
                              TIME MACHINE
                       (Git Trailers & State Replay)
```

---

## 2. Decision Precedence Hierarchy

Aegis enforces a strict, deterministic evaluation hierarchy:

| Priority | Stage | Description | Outcome |
| :--- | :--- | :--- | :--- |
| **1** | **Quarantine Containment** | Quarantined agent attempting any action | `BLOCK` (Lockdown) |
| **2** | **Hard-Deny Security Rules** | Path traversal, credential leaks, destructive shell commands (`rm -rf`, `curl \| sh`), SSRF cloud metadata | `BLOCK` (Critical Risk) |
| **3** | **Scope Violations** | Out-of-scope paths or unauthorized architectural layer access (e.g. frontend -> database) | `BLOCK` or `APPROVE` |
| **4** | **Human Approval** | High-impact actions (`install_package`, schema migrations, `git_push`, package.json edits) | `APPROVE` (`WAITING_FOR_HUMAN`) |
| **5** | **Restricted Constraints** | Untrusted external network calls or actions permitted with masking/limits | `RESTRICT` (Constraints object) |
| **6** | **Default Allow** | In-scope, low-risk operations | `ALLOW` |

---

## 3. Integration Contract

### A. TypeScript / Programmatic API

```typescript
import {
  check,
  registerAgent,
  approvalManager,
  quarantineManager,
  auditLogger,
  timeMachine,
  events,
} from "./src/index.ts";

// 1. Register agent with fine-grained scope & MCP allowlist
registerAgent({
  id: "frontend-agent-01",
  role: "frontend",
  allowedPaths: ["src/frontend/**", "public/**"],
  allowedMcpTools: ["readFile", "writeFile"],
  initialTrust: 100,
});

// 2. Evaluate an action
const decision = check("frontend-agent-01", "read", "src/frontend/App.tsx");
console.log(decision.decision); // "ALLOW"

// 3. High-impact action requiring human approval
const approvalDecision = check("frontend-agent-01", "install_package", "express");
console.log(approvalDecision.decision); // "APPROVE"
const ticketId = approvalDecision.approvalRequest!.id;

// 4. Human resolves approval ticket
approvalManager.approveRequest(ticketId, "secops_lead");

// 5. Gateway consumes single-use approval (Replay-Proof)
const consumed = approvalManager.consumeApproval(
  ticketId,
  "frontend-agent-01",
  { type: "install_package" },
  { resource: "express" }
);
```

### B. Typed Event Subscriptions (SSE / UI Integration)

```typescript
import { events } from "./src/index.ts";

events.subscribe("trust_changed", (data) => {
  console.log(`Agent ${data.agentId} trust changed: ${data.trustBefore} -> ${data.trustAfter}`);
});

events.subscribe("quarantined", (data) => {
  console.log(`🚨 Agent ${data.agentId} QUARANTINED: ${data.reason}`);
});
```

### C. Built-in Local HTTP Control Plane API (`127.0.0.1:4000`)

| Method | Route | Description |
| :--- | :--- | :--- |
| `POST` | `/check` | Evaluate action: `{ agentId, action, target }` |
| `POST` | `/agents` | Register agent manifest: `{ id, role, allowedPaths, allowedMcpTools }` |
| `GET` | `/agents/:id` | Get registered agent profile and trust state |
| `GET` | `/audit` | Query cryptographically chained JSONL audit log |
| `GET` | `/approvals` | List pending / resolved approval requests |
| `POST` | `/approvals/:id/resolve` | Resolve ticket: `{ action: "approve" \| "deny", resolverId }` |
| `GET` | `/events` | Server-Sent Events (SSE) live event stream |

---

## 4. Policy Configuration as Data

Policies are defined under `.devos/policy.json` (or customizable location) with versioning and dynamic `reload()`:

```json
{
  "policyVersion": "1.0.0",
  "riskThresholds": { "medium": 25, "high": 50, "critical": 75 },
  "trustPenalties": { "low": 0, "medium": 15, "high": 25, "critical": 34 },
  "quarantineThreshold": 20,
  "probingWindowSeconds": 60,
  "networkPolicy": {
    "allowedHosts": ["api.openai.com", "api.anthropic.com", "api.github.com"],
    "allowLocalhost": false
  }
}
```

---

## 5. Verification & Tooling

```bash
# 1. Run Complete Automated Test Suite (60+ Assertions across all 11 Subsystems)
npm test

# 2. Run TypeScript Typecheck (Strict Zero Errors)
npm run typecheck

# 3. Run Adversarial Red Team Attack Suite (10 Automated Threat Vectors)
npm run redteam

# 4. Run Live Protected Beat Demonstration (< 60s)
npm run demo

# 5. Launch Interactive Aegis Security CLI
npm run cli
```

---

## 6. Verification Status

**Verified & Complete**: All 8 Phases of the DevOS Aegis Specification are fully implemented with zero external runtime dependencies, 100% green test suite (49 test cases, 60+ assertions), clean TypeScript compilation, and 10/10 passing Adversarial Red Team attack scenarios.
