/**
 * DevSoul Agent Factory — Plan Validator Service
 * Deterministic validation of the Planner's proposed agent plan.
 * NO LLM is used. All checks are rule-based.
 *
 * The Factory will NOT create any agents until this service returns { valid: true }.
 */

import { isAllowedRole } from "../catalogs/roles.js";
import { isAllowedTool } from "../catalogs/tools.js";
import type { PlannerInput, PlannerResponse } from "../types/planner.js";
import type { ValidationResult } from "../types/pipeline.js";

/** Regex for safe agent IDs — lowercase letters, digits, underscores, starts with letter, max 63 chars. */
const SAFE_ID_PATTERN = /^[a-z][a-z0-9_]{0,62}$/;

/**
 * Validates the Planner response before the Factory creates any agents.
 * Returns a structured result with valid, errors[], and warnings[].
 */
export function validatePlan(
  plan: PlannerResponse,
  input: PlannerInput
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const { agents } = plan;
  const maxAgents = input.constraints.max_agents;
  const allowedTools = input.allowed_tools;

  // Build lookup sets from the input
  const validRequirementIds = new Set(input.requirements.map((r) => r.id));
  const validComponentNames = new Set(input.components.map((c) => c.name));

  // ── Check 1: Agent count ───────────────────────────────────────────────────
  if (agents.length === 0) {
    errors.push("Plan contains no agents. At least one agent is required.");
  }
  if (agents.length > maxAgents) {
    errors.push(
      `Plan proposes ${agents.length} agents but the project limit is ${maxAgents}.`
    );
  }

  // ── Check 2: Unique IDs ────────────────────────────────────────────────────
  const seenIds = new Set<string>();
  const duplicateIds: string[] = [];
  for (const agent of agents) {
    if (seenIds.has(agent.id)) {
      duplicateIds.push(agent.id);
    }
    seenIds.add(agent.id);
  }
  if (duplicateIds.length > 0) {
    errors.push(`Duplicate agent IDs found: ${duplicateIds.join(", ")}.`);
  }

  // Build a set of all proposed agent IDs for dependency checks
  const allAgentIds = new Set(agents.map((a) => a.id));

  // ── Per-agent checks ───────────────────────────────────────────────────────
  for (const agent of agents) {
    const ctx = `[agent: ${agent.id}]`;

    // Check 2b: ID pattern
    if (!SAFE_ID_PATTERN.test(agent.id)) {
      errors.push(
        `${ctx} ID "${agent.id}" is invalid. ` +
          "Must start with a lowercase letter and contain only lowercase letters, digits, and underscores (max 63 chars)."
      );
    }

    // Check 3: Role exists in catalog
    if (!isAllowedRole(agent.role)) {
      errors.push(
        `${ctx} Role "${agent.role}" is not in the role catalog. ` +
          "Allowed roles are: " +
          ["planner", "frontend", "backend", "database", "testing", "integration", "documentation"].join(", ") +
          "."
      );
    }

    // Check 4: Non-empty task
    if (!agent.task || agent.task.trim().length === 0) {
      errors.push(`${ctx} Task must not be empty.`);
    }

    // Check 5: Meaningful success criteria (at least 1, each non-empty)
    if (!agent.success_criteria || agent.success_criteria.length === 0) {
      errors.push(`${ctx} Must have at least one success criterion.`);
    } else {
      const emptyCount = agent.success_criteria.filter((s) => s.trim().length === 0).length;
      if (emptyCount > 0) {
        errors.push(`${ctx} All success criteria must be non-empty strings.`);
      }
    }

    // Check 6: Tools exist in catalog and are allowed by constraints
    for (const tool of agent.tools) {
      if (!isAllowedTool(tool)) {
        errors.push(
          `${ctx} Tool "${tool}" is not in the tool catalog. ` +
            "Only the following tools are allowed: " +
            allowedTools.join(", ") +
            "."
        );
      } else if (!allowedTools.includes(tool)) {
        errors.push(
          `${ctx} Tool "${tool}" is in the catalog but not permitted by the project constraints.`
        );
      }
    }

    // Check 7: Requirement IDs refer to actual requirements
    for (const reqId of agent.requirement_ids) {
      if (!validRequirementIds.has(reqId)) {
        errors.push(
          `${ctx} Requirement ID "${reqId}" does not exist in the input requirements.`
        );
      }
    }

    // Check 8: Architecture component references are valid
    for (const comp of agent.architecture_components) {
      if (!validComponentNames.has(comp)) {
        errors.push(
          `${ctx} Architecture component "${comp}" does not exist in the input architecture.`
        );
      }
    }

    // Check 9: No self-dependency
    if (agent.depends_on.includes(agent.id)) {
      errors.push(`${ctx} Agent depends on itself.`);
    }

    // Check 10: Dependencies reference existing agents
    for (const dep of agent.depends_on) {
      if (!allAgentIds.has(dep)) {
        errors.push(
          `${ctx} Dependency "${dep}" does not match any agent ID in the plan.`
        );
      }
    }
  }

  // ── Check 11: Circular dependencies ───────────────────────────────────────
  if (errors.length === 0) {
    // Only run cycle detection when basic structural checks pass
    const cycleError = detectCycle(agents);
    if (cycleError) {
      errors.push(cycleError);
    }
  }

  // ── Warnings ───────────────────────────────────────────────────────────────
  for (const agent of agents) {
    if (agent.requirement_ids.length === 0) {
      warnings.push(
        `[agent: ${agent.id}] has no requirement_ids linked. ` +
          "Consider linking it to one or more requirements for traceability."
      );
    }
    if (agent.architecture_components.length === 0) {
      warnings.push(
        `[agent: ${agent.id}] has no architecture_components linked. ` +
          "Consider linking it to the relevant architecture component."
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

// ─── Cycle Detection (Kahn's Algorithm) ──────────────────────────────────────

interface AgentWithDeps {
  id: string;
  depends_on: string[];
}

function detectCycle(agents: AgentWithDeps[]): string | null {
  const inDegree = new Map<string, number>();
  const adjList = new Map<string, string[]>(); // from -> to (dependant)

  for (const agent of agents) {
    if (!inDegree.has(agent.id)) inDegree.set(agent.id, 0);
    if (!adjList.has(agent.id)) adjList.set(agent.id, []);
  }

  for (const agent of agents) {
    for (const dep of agent.depends_on) {
      // dep -> agent.id (agent depends on dep, so dep must finish first)
      adjList.get(dep)?.push(agent.id);
      inDegree.set(agent.id, (inDegree.get(agent.id) ?? 0) + 1);
    }
  }

  const queue: string[] = [];
  for (const [id, degree] of inDegree) {
    if (degree === 0) queue.push(id);
  }

  let processed = 0;
  while (queue.length > 0) {
    const current = queue.shift()!;
    processed++;
    for (const neighbour of adjList.get(current) ?? []) {
      const newDegree = (inDegree.get(neighbour) ?? 0) - 1;
      inDegree.set(neighbour, newDegree);
      if (newDegree === 0) queue.push(neighbour);
    }
  }

  if (processed < agents.length) {
    const inCycle = agents
      .filter((a) => (inDegree.get(a.id) ?? 0) > 0)
      .map((a) => a.id);
    return `Circular dependency detected among agents: ${inCycle.join(", ")}.`;
  }

  return null;
}
