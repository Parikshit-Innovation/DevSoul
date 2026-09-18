/**
 * Architecture Intelligence — Pipeline CLI
 *
 * Non-interactive variant of demo.ts used by the DevSoul pipeline orchestrator.
 * Instead of asking the user each question via stdin, it reads a pre-populated
 * answers JSON file written by the orchestrator (PIPELINE_ANSWERS_PATH env var),
 * OR if that file is absent, falls back to the full interactive interview.
 *
 * Environment variables:
 *   DEVOS_DIR          — directory to read requirements.yaml from / write outputs to
 *   PROJECT_ID         — project identifier written into architecture.yaml
 *   PROJECT_SUMMARY    — summary text passed to the LLM for context
 *   PIPELINE_ANSWERS   — JSON string of {key: value} pre-filled answers (optional)
 *   PIPELINE_MOCK      — "true" to skip LLM calls and use deterministic fallbacks
 */
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
import { QUESTIONS } from "../src/interview/questions";

// ── Config ────────────────────────────────────────────────────────────────────

const DEVOS_DIR = path.resolve(
  process.env.DEVOS_DIR || path.join(__dirname, "..", ".devos-sample")
);

const PROJECT_ID = process.env.PROJECT_ID || "devos-pipeline";
const IS_MOCK    = process.env.PIPELINE_MOCK === "true";

// Pre-filled answers from the orchestrator (optional)
let PRE_ANSWERS: Record<string, string> | null = null;
if (process.env.PIPELINE_ANSWERS) {
  try {
    PRE_ANSWERS = JSON.parse(process.env.PIPELINE_ANSWERS) as Record<string, string>;
  } catch {
    // ignore — fall back to interactive
  }
}

// ── Non-interactive interview (when answers are pre-filled or mock mode) ───────

async function runNonInteractive(
  requirements: any
): Promise<Record<string, string>> {
  console.log("\n  [AI] Non-interactive mode — using pre-filled or default answers.");
  const answers: Record<string, string> = {};

  for (const q of QUESTIONS) {
    if (PRE_ANSWERS && PRE_ANSWERS[q.key]) {
      answers[q.key] = PRE_ANSWERS[q.key]!;
      console.log(`  [${q.key}] ${q.prompt}`);
      console.log(`  → ${answers[q.key]} (pre-filled)\n`);
    } else {
      // Default: ask LLM to choose
      try {
        const { chooseTechStack } = await import("../src/llm/llmRouter");
        const chosen = IS_MOCK
          ? `[mock-${q.key}]`
          : await chooseTechStack(requirements, q.key, q.prompt);
        answers[q.key] = chosen;
        console.log(`  [${q.key}] ${q.prompt}`);
        console.log(`  → ${chosen} (Gemini-selected)\n`);
      } catch {
        answers[q.key] = "none";
      }
    }
  }

  return answers;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("\n╔══════════════════════════════════════════════════════════╗");
  console.log("║      Architecture Intelligence  •  DevSoul Pipeline     ║");
  console.log("╚══════════════════════════════════════════════════════════╝");
  console.log(`\n  LLM Provider : ${getActiveProvider().name}`);
  console.log(`  .devos dir   : ${DEVOS_DIR}`);
  console.log(`  Project ID   : ${PROJECT_ID}`);
  console.log(`  Mock mode    : ${IS_MOCK}`);
  console.log(`  Pre-answers  : ${PRE_ANSWERS ? "yes" : "no (interactive)"}\n`);

  // 1. Load requirements ──────────────────────────────────────────────────────
  let requirements: any;
  try {
    requirements = readRequirements(DEVOS_DIR);
    const reqCount = (requirements.requirements || []).length;
    console.log(`  Project      : ${requirements.project || PROJECT_ID}`);
    console.log(`  Requirements : ${reqCount} loaded\n`);
  } catch (err) {
    console.error(`\n❌ ${(err as Error).message}`);
    process.exit(1);
  }

  // 2. Run interview ──────────────────────────────────────────────────────────
  let answers: Record<string, string>;

  if (PRE_ANSWERS || IS_MOCK) {
    answers = await runNonInteractive(requirements);
  } else {
    // Full interactive interview
    const rl = readline.createInterface({ input, output });
    try {
      answers = await runInterview(rl, requirements);
    } finally {
      rl.close();
    }
  }

  // 3. Build architecture ─────────────────────────────────────────────────────
  console.log("\n  🏗  Building architecture output…");
  const arch = await buildArchitecture(PROJECT_ID, requirements, answers);

  // 4. Generate diagram ───────────────────────────────────────────────────────
  const mermaid = generateDiagram(arch);

  // 5. Write outputs ──────────────────────────────────────────────────────────
  writeArchitecture(DEVOS_DIR, arch, mermaid);

  const DIVIDER = "─".repeat(60);
  console.log(`\n${DIVIDER}`);
  console.log("  Architecture Intelligence — Complete");
  console.log(`  Components: ${arch.components.length}`);
  console.log(`  Tech stack: frontend=${arch.technology_stack.frontend}, backend=${arch.technology_stack.backend}, db=${arch.technology_stack.database}`);
  console.log(DIVIDER);
}

main().catch((err) => {
  console.error("\n❌ Unexpected error:", err);
  process.exit(1);
});
