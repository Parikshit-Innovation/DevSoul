/**
 * DevSoul Agent Factory — Pipeline Runner
 *
 * Called by the Python pipeline orchestrator via `npx tsx pipeline/run_factory.ts`.
 * Reads a pipeline-request.json file, runs the full Factory pipeline,
 * and writes agents.yaml + pipeline-result.json to the same directory.
 *
 * Environment variables:
 *   PIPELINE_REQUEST_PATH — absolute path to pipeline-request.json
 *   AGENTS_YAML_PATH      — absolute path where agents.yaml should be written
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as url from "node:url";

import { runPipeline } from "../agent-factory/src/pipeline.js";
import { createGeminiProviderFromEnv } from "../agent-factory/src/llm/gemini.js";
import { createOllamaProviderFromEnv } from "../agent-factory/src/llm/ollama.js";
import { FallbackProvider } from "../agent-factory/src/llm/fallback.js";
import type { PipelineEvent } from "../agent-factory/src/types/pipeline.js";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

async function main(): Promise<void> {
  const requestPath = process.env["PIPELINE_REQUEST_PATH"];
  const agentsYamlPath = process.env["AGENTS_YAML_PATH"];

  if (!requestPath || !agentsYamlPath) {
    console.error(
      "[Factory Runner] PIPELINE_REQUEST_PATH and AGENTS_YAML_PATH must be set."
    );
    process.exit(1);
  }

  // ── Load pipeline request ────────────────────────────────────────────────
  let request: {
    task: string;
    requirementIntelligence: unknown;
    architectureIntelligence: unknown;
    outputPath?: string;
  };

  try {
    const raw = await fs.readFile(requestPath, "utf8");
    request = JSON.parse(raw);
  } catch (err) {
    console.error(`[Factory Runner] Failed to read pipeline request: ${err}`);
    process.exit(1);
  }

  // ── Resolve LLM provider ─────────────────────────────────────────────────
  const primaryProvider = createGeminiProviderFromEnv();
  if (!primaryProvider) {
    console.error(
      "[Factory Runner] GEMINI_API_KEY is not set. " +
        "Add it to agent-factory/.env and retry."
    );
    process.exit(1);
  }

  const fallbackProvider = createOllamaProviderFromEnv();
  const llmProvider = new FallbackProvider(primaryProvider, fallbackProvider);

  const outputPath = request.outputPath || agentsYamlPath;

  console.log(`\n[Factory Runner] Starting Agent Factory pipeline`);
  console.log(`  Task     : ${request.task.slice(0, 80)}…`);
  console.log(`  Provider : ${llmProvider.providerName}/${llmProvider.modelName}`);
  console.log(`  Output   : ${outputPath}\n`);

  // ── Run pipeline ─────────────────────────────────────────────────────────
  const result = await runPipeline({
    task: request.task,
    requirementIntelligence: request.requirementIntelligence,
    architectureIntelligence: request.architectureIntelligence,
    llmProvider,
    outputPath,
    onEvent: (event: PipelineEvent) => {
      const ts = new Date(event.timestamp).toLocaleTimeString();
      const icon = event.type.includes("FAILED") || event.type === "PIPELINE_FAILED"
        ? "✗" : event.type.includes("COMPLETED") || event.type.includes("PASSED") || event.type.includes("SAVED") || event.type.includes("CREATED")
        ? "✓" : "→";
      console.log(`  [${ts}] ${icon} ${event.type}${event.message ? ": " + event.message : ""}`);
    },
  });

  // ── Write result JSON for the Python orchestrator to read ────────────────
  const resultPath = path.join(path.dirname(outputPath), "pipeline-result.json");
  // Strip the potentially large YAML content from the result for the JSON file
  const resultForFile = {
    ...result,
    agentsYamlContents: result.agentsYamlContents ? "[see agents.yaml]" : undefined,
  };
  await fs.writeFile(resultPath, JSON.stringify(resultForFile, null, 2), "utf8");

  if (result.success) {
    console.log(`\n[Factory Runner] ✓ Pipeline succeeded`);
    console.log(`  agents.yaml → ${outputPath}`);
    console.log(`  result.json → ${resultPath}`);
    process.exitCode = 0;
  } else {
    console.error(`\n[Factory Runner] ✗ Pipeline failed: ${result.error}`);
    if (result.validation && !result.validation.valid) {
      result.validation.errors.forEach((e) => console.error(`  • ${e}`));
    }
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("[Factory Runner] Unexpected error:", err);
  process.exitCode = 1;
});
