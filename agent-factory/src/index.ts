/**
 * DevSoul Agent Factory — Express Server
 * HTTP API that exposes the pipeline over REST with SSE streaming.
 */

import "dotenv/config";
import express, { Request, Response } from "express";
import cors from "cors";
import * as path from "node:path";
import * as url from "node:url";
import { createReadStream } from "node:fs";
import * as fs from "node:fs/promises";

import { runPipeline } from "./pipeline.js";
import { createGeminiProviderFromEnv } from "./llm/gemini.js";
import type { PipelineEvent } from "./types/pipeline.js";

// ─── Resolve directories ─────────────────────────────────────────────────────

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, "fixtures");
const OUTPUT_DIR = path.join(__dirname, "..", "output");
const AGENTS_YAML_PATH = path.join(OUTPUT_DIR, "agents.yaml");

// ─── App ─────────────────────────────────────────────────────────────────────

const app = express();
const PORT = parseInt(process.env["AGENT_FACTORY_PORT"] ?? "8081", 10);

app.use(cors());
app.use(express.json({ limit: "2mb" }));

// ─── Health ──────────────────────────────────────────────────────────────────

app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", service: "agent-factory", version: "0.1.0" });
});

// ─── Fixtures ────────────────────────────────────────────────────────────────

app.get("/api/fixtures/requirements", async (_req: Request, res: Response) => {
  try {
    const raw = await fs.readFile(path.join(FIXTURES_DIR, "mock-requirement-intelligence.json"), "utf8");
    res.json(JSON.parse(raw));
  } catch {
    res.status(500).json({ error: "Failed to load requirement fixture." });
  }
});

app.get("/api/fixtures/architecture", async (_req: Request, res: Response) => {
  try {
    const raw = await fs.readFile(path.join(FIXTURES_DIR, "mock-architecture-intelligence.json"), "utf8");
    res.json(JSON.parse(raw));
  } catch {
    res.status(500).json({ error: "Failed to load architecture fixture." });
  }
});

// ─── agents.yaml ─────────────────────────────────────────────────────────────

app.get("/api/pipeline/agents-yaml", async (_req: Request, res: Response) => {
  try {
    const content = await fs.readFile(AGENTS_YAML_PATH, "utf8");
    res.type("text/plain").send(content);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      res.status(404).json({ error: "agents.yaml not found. Run the pipeline first." });
    } else {
      res.status(500).json({ error: "Failed to read agents.yaml." });
    }
  }
});

// ─── Pipeline Run (SSE) ───────────────────────────────────────────────────────

app.post("/api/pipeline/run", async (req: Request, res: Response) => {
  const { task, requirementIntelligence, architectureIntelligence } = req.body as {
    task?: string;
    requirementIntelligence?: unknown;
    architectureIntelligence?: unknown;
  };

  // Set up SSE
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const sendEvent = (event: PipelineEvent): void => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  // Resolve LLM provider
  const llmProvider = createGeminiProviderFromEnv();
  if (!llmProvider) {
    const errEvent: PipelineEvent = {
      type: "PIPELINE_FAILED",
      timestamp: new Date().toISOString(),
      message:
        "GEMINI_API_KEY is not configured. " +
        "Add GEMINI_API_KEY=<your-key> to agent-factory/.env and restart the server.",
    };
    sendEvent(errEvent);
    res.write(`data: ${JSON.stringify({ type: "DONE", success: false })}\n\n`);
    res.end();
    return;
  }

  const result = await runPipeline({
    task: task ?? "Implement the campus event browsing and registration functionality according to the requirements and architecture.",
    requirementIntelligence: requirementIntelligence ?? null,
    architectureIntelligence: architectureIntelligence ?? null,
    llmProvider,
    outputPath: AGENTS_YAML_PATH,
    onEvent: sendEvent,
  });

  // Send final result
  res.write(`data: ${JSON.stringify({ type: "DONE", ...result })}\n\n`);
  res.end();
});

// ─── Start ───────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`[Agent Factory] Server running on http://localhost:${PORT}`);
  console.log(`[Agent Factory] agents.yaml output: ${AGENTS_YAML_PATH}`);

  const geminiKey = process.env["GEMINI_API_KEY"];
  if (!geminiKey) {
    console.warn("[Agent Factory] WARNING: GEMINI_API_KEY is not set. Pipeline will fail at the Planner stage.");
  } else {
    console.log(`[Agent Factory] Gemini model: ${process.env["GEMINI_MODEL"] ?? "gemini-1.5-flash"}`);
  }
});

export default app;
