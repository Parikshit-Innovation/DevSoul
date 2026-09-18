/**
 * DevSoul Agent Factory — PreCheck Service
 * Deterministic validation of Requirement Intelligence and Architecture Intelligence inputs.
 * NO LLM is used here. All validation is rule-based.
 */

import { z } from "zod";
import { ALLOWED_ROLES } from "../catalogs/roles.js";
import { ALLOWED_TOOLS } from "../catalogs/tools.js";
import type {
  RequirementIntelligenceOutput,
  RIConstraints,
} from "../types/requirement-intelligence.js";
import type { ArchitectureIntelligenceOutput } from "../types/architecture-intelligence.js";
import type { PlannerInput } from "../types/planner.js";

// ─── Zod Schemas ─────────────────────────────────────────────────────────────

const RIRequirementSchema = z.object({
  id: z.string().min(1, "Requirement id must not be empty."),
  description: z.string().min(1, "Requirement description must not be empty."),
  priority: z.enum(["critical", "high", "medium", "low"]),
  acceptance_criteria: z
    .array(z.string().min(1))
    .min(1, "Each requirement must have at least one acceptance criterion."),
});

const RIConstraintsSchema = z.object({
  max_agents: z.number().int().min(1).max(20),
  max_planning_tokens: z.number().int().min(100),
  max_agent_steps: z.number().int().min(1),
  allowed_tools: z.array(z.string().min(1)).min(1),
  project_root: z.string().min(1),
});

const RISchema = z.object({
  project_id: z.string().min(1, "project_id is required."),
  project_name: z.string().min(1, "project_name is required."),
  summary: z.string().min(1, "summary is required."),
  requirements: z
    .array(RIRequirementSchema)
    .min(1, "At least one requirement must be present."),
  constraints: RIConstraintsSchema,
});

const AIComponentSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
});

const AISchema = z.object({
  project_id: z.string().min(1, "project_id is required."),
  architecture_summary: z.string().min(1, "architecture_summary is required."),
  technology_stack: z.record(z.string(), z.string().optional()),
  components: z
    .array(AIComponentSchema)
    .min(1, "At least one architecture component must be present."),
  design_constraints: z.array(z.string()),
  project_files: z.array(z.string()),
});

// ─── Max input size guard ─────────────────────────────────────────────────────

/** Maximum serialised byte size for a single input document (512 KB). */
const MAX_INPUT_BYTES = 512 * 1024;

// ─── PreCheck Error ───────────────────────────────────────────────────────────

export class PreCheckError extends Error {
  public readonly issues: string[];

  constructor(issues: string[]) {
    super(`Pre-check failed:\n${issues.map((i) => `  • ${i}`).join("\n")}`);
    this.name = "PreCheckError";
    this.issues = issues;
  }
}

// ─── PreCheck Service ─────────────────────────────────────────────────────────

export interface PreCheckInput {
  task: string;
  requirementIntelligence: unknown;
  architectureIntelligence: unknown;
}

/**
 * Validates the two intelligence inputs and the user task, then normalises them
 * into a PlannerInput ready for the Planner LLM service.
 *
 * Throws PreCheckError on any validation failure.
 * Never calls an LLM.
 */
export function runPreChecks(input: PreCheckInput): PlannerInput {
  const issues: string[] = [];

  // ── 1. Task validation ────────────────────────────────────────────────────
  if (!input.task || typeof input.task !== "string" || input.task.trim().length === 0) {
    issues.push("User task must not be empty.");
  }
  if (typeof input.task === "string" && input.task.trim().length > 4000) {
    issues.push("User task exceeds the maximum length of 4000 characters.");
  }

  // ── 2. Input size guard ───────────────────────────────────────────────────
  const riBytes = Buffer.byteLength(JSON.stringify(input.requirementIntelligence ?? ""), "utf8");
  const aiBytes = Buffer.byteLength(JSON.stringify(input.architectureIntelligence ?? ""), "utf8");

  if (riBytes > MAX_INPUT_BYTES) {
    issues.push(
      `Requirement Intelligence input exceeds the ${MAX_INPUT_BYTES / 1024} KB size limit.`
    );
  }
  if (aiBytes > MAX_INPUT_BYTES) {
    issues.push(
      `Architecture Intelligence input exceeds the ${MAX_INPUT_BYTES / 1024} KB size limit.`
    );
  }

  // ── 3. Schema validation ──────────────────────────────────────────────────
  const riResult = RISchema.safeParse(input.requirementIntelligence);
  if (!riResult.success) {
    riResult.error.issues.forEach((issue) => {
      issues.push(`[RequirementIntelligence] ${issue.path.join(".")} — ${issue.message}`);
    });
  }

  const aiResult = AISchema.safeParse(input.architectureIntelligence);
  if (!aiResult.success) {
    aiResult.error.issues.forEach((issue) => {
      issues.push(`[ArchitectureIntelligence] ${issue.path.join(".")} — ${issue.message}`);
    });
  }

  // Bail early if schemas are invalid — project_id comparison would be meaningless.
  if (issues.length > 0) {
    throw new PreCheckError(issues);
  }

  const ri = riResult.data as RequirementIntelligenceOutput;
  const ai = aiResult.data as ArchitectureIntelligenceOutput;

  // ── 4. Project ID match ───────────────────────────────────────────────────
  if (ri.project_id !== ai.project_id) {
    issues.push(
      `Project ID mismatch: RequirementIntelligence has "${ri.project_id}" ` +
        `but ArchitectureIntelligence has "${ai.project_id}". ` +
        `Both inputs must belong to the same project.`
    );
  }

  // ── 5. Requirement ID uniqueness ──────────────────────────────────────────
  const reqIds = ri.requirements.map((r) => r.id);
  const duplicateReqIds = reqIds.filter((id, idx) => reqIds.indexOf(id) !== idx);
  if (duplicateReqIds.length > 0) {
    issues.push(`Duplicate requirement IDs found: ${duplicateReqIds.join(", ")}.`);
  }

  // ── 6. Component name uniqueness ──────────────────────────────────────────
  const compNames = ai.components.map((c) => c.name);
  const duplicateCompNames = compNames.filter((n, idx) => compNames.indexOf(n) !== idx);
  if (duplicateCompNames.length > 0) {
    issues.push(`Duplicate architecture component names found: ${duplicateCompNames.join(", ")}.`);
  }

  // ── 7. Validate constraints ───────────────────────────────────────────────
  const constraints: RIConstraints = ri.constraints;

  // Validate allowed_tools exist in the catalog
  const unknownTools = constraints.allowed_tools.filter(
    (t) => !(ALLOWED_TOOLS as readonly string[]).includes(t)
  );
  if (unknownTools.length > 0) {
    issues.push(
      `Constraint allowed_tools contains tools not in the Factory catalog: ${unknownTools.join(", ")}.`
    );
  }

  if (issues.length > 0) {
    throw new PreCheckError(issues);
  }

  // ── 8. Normalise into PlannerInput ────────────────────────────────────────
  const plannerInput: PlannerInput = {
    project_id: ri.project_id,
    project_name: ri.project_name,
    task: input.task.trim(),
    summary: ri.summary,
    requirements: ri.requirements,
    design_constraints: ai.design_constraints,
    technology_stack: ai.technology_stack,
    components: ai.components,
    project_files: ai.project_files,
    constraints: ri.constraints,
    allowed_roles: [...ALLOWED_ROLES],
    allowed_tools: ri.constraints.allowed_tools,
  };

  return plannerInput;
}
