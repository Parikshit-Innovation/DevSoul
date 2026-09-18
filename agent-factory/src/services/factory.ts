/**
 * DevSoul Agent Factory — Factory Service
 * Receives a VALIDATED plan and produces fully configured AgentConfig objects.
 * The Factory, not the LLM, assigns backend, context, scope, budget, and lifecycle.
 */

import type { AgentSpec } from "../types/planner.js";
import type { PlannerInput } from "../types/planner.js";
import type { AgentConfig, AgentBackend } from "../types/agent-config.js";

// ─── Factory Defaults ─────────────────────────────────────────────────────────

export interface FactoryDefaults {
  backend: AgentBackend;
  maxStepsPerAgent: number;
  maxTokensPerAgent: number;
  /** Read-path globs granted to every agent (project-relative) */
  defaultReadScope: string[];
}

const DEFAULT_FACTORY_DEFAULTS: FactoryDefaults = {
  backend: {
    provider: process.env["AGENT_PROVIDER"] ?? "google",
    model: process.env["AGENT_MODEL"] ?? "gemini-1.5-flash",
  },
  maxStepsPerAgent: 8,
  maxTokensPerAgent: 4000,
  defaultReadScope: ["docs/**", "src/**"],
};

// ─── Factory Error ────────────────────────────────────────────────────────────

export class FactoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FactoryError";
  }
}

// ─── Factory Service ──────────────────────────────────────────────────────────

export class FactoryService {
  private readonly defaults: FactoryDefaults;

  constructor(defaults: Partial<FactoryDefaults> = {}) {
    this.defaults = { ...DEFAULT_FACTORY_DEFAULTS, ...defaults };
  }

  /**
   * Converts each validated AgentSpec into a fully configured AgentConfig.
   * All trusted fields (backend, scope, budget, lifecycle) are set here, NOT by the LLM.
   *
   * @throws FactoryError if any spec is unusable (should not happen after validation).
   */
  createAgentConfigs(specs: AgentSpec[], input: PlannerInput): AgentConfig[] {
    if (specs.length === 0) {
      throw new FactoryError("Factory received an empty agent spec list.");
    }

    const maxSteps = Math.min(
      this.defaults.maxStepsPerAgent,
      input.constraints.max_agent_steps
    );

    return specs.map((spec) => this.buildConfig(spec, maxSteps));
  }

  private buildConfig(spec: AgentSpec, maxSteps: number): AgentConfig {
    return {
      // From the validated Planner spec
      id: spec.id,
      role: spec.role,
      task: spec.task,
      reason: spec.reason,
      depends_on: spec.depends_on,
      tools: spec.tools,
      requirement_ids: spec.requirement_ids,
      architecture_components: spec.architecture_components,
      success_criteria: spec.success_criteria,

      // Assigned by the Factory — the LLM cannot set these
      backend: { ...this.defaults.backend },
      context: {
        include_requirements: true,
        include_architecture: true,
      },
      scope: {
        read: [...this.defaults.defaultReadScope],
        write: [], // No write access in this prototype
      },
      budget: {
        max_steps: maxSteps,
        max_tokens: this.defaults.maxTokensPerAgent,
      },
      lifecycle: {
        state: "CREATED",
      },
    };
  }

  get factoryDefaults(): Readonly<FactoryDefaults> {
    return this.defaults;
  }
}
