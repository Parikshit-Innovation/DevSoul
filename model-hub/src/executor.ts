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
        const response = await this.adapter.executeChat(
          model,
          request.messages,
          request.timeoutMs,
          request.signal
        );
        const totalLatency = SystemContext.nowMs() - startTime;

        // Calculate cost if known
        let estimatedCostUsd: number | undefined;
        if (
          response.usage &&
          model.costPer1MInputUsd !== undefined &&
          model.costPer1MOutputUsd !== undefined &&
          model.costPer1MInputUsd !== null &&
          model.costPer1MOutputUsd !== null
        ) {
          const inputCost = (response.usage.promptTokens / 1000000) * model.costPer1MInputUsd;
          const outputCost = (response.usage.completionTokens / 1000000) * model.costPer1MOutputUsd;
          estimatedCostUsd = Number((inputCost + outputCost).toFixed(6));
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
   * Streaming chat completion with privacy-safe stream rules
   */
  public async *chatStream(
    request: RouteRequest
  ): AsyncGenerator<string, { modelUsed: string; decision: RouteDecision; latencyMs: number }, void> {
    const startTime = SystemContext.nowMs();
    const promptText = request.messages.map((m) => m.content).join('\n');

    const decision = await this.router.route(request);
    const candidateModelIds = [decision.modelId, ...decision.fallbacks];
    let fullContent = '';
    let lastError: Error | null = null;

    for (let i = 0; i < candidateModelIds.length; i++) {
      const modelId = candidateModelIds[i];
      const model = this.registry.getModel(modelId);
      if (!model) continue;

      // CRITICAL ASSERTION: If task is private, candidate must NEVER be cloud (unless override confirmed)
      if (decision.sensitivity === 'private' && model.location === 'cloud' && !request.confirmPrivateToCloud) {
        throw new Error(
          `PRIVATE_TO_CLOUD_BLOCKED: Cannot stream private task to cloud model '${model.id}' without confirmation.`
        );
      }

      let emittedChunksInThisAttempt = false;

      try {
        const generator = this.adapter.executeChatStream(
          model,
          request.messages,
          request.timeoutMs,
          request.signal
        );

        for await (const chunk of generator) {
          if (request.signal?.aborted) {
            throw new Error(`Streaming request to model '${model.id}' aborted by client`);
          }
          emittedChunksInThisAttempt = true;
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
        lastError = err;

        // INVARIANT: If ANY output chunk has already been emitted to the client,
        // we must NEVER silently switch models mid-answer! Surface terminal error immediately.
        if (emittedChunksInThisAttempt || fullContent.length > 0) {
          const totalLatency = SystemContext.nowMs() - startTime;
          await this.auditLogger.record(
            decision,
            promptText,
            fullContent,
            totalLatency,
            false,
            `Stream terminated mid-generation on model '${model.id}': ${err.message}`
          );
          throw new Error(
            `STREAM_TERMINATED_MID_RESPONSE: Stream failed after partial generation on model '${model.id}'. Cannot failover mid-stream: ${err.message}`
          );
        }

        // Otherwise (0 chunks emitted), log reason and try next candidate if private safety holds
        decision.reasons.push(
          `[Stream Fallback] Stream attempt with model '${model.id}' failed before output (${err.message}). Trying next candidate...`
        );
      }
    }

    const totalLatency = SystemContext.nowMs() - startTime;
    await this.auditLogger.record(
      decision,
      promptText,
      fullContent,
      totalLatency,
      false,
      lastError?.message || 'All stream candidates failed'
    );

    throw new Error(
      `Streaming failed across all candidate models [${candidateModelIds.join(', ')}]. Last error: ${lastError?.message}`
    );
  }
}
