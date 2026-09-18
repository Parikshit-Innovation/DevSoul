import { describe, test, before, after } from 'node:test';
import * as assert from 'node:assert';
import { createModelHub, ModelHubClient } from '../src/index.ts';
import { AegisAdapter, createAegisIntegration } from '../src/integrations/aegis.ts';
import { ProviderAdapter } from '../src/adapters.ts';
import type { ModelEntry, RouteRequest } from '../src/models.ts';

describe('Model Hub Integration & Client Contract Test Suite', () => {
  let hub: ReturnType<typeof createModelHub>;
  let port: number;
  let client: ModelHubClient;

  const mockModels: ModelEntry[] = [
    {
      id: 'claude-3-5-sonnet',
      provider: 'openrouter',
      remoteName: 'anthropic/claude-3.5-sonnet',
      displayName: 'Claude 3.5 Sonnet',
      location: 'cloud',
      strengths: ['architecture', 'general'],
      costPer1MInputUsd: 2.5,
      costPer1MOutputUsd: 10.0,
      latencyTier: 'medium',
      enabled: true,
    },
    {
      id: 'qwen-2-5-coder-7b',
      provider: 'ollama',
      remoteName: 'qwen2.5-coder:7b',
      displayName: 'Qwen 2.5 Coder',
      location: 'local',
      strengths: ['refactor_simple', 'general'],
      costPer1MInputUsd: 0,
      costPer1MOutputUsd: 0,
      latencyTier: 'fast',
      enabled: true,
    },
  ];

  before(async () => {
    const mockAdapter = new ProviderAdapter({
      openRouterApiKey: 'test-sk-key-12345',
      fetchFn: async (url, init) => {
        const urlStr = String(url);
        if (urlStr.includes('/chat/completions') || urlStr.includes('/api/chat')) {
          if (init?.body && String(init.body).includes('"stream":true')) {
            const chunks = [
              'data: ' + JSON.stringify({ choices: [{ delta: { content: 'Client ' } }] }) + '\n\n',
              'data: ' + JSON.stringify({ choices: [{ delta: { content: 'stream OK!' } }] }) + '\n\n',
              'data: [DONE]\n\n',
            ];
            let index = 0;
            const stream = new ReadableStream({
              pull(controller) {
                if (index < chunks.length) {
                  controller.enqueue(new TextEncoder().encode(chunks[index++]));
                } else {
                  controller.close();
                }
              },
            });
            return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
          }

          return new Response(
            JSON.stringify({
              choices: [{ message: { role: 'assistant', content: 'Integration chat output' } }],
              usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }

        if (urlStr.includes('/models')) {
          return new Response(
            JSON.stringify({ data: [{ id: 'anthropic/claude-3.5-sonnet' }, { id: 'openai/gpt-4o' }] }),
            { status: 200 }
          );
        }
        if (urlStr.includes('/api/tags')) {
          return new Response(JSON.stringify({ models: [{ name: 'qwen2.5-coder:7b' }] }), { status: 200 });
        }

        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      },
    });

    hub = createModelHub({
      port: 0,
      host: '127.0.0.1',
      adapter: mockAdapter,
      initialConfig: {
        models: mockModels,
        settings: {
          defaultCloudModelId: 'claude-3-5-sonnet',
          defaultLocalModelId: 'qwen-2-5-coder-7b',
          healthCheckTtlSeconds: 30,
          requestTimeoutMs: { cloud: 30000, local: 60000 },
          privateGlobs: ['.env*'],
          privateProject: false,
        },
      },
    });

    port = await hub.server.start();
    client = new ModelHubClient({ baseUrl: `http://127.0.0.1:${port}` });
  });

  after(async () => {
    await hub.server.stop();
  });

  test('1. createModelHub factory exports all lifecycle components and routes directly', async () => {
    assert.ok(hub.registry);
    assert.ok(hub.router);
    assert.ok(hub.executor);
    assert.ok(hub.server);

    const decision = await hub.route({
      messages: [{ role: 'user', content: 'Architecture query' }],
      category: 'architecture',
    });
    assert.strictEqual(decision.modelId, 'claude-3-5-sonnet');
  });

  test('2. ModelHubClient.getModels() and refreshModels() fetch live catalogs over HTTP', async () => {
    const models = await client.getModels();
    assert.ok(Array.isArray(models));
    assert.strictEqual(models.length, 2);

    const refreshed = await client.refreshModels();
    assert.ok(Array.isArray(refreshed));
  });

  test('3. ModelHubClient.route() performs dry-run preview over HTTP', async () => {
    const decision = await client.route({
      messages: [{ role: 'user', content: 'Refactor simple helper' }],
      category: 'refactor_simple',
    });
    assert.strictEqual(decision.modelId, 'qwen-2-5-coder-7b');
    assert.strictEqual(decision.location, 'local');
  });

  test('4. ModelHubClient.chat() executes completion and returns payload over HTTP', async () => {
    const result = await client.chat({
      messages: [{ role: 'user', content: 'Explain code' }],
    });
    assert.strictEqual(result.content, 'Integration chat output');
    assert.strictEqual(result.modelUsed, 'claude-3-5-sonnet');
    assert.ok(result.usage);
  });

  test('5. ModelHubClient.chatStream() consumes SSE deltas over HTTP', async () => {
    const chunks: string[] = [];
    for await (const chunk of client.chatStream({
      messages: [{ role: 'user', content: 'Stream test' }],
    })) {
      chunks.push(chunk);
    }
    assert.deepStrictEqual(chunks, ['Client ', 'stream OK!']);
  });

  test('6. ModelHubClient.getDecisions() queries recent decisions from audit log', async () => {
    const decisions = await client.getDecisions(5);
    assert.ok(Array.isArray(decisions));
    assert.ok(decisions.length > 0);
  });

  test('7. AegisAdapter contract: flags sensitive files/payloads and forwards audit records', async () => {
    const loggedAegisEvents: any[] = [];
    const fakeAegis = {
      resourceClassifier: {
        classify: (target: any) => {
          const targetStr = typeof target === 'string' ? target : target?.path || '';
          if (targetStr.includes('payroll.db')) {
            return { isSensitive: true, sensitivity: 'confidential' };
          }
          return { isSensitive: false, sensitivity: 'public' };
        },
      },
      payloadScanner: {
        scan: (payload: string) => {
          if (payload.includes('SUPER_SECRET_PAYLOAD')) {
            return { hasSensitiveData: true, findings: ['secret_token'] };
          }
          return { hasSensitiveData: false, findings: [] };
        },
      },
      auditLogger: {
        logEvent: (event: any) => {
          loggedAegisEvents.push(event);
        },
      },
    };

    const aegisAdapter = createAegisIntegration(fakeAegis);

    // Test 1: Sensitive file path escalates to PRIVATE
    const fileReq: RouteRequest = {
      messages: [{ role: 'user', content: 'Query user data' }],
      filePaths: ['src/database/payroll.db'],
    };
    const fileSens = await aegisAdapter.evaluateSensitivity(fileReq);
    assert.strictEqual(fileSens, 'private');

    // Test 2: Sensitive payload escalates to PRIVATE
    const payloadReq: RouteRequest = {
      messages: [{ role: 'user', content: 'Here is SUPER_SECRET_PAYLOAD' }],
    };
    const payloadSens = await aegisAdapter.evaluateSensitivity(payloadReq);
    assert.strictEqual(payloadSens, 'private');

    // Test 3: Public request stays public
    const publicReq: RouteRequest = {
      messages: [{ role: 'user', content: 'Hello DevOS' }],
    };
    const publicSens = await aegisAdapter.evaluateSensitivity(publicReq);
    assert.strictEqual(publicSens, 'public');

    // Test 4: Forward audit event
    await aegisAdapter.logDecision({
      id: 'audit-test-1',
      timestamp: new Date().toISOString(),
      taskId: 'task-100',
      category: 'general',
      sensitivity: 'private',
      chosenModel: 'qwen-2-5-coder-7b',
      provider: 'ollama',
      location: 'local',
      overridden: false,
      fallbacks: [],
      reasons: ['Aegis policy enforced'],
      promptHash: 'abcdef123456',
      promptLength: 25,
      success: true,
    });

    assert.strictEqual(loggedAegisEvents.length, 1);
    assert.strictEqual(loggedAegisEvents[0].eventType, 'MODEL_ROUTING_DECISION');
    assert.strictEqual(loggedAegisEvents[0].details.chosenModel, 'qwen-2-5-coder-7b');
  });
});
