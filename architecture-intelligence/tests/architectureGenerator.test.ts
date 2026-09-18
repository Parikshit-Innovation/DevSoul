// Mock the LLM summary helper so tests never make real network calls
jest.mock("../src/llm/architectureSummaryHelper", () => ({
  generateArchitectureNarrative: jest.fn().mockResolvedValue({
    architecture_summary:
      "A web application with a React frontend and a Node.js API.",
    components: [
      {
        name: "frontend",
        description: "Student-facing event browsing and registration UI.",
      },
      {
        name: "backend",
        description: "API for events, registrations, and organizer operations.",
      },
      {
        name: "database",
        description: "Stores users, events, and registrations.",
      },
    ],
    design_constraints: [
      "Prevent duplicate event registrations.",
      "Only authorized organizers can manage events.",
    ],
  }),
}));

import { buildArchitecture } from "../src/generator/architectureGenerator";
import { generateDiagram } from "../src/generator/diagramGenerator";

const MOCK_REQUIREMENTS = {
  project: "devos-demo",
  requirements: [
    {
      id: "REQ-001",
      text: "Students can browse and register for campus events",
      category: "feature",
      status: "confirmed",
    },
    {
      id: "REQ-002",
      text: "Prevent duplicate event registrations",
      category: "constraint",
      status: "confirmed",
    },
    {
      id: "REQ-003",
      text: "Only authorized organizers can manage events",
      category: "auth",
      status: "confirmed",
    },
  ],
};

/** Full 15-key answer set as the interview would produce */
const MOCK_ANSWERS: Record<string, string> = {
  frontend_core: "SPA",
  frontend_framework: "React",
  frontend_state: "Zustand",
  backend_runtime: "Node.js",
  backend_api: "Express",
  db_relational: "PostgreSQL",
  db_nonrelational: "none",
  db_caching: "Redis",
  auth: "JWT",
  devops_cloud: "AWS",
  devops_containers: "Docker",
  devops_cicd: "GitHub Actions",
  devops_iac: "Terraform",
  monitoring_error: "Sentry",
  monitoring_logs: "CloudWatch",
};

// ── buildArchitecture ─────────────────────────────────────────────────────────

describe("buildArchitecture", () => {
  it("returns an object with all six required top-level keys", async () => {
    const arch = await buildArchitecture(
      "devos-demo",
      MOCK_REQUIREMENTS,
      MOCK_ANSWERS
    );

    expect(arch).toHaveProperty("project_id");
    expect(arch).toHaveProperty("architecture_summary");
    expect(arch).toHaveProperty("technology_stack");
    expect(arch).toHaveProperty("components");
    expect(arch).toHaveProperty("design_constraints");
    expect(arch).toHaveProperty("project_files");
  });

  it("sets project_id to the value passed in", async () => {
    const arch = await buildArchitecture(
      "devos-demo",
      MOCK_REQUIREMENTS,
      MOCK_ANSWERS
    );
    expect(arch.project_id).toBe("devos-demo");
  });

  it("maps technology_stack from the three primary interview keys", async () => {
    const arch = await buildArchitecture(
      "devos-demo",
      MOCK_REQUIREMENTS,
      MOCK_ANSWERS
    );
    expect(arch.technology_stack.frontend).toBe("React");
    expect(arch.technology_stack.backend).toBe("Node.js");
    expect(arch.technology_stack.database).toBe("PostgreSQL");
  });

  it("technology_stack has correct types (all strings)", async () => {
    const arch = await buildArchitecture(
      "devos-demo",
      MOCK_REQUIREMENTS,
      MOCK_ANSWERS
    );
    expect(typeof arch.technology_stack.frontend).toBe("string");
    expect(typeof arch.technology_stack.backend).toBe("string");
    expect(typeof arch.technology_stack.database).toBe("string");
  });

  it("components is a non-empty array of {name, description} objects", async () => {
    const arch = await buildArchitecture(
      "devos-demo",
      MOCK_REQUIREMENTS,
      MOCK_ANSWERS
    );
    expect(Array.isArray(arch.components)).toBe(true);
    expect(arch.components.length).toBeGreaterThan(0);
    arch.components.forEach((c) => {
      expect(typeof c.name).toBe("string");
      expect(typeof c.description).toBe("string");
    });
  });

  it("architecture_summary is a non-empty string", async () => {
    const arch = await buildArchitecture(
      "devos-demo",
      MOCK_REQUIREMENTS,
      MOCK_ANSWERS
    );
    expect(typeof arch.architecture_summary).toBe("string");
    expect(arch.architecture_summary.length).toBeGreaterThan(0);
  });

  it("design_constraints is an array of strings", async () => {
    const arch = await buildArchitecture(
      "devos-demo",
      MOCK_REQUIREMENTS,
      MOCK_ANSWERS
    );
    expect(Array.isArray(arch.design_constraints)).toBe(true);
    arch.design_constraints.forEach((c) => {
      expect(typeof c).toBe("string");
    });
  });

  it("project_files is an array containing src/frontend/ and src/backend/", async () => {
    const arch = await buildArchitecture(
      "devos-demo",
      MOCK_REQUIREMENTS,
      MOCK_ANSWERS
    );
    expect(Array.isArray(arch.project_files)).toBe(true);
    expect(arch.project_files).toContain("src/frontend/");
    expect(arch.project_files).toContain("src/backend/");
  });

  it("includes database/ in project_files when db_relational is set", async () => {
    const arch = await buildArchitecture(
      "devos-demo",
      MOCK_REQUIREMENTS,
      MOCK_ANSWERS
    );
    expect(arch.project_files).toContain("database/");
  });

  it("omits database/ in project_files when db_relational is 'none'", async () => {
    const noneAnswers = { ...MOCK_ANSWERS, db_relational: "none" };
    const arch = await buildArchitecture(
      "devos-demo",
      MOCK_REQUIREMENTS,
      noneAnswers
    );
    expect(arch.project_files).not.toContain("database/");
  });
});

// ── generateDiagram ───────────────────────────────────────────────────────────

describe("generateDiagram", () => {
  it("produces a valid Mermaid graph string from ArchitectureOutput", async () => {
    const arch = await buildArchitecture(
      "devos-demo",
      MOCK_REQUIREMENTS,
      MOCK_ANSWERS
    );
    const diagram = generateDiagram(arch);
    expect(diagram).toContain("graph TD");
    expect(diagram).toContain("React");
    expect(diagram).toContain("Node.js");
    expect(diagram).toContain("PostgreSQL");
  });

  it("diagram contains arrows linking Frontend → Backend → Database", async () => {
    const arch = await buildArchitecture(
      "devos-demo",
      MOCK_REQUIREMENTS,
      MOCK_ANSWERS
    );
    const diagram = generateDiagram(arch);
    expect(diagram).toContain("-->");
  });
});
