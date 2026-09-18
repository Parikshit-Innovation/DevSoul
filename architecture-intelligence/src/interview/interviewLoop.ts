import * as readline from "readline/promises";
import { QUESTIONS } from "./questions";
import { chooseTechStack, analyzeStack } from "../llm/llmRouter";

const DIVIDER = "─".repeat(60);

/**
 * Detects whether the user input is a comma-separated list of options
 * (e.g. "React, Vue, Next.js") meaning they want Gemini to pick the best one.
 */
function isCommaList(input: string): boolean {
  return input.includes(",") && input.split(",").length >= 2;
}

export async function runInterview(
  rl: readline.Interface,
  requirements: any
): Promise<Record<string, string>> {
  const answers: Record<string, string> = {};
  const total = QUESTIONS.length;

  console.log(`\n${DIVIDER}`);
  console.log("  Architecture Interview");
  console.log(`  ${total} questions — type your answer, "you choose", or a`);
  console.log(`  comma-separated list (e.g. "React, Vue") and Gemini picks.`);
  console.log(`${DIVIDER}\n`);

  for (let i = 0; i < QUESTIONS.length; i++) {
    const q = QUESTIONS[i];
    let answer = "";

    while (!answer) {
      const raw = await rl.question(
        `[${i + 1}/${total}] (${q.category}) ${q.prompt}\n> `
      );
      const trimmed = raw.trim();

      if (!trimmed) {
        console.log('  Please enter a value, "you choose", or a comma-separated list.\n');
        continue;
      }

      if (trimmed.toLowerCase() === "you choose") {
        // ── LLM picks from scratch ──────────────────────────────────────
        process.stdout.write("  🤖 Asking Gemini...");
        const chosen = await chooseTechStack(requirements, q.key, q.prompt);
        process.stdout.write(`\r  🤖 Gemini chose → \x1b[32m${chosen}\x1b[0m\n\n`);
        answer = chosen;
      } else if (isCommaList(trimmed)) {
        // ── User gave multiple options, LLM analyses and picks best ─────
        const options = trimmed.split(",").map((s) => s.trim()).filter(Boolean);
        process.stdout.write(
          `  🤖 Analysing [${options.join(", ")}] against your requirements...`
        );
        const analysis = await analyzeStack(requirements, q.key, options);
        process.stdout.write("\r" + " ".repeat(72) + "\r"); // clear spinner line

        // Pretty-print the analysis block
        console.log(`\n  📊 Gemini Analysis for "${q.key}":`);
        analysis.split("\n").forEach((line) => console.log(`     ${line}`));

        // Extract the recommended tech from the first line ("Recommended: X")
        const recommended =
          analysis
            .split("\n")[0]
            ?.replace(/^Recommended:\s*/i, "")
            .trim() || options[0];

        const confirm = await rl.question(
          `\n  Accept "${recommended}"? (Enter to confirm, or type a different value) > `
        );
        answer = confirm.trim() || recommended;
        console.log(`  ✅ Using → \x1b[32m${answer}\x1b[0m\n`);
      } else {
        // ── Explicit user answer ─────────────────────────────────────────
        answer = trimmed;
        console.log(`  ✅ Noted → \x1b[32m${answer}\x1b[0m\n`);
      }
    }

    answers[q.key] = answer;
  }

  return answers;
}
