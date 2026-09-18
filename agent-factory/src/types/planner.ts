/**
 * DevSoul Agent Factory — Planner Types
 * Defines the input and output schemas for the Planner LLM service.
 */

import { z } from "zod";
import type { RIRequirement, RIConstraints } from "./requirement-intelligence.js";
import type { AIComponent, AITechnologyStack } from "./architecture-intelligence.js";

// ─── Planner Input ───────────────────────────────────────────────────────────

/**
 * Normalised input that the PreCheck service produces and the Planner consumes.
 */
export interface PlannerInput {
  project_id: string;
  project_name: string;
  task: string;
  summary: string;
  requirements: RIRequirement[];
  design_constraints: string[];
  technology_stack: AITechnologyStack;
  components: AIComponent[];
  project_files: string[];
  constraints: RIConstraints;
  allowed_roles: string[];
  allowed_tools: string[];
}

// ─── Planner Output (Zod schema + inferred types) ───────────────────────────

/**
 * Zod schema for a single agent spec returned by the Planner LLM.
 * This is the strict schema — any extra fields are stripped.
 */
export const AgentSpecSchema = z.object({
  id: z
    .string()
    .regex(
      /^[a-z][a-z0-9_]{0,62}$/,
      "Agent ID must start with a lowercase letter and contain only lowercase letters, digits, and underscores (max 63 chars)."
    ),
  role: z.string().min(1),
  task: z.string().min(1),
  reason: z.string().min(1),
  depends_on: z.array(z.string()).default([]),
  tools: z.array(z.string()).default([]),
  success_criteria: z.array(z.string()).min(1),
  requirement_ids: z.array(z.string()).default([]),
  architecture_components: z.array(z.string()).default([]),
});

export type AgentSpec = z.infer<typeof AgentSpecSchema>;

/**
 * Zod schema for the full Planner response.
 */
export const PlannerResponseSchema = z.object({
  task: z.string().min(1),
  agents: z.array(AgentSpecSchema).min(1),
});

export type PlannerResponse = z.infer<typeof PlannerResponseSchema>;
