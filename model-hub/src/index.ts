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
export * from './client.ts';
export * from './integrations/aegis.ts';

import { ProviderAdapter } from './adapters.ts';
import { ModelRegistry } from './registry.ts';
import { PrivacyDetector } from './privacyDetector.ts';
import { ModelRouter } from './router.ts';
import { AuditLogger } from './audit.ts';
import { ModelExecutor } from './executor.ts';
import { ModelHubServer, type ServerOptions } from './server.ts';
import type { ChatResult, ModelHubConfig, RouteDecision, RouteRequest } from './models.ts';

/**
 * Factory to create an isolated Model Hub instance
 */
export function createModelHub(options: ServerOptions & { initialConfig?: ModelHubConfig } = {}) {
  const adapter = options.adapter || new ProviderAdapter();
  const registry = options.registry || new ModelRegistry(adapter, options.configPath);
  if (options.initialConfig) {
    registry.loadFromConfig(options.initialConfig);
  }
  const privacyDetector = new PrivacyDetector();
  const router = options.router || new ModelRouter(registry, privacyDetector);
  const auditLogger = options.auditLogger || new AuditLogger();
  const executor =
    options.executor || new ModelExecutor(router, registry, adapter, auditLogger);
  const server = new ModelHubServer({
    ...options,
    adapter,
    registry,
    router,
    executor,
    auditLogger,
  });

  return {
    adapter,
    registry,
    privacyDetector,
    router,
    auditLogger,
    executor,
    server,
    route: (req: RouteRequest) => router.route(req),
    chat: (req: RouteRequest) => executor.chat(req),
    chatStream: (req: RouteRequest) => executor.chatStream(req),
  };
}

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

