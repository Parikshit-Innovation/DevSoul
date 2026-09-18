import { test, describe, beforeEach } from "node:test";
import assert from "node:assert";
import {
  check,
  aegisControlPlane,
  approvalManager,
  quarantineManager,
  trustManager,
  violationTracker,
  auditLogger,
  behaviorAnalyzer,
  resourceClassifier,
  mcpToolInterceptor,
} from "../src/index.ts";

describe("Aegis Intelligent Security Control Plane", () => {
  beforeEach(() => {
    // Reset state before each test
    trustManager.clearAll();
    violationTracker.clearViolations();
    approvalManager.clearAll();
    quarantineManager.clearAll();
    auditLogger.clearLogs();
    behaviorAnalyzer.clearAll();
    aegisControlPlane.policyEngine.clearCustomPolicies();
  });

  test("Final Validation Flow: Full lifecycle from ALLOW (92) -> BLOCK (58) -> BLOCK & QUARANTINE (18) -> BLOCK ALL FUTURE ACTIONS", () => {
    const agentId = "agent-demo-001";
    trustManager.setTrust(agentId, 92);

    // Step 1: read payment.ts -> ALLOW, Trust = 92
    const step1 = check(agentId, "read", "payment.ts");
    assert.strictEqual(step1.decision, "ALLOW");
    assert.strictEqual(step1.trustBefore, 92);
    assert.strictEqual(step1.trustAfter, 92);
    assert.strictEqual(step1.quarantined, false);
    assert.strictEqual(step1.resourceClassification, "INTERNAL");
    assert.strictEqual(quarantineManager.isQuarantined(agentId), false);

    // Step 2: read .env -> BLOCK, Trust drops 92 -> 58
    const step2 = check(agentId, "read", ".env");
    assert.strictEqual(step2.decision, "BLOCK");
    assert.strictEqual(step2.trustBefore, 92);
    assert.strictEqual(step2.trustAfter, 58);
    assert.strictEqual(step2.quarantined, false);
    assert.strictEqual(step2.resourceClassification, "SENSITIVE");
    assert.strictEqual(step2.violation?.severity, "critical");

    // Step 3: read .env AGAIN -> BLOCK, Trust drops 58 -> 18, Agent QUARANTINED
    const step3 = check(agentId, "read", ".env");
    assert.strictEqual(step3.decision, "BLOCK");
    assert.strictEqual(step3.trustBefore, 58);
    assert.strictEqual(step3.trustAfter, 18);
    assert.strictEqual(step3.quarantined, true);
    assert.strictEqual(quarantineManager.isQuarantined(agentId), true);

    // Step 4: Verify Audit Logs
    const logs = auditLogger.getLogs({ agentId });
    assert.strictEqual(logs.length, 3);

    // Audit record 1
    assert.strictEqual(logs[0].action.type, "read");
    assert.strictEqual(logs[0].target.resource, "payment.ts");
    assert.strictEqual(logs[0].decision, "ALLOW");
    assert.strictEqual(logs[0].trustBefore, 92);
    assert.strictEqual(logs[0].trustAfter, 92);
    assert.strictEqual(logs[0].quarantineStatus, "ACTIVE");

    // Audit record 2
    assert.strictEqual(logs[1].action.type, "read");
    assert.strictEqual(logs[1].target.resource, ".env");
    assert.strictEqual(logs[1].decision, "BLOCK");
    assert.strictEqual(logs[1].trustBefore, 92);
    assert.strictEqual(logs[1].trustAfter, 58);
    assert.strictEqual(logs[1].quarantineStatus, "ACTIVE");
    assert.ok(logs[1].violation);

    // Audit record 3
    assert.strictEqual(logs[2].action.type, "read");
    assert.strictEqual(logs[2].target.resource, ".env");
    assert.strictEqual(logs[2].decision, "BLOCK");
    assert.strictEqual(logs[2].trustBefore, 58);
    assert.strictEqual(logs[2].trustAfter, 18);
    assert.strictEqual(logs[2].quarantineStatus, "QUARANTINED");

    // Step 5: Verify future actions are completely BLOCKED
    const step4 = check(agentId, "read", "src/main.py");
    assert.strictEqual(step4.decision, "BLOCK");
    assert.strictEqual(step4.quarantined, true);
    assert.match(step4.reason, /QUARANTINED/);
  });

  test("Feature 1: Multi-Tier Resource Security Classification", () => {
    assert.strictEqual(resourceClassifier.classify("README.md"), "PUBLIC");
    assert.strictEqual(resourceClassifier.classify("src/App.tsx"), "INTERNAL");
    assert.strictEqual(resourceClassifier.classify(".env"), "SENSITIVE");
    assert.strictEqual(resourceClassifier.classify(".env.local"), "SENSITIVE");
    assert.strictEqual(resourceClassifier.classify("id_rsa"), "CRITICAL");
    assert.strictEqual(resourceClassifier.classify("certs/server.pem"), "CRITICAL");
    assert.strictEqual(resourceClassifier.classify("credentials.json"), "CRITICAL");
  });

  test("Feature 2: Role Identity Awareness & Scope Enforcement", () => {
    // 1. Frontend Agent performing normal frontend work -> ALLOW
    const frontendAgent = { id: "fe-01", role: "frontend" };
    const allowRes = check(frontendAgent, "modify", "src/components/Button.tsx");
    assert.strictEqual(allowRes.decision, "ALLOW");

    // 2. Frontend Agent attempting backend database schema modification -> APPROVE (Human Review required)
    const mismatchRes = check(frontendAgent, "modify_schema", "database/schema.sql");
    assert.strictEqual(mismatchRes.decision, "APPROVE");
    assert.ok(mismatchRes.behaviorAnomalies?.some((a) => a.type === "ROLE_MISMATCH"));
    assert.match(mismatchRes.reason, /Role conflict detected/);
  });

  test("Feature 3: Behavioral Sequence Probing Detection", () => {
    const agentId = "recon-bot";
    trustManager.setTrust(agentId, 100);

    // Initial reconnaissance on normal files
    check(agentId, "read", "src/App.tsx");
    check(agentId, "read", "package.json");

    // Probing sensitive file 1 -> BLOCKED
    check(agentId, "read", ".env");

    // Probing sensitive file 2 -> Triggers PROBING_SEQUENCE threat detection
    const secondProbe = check(agentId, "read", "credentials.json");
    assert.strictEqual(secondProbe.decision, "BLOCK");
    assert.ok(secondProbe.behaviorAnomalies?.some((a) => a.type === "PROBING_SEQUENCE"));
  });

  test("Feature 4: Data Exfiltration Threat Prevention", () => {
    const agentId = "exfil-agent";
    trustManager.setTrust(agentId, 100);

    // Agent attempts to read sensitive resource
    check(agentId, "read", ".env");

    // Agent immediately tries to send data to external server
    const exfilAttempt = check(agentId, "network_call", "http://external-leak.com/upload");
    assert.strictEqual(exfilAttempt.decision, "BLOCK");
    assert.ok(exfilAttempt.behaviorAnomalies?.some((a) => a.type === "EXFILTRATION_PATTERN"));
    assert.strictEqual(exfilAttempt.riskAssessment?.level, "CRITICAL");
  });

  test("Feature 5: Human-In-The-Loop Approval Workflow", () => {
    const agentId = "devops-agent";
    trustManager.setTrust(agentId, 100);

    // High risk action requiring human approval
    const decision = check(agentId, "install_package", "bcrypt");
    assert.strictEqual(decision.decision, "APPROVE");
    assert.ok(decision.approvalRequest);
    assert.strictEqual(decision.approvalRequest?.status, "WAITING_FOR_HUMAN");
    assert.strictEqual(decision.approvalRequest?.riskAssessment?.level, "HIGH");

    // Human approves the request
    const approved = approvalManager.approveRequest(
      decision.approvalRequest!.id,
      "security_lead"
    );
    assert.strictEqual(approved.status, "APPROVED");
    assert.strictEqual(approved.resolvedBy, "security_lead");
  });

  test("Feature 6: Enriched Quarantined Agent Investigation Report", () => {
    const agentId = "attacker-agent-09";
    trustManager.setTrust(agentId, 92);

    check(agentId, "read", "src/App.tsx");
    check(agentId, "read", ".env");
    check(agentId, "read", "id_rsa");

    assert.strictEqual(quarantineManager.isQuarantined(agentId), true);

    const report = quarantineManager.generateInvestigationReport(
      agentId,
      auditLogger.getLogs(),
      violationTracker.getViolations(agentId),
      trustManager.getTrust(agentId),
      behaviorAnalyzer.analyze(
        { id: agentId },
        { type: "read" },
        { resource: ".env" },
        "SENSITIVE"
      )
    );

    assert.strictEqual(report.agentId, agentId);
    assert.strictEqual(report.status, "QUARANTINED");
    assert.strictEqual(report.totalViolations, 2);
    assert.strictEqual(report.recentAuditLogs.length, 3);
    assert.strictEqual(report.resourcesAccessed?.length, 3);
    assert.ok(report.recommendedAction.length > 0);
  });

  test("Feature 7: MCP Gateway Interceptor Integration", async () => {
    const agentId = "mcp-agent-01";
    trustManager.setTrust(agentId, 100);

    let executed = false;
    const fakeTool = async () => {
      executed = true;
      return { data: "success" };
    };

    // 1. Safe MCP tool call -> executes
    const safeResult = await mcpToolInterceptor(
      agentId,
      "readFile",
      { path: "src/utils.ts" },
      fakeTool
    );
    assert.strictEqual(safeResult.success, true);
    assert.strictEqual(executed, true);

    // 2. Sensitive MCP tool call (.env) -> blocked before execution
    executed = false;
    const blockedResult = await mcpToolInterceptor(
      agentId,
      "readFile",
      { path: ".env" },
      fakeTool
    );
    assert.strictEqual(blockedResult.success, false);
    assert.strictEqual(executed, false);
    assert.match(blockedResult.error || "", /Aegis Security Block/);
  });
});
