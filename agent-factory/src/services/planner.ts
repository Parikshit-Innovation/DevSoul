/**
 * DevSoul Agent Factory — Planner Service
 * Makes ONE LLM call per planning attempt and validates the response against the Planner schema.
 * The Planner proposes agents; it cannot assign backends, scopes, budgets, or lifecycle states.
 */

import type { LLMProvider } from "../llm/provider.interface.js";
import type { PlannerInput, PlannerResponse } from "../types/planner.js";
import { PlannerResponseSchema } from "../types/planner.js";

// ─── Planner Error ────────────────────────────────────────────────────────────

export class PlannerError extends Error {
  constructor(message: string, public readonly rawResponse?: string) {
    super(message);
    this.name = "PlannerError";
  }
}

// ─── System Prompt Builder ────────────────────────────────────────────────────

function buildSystemPrompt(): string {
  return `You are the DevSoul Agent Factory Planner.
Your sole job is to propose the smallest sufficient set of agents required to complete the user's task.

RULES:
1. Return ONLY valid JSON matching the schema below. No markdown fences. No explanatory text before or after the JSON.
2. Do NOT create an agent for every technology in the stack. Create only what is necessary.
3. Each agent must have a distinct, well-defined responsibility.
4. Each agent must have specific, measurable success criteria (at least 1).
5. Use depends_on only when an agent genuinely needs another agent's completed output.
6. Use ONLY the roles from the allowed_roles list.
7. Use ONLY the tools from the allowed_tools list. Never invent tools.
8. Do NOT assign backend, model, permissions, filesystem scope, token budgets, or lifecycle state — these are assigned by the Factory.
9. Do NOT write agents.yaml. Do NOT execute tools. Do NOT modify project files.
10. Agent IDs must be lowercase letters, digits, and underscores only, starting with a letter (max 63 chars).

OUTPUT SCHEMA (JSON):
{
  "task": "<concise restatement of the task>",
  "agents": [
    {
      "id": "<unique_agent_id>",
      "role": "<one of the allowed_roles>",
      "task": "<specific task for this agent>",
      "reason": "<why this agent is needed>",
      "depends_on": ["<other_agent_id>"],
      "tools": ["<tool from allowed_tools>"],
      "success_criteria": ["<measurable condition>"],
      "requirement_ids": ["<REQ-id from the requirements list>"],
      "architecture_components": ["<component name from the components list>"]
    }
  ]
}`;
}

// ─── User Prompt Builder ──────────────────────────────────────────────────────

function buildUserPrompt(input: PlannerInput): string {
  const reqList = input.requirements
    .map(
      (r) =>
        `  - ${r.id} [${r.priority}]: ${r.description}\n` +
        r.acceptance_criteria.map((ac) => `      • ${ac}`).join("\n")
    )
    .join("\n");

  const compList = input.components
    .map((c) => `  - ${c.name}: ${c.description}`)
    .join("\n");

  const techList = Object.entries(input.technology_stack)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `  ${k}: ${v}`)
    .join("\n");

  const designConstraints = input.design_constraints.map((c) => `  - ${c}`).join("\n");

  return `PROJECT: ${input.project_name} (${input.project_id})
SUMMARY: ${input.summary}

USER TASK:
${input.task}

REQUIREMENTS:
${reqList}

ARCHITECTURE SUMMARY:
${input.technology_stack ? techList : "(not provided)"}

COMPONENTS:
${compList}

DESIGN CONSTRAINTS:
${designConstraints || "  (none)"}

ALLOWED AGENT ROLES: ${input.allowed_roles.join(", ")}
ALLOWED TOOLS: ${input.allowed_tools.join(", ")}
MAX AGENTS: ${input.constraints.max_agents}
MAX PLANNING TOKENS: ${input.constraints.max_planning_tokens}

PROJECT FILES:
${input.project_files.map((f) => `  - ${f}`).join("\n")}

Now produce the agent plan as a single JSON object matching the schema.`;
}

// ─── Planner Service ──────────────────────────────────────────────────────────

export interface PlannerServiceConfig {
  /** LLM provider used for the planning call */
  provider: LLMProvider;
  /** Maximum tokens for the planning response */
  maxTokens?: number;
}

export class PlannerService {
  private readonly provider: LLMProvider;
  private readonly maxTokens: number;

  constructor(config: PlannerServiceConfig) {
    this.provider = config.provider;
    this.maxTokens = config.maxTokens ?? 3000;
  }

  /**
   * Makes ONE LLM call and returns a validated PlannerResponse.
   * Throws PlannerError if the call fails or the response is malformed.
   */
  async plan(input: PlannerInput): Promise<PlannerResponse> {
    const effectiveMaxTokens = Math.min(this.maxTokens, input.constraints.max_planning_tokens);

    let rawText: string;
    try {
      const response = await this.provider.complete({
        systemPrompt: buildSystemPrompt(),
        userPrompt: buildUserPrompt(input),
        maxTokens: effectiveMaxTokens,
        responseMimeType: "application/json",
      });
      rawText = response.text;
    } catch (err) {
      throw new PlannerError(
        `LLM provider error: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    // Strip markdown fences if the model ignored that instruction
    const cleaned = rawText
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```\s*$/, "")
      .trim();

    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      throw new PlannerError(
        "Planner returned malformed JSON. The response could not be parsed.",
        rawText
      );
    }

    const result = PlannerResponseSchema.safeParse(parsed);
    if (!result.success) {
      const issues = result.error.issues.map((i) => `${i.path.join(".")} — ${i.message}`);
      throw new PlannerError(
        `Planner response does not match the required schema:\n${issues.map((i) => `  • ${i}`).join("\n")}`,
        rawText
      );
    }

    return result.data;
  }

  get plannerProviderName(): string {
    return this.provider.providerName;
  }

  get plannerModelName(): string {
    return this.provider.modelName;
  }
}
