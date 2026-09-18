import * as fs from "node:fs";
import * as path from "node:path";
import { redTeamScenarios } from "./scenarios.ts";
import { trustManager } from "../src/trustManager.ts";
import { quarantineManager } from "../src/quarantineManager.ts";
import { auditLogger } from "../src/auditLogger.ts";
import { approvalManager } from "../src/approvalManager.ts";
import { behaviorAnalyzer } from "../src/behaviorAnalyzer.ts";

async function runRedTeamSuite() {
  console.log("==========================================================================");
  console.log("🔴  AEGIS ADVERSARIAL RED TEAM AUTOMATED SUITE (10 SCENARIOS)");
  console.log("==========================================================================");

  let blockedCount = 0;
  let detectedCount = 0;
  let missedCount = 0;
  const results: any[] = [];

  for (const scenario of redTeamScenarios) {
    // Reset state before each red team scenario
    trustManager.clearAll();
    quarantineManager.clearAll();
    auditLogger.clearLogs();
    approvalManager.clearAll();
    behaviorAnalyzer.clearAll();

    const res = await scenario.execute();

    if (res.passed) {
      blockedCount++;
      detectedCount++;
      console.log(`\n  ✅ [PASSED] ${scenario.id}: ${scenario.name}`);
      console.log(`     Category: ${scenario.category}`);
      console.log(`     Details:  ${res.details}`);
    } else {
      missedCount++;
      console.log(`\n  ❌ [FAILED/MISSED] ${scenario.id}: ${scenario.name}`);
      console.log(`     Expected: ${res.expected}`);
      console.log(`     Actual:   ${res.actual}`);
      console.log(`     Details:  ${res.details}`);
    }

    results.push({
      id: scenario.id,
      name: scenario.name,
      category: scenario.category,
      passed: res.passed,
      expected: res.expected,
      actual: res.actual,
      details: res.details,
    });
  }

  console.log("\n==========================================================================");
  console.log("📊 RED TEAM SCORECARD");
  console.log("==========================================================================");
  console.log(`  Total Scenarios Evaluated:  ${redTeamScenarios.length}`);
  console.log(`  Threats Blocked / Handled:  ${blockedCount}`);
  console.log(`  Anomalies Detected:         ${detectedCount}`);
  console.log(`  Threats Missed (Failures):  ${missedCount}`);
  console.log("==========================================================================");

  const outputPath = path.resolve(process.cwd(), "redteam_results.json");
  fs.writeFileSync(
    outputPath,
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        scorecard: {
          total: redTeamScenarios.length,
          blocked: blockedCount,
          detected: detectedCount,
          missed: missedCount,
          status: missedCount === 0 ? "PASSED" : "FAILED",
        },
        scenarios: results,
      },
      null,
      2
    )
  );
  console.log(`Artifact generated: ${outputPath}\n`);

  if (missedCount > 0) {
    process.exit(1);
  }
}

runRedTeamSuite().catch((err) => {
  console.error("Red Team execution failed:", err);
  process.exit(1);
});
