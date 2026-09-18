export type * from './models.ts';
export * from './utils.ts';
export * from './privacyDetector.ts';
export * from './categoryClassifier.ts';
export * from './adapters.ts';
export * from './registry.ts';
export * from './routing.rules.ts';
export * from './router.ts';
export * from './audit.ts';
export * from './executor.ts';
export * from './server.ts';

import { ProviderAdapter } from './adapters.ts';
import { ModelRegistry } from './registry.ts';
import { PrivacyDetector } from './privacyDetector.ts';
import { ModelRouter } from './router.ts';
import { AuditLogger } from './audit.ts';
import { ModelExecutor } from './executor.ts';
import type { ChatResult, RouteDecision, RouteRequest } from './models.ts';

/**
 * Convenience singleton instance for easy programmatic integration
 */
export const providerAdapter = new ProviderAdapter();
export const modelRegistry = new ModelRegistry(providerAdapter);
export const privacyDetector = new PrivacyDetector();
export const modelRouter = new ModelRouter(modelRegistry, privacyDetector);
export const auditLogger = new AuditLogger();
export const modelExecutor = new ModelExecutor(
  modelRouter,
  modelRegistry,
  providerAdapter,
  auditLogger
);

/**
 * Top-level programmatic API
 */
export async function route(request: RouteRequest): Promise<RouteDecision> {
  return modelRouter.route(request);
}

export async function chat(request: RouteRequest): Promise<ChatResult> {
  return modelExecutor.chat(request);
}
