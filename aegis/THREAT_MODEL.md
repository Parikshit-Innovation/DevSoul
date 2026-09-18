# Aegis Threat Model & Security Boundaries

## 1. Executive Summary & Purpose
**Aegis** serves as the deterministic Security Control Plane for DevOS AI agents. It evaluates all prospective agent actions against declarative security policies, cryptographic path boundaries, role permissions, payload data leaks, shell command patterns, network egress rules, and temporal behavior sequences.

---

## 2. Threat Coverage (What Aegis Stops)

| Threat Category | Attack Vector Example | Aegis Control Mechanism | Decision & Effect |
| :--- | :--- | :--- | :--- |
| **Direct Sensitive File Access** | Reading `.env`, `.env.local`, `id_rsa`, `*.pem`, `*.key`, `*.tfstate`, `service-account.json` | Resource classifier data-table (`SENSITIVE` / `CRITICAL`) | `BLOCK`, immediate trust decay (`-34` to `-40`) |
| **Path Traversal & Root Escape** | `../../../../etc/passwd`, `%2e%2e%2f.env`, null bytes, symlink breakout | Canonicalization via `PathSecurityManager`, `fs.realpathSync`, strict workspace root confinement | `BLOCK`, `PATH_ESCAPE` anomaly |
| **Destructive & Malicious Commands** | `rm -rf /`, `curl \| sh`, `sudo su`, `chmod 777`, `git push --force` | Lexical AST tokenizer, shell pipe detection, hazardous pattern blocking | `BLOCK`, `COMMAND_INJECTION` anomaly |
| **Secret Exfiltration in Commands** | Shell reading secret files via `cat .env`, `type id_rsa`, `Get-Content .env` | Sub-command file operand extraction + resource classifier lookup | `BLOCK`, `COMMAND_INJECTION` anomaly |
| **Live Secret Leaks in Payloads** | Writing/transmitting raw AWS keys (`AKIA...`), Stripe keys (`sk_live_...`), Google AIza keys, GitHub tokens (`ghp_...`), private key blocks | Regex credential scanner with entropy heuristics and log redaction | `BLOCK` or `RESTRICT` with masking |
| **SSRF & Cloud Metadata Hijacking** | Requesting `http://169.254.169.254/latest/meta-data`, private subnets `10.0.0.0/8`, `192.168.0.0/16` | Network security gateway IP subnet & cloud endpoint filtering | `BLOCK`, `SSRF_METADATA_ACCESS` |
| **Privilege & Scope Escalation** | Frontend agent modifying database schemas (`database/schema.sql`) or out-of-scope backend files | Fine-grained scope globs (`allowedPaths`) and architectural layer enforcement | `APPROVE` (Human required) or `BLOCK` (`SCOPE_VIOLATION`) |
| **Sequential Reconnaissance / Probing** | Repeated probing of sensitive files in rapid succession | Sliding-window `BehaviorAnalyzer` sequence detection | `BLOCK` + immediate `QUARANTINE` |
| **Approval Replay & Tampering** | Reusing approved tickets or submitting forged payloads | SHA-256 payload hash binding (`actionHash`), single-use `consumeApproval()`, 10-minute expiry | Replay rejected (`CONSUMED` status) |
| **Post-Quarantine Unauthorized Work** | Quarantined agent attempting subsequent actions | Quarantine state machine lockdown | `BLOCK` (only `explain()` / `investigate()` permitted) |
| **Audit Log Tampering** | Adversary modifying logged records after incident | Cryptographic SHA-256 hash chaining with `verifyChain()` tamper detection | Tamper identified at exact sequence index |

---

## 3. Precedence Hierarchy

Aegis enforces a strict, deterministic precedence order for all incoming actions:

```text
┌─────────────────────────────────────────────────────────────┐
│ 1. Quarantine Check         -> Instant BLOCK               │
├─────────────────────────────────────────────────────────────┤
│ 2. Hard Deny Rules          -> Hard BLOCK (Escapes, Secrets)│
├─────────────────────────────────────────────────────────────┤
│ 3. Scope Violations         -> BLOCK (or APPROVE for roles) │
├─────────────────────────────────────────────────────────────┤
│ 4. High-Impact Approvals    -> APPROVE (Human-in-the-Loop)  │
├─────────────────────────────────────────────────────────────┤
│ 5. Restricted Actions       -> RESTRICT (Masking/Rate-limit)│
├─────────────────────────────────────────────────────────────┤
│ 6. Default Policy           -> ALLOW                        │
└─────────────────────────────────────────────────────────────┘
```

---

## 4. Honest Limits & Assumptions

To maintain transparent and realistic security guarantees, the following system boundaries must be recognized:

1. **Gateway Reliance**:
   - Aegis is a **Control Plane**, not an OS kernel. It is only effective if all agent tool invocations, file operations, commands, and network calls are mediated through the MCP Gateway, API adapter, or `check()` interceptor. If an agent executes raw native code outside the gateway, Aegis cannot intercept it.
2. **Worktrees vs. OS Sandboxing**:
   - The Git Time Machine provides branch-level rollback, state restoration, and auditable trailer commits on isolated worktrees (`agent/<id>`). However, Git worktrees are not OS-level sandboxes (e.g. Docker, gVisor, or seccomp) and do not isolate host CPU/memory or OS system calls.
3. **Pattern-Based Secret Classification**:
   - Payload scanning uses high-entropy pattern definitions and regex heuristics for recognized cloud and API tokens. Highly novel secret formats, encrypted blobs, or steganographic text may bypass heuristic pattern scanners without dynamic runtime sandboxing.
4. **Deterministic Policy vs. Machine Learning**:
   - Aegis intentionally avoids non-deterministic Large Language Models (LLMs) in the critical path decision loop. Decisions are 100% deterministic, auditable, and testable using rules, metrics, and risk heuristics.
5. **Human Approval Authority**:
   - Once a human reviewer approves a ticket via `approveRequest()`, Aegis trusts the human resolver identity and permits execution of that specific, cryptographically-hashed payload exactly once.

---

## 5. Security Invariants

- **Fail-Closed**: Any unhandled exception, syntax failure, or circular input automatically resolves to `BLOCK` with `CRITICAL` risk level.
- **Zero Raw Secrets in Logs**: All audit records, git commits, and timeline messages are processed through `payloadScanner.mask()` prior to persistence.
- **Single-Use Approvals**: Every approval ticket binds to `SHA256(agentId + action + target + args)` and can only be consumed once.
