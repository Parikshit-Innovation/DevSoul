import { describe, test } from 'node:test';
import * as assert from 'node:assert';
import { ProviderAdapter } from '../src/adapters.ts';
import { ModelRegistry } from '../src/registry.ts';
import { ModelRouter } from '../src/router.ts';
import { ModelExecutor } from '../src/executor.ts';
import { AuditLogger } from '../src/audit.ts';
import type { ModelEntry, RouteRequest } from '../src/models.ts';

describe('Model Hub Resilience & Reliability Test Suite', () => {
  test('1. Timeouts: Default local timeout (60s) is longer than cloud timeout (30s), and custom timeout triggers abort', async () => {
    const adapter = new ProviderAdapter();
    assert.strictEqual((adapter as any).localTimeoutMs, 60000);
    assert.strictEqual((adapter as any).cloudTimeoutMs, 30000);
    assert.ok((adapter as any).localTimeoutMs > (adapter as any).cloudTimeoutMs);

    // Test custom timeout
    const slowAdapter = new ProviderAdapter({
      fetchFn: async (url, init) => {
        return new Promise((resolve, reject) => {
          const t = setTimeout(() => {
            resolve(new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] })));
          }, 200);
          if (init?.signal) {
            init.signal.addEventListener('abort', () => {
              clearTimeout(t);
              reject(new DOMException('The operation was aborted', 'AbortError'));
            });
          }
        });
      },
    });

    const model: ModelEntry = {
      id: 'quick-model',
      provider: 'ollama',
      remoteName: 'qwen2.5-coder:7b',
      displayName: 'Quick Model',
      location: 'local',
      strengths: ['general'],
      latencyTier: 'fast',
      enabled: true,
    };

    let caughtError: any = null;
    try {
      await slowAdapter.executeChat(model, [{ role: 'user', content: 'test' }], 50); // 50ms timeout
    } catch (err: any) {
      caughtError = err;
    }

    assert.ok(caughtError, 'Should throw timeout error');
    assert.ok(caughtError.message.includes('timed out after 50ms'));
  });

  test('2. 429 Rate Limit: Bounded exponential backoff retries and recovers successfully', async () => {
    let callCount = 0;
    const adapter = new ProviderAdapter({
      fetchFn: async () => {
        callCount++;
        if (callCount < 3) {
          // Return 429 for first 2 attempts
          return new Response('Rate limit exceeded', { status: 429 });
        }
        // Success on 3rd attempt
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: 'Recovered after backoff' } }],
            usage: { total_tokens: 10 },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      },
    });

    const model: ModelEntry = {
      id: 'cloud-model',
      provider: 'openrouter',
      remoteName: 'anthropic/claude-3.5-sonnet',
      displayName: 'Cloud Model',
      location: 'cloud',
      strengths: ['general'],
      latencyTier: 'medium',
      enabled: true,
    };

    const res = await adapter.executeChat(model, [{ role: 'user', content: 'test' }]);
    assert.strictEqual(callCount, 3, 'Should have retried twice and succeeded on attempt 3');
    assert.strictEqual(res.content, 'Recovered after backoff');
  });

  test('3. 4xx Auth Errors (401/403): Fails immediately without wasteful retries', async () => {
    let callCount = 0;
    const adapter = new ProviderAdapter({
      fetchFn: async () => {
        callCount++;
        return new Response('Unauthorized: Invalid API Key', { status: 401 });
      },
    });

    const model: ModelEntry = {
      id: 'cloud-model',
      provider: 'openrouter',
      remoteName: 'anthropic/claude-3.5-sonnet',
      displayName: 'Cloud Model',
      location: 'cloud',
      strengths: ['general'],
      latencyTier: 'medium',
      enabled: true,
    };

    let caughtError: any = null;
    try {
      await adapter.executeChat(model, [{ role: 'user', content: 'test' }]);
    } catch (err: any) {
      caughtError = err;
    }

    assert.strictEqual(callCount, 1, '401 Unauthorized must NEVER be retried');
    assert.ok(caughtError.message.includes('401'));
  });

  test('4. Fallback order is strictly respected when primary model fails', async () => {
    const attemptOrder: string[] = [];

    const mockAdapter = new ProviderAdapter({
      fetchFn: async (url, init) => {
        const body = JSON.parse(String(init?.body || '{}'));
        attemptOrder.push(body.model);
        if (body.model === 'primary-model:latest') {
          return new Response('Server Error', { status: 500 });
        }
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: 'Fallback answer' } }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      },
    });

    const registry = new ModelRegistry(mockAdapter);
    registry.loadFromConfig({
      models: [
        {
          id: 'model-primary',
          provider: 'ollama',
          remoteName: 'primary-model:latest',
          displayName: 'Primary Model',
          location: 'local',
          strengths: ['general'],
          latencyTier: 'fast',
          enabled: true,
        },
        {
          id: 'model-fallback-1',
          provider: 'ollama',
          remoteName: 'fallback-1:latest',
          displayName: 'Fallback 1',
          location: 'local',
          strengths: ['general'],
          latencyTier: 'fast',
          enabled: true,
        },
      ],
      settings: {
        defaultCloudModelId: 'model-primary',
        defaultLocalModelId: 'model-primary',
        healthCheckTtlSeconds: 30,
        requestTimeoutMs: { cloud: 30000, local: 60000 },
        privateGlobs: ['.env*'],
        privateProject: false,
      },
    });

    const router = new ModelRouter(registry);
    router.setRules([
      {
        name: 'Test Fallback Order Rule',
        when: {},
        prefer: ['model-primary', 'model-fallback-1'],
      },
    ]);

    const executor = new ModelExecutor(router, registry, mockAdapter, new AuditLogger());
    const res = await executor.chat({ messages: [{ role: 'user', content: 'hello' }] });

    assert.strictEqual(res.modelUsed, 'model-fallback-1');
    assert.deepStrictEqual(attemptOrder, ['primary-model:latest', 'fallback-1:latest']);
  });

  test('5. maxCostTier and preferLowLatency tie-breakers function correctly', async () => {
    const registry = new ModelRegistry(new ProviderAdapter());
    registry.loadFromConfig({
      models: [
        {
          id: 'expensive-slow',
          provider: 'openrouter',
          remoteName: 'expensive/slow',
          displayName: 'Expensive Slow',
          location: 'cloud',
          strengths: ['architecture'],
          costPer1MInputUsd: 10.0,
          costPer1MOutputUsd: 30.0,
          latencyTier: 'slow',
          enabled: true,
        },
        {
          id: 'cheap-fast',
          provider: 'openrouter',
          remoteName: 'cheap/fast',
          displayName: 'Cheap Fast',
          location: 'cloud',
          strengths: ['architecture'],
          costPer1MInputUsd: 0.2,
          costPer1MOutputUsd: 0.5,
          latencyTier: 'fast',
          enabled: true,
        },
        {
          id: 'free-local',
          provider: 'ollama',
          remoteName: 'free/local',
          displayName: 'Free Local',
          location: 'local',
          strengths: ['architecture'],
          costPer1MInputUsd: 0,
          costPer1MOutputUsd: 0,
          latencyTier: 'medium',
          enabled: true,
        },
      ],
      settings: {
        defaultCloudModelId: 'expensive-slow',
        defaultLocalModelId: 'free-local',
        healthCheckTtlSeconds: 30,
        requestTimeoutMs: { cloud: 30000, local: 60000 },
        privateGlobs: ['.env*'],
        privateProject: false,
      },
    });

    const router = new ModelRouter(registry);
    router.setRules([
      {
        name: 'All Architecture Models',
        when: { category: 'architecture' },
        prefer: ['expensive-slow', 'cheap-fast', 'free-local'],
      },
    ]);

    // Test maxCostTier: 'free' -> drops cloud models with >0 cost
    const freeReq: RouteRequest = {
      messages: [{ role: 'user', content: 'Design system' }],
      category: 'architecture',
      maxCostTier: 'free',
    };
    const freeDecision = await router.route(freeReq);
    assert.strictEqual(freeDecision.modelId, 'free-local');

    // Test preferLowLatency: true -> ranks fast before slow/medium
    const latencyReq: RouteRequest = {
      messages: [{ role: 'user', content: 'Design system' }],
      category: 'architecture',
      preferLowLatency: true,
    };
    const latencyDecision = await router.route(latencyReq);
    assert.strictEqual(latencyDecision.modelId, 'cheap-fast');
  });

  test('6. Health check failure never crashes process and marks models offline gracefully', async () => {
    const crashingAdapter = new ProviderAdapter({
      fetchFn: async () => {
        throw new Error('Connection refused / DNS failure ECONNREFUSED');
      },
    });

    const registry = new ModelRegistry(crashingAdapter);
    // Should never throw or crash
    const statuses = await registry.refreshAvailability(true);
    assert.ok(Array.isArray(statuses));
    assert.ok(statuses.every((s) => s.available === false));
  });

  test('7. Token/Cost Accounting: Returns undefined cost when pricing is null/unknown', async () => {
    const mockAdapter = new ProviderAdapter({
      fetchFn: async () => {
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: 'No pricing response' } }],
            usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      },
    });

    const registry = new ModelRegistry(mockAdapter);
    registry.loadFromConfig({
      models: [
        {
          id: 'unpriced-model',
          provider: 'ollama',
          remoteName: 'custom:model',
          displayName: 'Unpriced Model',
          location: 'local',
          strengths: ['general'],
          costPer1MInputUsd: null, // Unknown/null pricing
          costPer1MOutputUsd: null,
          latencyTier: 'fast',
          enabled: true,
        },
      ],
      settings: {
        defaultCloudModelId: 'unpriced-model',
        defaultLocalModelId: 'unpriced-model',
        healthCheckTtlSeconds: 30,
        requestTimeoutMs: { cloud: 30000, local: 60000 },
        privateGlobs: ['.env*'],
        privateProject: false,
      },
    });

    const router = new ModelRouter(registry);
    const executor = new ModelExecutor(router, registry, mockAdapter, new AuditLogger());

    const res = await executor.chat({
      messages: [{ role: 'user', content: 'Cost calculation check' }],
    });

    // Unknown/null cost returns undefined or 0 for local
    assert.strictEqual(res.estimatedCostUsd, undefined, 'Cost must be undefined when model pricing is null/unknown');
  });
});
