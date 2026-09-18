/**
 * Tests: Factory Service
 */

import { describe, it, expect } from "vitest";
import { FactoryService, FactoryError } from "../src/services/factory.js";
import type { PlannerInput } from "../src/types/planner.js";
import type { AgentSpec } from "../src/types/planner.js";

const validInput: PlannerInput = {
  project_id: "devos-demo",
  project_name: "Campus Event Management",
  task: "Implement campus event browsing and registration.",
  summary: "A web app.",
  requirements: [{ id: "REQ-001", description: "View events.", priority: "high", acceptance_criteria: ["Display events."] }],
  design_constraints: [],
  technology_stack: { frontend: "React", backend: "Node.js" },
  components: [{ name: "backend", description: "API." }],
  project_files: ["src/"],
  constraints: {
    max_agents: 5,
    max_planning_tokens: 3000,
    max_agent_steps: 6,
    allowed_tools: ["read_file"],
    project_root: ".",
  },
  allowed_roles: ["backend", "frontend"],
  allowed_tools: ["read_file"],
};

const validSpec: AgentSpec = {
  id: "backend_agent",
  role: "backend",
  task: "Implement the events API.",
  reason: "Handles business logic.",
  depends_on: [],
  tools: ["read_file"],
  success_criteria: ["API satisfies REQ-001."],
  requirement_ids: ["REQ-001"],
  architecture_components: ["backend"],
};

describe("Factory Service", () => {
  it("creates AgentConfig from a valid spec", () => {
    const factory = new FactoryService();
    const configs = factory.createAgentConfigs([validSpec], validInput);
    expect(configs).toHaveLength(1);
    const config = configs[0]!;
    expect(config.id).toBe("backend_agent");
    expect(config.role).toBe("backend");
    expect(config.task).toBe("Implement the events API.");
  });

  it("initial lifecycle state is CREATED", () => {
    const factory = new FactoryService();
    const [config] = factory.createAgentConfigs([validSpec], validInput);
    expect(config!.lifecycle.state).toBe("CREATED");
  });

  it("backend configuration comes from Factory defaults, not the spec", () => {
    const factory = new FactoryService({
      backend: { provider: "test-provider", model: "test-model" },
    });
    const [config] = factory.createAgentConfigs([validSpec], validInput);
    expect(config!.backend.provider).toBe("test-provider");
    expect(config!.backend.model).toBe("test-model");
  });

  it("budget max_steps respects constraints.max_agent_steps", () => {
    const factory = new FactoryService({ maxStepsPerAgent: 100 });
    const [config] = factory.createAgentConfigs([validSpec], validInput);
    // Should be min(100, max_agent_steps=6) = 6
    expect(config!.budget.max_steps).toBe(6);
  });

  it("write scope is empty (no write access in this prototype)", () => {
    const factory = new FactoryService();
    const [config] = factory.createAgentConfigs([validSpec], validInput);
    expect(config!.scope.write).toHaveLength(0);
  });

  it("context flags are set by the Factory", () => {
    const factory = new FactoryService();
    const [config] = factory.createAgentConfigs([validSpec], validInput);
    expect(config!.context.include_requirements).toBe(true);
    expect(config!.context.include_architecture).toBe(true);
  });

  it("throws FactoryError on empty spec list", () => {
    const factory = new FactoryService();
    expect(() => factory.createAgentConfigs([], validInput)).toThrow(FactoryError);
  });

  it("creates multiple configs for multiple specs", () => {
    const factory = new FactoryService();
    const spec2: AgentSpec = { ...validSpec, id: "frontend_agent", role: "frontend" };
    const configs = factory.createAgentConfigs([validSpec, spec2], validInput);
    expect(configs).toHaveLength(2);
    expect(configs.map((c) => c.id)).toEqual(["backend_agent", "frontend_agent"]);
  });
});
