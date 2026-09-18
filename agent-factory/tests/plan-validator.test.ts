/**
 * Tests: Plan Validator Service
 */

import { describe, it, expect } from "vitest";
import { validatePlan } from "../src/services/plan-validator.js";
import type { PlannerInput, PlannerResponse } from "../src/types/planner.js";

const validInput: PlannerInput = {
  project_id: "devos-demo",
  project_name: "Campus Event Management",
  task: "Implement campus event browsing and registration.",
  summary: "A web app.",
  requirements: [
    {
      id: "REQ-001",
      description: "Students can view events.",
      priority: "high",
      acceptance_criteria: ["Display event title."],
    },
    {
      id: "REQ-002",
      description: "Students can register.",
      priority: "high",
      acceptance_criteria: ["Prevent duplicate registrations."],
    },
  ],
  design_constraints: [],
  technology_stack: { frontend: "React", backend: "Node.js" },
  components: [
    { name: "frontend", description: "UI." },
    { name: "backend", description: "API." },
  ],
  project_files: ["src/"],
  constraints: {
    max_agents: 5,
    max_planning_tokens: 3000,
    max_agent_steps: 8,
    allowed_tools: ["read_file"],
    project_root: ".",
  },
  allowed_roles: ["planner", "frontend", "backend", "database", "testing", "integration", "documentation"],
  allowed_tools: ["read_file"],
};

const validPlan: PlannerResponse = {
  task: "Implement campus event browsing and registration.",
  agents: [
    {
      id: "backend_agent",
      role: "backend",
      task: "Implement the events and registration API.",
      reason: "The backend handles business logic.",
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
};

describe("PlanValidator Service", () => {
  it("passes a valid plan", () => {
    const result = validatePlan(validPlan, validInput);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("fails when duplicate agent IDs exist", () => {
    const plan: PlannerResponse = {
      ...validPlan,
      agents: [validPlan.agents[0]!, { ...validPlan.agents[0]! }],
    };
    const result = validatePlan(plan, validInput);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("Duplicate agent IDs"))).toBe(true);
  });

  it("fails when an unknown role is used", () => {
    const plan: PlannerResponse = {
      ...validPlan,
      agents: [{ ...validPlan.agents[0]!, role: "hacker" }],
    };
    const result = validatePlan(plan, validInput);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("hacker"))).toBe(true);
  });

  it("fails when an unknown tool is used", () => {
    const plan: PlannerResponse = {
      ...validPlan,
      agents: [{ ...validPlan.agents[0]!, tools: ["execute_shell"] }],
    };
    const result = validatePlan(plan, validInput);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("execute_shell"))).toBe(true);
  });

  it("fails when a dependency references a non-existent agent", () => {
    const plan: PlannerResponse = {
      ...validPlan,
      agents: [{ ...validPlan.agents[0]!, depends_on: ["ghost_agent"] }],
    };
    const result = validatePlan(plan, validInput);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("ghost_agent"))).toBe(true);
  });

  it("fails when an agent depends on itself", () => {
    const plan: PlannerResponse = {
      ...validPlan,
      agents: [{ ...validPlan.agents[0]!, depends_on: ["backend_agent"] }],
    };
    const result = validatePlan(plan, validInput);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("depends on itself"))).toBe(true);
  });

  it("fails when a circular dependency exists", () => {
    const plan: PlannerResponse = {
      task: "Test",
      agents: [
        {
          id: "agent_a",
          role: "backend",
          task: "Task A",
          reason: "Reason A",
          depends_on: ["agent_b"],
          tools: ["read_file"],
          success_criteria: ["Done."],
          requirement_ids: [],
          architecture_components: [],
        },
        {
          id: "agent_b",
          role: "frontend",
          task: "Task B",
          reason: "Reason B",
          depends_on: ["agent_a"],
          tools: ["read_file"],
          success_criteria: ["Done."],
          requirement_ids: [],
          architecture_components: [],
        },
      ],
    };
    const result = validatePlan(plan, validInput);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("Circular dependency"))).toBe(true);
  });

  it("fails when agent count exceeds max_agents", () => {
    const tooManyAgents = Array.from({ length: 6 }, (_, i) => ({
      id: `agent_${i}`,
      role: "backend",
      task: `Task ${i}`,
      reason: "Needed.",
      depends_on: [] as string[],
      tools: ["read_file"] as string[],
      success_criteria: ["Done."],
      requirement_ids: [] as string[],
      architecture_components: [] as string[],
    }));
    const plan: PlannerResponse = { task: "Test", agents: tooManyAgents };
    const result = validatePlan(plan, { ...validInput, constraints: { ...validInput.constraints, max_agents: 5 } });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("5"))).toBe(true);
  });

  it("fails when a requirement ID does not exist in the input", () => {
    const plan: PlannerResponse = {
      ...validPlan,
      agents: [{ ...validPlan.agents[0]!, requirement_ids: ["REQ-999"] }],
    };
    const result = validatePlan(plan, validInput);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("REQ-999"))).toBe(true);
  });

  it("fails when an architecture component reference does not exist", () => {
    const plan: PlannerResponse = {
      ...validPlan,
      agents: [{ ...validPlan.agents[0]!, architecture_components: ["nonexistent_component"] }],
    };
    const result = validatePlan(plan, validInput);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("nonexistent_component"))).toBe(true);
  });

  it("fails when an agent has no success criteria", () => {
    const plan: PlannerResponse = {
      ...validPlan,
      agents: [{ ...validPlan.agents[0]!, success_criteria: [] }],
    };
    const result = validatePlan(plan, validInput);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("success criterion"))).toBe(true);
  });

  it("produces warnings for agents without requirement_ids", () => {
    const plan: PlannerResponse = {
      ...validPlan,
      agents: [{ ...validPlan.agents[0]!, requirement_ids: [] }],
    };
    const result = validatePlan(plan, validInput);
    // No requirement_ids should produce a warning, not an error
    expect(result.warnings.some((w) => w.includes("requirement_ids"))).toBe(true);
  });
});
