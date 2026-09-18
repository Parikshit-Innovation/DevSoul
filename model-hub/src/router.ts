import type {
  ModelStatus,
  RouteDecision,
  RouteRequest,
  RoutingRule,
  Sensitivity,
  TaskCategory,
} from './models.ts';
import { ModelRegistry } from './registry.ts';
import { PrivacyDetector } from './privacyDetector.ts';
import { CategoryClassifier } from './categoryClassifier.ts';
import { DEFAULT_ROUTING_RULES } from './routing.rules.ts';
import { SystemContext } from './utils.ts';

export class ModelRouter {
  private registry: ModelRegistry;
  private privacyDetector: PrivacyDetector;
  private rules: RoutingRule[];

  constructor(
    registry: ModelRegistry,
    privacyDetector: PrivacyDetector,
    rules: RoutingRule[] = DEFAULT_ROUTING_RULES
  ) {
    this.registry = registry;
    this.privacyDetector = privacyDetector;
    this.rules = [...rules];
  }

  public setRules(rules: RoutingRule[]): void {
    this.rules = [...rules];
  }

  public getRules(): RoutingRule[] {
    return [...this.rules];
  }

  public async route(request: RouteRequest): Promise<RouteDecision> {
    const reasons: string[] = [];
    const taskId = request.taskId || SystemContext.generateId('task');

    // -----------------------------------------------------------------------
    // Step 1: Category Determination
    // -----------------------------------------------------------------------
    const categoryResult = CategoryClassifier.classify(request.category, request.messages);
    const category: TaskCategory = categoryResult.category;
    categoryResult.reasons.forEach((r) => reasons.push(`[Category] ${r}`));

    // -----------------------------------------------------------------------
    // Step 2: Sensitivity & Privacy Determination
    // -----------------------------------------------------------------------
    const privacyResult = await this.privacyDetector.evaluate(request);
    const sensitivity: Sensitivity = privacyResult.sensitivity;
    privacyResult.reasons.forEach((r) => reasons.push(`[Privacy] ${r}`));

    // -----------------------------------------------------------------------
    // Step 3: Manual Override Check
    // -----------------------------------------------------------------------
    if (request.overrideModelId) {
      const overrideModel = this.registry.getModel(request.overrideModelId);
      const allModels = this.registry.getAllModels();
      const validIds = allModels.filter((m) => m.enabled && m.available).map((m) => m.id);

      if (!overrideModel) {
        throw new Error(
          `Override model '${request.overrideModelId}' does not exist. Available models: [${validIds.join(', ')}]`
        );
      }

      if (!overrideModel.enabled) {
        throw new Error(
          `Override model '${request.overrideModelId}' is disabled in configuration. Available models: [${validIds.join(', ')}]`
        );
      }

      if (!overrideModel.available) {
        throw new Error(
          `Override model '${request.overrideModelId}' is currently unavailable (${overrideModel.reason || 'Health check failed'}). Available models: [${validIds.join(', ')}]`
        );
      }

      // Hard Privacy Constraint on Manual Override
      if (sensitivity === 'private' && overrideModel.location === 'cloud') {
        if (!request.confirmPrivateToCloud) {
          const error: any = new Error(
            `PRIVATE_TO_CLOUD_BLOCKED: Manual override '${overrideModel.id}' is a cloud model, but this task involves private/sensitive code. Overriding requires explicit confirmPrivateToCloud: true.`
          );
          error.code = 'PRIVATE_TO_CLOUD_BLOCKED';
          throw error;
        }

        reasons.push(
          `⚠️ [SECURITY EXCEPTION] Developer explicitly confirmed private task override to cloud model '${overrideModel.id}'. Audited for compliance.`
        );
      } else {
        reasons.push(`[Override] Manual override applied: Selected '${overrideModel.id}' (${overrideModel.displayName})`);
      }

      // Compute privacy-safe fallbacks for the override
      const rawFallbacks = this.registry
        .getAvailableModels()
        .filter((m) => m.id !== overrideModel.id)
        .map((m) => m.id);

      const filteredFallbacks = this.filterByPrivacyAndConstraints(
        rawFallbacks,
        sensitivity,
        request
      );

      return {
        taskId,
        modelId: overrideModel.id,
        provider: overrideModel.provider,
        remoteName: overrideModel.remoteName,
        location: overrideModel.location,
        category,
        sensitivity,
        overridden: true,
        reasons,
        fallbacks: filteredFallbacks,
        decidedAt: SystemContext.nowMs(),
      };
    }

    // -----------------------------------------------------------------------
    // Step 4: Rule Table Matching
    // -----------------------------------------------------------------------
    let matchedRule: RoutingRule | undefined;

    for (const rule of this.rules) {
      const matchSensitivity =
        !rule.when.sensitivity || rule.when.sensitivity === sensitivity;
      const matchCategory =
        !rule.when.category || rule.when.category === category;

      if (matchSensitivity && matchCategory) {
        matchedRule = rule;
        break;
      }
    }

    if (!matchedRule) {
      // Fallback to default general rule
      matchedRule = {
        name: 'Catch-all Default Rule',
        when: {},
        prefer: ['claude-3-5-sonnet', 'qwen-2-5-coder-7b', 'llama-3-1-8b'],
      };
    }

    reasons.push(
      `[Rule Table] Matched rule '${matchedRule.name}' with preference list: [${matchedRule.prefer.join(', ')}]`
    );

    // -----------------------------------------------------------------------
    // Step 5: Constraint Filter & Tie-Breaking
    // -----------------------------------------------------------------------
    const candidateIds = matchedRule.prefer;
    const survivingModelIds = this.filterByPrivacyAndConstraints(
      candidateIds,
      sensitivity,
      request,
      reasons
    );

    // -----------------------------------------------------------------------
    // Step 6: Survivor Selection & Fallback Chain
    // -----------------------------------------------------------------------
    if (survivingModelIds.length === 0) {
      if (sensitivity === 'private') {
        const localModels = this.registry
          .getAllModels()
          .filter((m) => m.location === 'local');
        const pullHints = localModels
          .map((m) => `ollama pull ${m.remoteName}`)
          .join(' or ');

        const error: any = new Error(
          `NO_LOCAL_MODEL_AVAILABLE: Task contains private/sensitive code, but no local models in Ollama are currently available. Run: ${pullHints || 'ollama pull qwen2.5-coder:7b'} and ensure Ollama is running.`
        );
        error.code = 'NO_LOCAL_MODEL_AVAILABLE';
        throw error;
      }

      // For public tasks, check if any global model is available
      const anyAvailable = this.registry.getAvailableModels();
      if (anyAvailable.length > 0) {
        const fallbackModel = anyAvailable[0];
        reasons.push(
          `[Fallback Recovery] No preferred rule models available; falling back to first available model '${fallbackModel.id}'`
        );
        return {
          taskId,
          modelId: fallbackModel.id,
          provider: fallbackModel.provider,
          remoteName: fallbackModel.remoteName,
          location: fallbackModel.location,
          category,
          sensitivity,
          overridden: false,
          reasons,
          fallbacks: anyAvailable.slice(1).map((m) => m.id),
          decidedAt: SystemContext.nowMs(),
        };
      }

      const error: any = new Error(
        'NO_MODEL_AVAILABLE: No cloud or local models are currently enabled and available.'
      );
      error.code = 'NO_MODEL_AVAILABLE';
      throw error;
    }

    const chosenId = survivingModelIds[0];
    const chosenModel = this.registry.getModel(chosenId)!;
    const fallbacks = survivingModelIds.slice(1);

    reasons.push(
      `[Decision] Selected '${chosenModel.id}' (${chosenModel.displayName}) at location '${chosenModel.location.toUpperCase()}'. Privacy-filtered fallbacks: [${fallbacks.join(', ') || 'none'}]`
    );

    return {
      taskId,
      modelId: chosenModel.id,
      provider: chosenModel.provider,
      remoteName: chosenModel.remoteName,
      location: chosenModel.location,
      category,
      sensitivity,
      overridden: false,
      reasons,
      fallbacks,
      decidedAt: SystemContext.nowMs(),
    };
  }

