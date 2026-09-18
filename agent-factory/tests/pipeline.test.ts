/**
 * Tests: End-to-End Pipeline (mock LLM — no network required)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { vi } from "vitest";
import { runPipeline } from "../src/pipeline.js";
import type { LLMProvider, LLMRequest, LLMResponse } from "../src/llm/provider.interface.js";

let tmpDir: string;
let outputPath: string;

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const mockRI = {
  project_id: "devos-demo",
  project_name: "Campus Event Management",
  summary: "A web app for campus events.",
  requirements: [
    { id: "REQ-001", description: "View events.", priority: "high", acceptance_criteria: ["Display events."] },
    { id: "REQ-002", description: "Register for events.", priority: "high", acceptance_criteria: ["Prevent duplicates."] },
  ],
  constraints: {
    max_agents: 5,
    max_planning_tokens: 3000,
    max_agent_steps: 8,
    allowed_tools: ["read_file"],
    project_root: ".",
  },
};

const mockAI = {
  project_id: "devos-demo",
  architecture_summary: "A React/Node.js web app.",
  technology_stack: { frontend: "React", backend: "Node.js" },
  components: [
    { name: "frontend", description: "UI." },
    { name: "backend", description: "API." },
  ],
  design_constraints: ["Prevent duplicate registrations."],
  project_files: ["src/frontend/", "src/backend/"],
};

const VALID_PLANNER_RESPONSE = JSON.stringify({
  task: "Implement campus event browsing and registration.",
  agents: [
    {
      id: "backend_agent",
      role: "backend",
      task: "Implement the events and registration API.",
      reason: "Handles business rules.",
      depends_on: [],
      tools: ["read_file"],
      success_criteria: ["API satisfies REQ-001 and REQ-002."],
      requirement_ids: ["REQ-001", "REQ-002"],
      architecture_components: ["backend"],
    },
    {
      id: "frontend_agent",
      role: "frontend",
      task: "Build the event browsing UI.",
      reason: "Students need a UI.",
      depends_on: ["backend_agent"],
      tools: ["read_file"],
      success_criteria: ["Students can browse events."],
      requirement_ids: ["REQ-001"],
      architecture_components: ["frontend"],
    },
  ],
});

function makeMockProvider(responseText: string): LLMProvider {
  return {
    providerName: "mock",
    modelName: "mock-model",
    complete: vi.fn(async (_req: LLMRequest): Promise<LLMResponse> => ({ text: responseText })),
  };
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "devosoul-e2e-"));
  outputPath = path.join(tmpDir, "agents.yaml");
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("Pipeline end-to-end", () => {
  it("runs the full pipeline with mock inputs and produces agents.yaml", async () => {
    const result = await runPipeline({
      task: "Implement the campus event browsing and registration functionality.",
      requirementIntelligence: mockRI,
      architectureIntelligence: mockAI,
      llmProvider: makeMockProvider(VALID_PLANNER_RESPONSE),
      outputPath,
    });

    expect(result.success).toBe(true);
    expect(result.agentsYamlPath).toBe(outputPath);
    expect(result.agentsYamlContents).toContain("backend_agent");
    expect(result.agentsYamlContents).toContain("frontend_agent");
  });

  it("emits events in the correct order", async () => {
    const eventTypes: string[] = [];
    await runPipeline({
      task: "Implement campus events.",
      requirementIntelligence: mockRI,
      architectureIntelligence: mockAI,
      llmProvider: makeMockProvider(VALID_PLANNER_RESPONSE),
      outputPath,
      onEvent: (ev) => eventTypes.push(ev.type),
    });

    expect(eventTypes).toContain("PRECHECK_STARTED");
    expect(eventTypes).toContain("PRECHECK_COMPLETED");
    expect(eventTypes).toContain("PLANNER_STARTED");
    expect(eventTypes).toContain("PLANNER_COMPLETED");
    expect(eventTypes).toContain("VALIDATION_STARTED");
    expect(eventTypes).toContain("VALIDATION_PASSED");
    expect(eventTypes).toContain("FACTORY_STARTED");
    expect(eventTypes).toContain("AGENTS_CREATED");
    expect(eventTypes).toContain("YAML_SAVED");

    // Order check: PRECHECK before PLANNER
    expect(eventTypes.indexOf("PRECHECK_COMPLETED")).toBeLessThan(eventTypes.indexOf("PLANNER_STARTED"));
    // VALIDATION before FACTORY
    expect(eventTypes.indexOf("VALIDATION_PASSED")).toBeLessThan(eventTypes.indexOf("FACTORY_STARTED"));
  });

  it("fails cleanly on pre-check error (mismatched project IDs)", async () => {
    const mismatchAI = { ...mockAI, project_id: "wrong-id" };
    const result = await runPipeline({
      task: "Implement campus events.",
      requirementIntelligence: mockRI,
      architectureIntelligence: mismatchAI,
      llmProvider: makeMockProvider(VALID_PLANNER_RESPONSE),
      outputPath,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Pre-check");
    expect(result.events.some((e) => e.type === "PIPELINE_FAILED")).toBe(true);
  });

  it("fails cleanly when the planner returns malformed JSON", async () => {
    const result = await runPipeline({
      task: "Implement campus events.",
      requirementIntelligence: mockRI,
      architectureIntelligence: mockAI,
      llmProvider: makeMockProvider("THIS IS NOT JSON"),
      outputPath,
    });

    expect(result.success).toBe(false);
    expect(result.events.some((e) => e.type === "PIPELINE_FAILED")).toBe(true);
  });

  it("fails cleanly when the plan is invalid (unknown role)", async () => {
    const badPlan = JSON.stringify({
      task: "Bad plan",
      agents: [
        {
          id: "bad_agent",
          role: "hacker",
          task: "Do bad things.",
          reason: "Malicious.",
          depends_on: [],
          tools: ["read_file"],
          success_criteria: ["Done."],
          requirement_ids: [],
          architecture_components: [],
        },
      ],
    });
    const result = await runPipeline({
      task: "Implement campus events.",
      requirementIntelligence: mockRI,
      architectureIntelligence: mockAI,
      llmProvider: makeMockProvider(badPlan),
      outputPath,
    });

    expect(result.success).toBe(false);
    expect(result.validation?.valid).toBe(false);
    expect(result.validation?.errors.some((e) => e.includes("hacker"))).toBe(true);
    // agents.yaml must NOT have been written
    await expect(fs.access(outputPath)).rejects.toThrow();
  });

  it("agent configs have CREATED lifecycle state", async () => {
    const result = await runPipeline({
      task: "Implement campus events.",
      requirementIntelligence: mockRI,
      architectureIntelligence: mockAI,
      llmProvider: makeMockProvider(VALID_PLANNER_RESPONSE),
      outputPath,
    });

    expect(result.success).toBe(true);
    expect(result.agentsYamlContents).toContain("CREATED");
  });
});
