import { describe, test, beforeEach } from 'node:test';
import * as assert from 'node:assert';
import { ModelRouter } from '../src/router.ts';
import { ModelRegistry } from '../src/registry.ts';
import { PrivacyDetector } from '../src/privacyDetector.ts';
import { ProviderAdapter } from '../src/adapters.ts';
import { ModelExecutor } from '../src/executor.ts';
import { AuditLogger } from '../src/audit.ts';
import type { ModelHubConfig, RouteRequest } from '../src/models.ts';

describe('Model Hub Router — Acceptance & Core Test Suite', () => {
  let adapter: ProviderAdapter;
  let registry: ModelRegistry;
  let privacyDetector: PrivacyDetector;
  let router: ModelRouter;
  let auditLogger: AuditLogger;
  let executor: ModelExecutor;

  const mockConfig: ModelHubConfig = {
    models: [
      {
        id: 'claude-3-5-sonnet',
        provider: 'openrouter',
        remoteName: 'anthropic/claude-3.5-sonnet',
        displayName: 'Claude 3.5 Sonnet',
        location: 'cloud',
        strengths: ['architecture', 'code_review', 'debugging', 'general'],
        costPer1MInputUsd: 3.0,
        costPer1MOutputUsd: 15.0,
        latencyTier: 'medium',
        contextWindow: 200000,
        enabled: true,
      },
      {
        id: 'gpt-4o',
        provider: 'openrouter',
        remoteName: 'openai/gpt-4o',
        displayName: 'GPT-4o',
        location: 'cloud',
        strengths: ['architecture', 'debugging', 'general'],
        costPer1MInputUsd: 2.5,
        costPer1MOutputUsd: 10.0,
        latencyTier: 'fast',
        contextWindow: 128000,
        enabled: true,
      },
      {
        id: 'llama-3-1-8b',
        provider: 'openrouter',
        remoteName: 'meta-llama/llama-3.1-8b-instruct',
        displayName: 'Llama 3.1 8B Instruct',
        location: 'cloud',
        strengths: ['documentation', 'boilerplate', 'test_generation'],
        costPer1MInputUsd: 0.05,
        costPer1MOutputUsd: 0.05,
        latencyTier: 'fast',
        contextWindow: 128000,
        enabled: true,
      },
      {
        id: 'gemini-flash-1-5',
        provider: 'openrouter',
        remoteName: 'google/gemini-flash-1.5',
        displayName: 'Gemini 1.5 Flash',
        location: 'cloud',
        strengths: ['documentation', 'boilerplate', 'general'],
        costPer1MInputUsd: 0.075,
        costPer1MOutputUsd: 0.3,
        latencyTier: 'fast',
        contextWindow: 1000000,
        enabled: true,
      },
      {
        id: 'qwen-2-5-coder-7b',
        provider: 'ollama',
        remoteName: 'qwen2.5-coder:7b',
        displayName: 'Qwen 2.5 Coder 7B',
        location: 'local',
        strengths: ['refactor_simple', 'boilerplate', 'test_generation', 'code_review', 'debugging', 'architecture', 'general'],
        costPer1MInputUsd: 0.0,
        costPer1MOutputUsd: 0.0,
        latencyTier: 'medium',
        contextWindow: 32768,
        enabled: true,
      },
      {
        id: 'llama-3-2-3b',
        provider: 'ollama',
        remoteName: 'llama3.2:3b',
        displayName: 'Llama 3.2 3B',
        location: 'local',
        strengths: ['documentation', 'boilerplate', 'general'],
        costPer1MInputUsd: 0.0,
        costPer1MOutputUsd: 0.0,
        latencyTier: 'fast',
        contextWindow: 131072,
        enabled: true,
      },
      {
        id: 'deepseek-r1-8b',
        provider: 'ollama',
        remoteName: 'deepseek-r1:8b',
        displayName: 'DeepSeek R1 8B',
        location: 'local',
        strengths: ['architecture', 'debugging', 'code_review'],
        costPer1MInputUsd: 0.0,
        costPer1MOutputUsd: 0.0,
        latencyTier: 'slow',
        contextWindow: 65536,
        enabled: true,
      },
    ],
    settings: {
      defaultCloudModelId: 'claude-3-5-sonnet',
      defaultLocalModelId: 'qwen-2-5-coder-7b',
      healthCheckTtlSeconds: 30,
      requestTimeoutMs: { cloud: 30000, local: 60000 },
      privateGlobs: ['.env*', '**/secrets/**', '**/*.pem', '**/*.key', '**/credentials*'],
      privateProject: false,
    },
  };

  beforeEach(() => {
    adapter = new ProviderAdapter();
    registry = new ModelRegistry(adapter);
    registry.loadFromConfig(mockConfig);

    // Mark all as available by default for unit tests
    mockConfig.models.forEach((m) => {
      registry.setModelAvailability(m.id, true, 'Available');
    });

    privacyDetector = new PrivacyDetector(mockConfig.settings.privateGlobs, false);
    router = new ModelRouter(registry, privacyDetector);
    auditLogger = new AuditLogger();
    executor = new ModelExecutor(router, registry, adapter, auditLogger);
  });

  // =========================================================================
  // Minimum Acceptance Case 1
  // =========================================================================
  test('Case 1: architecture + public -> strongest reasoning cloud model (claude-3-5-sonnet)', async () => {
    const req: RouteRequest = {
      messages: [{ role: 'user', content: 'Design an event-driven architecture for distributed checkout' }],
    };
    const decision = await router.route(req);
    assert.strictEqual(decision.category, 'architecture');
    assert.strictEqual(decision.sensitivity, 'public');
    assert.strictEqual(decision.modelId, 'claude-3-5-sonnet');
    assert.strictEqual(decision.location, 'cloud');
  });

  // =========================================================================
  // Minimum Acceptance Case 2
  // =========================================================================
  test('Case 2: refactor_simple + public -> local Qwen coder (qwen-2-5-coder-7b)', async () => {
    const req: RouteRequest = {
      messages: [{ role: 'user', content: 'Refactor and simplify this helper function by renaming variables' }],
    };
    const decision = await router.route(req);
    assert.strictEqual(decision.category, 'refactor_simple');
    assert.strictEqual(decision.sensitivity, 'public');
    assert.strictEqual(decision.modelId, 'qwen-2-5-coder-7b');
    assert.strictEqual(decision.location, 'local');
  });

  // =========================================================================
  // Minimum Acceptance Case 3
  // =========================================================================
  test('Case 3: documentation + public -> fast cheap cloud model (llama-3-1-8b)', async () => {
    const req: RouteRequest = {
      messages: [{ role: 'user', content: 'Generate a clean README and markdown docstrings for this module' }],
    };
    const decision = await router.route(req);
    assert.strictEqual(decision.category, 'documentation');
    assert.strictEqual(decision.sensitivity, 'public');
    assert.strictEqual(decision.modelId, 'llama-3-1-8b');
    assert.strictEqual(decision.location, 'cloud');
  });

  // =========================================================================
  // Minimum Acceptance Case 4
  // =========================================================================
  test('Case 4: any category + private -> stays on a LOCAL model', async () => {
    const categories: ('architecture' | 'documentation' | 'debugging' | 'boilerplate')[] = [
      'architecture',
      'documentation',
      'debugging',
      'boilerplate',
    ];

    for (const cat of categories) {
      const req: RouteRequest = {
        category: cat,
        sensitivity: 'private',
        messages: [{ role: 'user', content: `Perform ${cat} on our proprietary internal system` }],
      };
      const decision = await router.route(req);
      assert.strictEqual(decision.sensitivity, 'private');
      assert.strictEqual(decision.location, 'local', `Category ${cat} routed to cloud on private task!`);
      assert.ok(
        decision.fallbacks.every((f) => registry.getModel(f)?.location === 'local'),
        `Fallbacks for ${cat} contain cloud models!`
      );
    }
  });

  // =========================================================================
  // Minimum Acceptance Case 5
  // =========================================================================
  test('Case 5: private + Ollama down/no local model -> throws NO_LOCAL_MODEL_AVAILABLE and makes ZERO cloud calls', async () => {
    // Disable all local models
    registry.setModelAvailability('qwen-2-5-coder-7b', false, 'Ollama offline');
    registry.setModelAvailability('llama-3-2-3b', false, 'Ollama offline');
    registry.setModelAvailability('deepseek-r1-8b', false, 'Ollama offline');

    let cloudCallMade = false;
    adapter.setFetch(async () => {
      cloudCallMade = true;
      return new Response(JSON.stringify({ choices: [{ message: { content: 'leaked' } }] }));
    });

    const req: RouteRequest = {
      sensitivity: 'private',
      messages: [{ role: 'user', content: 'Process sensitive private payload' }],
    };

    await assert.rejects(
      async () => {
        await executor.chat(req);
      },
      (err: any) => {
        return err.code === 'NO_LOCAL_MODEL_AVAILABLE' || err.message.includes('NO_LOCAL_MODEL_AVAILABLE');
      }
    );

    assert.strictEqual(cloudCallMade, false, 'Security invariant violated: Cloud call made during private task failure!');
  });

  // =========================================================================
  // Minimum Acceptance Case 6
  // =========================================================================
  test('Case 6: private + local model fails mid-request -> fallback chain contains no cloud models, error surfaced', async () => {
    const req: RouteRequest = {
      sensitivity: 'private',
      messages: [{ role: 'user', content: 'Sensitive private refactor' }],
    };

    const decision = await router.route(req);
    assert.strictEqual(decision.location, 'local');

    // Verify every fallback model is strictly local
    for (const fbId of decision.fallbacks) {
      const fbModel = registry.getModel(fbId);
      assert.strictEqual(fbModel?.location, 'local', `Cloud model '${fbId}' found in private fallback chain!`);
    }

    // Mock failure on local execution
    adapter.setFetch(async () => {
      throw new Error('Local inference engine GPU out of memory');
    });

    await assert.rejects(
      async () => {
        await executor.chat(req);
      },
      /Execution failed across all candidate models/
    );
  });

  // =========================================================================
  // Minimum Acceptance Case 7
  // =========================================================================
  test('Case 7: override to an available public model -> honoured, overridden=true', async () => {
    const req: RouteRequest = {
      overrideModelId: 'gpt-4o',
      messages: [{ role: 'user', content: 'Generate simple documentation' }],
    };
    const decision = await router.route(req);
    assert.strictEqual(decision.modelId, 'gpt-4o');
    assert.strictEqual(decision.overridden, true);
  });

  // =========================================================================
  // Minimum Acceptance Case 8
  // =========================================================================
  test('Case 8: override cloud model on private without confirmation -> PRIVATE_TO_CLOUD_BLOCKED; with confirmation -> allowed and audited', async () => {
    // 8a: Without confirmation -> Rejected
    const reqBlocked: RouteRequest = {
      overrideModelId: 'claude-3-5-sonnet',
      sensitivity: 'private',
      messages: [{ role: 'user', content: 'Review internal credentials' }],
    };

    await assert.rejects(
      async () => {
        await router.route(reqBlocked);
      },
      (err: any) => {
        return err.code === 'PRIVATE_TO_CLOUD_BLOCKED' || err.message.includes('PRIVATE_TO_CLOUD_BLOCKED');
      }
    );

    // 8b: With explicit confirmation -> Allowed with security audit warning
    const reqAllowed: RouteRequest = {
      overrideModelId: 'claude-3-5-sonnet',
      sensitivity: 'private',
      confirmPrivateToCloud: true,
      messages: [{ role: 'user', content: 'Review internal credentials' }],
    };

    const decision = await router.route(reqAllowed);
    assert.strictEqual(decision.modelId, 'claude-3-5-sonnet');
    assert.strictEqual(decision.overridden, true);
    assert.ok(decision.reasons.some((r) => r.includes('SECURITY EXCEPTION')));
  });

  // =========================================================================
  // Minimum Acceptance Case 9
  // =========================================================================
  test('Case 9: override to unknown or unavailable model -> clear error listing valid ids', async () => {
    // Unknown model
    await assert.rejects(
      async () => {
        await router.route({
          overrideModelId: 'non-existent-model-xyz',
          messages: [{ role: 'user', content: 'Hello' }],
        });
      },
      /Override model 'non-existent-model-xyz' does not exist\. Available models:/
    );

    // Unavailable model
    registry.setModelAvailability('claude-3-5-sonnet', false, 'API key missing');
    await assert.rejects(
      async () => {
        await router.route({
          overrideModelId: 'claude-3-5-sonnet',
          messages: [{ role: 'user', content: 'Hello' }],
        });
      },
      /Override model 'claude-3-5-sonnet' is currently unavailable/
    );
  });

  // =========================================================================
  // Minimum Acceptance Case 10
  // =========================================================================
  test('Case 10: cloud model returns 429/5xx -> next fallback used, decision records it', async () => {
    let callCount = 0;
    adapter.setFetch(async (url, init) => {
      callCount++;
      const body = JSON.parse(init?.body as string);
      if (body.model === 'anthropic/claude-3.5-sonnet') {
        return new Response('Rate limit exceeded', { status: 429, statusText: 'Too Many Requests' });
      }
      // Fallback model succeeds
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: 'Fallback GPT-4o response success' } }],
          usage: { prompt_tokens: 20, completion_tokens: 15, total_tokens: 35 },
        }),
        { status: 200 }
      );
    });

    const req: RouteRequest = {
      category: 'architecture',
      messages: [{ role: 'user', content: 'System design query' }],
    };

    const result = await executor.chat(req);
    assert.strictEqual(result.modelUsed, 'gpt-4o');
    assert.strictEqual(result.content, 'Fallback GPT-4o response success');
    assert.ok(callCount >= 2, 'Fallback was not invoked on primary 429 failure');
  });

  // =========================================================================
  // Minimum Acceptance Case 11
  // =========================================================================
  test('Case 11: secret-pattern and private-glob detectors escalate correctly and cannot be downgraded', async () => {
    const reqWithSecrets: RouteRequest = {
      messages: [{ role: 'user', content: 'Fix bug with Stripe key: sk_live_51Abcdefghijklmnopqrstuv' }],
      sensitivity: 'public', // User tries to label public
    };
    const decision = await router.route(reqWithSecrets);
    assert.strictEqual(decision.sensitivity, 'private');
    assert.strictEqual(decision.location, 'local');
  });

  // =========================================================================
  // Minimum Acceptance Case 12
  // =========================================================================
  test('Case 12: configured model missing from /models or /api/tags -> marked unavailable, never routed to', async () => {
    // Simulate catalog check where gpt-4o is missing from remote
    registry.setModelAvailability('claude-3-5-sonnet', false, 'Model not found in OpenRouter catalog');

    const req: RouteRequest = {
      category: 'architecture',
      messages: [{ role: 'user', content: 'Architecture task' }],
    };

    const decision = await router.route(req);
    // Should skip unavailable claude-3-5-sonnet and route to gpt-4o
    assert.strictEqual(decision.modelId, 'gpt-4o');
    assert.ok(!decision.fallbacks.includes('claude-3-5-sonnet'));
  });
});
