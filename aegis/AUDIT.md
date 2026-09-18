# Aegis Architecture & Feature Audit (DevOS Blueprint)

Audit Date: 2026-09-18
Evaluator: Member B (Security Subsystem Lead)

This audit documents the baseline assessment of the existing Aegis implementation across Phases 1 through 8.

| Phase / Requirement | Status | Existing References | Analysis & Gap Description |
|---|---|---|---|
| **Phase 1: Hardening** | | | |
| 1.1 Path Canonicalization & Root Escaping | Partial | `src/resourceClassifier.ts` | Basic regex exists. Missing: `workspaceRoot` resolution, symlink realpathing, Windows/POSIX separator normalization, null-byte/URL-encoding (`%2e%2e`) handling, `PATH_ESCAPE` anomaly emission. |
| 1.2 Data-driven Classifier Table | Partial | `src/resourceClassifier.ts` | Regex list exists. Missing: Configurable data table, distinguishing `.env.example`/`.sample`/`.template` as `INTERNAL`, coverage for `.npmrc`, `.pypirc`, `.netrc`, `.git/config`, `*.tfstate`, `service-account*.json`, `.p12`. |
| 1.3 Command Analyzer (`run_command`, etc.) | Partial | `src/policyEngine.ts` | Basic string checks for `install_package`/`modify_schema`. Missing: Robust tokenization (quotes, `;`, `&&`, `\|`, `$()`, backticks), file operand extraction & classification, dangerous pattern flags (`rm -rf`, `sudo`, `chmod 777`, `curl\|sh`, `git push --force`, exfil via base64/grep). Unparseable command fallback to `APPROVE`. |
| 1.4 Secret & Payload Scanning (Tokens, Keys) | Missing | None | No payload scanner in `write` or `network_call` for AWS keys, Stripe `sk_live`, Google `AIza`, GitHub `ghp_`, private key headers, or high-entropy secrets. Missing redaction/masking in logs. |
| 1.5 Network Call Policy & Exfiltration Checks | Partial | `src/behaviorAnalyzer.ts`, `src/policyEngine.ts` | Basic URL check exists. Missing: destination allow-list, blocking private/metadata IPs (`169.254.169.254`, `localhost` unless allowed), payload inspection against sensitive data sources. |
| 1.6 Server-side Identity Binding (`registerAgent`) | Partial | `src/middleware.ts` | Client can pass ad-hoc role and trust in `check()`. Missing: Server-side agent registry (`registerAgent`), rejecting unknown agents with `BLOCK`, enforcing manifest scope globs & MCP allow-lists. |
| **Phase 2: Policy as Data, Scope, Decision Semantics** | | | |
| 2.1 External Policy File (`.devos/policy.json` / path) | Missing | `src/policyEngine.ts` | Hardcoded policy in code. Missing: Configurable JSON policy file with action weights, risk thresholds, trust penalties, quarantine thresholds, host allowlists, schema validation, `reload()`, `policyVersion`. |
| 2.2 Fine-grained Scope Enforcement | Partial | `src/behaviorAnalyzer.ts` | Role mismatch heuristics exist. Missing: Strict file-scope glob evaluation (`allowedPaths`), `SCOPE_VIOLATION` decision with trust penalty, separating scope blocks from legitimate in-scope `APPROVE` actions. |
| 2.3 Concrete `RESTRICT` Implementation | Missing | `src/models.ts`, `src/middleware.ts` | `RESTRICT` returns string reason only. Missing: structured `constraints` object (e.g. read-only, redaction required, max payload size, no network), demo scenario. |
| 2.4 Strict Decision Precedence & Explainability | Partial | `src/middleware.ts` | Flow exists but lacks formal hierarchy: Quarantine > Hard-Deny > Scope Violation > Approval > Restrict > Allow. Missing: `ruleId`, `decidedBy`, `policyVersion` in all results; automatic risk elevation to `HIGH`/`CRITICAL` on hard-deny. |
| **Phase 3: Trust & Approval Lifecycle** | | | |
| 3.1 Trust Clamping & Clean Action Recovery | Partial | `src/trustManager.ts` | Penalty decay works (`92 -> 58 -> 18`). Missing: Slow capped trust recovery for clean allowed actions; disabling recovery during probation. |
| 3.2 Permanent Quarantine & Admin Release | Partial | `src/quarantineManager.ts` | Quarantine triggers properly. Missing: Permanent lockdown until explicit `releaseFromQuarantine(agentId, adminId, reason)` with probation reset and audit event; strict enforcement allowing only `explain()`/`investigate()`. |
| 3.3 Cryptographic Single-Use Approvals | Partial | `src/approvalManager.ts` | State machine exists. Missing: Binding approval to hash of `(agentId, action, target, args)`, single-use consumption (`consumeApproval`), 10-minute expiry auto-deny, replay rejection, resolver identity. |
| 3.4 Concurrency Serialization per Agent | Missing | `src/middleware.ts` | Concurrent `check()` calls can race trust score updates. Missing: Per-agent queue / mutex lock. |
| **Phase 4: Audit, Events, Investigation & HTTP Adapter** | | | |
| 4.1 Cryptographic Hash-Chained JSONL Audit Log | Partial | `src/auditLogger.ts` | In-memory log array. Missing: Append-only JSONL file persistence (`.devos/audit/aegis.jsonl`), SHA-256 hash chaining (`seq`, `prevHash`, `hash`), `verifyChain()` tamper detection, UTC ISO timestamps. |
| 4.2 Typed EventEmitter for Live UI Updates | Missing | None | No event emitter for `decision`, `trust_changed`, `quarantined`, `approval_requested`, `approval_resolved`. |
| 4.3 Enhanced Investigation Report | Partial | `src/quarantineManager.ts` | Report exists. Missing: clear separation of attempted vs granted resources, decision timeline with `ruleIds`, trust trajectory graph data, git commit section from Time Machine, real function recommendations. |
| 4.4 Local HTTP Server Adapter (`node:http`) | Missing | None | No REST / SSE server on 127.0.0.1 for `/check`, `/agents`, `/audit`, `/approvals`, `/events`. |
| **Phase 5: MCP Gateway** | | | |
| 5.1 Per-agent MCP Tool Allow-list & Mapping | Partial | `src/index.ts` | Minimal interceptor exists. Missing: Dedicated MCP Gateway class with tool-to-action declarative mapper, `{name, arguments}` call shape, allow-list enforcement, audit distinction ("gateway" vs "aegis"), fake filesystem MCP test fixture. |
| **Phase 6: Time Machine (Git-Backed)** | | | |
| 6.1 Git Worktree Isolation & Checkpointing | Missing | None | No git worktree management (`agent/<id>`), checkpointing with structured commit trailers, `--allow-empty` for containment blocks, `restore()`, `replay()` joined with audit records. |
| **Phase 7: Red Team** | | | |
| 7.1 Adversarial Red Team Test Suite | Missing | None | No `redteam/` directory with 8-10 canned attack vectors (path traversal, case tricks, cat .env, exfil, prompt injection payload handling, replay attack), scorecard generator, or `npm run redteam`. |
| **Phase 8: Tests, Docs, Verification** | | | |
| 8.1 60+ Test Suite & Fake Clock | Partial | `tests/fakeAgents.test.ts` (8 tests) | Needs scaling to 60+ unit & integration tests covering hash chaining, clock injection, fail-closed handlers, tokenizer, approvals, quarantine. |
| 8.2 Production Documentation & Threat Model | Partial | `README.md` | Needs `THREAT_MODEL.md`, integration guides, policy schemas, precedence tables. |
