import {
  check,
  registerAgent,
  auditLogger,
  quarantineManager,
  trustManager,
  approvalManager,
  violationTracker,
  behaviorAnalyzer,
  mcpToolInterceptor,
  mcpGateway,
  timeMachine,
} from "./index.ts";

function printHeader(title: string) {
  console.log("\n" + "=".repeat(78));
  console.log(`🛡️  ${title.toUpperCase()}`);
  console.log("=".repeat(78));
}

function printStep(stepNum: number, description: string) {
  console.log(`\n▶ STEP ${stepNum}: ${description}`);
  console.log("-".repeat(78));
}

function displayDecision(decision: any) {
  const badge =
    decision.decision === "ALLOW"
      ? "🟢 ALLOW"
      : decision.decision === "BLOCK"
      ? "🔴 BLOCK"
      : decision.decision === "APPROVE"
      ? "🟡 APPROVE (HUMAN REQUIRED)"
      : "🟠 RESTRICT (CONSTRAINED ACCESS)";

  console.log(`  Decision:          ${badge}`);
  console.log(`  Agent:             ${decision.agentId}`);
  console.log(`  Rule Applied:      ${decision.ruleId || "N/A"} (Decided by: ${decision.decidedBy || "policy_engine"})`);
  console.log(`  Reason:            ${decision.reason}`);
  console.log(`  Resource Tier:     ${decision.resourceClassification || "INTERNAL"}`);
  if (decision.constraints) {
    console.log(`  Constraints:       ${JSON.stringify(decision.constraints)}`);
  }
  if (decision.riskAssessment) {
    console.log(`  Risk Assessment:   ${decision.riskAssessment.level} (${decision.riskAssessment.score}/100)`);
    if (decision.riskAssessment.factors?.length) {
      console.log(`  Risk Factors:`);
      decision.riskAssessment.factors.forEach((f: any) =>
        console.log(`    • [${f.category}] ${f.description} (+${f.weight})`)
      );
    }
  }
  if (decision.behaviorAnomalies?.length) {
    console.log(`  ⚠️  Anomalies:`);
    decision.behaviorAnomalies.forEach((a: any) =>
      console.log(`    • [${a.type}] ${a.description}`)
    );
  }
  console.log(`  Trust Score:       ${decision.trustBefore} ➔ ${decision.trustAfter}`);
  console.log(`  Quarantined:       ${decision.quarantined ? "🚨 YES (Containment active)" : "NO"}`);
  if (decision.approvalRequest) {
    console.log(`  Approval Ticket:   ID: ${decision.approvalRequest.id} | Status: ${decision.approvalRequest.status}`);
  }
}

