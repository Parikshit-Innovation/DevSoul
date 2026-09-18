import "dotenv/config";
import path from "path";
import * as readline from "readline/promises";
import { stdin as input, stdout as output } from "process";

import { readRequirements } from "../src/io/readRequirements";
import { runInterview } from "../src/interview/interviewLoop";
import { buildArchitecture } from "../src/generator/architectureGenerator";
import { generateDiagram } from "../src/generator/diagramGenerator";
import { writeArchitecture } from "../src/io/writeArchitecture";
import { getActiveProvider } from "../src/llm/llmRouter";

// ── Config ─────────────────────────────────────────────────────────────────
// devos dir is configurable via DEVOS_DIR env var; defaults to the sample.
const DEVOS_DIR = path.resolve(
  process.env.DEVOS_DIR || path.join(__dirname, "..", ".devos-sample")
);

const PROJECT_ID = "devos-demo";

async function main() {
  console.log("\n╔══════════════════════════════════════════════════════════╗");
  console.log("║      Architecture Intelligence  •  DevSoul              ║");
  console.log("╚══════════════════════════════════════════════════════════╝");
  console.log(`\n  LLM Provider : ${getActiveProvider().name}`);
  console.log(`  .devos dir   : ${DEVOS_DIR}`);
  console.log(`  Project ID   : ${PROJECT_ID}\n`);

  // 1. Load requirements written by teammate ──────────────────────────────
  let requirements: any;
  try {
    requirements = readRequirements(DEVOS_DIR);
    console.log(`  Project      : ${requirements.project}`);
    console.log(`  Requirements : ${(requirements.requirements || []).length} loaded\n`);
  } catch (err) {
    console.error(`\n❌ ${(err as Error).message}`);
    process.exit(1);
  }

  // 2. Run interactive interview (15 questions) ───────────────────────────
  const rl = readline.createInterface({ input, output });
  let answers: Record<string, string>;
  try {
    answers = await runInterview(rl, requirements);
  } finally {
    rl.close();
  }

  // 3. Generate ArchitectureOutput (calls LLM summary helper internally) ──
  console.log("\n  🏗  Building architecture output…");
  const arch = await buildArchitecture(PROJECT_ID, requirements, answers);

  // 4. Generate Mermaid diagram ───────────────────────────────────────────
  const mermaid = generateDiagram(arch);

  // 5. Write .yaml + .json + .mmd to .devos dir ──────────────────────────
  writeArchitecture(DEVOS_DIR, arch, mermaid);

  // 6. Print final JSON to console for visual confirmation ───────────────
  const DIVIDER = "─".repeat(60);
  console.log(`\n${DIVIDER}`);
  console.log("  Final architecture.json");
  console.log(DIVIDER);
  console.log(JSON.stringify(arch, null, 2));
  console.log(`\n${DIVIDER}`);
  console.log("  Mermaid Diagram (architecture.mmd)");
  console.log(DIVIDER);
  mermaid.split("\n").forEach((l) => console.log(`  ${l}`));
  console.log(`\n${DIVIDER}`);
}

main().catch((err) => {
  console.error("\n❌ Unexpected error:", err);
  process.exit(1);
});
