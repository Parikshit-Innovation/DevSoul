import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import {
  check,
  auditLogger,
  quarantineManager,
  trustManager,
  resourceClassifier,
  behaviorAnalyzer,
  violationTracker,
} from "./index.ts";

async function runInteractiveCli() {
  const args = process.argv.slice(2);

  // 1. Direct one-off command mode: node cli.ts <agent> <action> <target> [initialTrust] [role]
  if (args.length >= 3) {
    const [agentId, action, target, initTrust, role] = args;
    if (initTrust) {
      trustManager.setTrust(agentId, parseInt(initTrust, 10));
    }
    const result = check({ id: agentId, role }, action, target);
    console.log("\n🛡️  Aegis Security Evaluation Result:");
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  // 2. Interactive REPL mode
  console.log("==================================================================");
  console.log("🛡️   Aegis Intelligent AI Security Control Plane — Interactive CLI");
  console.log("==================================================================");
  console.log("Evaluates: Identity + Intent + Resource + Behavior + Risk + Trust\n");

  const rl = readline.createInterface({ input, output });

  try {
    const agentId =
      (await rl.question("Enter Agent ID [default: frontend-agent-01]: ")).trim() ||
      "frontend-agent-01";
    const role =
      (await rl.question("Agent Role (frontend/backend/reviewer/devops) [default: frontend]: ")).trim() ||
      "frontend";
    const rawTrust = (await rl.question("Initial Trust Score (0-100) [default: 100]: ")).trim();
    if (rawTrust) {
      trustManager.setTrust(agentId, parseInt(rawTrust, 10));
    }

    console.log(`\nActive Agent: ${agentId} | Role: ${role} | Trust: ${trustManager.getTrust(agentId)}`);
    console.log("Commands:");
    console.log("  • 'report'   -> Generate full Quarantined/Active Investigation Report");
    console.log("  • 'timeline' -> View formatted audit event log");
    console.log("  • 'exit'     -> Quit CLI\n");

    while (true) {
      const actionInput = (
        await rl.question("Action (e.g. read, write, modify_schema, install_package, network_call): ")
      ).trim();
      if (!actionInput) continue;
      if (actionInput.toLowerCase() === "exit") break;

      if (actionInput.toLowerCase() === "report") {
        const report = quarantineManager.generateInvestigationReport(
          agentId,
          auditLogger.getLogs(),
          violationTracker.getViolations(agentId),
          trustManager.getTrust(agentId),
          behaviorAnalyzer.analyze(
            { id: agentId, role },
            { type: "read" },
            { resource: "report_query" },
            "INTERNAL"
          )
        );
        console.log("\n📋 Investigation Report:\n", JSON.stringify(report, null, 2), "\n");
        continue;
      }

      if (actionInput.toLowerCase() === "timeline") {
        console.log("\n📜 Audit Timeline:");
        const timeline = auditLogger.getFormattedTimeline(agentId);
        if (timeline.length === 0) {
          console.log("  (No actions recorded yet)");
        } else {
          timeline.forEach((t) => console.log(" ", t));
        }
        console.log("");
        continue;
      }

      const targetInput = (
        await rl.question("Target Resource (e.g. src/App.tsx, .env, id_rsa, database/schema.sql): ")
      ).trim();

      const decision = check({ id: agentId, role }, actionInput, targetInput);

      console.log("\n──────────────────────────────────────────────────────────────────");
      const badge =
        decision.decision === "ALLOW"
          ? "🟢 ALLOW"
          : decision.decision === "BLOCK"
          ? "🔴 BLOCK"
          : decision.decision === "APPROVE"
          ? "🟡 APPROVE (HUMAN REQUIRED)"
          : "🟠 RESTRICT";

      console.log(`Decision:          ${badge}`);
      console.log(`Reason:            ${decision.reason}`);
      console.log(`Resource Security: ${decision.resourceClassification}`);
      console.log(
        `Risk Assessment:   ${decision.riskAssessment?.level} (Score: ${decision.riskAssessment?.score}/100)`
      );
      if (decision.riskAssessment?.factors && decision.riskAssessment.factors.length > 0) {
        console.log("Risk Factors:");
        decision.riskAssessment.factors.forEach((f) =>
          console.log(`  - [${f.category}] ${f.description} (+${f.weight})`)
        );
      }
      if (decision.behaviorAnomalies && decision.behaviorAnomalies.length > 0) {
        console.log("⚠️ Behavioral Anomalies Detected:");
        decision.behaviorAnomalies.forEach((a) =>
          console.log(`  - [${a.type}] ${a.description}`)
        );
      }
      console.log(`Trust Lifecycle:   ${decision.trustBefore} ➔ ${decision.trustAfter}`);
      console.log(`Containment State: ${decision.quarantined ? "🚨 QUARANTINED (All future actions blocked)" : "ACTIVE"}`);
      if (decision.approvalRequest) {
        console.log(`Pending Approval:  ID: ${decision.approvalRequest.id} | Status: ${decision.approvalRequest.status}`);
      }
      console.log("──────────────────────────────────────────────────────────────────\n");
    }
  } finally {
    rl.close();
  }
}

runInteractiveCli().catch(console.error);