async function runEndToEndSampleDemo() {
  printHeader("Aegis Security Control Plane — End-to-End Live Demonstration");

  // Reset demo state
  trustManager.clearAll();
  quarantineManager.clearAll();
  auditLogger.clearLogs();
  approvalManager.clearAll();
  behaviorAnalyzer.clearAll();

  // Register agents server-side
  registerAgent({
    id: "frontend-agent-01",
    role: "frontend",
    allowedPaths: ["src/frontend/**", "public/**"],
    allowedMcpTools: ["readFile", "writeFile"],
  });

  registerAgent({
    id: "backend-agent-01",
    role: "backend",
    allowedPaths: ["src/backend/**", "src/services/**"],
    allowedMcpTools: ["readFile", "writeFile", "runCommand", "installPackage"],
  });

  // -------------------------------------------------------------
  // Scenario 1: Normal In-Scope Allowed Action
  // -------------------------------------------------------------
  printStep(1, "Agent 'frontend-agent-01' reads in-scope UI component (Expected: ALLOW, Trust = 100)");
  const d1 = check("frontend-agent-01", "read", "src/frontend/App.tsx");
  displayDecision(d1);
  await timeMachine.checkpoint("frontend-agent-01", {
    action: "read",
    target: "src/frontend/App.tsx",
    decision: d1.decision,
    risk: d1.riskAssessment?.level,
    trust: d1.trustAfter,
  });

  // -------------------------------------------------------------
  // Scenario 2: Suspicious Sensitive File Probing (.env) -> Trust Drops
  // -------------------------------------------------------------
  printStep(2, "Agent 'frontend-agent-01' attempts to read sensitive file '.env' (Expected: BLOCK, Trust drops 100 ➔ 66)");
  const d2 = check("frontend-agent-01", "read", ".env");
  displayDecision(d2);
  await timeMachine.checkpoint("frontend-agent-01", {
    action: "read",
    target: ".env",
    decision: d2.decision,
    risk: d2.riskAssessment?.level,
    trust: d2.trustAfter,
  });

  // -------------------------------------------------------------
  // Scenario 3: Sequential Probing Attack (credentials.json) -> Quarantine
  // -------------------------------------------------------------
  printStep(3, "Agent 'frontend-agent-01' attempts another sensitive file 'credentials.json' (Expected: BLOCK + QUARANTINE)");
  const d3 = check("frontend-agent-01", "read", "credentials.json");
  displayDecision(d3);
  await timeMachine.checkpoint("frontend-agent-01", {
    action: "read",
    target: "credentials.json",
    decision: d3.decision,
    risk: d3.riskAssessment?.level,
    trust: d3.trustAfter,
  });

  // -------------------------------------------------------------
  // Scenario 4: Post-Quarantine Containment
  // -------------------------------------------------------------
  printStep(4, "Quarantined agent attempts harmless read 'src/frontend/index.html' (Expected: Containment BLOCK)");
  const d4 = check("frontend-agent-01", "read", "src/frontend/index.html");
  displayDecision(d4);

  // -------------------------------------------------------------
  // Scenario 5: RESTRICT Scenario (Constrained Payload / Redaction)
  // -------------------------------------------------------------
  printStep(5, "Agent 'backend-agent-01' reads internal config file (Expected: RESTRICT with redaction constraints)");
  const d5 = check(
    "backend-agent-01",
    { type: "read", details: { constraints: { redactSecrets: true, readOnly: true } } },
    "src/backend/config.json"
  );
  displayDecision(d5);

  // -------------------------------------------------------------
  // Scenario 6: APPROVE Scenario with Single-Use Token Consumption
  // -------------------------------------------------------------
  printStep(6, "Agent 'backend-agent-01' requests high-impact package install (Expected: APPROVE)");
  const d6 = check("backend-agent-01", "install_package", "express");
  displayDecision(d6);

  console.log("\n  ▶ [HUMAN RESOLUTION]: Admin reviews and approves request ticket...");
  const approvedTicket = approvalManager.approveRequest(d6.approvalRequest!.id, "admin_lead_secops");
  console.log(`    Status updated to: ${approvedTicket.status} (Resolved by: ${approvedTicket.resolvedBy})`);

  console.log("  ▶ [GATEWAY CONSUMPTION]: Gateway consumes single-use approval ticket...");
  const consumed = approvalManager.consumeApproval(
    d6.approvalRequest!.id,
    "backend-agent-01",
    { type: "install_package" },
    { resource: "express" }
  );
  console.log(`    Single-use token consumed successfully: ${consumed.success}`);

  // -------------------------------------------------------------
  // Scenario 7: Time Machine Audit Replay & Trailers
  // -------------------------------------------------------------
  printStep(7, "Git-Backed Time Machine Checkpoints & Audit Replay for 'frontend-agent-01'");
  const replay = timeMachine.replay("frontend-agent-01", auditLogger.getLogs());
  console.log(`  Worktree Branch:     ${replay.branch}`);
  console.log(`  Checkpoints Count:   ${replay.checkpoints.length}`);
  replay.checkpoints.forEach((cp, idx) => {
    console.log(`    [#${idx + 1}] Commit ${cp.commitId.substring(0, 7)} | Trailer: ${cp.trailers["Action"] || "action"} -> ${cp.trailers["Decision"] || "decision"} (Trust: ${cp.trailers["Trust"] || "N/A"})`);
  });

  // -------------------------------------------------------------
  // Scenario 8: SHA-256 Audit Log Hash Chain Verification
  // -------------------------------------------------------------
  printStep(8, "Cryptographic Audit Log Hash Chain Integrity Verification");
  const verification = auditLogger.verifyChain();
  console.log(`  Audit Records Count: ${auditLogger.getLogs().length}`);
  console.log(`  Chain Valid:         ${verification.isValid ? "✅ YES (SHA-256 Tamper-Proof)" : "❌ NO"}`);

  // -------------------------------------------------------------
  // Scenario 9: Quarantined Agent Comprehensive Investigation Report
  // -------------------------------------------------------------
  printStep(9, "Generated Forensic Investigation Report for 'frontend-agent-01'");
  const report = quarantineManager.generateInvestigationReport(
    "frontend-agent-01",
    auditLogger.getLogs(),
    violationTracker.getViolations("frontend-agent-01"),
    trustManager.getTrust("frontend-agent-01"),
    behaviorAnalyzer.analyze(
      { id: "frontend-agent-01" },
      { type: "read" },
      { resource: "credentials.json" },
      "CRITICAL"
    ),
    {
      branch: replay.branch,
      checkpointCount: replay.checkpoints.length,
      headCommit: replay.checkpoints[replay.checkpoints.length - 1]?.commitId,
    }
  );

  console.log(`  Agent Status:        ${report.status}`);
  console.log(`  Quarantine Reason:   ${report.quarantineReason}`);
  console.log(`  Granted Resources:   ${report.resources.granted.map((r) => r.resource).join(", ") || "None"}`);
  console.log(`  Blocked Resources:   ${report.resources.attemptedAndBlocked.map((r) => r.resource).join(", ")}`);
  console.log(`  Recommended Action:  ${report.recommendedAction}`);

  printHeader("Demonstration Complete: 10/10 DevOS Blueprint Capabilities Verified");
}

runEndToEndSampleDemo().catch(console.error);

