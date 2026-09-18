/**
 * DevSoul Agent Factory — Pipeline Orchestrator
 * Coordinates all pipeline stages in order:
 * PreCheck → Planner → PlanValidator → Factory → YamlWriter
 *
 * Emits pipeline events via a callback so the API layer can stream them.
 */

import { runPreChecks, PreCheckError } from "./services/pre-check.js";
import { PlannerService, PlannerError } from "./services/planner.js";
import { validatePlan } from "./services/plan-validator.js";
import { FactoryService, FactoryError } from "./services/factory.js";
import { YamlWriterService, YamlWriterError } from "./services/yaml-writer.js";
import type { LLMProvider } from "./llm/provider.interface.js";
import type { PipelineEvent, PipelineEventType, PipelineResult } from "./types/pipeline.js";
import type { AgentConfig } from "./types/agent-config.js";

export interface PipelineRunOptions {
  task: string;
  requirementIntelligence: unknown;
  architectureIntelligence: unknown;
  llmProvider: LLMProvider;
  outputPath: string;
  onEvent?: (event: PipelineEvent) => void;
}

function makeEvent(
  type: PipelineEventType,
  message?: string,
  data?: unknown
): PipelineEvent {
  return { type, timestamp: new Date().toISOString(), message, data };
}

export async function runPipeline(options: PipelineRunOptions): Promise<PipelineResult> {
  const { task, requirementIntelligence, architectureIntelligence, llmProvider, outputPath, onEvent } =
    options;

  const events: PipelineEvent[] = [];

  const emit = (event: PipelineEvent): void => {
    events.push(event);
    onEvent?.(event);
  };

  const fail = (message: string, data?: unknown): PipelineResult => {
    const ev = makeEvent("PIPELINE_FAILED", message, data);
    emit(ev);
    return { success: false, error: message, events };
  };

  // ── Stage 1: Pre-checks ──────────────────────────────────────────────────
  emit(makeEvent("PRECHECK_STARTED", "Running deterministic pre-checks…"));

  let plannerInput;
  try {
    plannerInput = runPreChecks({ task, requirementIntelligence, architectureIntelligence });
  } catch (err) {
    if (err instanceof PreCheckError) {
      return fail(`Pre-check failed: ${err.issues.join("; ")}`, { issues: err.issues });
    }
    return fail(`Pre-check encountered an unexpected error: ${String(err)}`);
  }

  emit(makeEvent("PRECHECK_COMPLETED", "Pre-checks passed. Inputs are valid.", {
    project_id: plannerInput.project_id,
    requirement_count: plannerInput.requirements.length,
    component_count: plannerInput.components.length,
  }));

  // ── Stage 2: Planner LLM Call ────────────────────────────────────────────
  emit(makeEvent("PLANNER_STARTED", `Calling Planner LLM (${llmProvider.providerName}/${llmProvider.modelName})…`));

  const plannerService = new PlannerService({
    provider: llmProvider,
    maxTokens: plannerInput.constraints.max_planning_tokens,
  });

  let plan;
  try {
    plan = await plannerService.plan(plannerInput);
  } catch (err) {
    if (err instanceof PlannerError) {
      return fail(`Planner error: ${err.message}`, { rawResponse: err.rawResponse });
    }
    return fail(`Planner encountered an unexpected error: ${String(err)}`);
  }

  emit(makeEvent("PLANNER_COMPLETED", `Planner proposed ${plan.agents.length} agent(s).`, {
    task: plan.task,
    agent_ids: plan.agents.map((a) => a.id),
  }));

  // ── Stage 3: Plan Validation ─────────────────────────────────────────────
  emit(makeEvent("VALIDATION_STARTED", "Running deterministic plan validation…"));

  const validationResult = validatePlan(plan, plannerInput);

  if (!validationResult.valid) {
    emit(makeEvent("VALIDATION_FAILED", "Plan validation failed.", validationResult));
    return {
      success: false,
      error: `Plan validation failed with ${validationResult.errors.length} error(s).`,
      events,
      validation: validationResult,
    };
  }

  emit(makeEvent("VALIDATION_PASSED", "Plan passed all validation checks.", validationResult));

  // ── Stage 4: Factory Configuration ──────────────────────────────────────
  emit(makeEvent("FACTORY_STARTED", "Creating agent configurations…"));

  const factoryService = new FactoryService();
  let agentConfigs: AgentConfig[];
  try {
    agentConfigs = factoryService.createAgentConfigs(plan.agents, plannerInput);
  } catch (err) {
    if (err instanceof FactoryError) {
      return fail(`Factory error: ${err.message}`);
    }
    return fail(`Factory encountered an unexpected error: ${String(err)}`);
  }

  emit(makeEvent("AGENTS_CREATED", `Created ${agentConfigs.length} agent configuration(s).`, {
    agents: agentConfigs.map((a) => ({ id: a.id, role: a.role, lifecycle: a.lifecycle.state })),
  }));

  // ── Stage 5: Persist agents.yaml ─────────────────────────────────────────
  const yamlWriter = new YamlWriterService({
    outputPath,
    plannerProvider: llmProvider.providerName,
    plannerModel: llmProvider.modelName,
  });

  try {
    await yamlWriter.write(agentConfigs, plannerInput, plan.task);
  } catch (err) {
    if (err instanceof YamlWriterError) {
      return fail(`YAML write failed: ${err.message}`);
    }
    return fail(`YAML writer encountered an unexpected error: ${String(err)}`);
  }

  const yamlContents = await yamlWriter.read();

  emit(makeEvent("YAML_SAVED", `agents.yaml saved to: ${outputPath}`, { path: outputPath }));

  return {
    success: true,
    events,
    validation: validationResult,
    agentsYamlPath: outputPath,
    agentsYamlContents: yamlContents ?? undefined,
  };
}