  /**
   * Filters a candidate list strictly adhering to privacy and availability
   */
  private filterByPrivacyAndConstraints(
    modelIds: string[],
    sensitivity: Sensitivity,
    request: RouteRequest,
    reasons?: string[]
  ): string[] {
    const survivors: string[] = [];

    for (const id of modelIds) {
      const model = this.registry.getModel(id);
      if (!model) continue;

      // 5a. Privacy constraint: If task is private, drop every cloud model
      if (sensitivity === 'private' && model.location === 'cloud') {
        if (reasons) {
          reasons.push(
            `[Constraint Filter] Dropped cloud model '${model.id}' due to HARD privacy constraint (private code must stay local)`
          );
        }
        continue;
      }

      // 5b. Availability & Enablement constraint
      if (!model.enabled || !model.available) {
        if (reasons) {
          reasons.push(
            `[Constraint Filter] Dropped unavailable model '${model.id}' (${model.reason || 'offline'})`
          );
        }
        continue;
      }

      // 5c. Optional tie-breakers: maxCostTier
      if (request.maxCostTier === 'free' && model.costPer1MInputUsd && model.costPer1MInputUsd > 0) {
        continue;
      }

      survivors.push(model.id);
    }

    // Apply low-latency tie-breaker if requested
    if (request.preferLowLatency && survivors.length > 1) {
      survivors.sort((a, b) => {
        const mA = this.registry.getModel(a);
        const mB = this.registry.getModel(b);
        const rank = { fast: 0, medium: 1, slow: 2 };
        const rankA = mA ? rank[mA.latencyTier] : 1;
        const rankB = mB ? rank[mB.latencyTier] : 1;
        return rankA - rankB;
      });
    }

    return survivors;
  }
}
