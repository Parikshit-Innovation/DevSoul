/**
 * Tests: PreCheck Service
 */

import { describe, it, expect } from "vitest";
import { runPreChecks, PreCheckError } from "../src/services/pre-check.js";

const validRI = {
  project_id: "devos-demo",
  project_name: "Campus Event Management",
  summary: "A web app for campus events.",
  requirements: [
    {
      id: "REQ-001",
      description: "Students can view events.",
      priority: "high",
      acceptance_criteria: ["Display event title and date."],
    },
  ],
  constraints: {
    max_agents: 5,
    max_planning_tokens: 3000,
    max_agent_steps: 8,
    allowed_tools: ["read_file"],
    project_root: ".",
  },
};

const validAI = {
  project_id: "devos-demo",
  architecture_summary: "A React/Node.js web application.",
  technology_stack: { frontend: "React", backend: "Node.js" },
  components: [
    { name: "frontend", description: "Student-facing UI." },
    { name: "backend", description: "API server." },
  ],
  design_constraints: ["Prevent duplicate registrations."],
  project_files: ["src/frontend/", "src/backend/"],
};

describe("PreCheck Service", () => {
  it("passes valid mock inputs", () => {
    expect(() =>
      runPreChecks({
        task: "Implement the campus event functionality.",
        requirementIntelligence: validRI,
        architectureIntelligence: validAI,
      })
    ).not.toThrow();
  });

  it("returns normalised PlannerInput on success", () => {
    const result = runPreChecks({
      task: "  Implement the campus event functionality.  ",
      requirementIntelligence: validRI,
      architectureIntelligence: validAI,
    });

    expect(result.project_id).toBe("devos-demo");
    expect(result.task).toBe("Implement the campus event functionality.");
    expect(result.requirements).toHaveLength(1);
    expect(result.components).toHaveLength(2);
    expect(result.allowed_roles).toBeDefined();
    expect(result.allowed_tools).toContain("read_file");
  });

  it("fails when task is empty", () => {
    expect(() =>
      runPreChecks({
        task: "",
        requirementIntelligence: validRI,
        architectureIntelligence: validAI,
      })
    ).toThrow(PreCheckError);
  });

  it("fails when task is whitespace only", () => {
    expect(() =>
      runPreChecks({
        task: "   ",
        requirementIntelligence: validRI,
        architectureIntelligence: validAI,
      })
    ).toThrow(PreCheckError);
  });

  it("fails on malformed RI input (missing project_id)", () => {
    const badRI = { ...validRI, project_id: "" };
    expect(() =>
      runPreChecks({
        task: "Do something.",
        requirementIntelligence: badRI,
        architectureIntelligence: validAI,
      })
    ).toThrow(PreCheckError);
  });

  it("fails on malformed RI input (no requirements)", () => {
    const badRI = { ...validRI, requirements: [] };
    expect(() =>
      runPreChecks({
        task: "Do something.",
        requirementIntelligence: badRI,
        architectureIntelligence: validAI,
      })
    ).toThrow(PreCheckError);
  });

  it("fails on malformed AI input (missing components)", () => {
    const badAI = { ...validAI, components: [] };
    expect(() =>
      runPreChecks({
        task: "Do something.",
        requirementIntelligence: validRI,
        architectureIntelligence: badAI,
      })
    ).toThrow(PreCheckError);
  });

  it("fails when project IDs do not match", () => {
    const mismatchedAI = { ...validAI, project_id: "different-project" };
    let caughtError: PreCheckError | null = null;
    try {
      runPreChecks({
        task: "Do something.",
        requirementIntelligence: validRI,
        architectureIntelligence: mismatchedAI,
      });
    } catch (err) {
      caughtError = err as PreCheckError;
    }
    expect(caughtError).not.toBeNull();
    expect(caughtError!.issues.some((i) => i.includes("Project ID mismatch"))).toBe(true);
  });

  it("fails when RI input is null", () => {
    expect(() =>
      runPreChecks({
        task: "Do something.",
        requirementIntelligence: null,
        architectureIntelligence: validAI,
      })
    ).toThrow(PreCheckError);
  });

  it("fails when an invalid tool is in constraints.allowed_tools", () => {
    const badRI = {
      ...validRI,
      constraints: { ...validRI.constraints, allowed_tools: ["read_file", "execute_shell"] },
    };
    let caughtError: PreCheckError | null = null;
    try {
      runPreChecks({
        task: "Do something.",
        requirementIntelligence: badRI,
        architectureIntelligence: validAI,
      });
    } catch (err) {
      caughtError = err as PreCheckError;
    }
    expect(caughtError).not.toBeNull();
    expect(caughtError!.issues.some((i) => i.includes("execute_shell"))).toBe(true);
  });
});
