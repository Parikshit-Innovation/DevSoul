import type {
  ChatResult,
  ModelEntry,
  RouteDecision,
  RouteRequest,
  TokenUsage,
} from './models.ts';
import { ModelRouter } from './router.ts';
import { ModelRegistry } from './registry.ts';
import { ProviderAdapter } from './adapters.ts';
import { AuditLogger } from './audit.ts';
import { SystemContext } from './utils.ts';

export class ModelExecutor {
  private router: ModelRouter;
  private registry: ModelRegistry;
  private adapter: ProviderAdapter;
  private auditLogger: AuditLogger;

  constructor(
    router: ModelRouter,
    registry: ModelRegistry,
    adapter: ProviderAdapter,
    auditLogger: AuditLogger
  ) {
    this.router = router;
    this.registry = registry;
    this.adapter = adapter;
    this.auditLogger = auditLogger;
  }

  public getRouter(): ModelRouter {
    return this.router;
  }

  public getRegistry(): ModelRegistry {
    return this.registry;
  }

  public getAuditLogger(): AuditLogger {
    return this.auditLogger;
  }

  /**
   * Main chat completion with automatic privacy-safe fallback chain
   */
  public async chat(request: RouteRequest): Promise<ChatResult> {
    const startTime = SystemContext.nowMs();
    const promptText = request.messages.map((m) => m.content).join('\n');

    // 1. Route the request
    const decision = await this.router.route(request);

    // 2. Build prioritized candidate list: [primary, ...fallbacks]
    const candidateModelIds = [decision.modelId, ...decision.fallbacks];
    let lastError: Error | null = null;

    for (let i = 0; i < candidateModelIds.length; i++) {
      const modelId = candidateModelIds[i];
      const model = this.registry.getModel(modelId);

      if (!model) continue;

      // CRITICAL ASSERTION: If task is private, ensure candidate is strictly local
      // (unless developer explicitly confirmed override)
      if (decision.sensitivity === 'private' && model.location === 'cloud' && !request.confirmPrivateToCloud) {
        throw new Error(
          `PRIVACY_VIOLATION_IN_FALLBACK: Candidate '${model.id}' is a cloud model, but task is private. Aborting execution.`
        );
      }

      try {
        const response = await this.adapter.executeChat(model, request.messages);
        const totalLatency = SystemContext.nowMs() - startTime;

        // Calculate cost if known
        let estimatedCostUsd: number | undefined;
        if (response.usage && model.costPer1MInputUsd !== undefined && model.costPer1MOutputUsd !== undefined) {
          if (model.costPer1MInputUsd !== null && model.costPer1MOutputUsd !== null) {
            const inputCost = (response.usage.promptTokens / 1000000) * model.costPer1MInputUsd;
            const outputCost = (response.usage.completionTokens / 1000000) * model.costPer1MOutputUsd;
            estimatedCostUsd = Number((inputCost + outputCost).toFixed(6));
          } else {
            estimatedCostUsd = 0;
          }
        }

        // Record successful audit entry
        await this.auditLogger.record(
          decision,
          promptText,
          response.content,
          totalLatency,
          true
        );

        return {
          content: response.content,
          modelUsed: model.id,
          provider: model.provider,
          decision,
          usage: response.usage,
          latencyMs: totalLatency,
          estimatedCostUsd,
        };
      } catch (err: any) {
        lastError = err;
        decision.reasons.push(
          `[Execution Fallback] Attempt with model '${model.id}' failed (${err.message}). Trying next fallback...`
        );
      }
    }

    // If all candidates failed
    const totalLatency = SystemContext.nowMs() - startTime;
    await this.auditLogger.record(
      decision,
      promptText,
      undefined,
      totalLatency,
      false,
      lastError?.message || 'All candidate models failed'
    );

    throw new Error(
      `Execution failed across all candidate models [${candidateModelIds.join(', ')}]. Last error: ${lastError?.message}`
    );
  }

  /**
   * Streaming chat completion
   */
  public async *chatStream(
    request: RouteRequest
  ): AsyncGenerator<string, { modelUsed: string; decision: RouteDecision; latencyMs: number }, void> {
    const startTime = SystemContext.nowMs();
    const promptText = request.messages.map((m) => m.content).join('\n');

    const decision = await this.router.route(request);
    const model = this.registry.getModel(decision.modelId);

    if (!model) {
      throw new Error(`Model '${decision.modelId}' not found in registry`);
    }

    if (decision.sensitivity === 'private' && model.location === 'cloud' && !request.confirmPrivateToCloud) {
      throw new Error(
        `PRIVATE_TO_CLOUD_BLOCKED: Cannot stream private task to cloud model '${model.id}' without confirmation.`
      );
    }

    let fullContent = '';
    try {
      const generator = this.adapter.executeChatStream(model, request.messages);
      for await (const chunk of generator) {
        fullContent += chunk;
        yield chunk;
      }

      const totalLatency = SystemContext.nowMs() - startTime;
      await this.auditLogger.record(
        decision,
        promptText,
        fullContent,
        totalLatency,
        true
      );

      return {
        modelUsed: model.id,
        decision,
        latencyMs: totalLatency,
      };
    } catch (err: any) {
      const totalLatency = SystemContext.nowMs() - startTime;
      await this.auditLogger.record(
        decision,
        promptText,
        fullContent,
        totalLatency,
        false,
        err.message
      );
      throw err;
    }
  }
}
