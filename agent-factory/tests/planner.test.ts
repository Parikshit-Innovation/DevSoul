/**
 * Tests: Planner Service (mock LLM provider — no network required)
 */

import { describe, it, expect, vi } from "vitest";
import { PlannerService, PlannerError } from "../src/services/planner.js";
import type { LLMProvider, LLMRequest, LLMResponse } from "../src/llm/provider.interface.js";
import type { PlannerInput } from "../src/types/planner.js";

// ─── Mock LLM Provider ────────────────────────────────────────────────────────

function makeMockProvider(responseText: string): LLMProvider {
  return {
    providerName: "mock",
    modelName: "mock-model",
    complete: vi.fn(async (_request: LLMRequest): Promise<LLMResponse> => ({
      text: responseText,
    })),
  };
}

// ─── Valid Planner response ───────────────────────────────────────────────────

const VALID_RESPONSE = JSON.stringify({
  task: "Implement campus event browsing and registration.",
  agents: [
    {
      id: "backend_agent",
      role: "backend",
      task: "Implement the events API.",
      reason: "Handles business logic.",
      depends_on: [],
      tools: ["read_file"],
      success_criteria: ["API satisfies requirements."],
      requirement_ids: ["REQ-001"],
      architecture_components: ["backend"],
    },
  ],
});

// ─── PlannerInput fixture ─────────────────────────────────────────────────────

const plannerInput: PlannerInput = {
  project_id: "devos-demo",
  project_name: "Campus Event Management",
  task: "Implement campus event browsing and registration.",
  summary: "A web app.",
  requirements: [
    { id: "REQ-001", description: "View events.", priority: "high", acceptance_criteria: ["Show events."] },
  ],
  design_constraints: [],
  technology_stack: { frontend: "React", backend: "Node.js" },
  components: [{ name: "backend", description: "API." }],
  project_files: ["src/"],
  constraints: {
    max_agents: 5,
    max_planning_tokens: 3000,
    max_agent_steps: 8,
    allowed_tools: ["read_file"],
    project_root: ".",
  },
  allowed_roles: ["backend"],
  allowed_tools: ["read_file"],
};

describe("PlannerService", () => {
  it("parses a valid planner response into the expected schema", async () => {
    const service = new PlannerService({ provider: makeMockProvider(VALID_RESPONSE) });
    const result = await service.plan(plannerInput);

    expect(result.task).toBe("Implement campus event browsing and registration.");
    expect(result.agents).toHaveLength(1);
    expect(result.agents[0]!.id).toBe("backend_agent");
    expect(result.agents[0]!.role).toBe("backend");
  });

  it("strips markdown fences from the response before parsing", async () => {
    const fencedResponse = `\`\`\`json\n${VALID_RESPONSE}\n\`\`\``;
    const service = new PlannerService({ provider: makeMockProvider(fencedResponse) });
    const result = await service.plan(plannerInput);
    expect(result.agents).toHaveLength(1);
  });

  it("throws PlannerError on malformed JSON", async () => {
    const service = new PlannerService({ provider: makeMockProvider("not json at all {{{") });
    await expect(service.plan(plannerInput)).rejects.toThrow(PlannerError);
  });

  it("throws PlannerError when response does not match the schema", async () => {
    const badResponse = JSON.stringify({ wrong: "structure" });
    const service = new PlannerService({ provider: makeMockProvider(badResponse) });
    await expect(service.plan(plannerInput)).rejects.toThrow(PlannerError);
  });

  it("throws PlannerError when the LLM provider throws", async () => {
    const failingProvider: LLMProvider = {
      providerName: "mock",
      modelName: "mock-model",
      complete: vi.fn(async () => {
        throw new Error("Network error");
      }),
    };
    const service = new PlannerService({ provider: failingProvider });
    await expect(service.plan(plannerInput)).rejects.toThrow(PlannerError);
  });

  it("throws PlannerError when agents array is empty", async () => {
    const emptyAgents = JSON.stringify({ task: "Test", agents: [] });
    const service = new PlannerService({ provider: makeMockProvider(emptyAgents) });
    await expect(service.plan(plannerInput)).rejects.toThrow(PlannerError);
  });

  it("exposes provider and model names", () => {
    const service = new PlannerService({ provider: makeMockProvider("{}") });
    expect(service.plannerProviderName).toBe("mock");
    expect(service.plannerModelName).toBe("mock-model");
  });
});
