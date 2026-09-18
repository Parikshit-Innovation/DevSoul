/**
 * Tests: YAML Writer Service
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import yaml from "js-yaml";
import { YamlWriterService, YamlWriterError } from "../src/services/yaml-writer.js";
import type { AgentConfig } from "../src/types/agent-config.js";
import type { PlannerInput } from "../src/types/planner.js";

let tmpDir: string;
let outputPath: string;

const validConfig: AgentConfig = {
  id: "backend_agent",
  role: "backend",
  task: "Implement the events API.",
  reason: "Handles business logic.",
  depends_on: [],
  tools: ["read_file"],
  requirement_ids: ["REQ-001"],
  architecture_components: ["backend"],
  success_criteria: ["API works."],
  backend: { provider: "google", model: "gemini-1.5-flash" },
  context: { include_requirements: true, include_architecture: true },
  scope: { read: ["docs/**", "src/**"], write: [] },
  budget: { max_steps: 8, max_tokens: 4000 },
  lifecycle: { state: "CREATED" },
};

const validInput: PlannerInput = {
  project_id: "devos-demo",
  project_name: "Campus Event Management",
  task: "Implement campus events.",
  summary: "A web app.",
  requirements: [{ id: "REQ-001", description: "View events.", priority: "high", acceptance_criteria: ["Show events."] }],
  design_constraints: [],
  technology_stack: {},
  components: [],
  project_files: [],
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

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "devosoul-test-"));
  outputPath = path.join(tmpDir, "output", "agents.yaml");
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("YamlWriterService", () => {
  it("writes a valid YAML file", async () => {
    const writer = new YamlWriterService({ outputPath, plannerProvider: "google", plannerModel: "gemini-1.5-flash" });
    await writer.write([validConfig], validInput, "Implement campus events.");

    const contents = await fs.readFile(outputPath, "utf8");
    expect(contents).toBeTruthy();

    // Must be valid YAML
    const parsed = yaml.load(contents) as Record<string, unknown>;
    expect(parsed).toBeTruthy();
    expect(parsed["version"]).toBe(1);
    expect((parsed["project"] as Record<string, string>)["id"]).toBe("devos-demo");
  });

  it("does not include any secret keys in the output", async () => {
    const writer = new YamlWriterService({ outputPath, plannerProvider: "google", plannerModel: "gemini-1.5-flash" });
    await writer.write([validConfig], validInput, "Implement campus events.");

    const contents = await fs.readFile(outputPath, "utf8");
    // No secret/credential patterns (max_tokens is a budget field, not a secret)
    expect(contents).not.toMatch(/sk-[A-Za-z0-9]/);
    expect(contents).not.toMatch(/api[_-]?key\s*:/i);
    expect(contents).not.toMatch(/api[_-]?secret\s*:/i);
    expect(contents).not.toMatch(/access_token\s*:/i);
    expect(contents).not.toMatch(/bearer\s+[A-Za-z0-9]/i);
  });

  it("write scope contains no writable paths", async () => {
    const writer = new YamlWriterService({ outputPath, plannerProvider: "google", plannerModel: "gemini-1.5-flash" });
    await writer.write([validConfig], validInput, "Implement campus events.");

    const contents = await fs.readFile(outputPath, "utf8");
    const parsed = yaml.load(contents) as { agents: Array<{ scope: { write: string[] } }> };
    expect(parsed.agents[0]!.scope.write).toHaveLength(0);
  });

  it("read() returns null when the file does not exist", async () => {
    const writer = new YamlWriterService({ outputPath, plannerProvider: "google", plannerModel: "gemini-1.5-flash" });
    const content = await writer.read();
    expect(content).toBeNull();
  });

  it("read() returns the file content after writing", async () => {
    const writer = new YamlWriterService({ outputPath, plannerProvider: "google", plannerModel: "gemini-1.5-flash" });
    await writer.write([validConfig], validInput, "Implement campus events.");
    const content = await writer.read();
    expect(content).toContain("backend_agent");
  });

  it("does not overwrite the previous file when called with an invalid outputPath directory", async () => {
    // First write a valid file
    const writer = new YamlWriterService({ outputPath, plannerProvider: "google", plannerModel: "gemini-1.5-flash" });
    await writer.write([validConfig], validInput, "Implement campus events.");
    const originalContent = await fs.readFile(outputPath, "utf8");

    // Attempt a write to a path with an impossible parent (a file, not a directory)
    const impossiblePath = path.join(outputPath, "cannot-be-a-dir", "agents.yaml");
    const badWriter = new YamlWriterService({ outputPath: impossiblePath, plannerProvider: "google", plannerModel: "gemini-1.5-flash" });
    await expect(badWriter.write([validConfig], validInput, "Fail.")).rejects.toThrow();

    // Original file should be unchanged
    const currentContent = await fs.readFile(outputPath, "utf8");
    expect(currentContent).toBe(originalContent);
  });

  it("creates the output directory if it does not exist", async () => {
    const deepPath = path.join(tmpDir, "deep", "nested", "agents.yaml");
    const writer = new YamlWriterService({ outputPath: deepPath, plannerProvider: "google", plannerModel: "test" });
    await expect(writer.write([validConfig], validInput, "Test.")).resolves.not.toThrow();
    expect(await fs.readFile(deepPath, "utf8")).toContain("version");
  });
});
