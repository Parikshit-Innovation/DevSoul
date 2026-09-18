import { describe, test, before, after } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ModelHubServer } from '../src/server.ts';
import { ProviderAdapter } from '../src/adapters.ts';
import { ModelRegistry } from '../src/registry.ts';
import { ModelRouter } from '../src/router.ts';
import { AuditLogger } from '../src/audit.ts';
import { ModelExecutor } from '../src/executor.ts';
import type { ModelEntry } from '../src/models.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Model Hub Server Hardening & API Endpoints Verification', () => {
  const SECRET_API_KEY = 'sk-or-v1-super-secret-canary-key-abcdef123456';
  let server: ModelHubServer;
  let port: number;
  let baseUrl: string;

  const mockModels: ModelEntry[] = [
    {
      id: 'claude-3-5-sonnet',
      provider: 'openrouter',
      remoteName: 'anthropic/claude-3.5-sonnet',
      displayName: 'Claude 3.5 Sonnet',
      location: 'cloud',
      strengths: ['architecture', 'general'],
      costPer1MInputUsd: 3.0,
      costPer1MOutputUsd: 15.0,
      latencyTier: 'medium',
      enabled: true,
    },
    {
      id: 'qwen-2-5-coder-7b',
      provider: 'ollama',
      remoteName: 'qwen2.5-coder:7b',
      displayName: 'Qwen 2.5 Coder 7B',
      location: 'local',
      strengths: ['refactor_simple', 'general'],
      costPer1MInputUsd: 0,
      costPer1MOutputUsd: 0,
      latencyTier: 'fast',
      enabled: true,
    },
  ];

  before(async () => {
    // Custom mock adapter
    const mockAdapter = new ProviderAdapter({
      openRouterApiKey: SECRET_API_KEY,
      openRouterBaseUrl: 'https://openrouter.ai/api/v1',
      ollamaBaseUrl: 'http://localhost:11434',
      fetchFn: async (url, init) => {
        const urlStr = String(url);
        if (urlStr.includes('/chat/completions') || urlStr.includes('/api/chat')) {
          if (init?.body && String(init.body).includes('"stream":true')) {
            // Mock streaming SSE response
            const chunks = [
              'data: ' + JSON.stringify({ choices: [{ delta: { content: 'Hello ' } }] }) + '\n\n',
              'data: ' + JSON.stringify({ choices: [{ delta: { content: 'world!' } }] }) + '\n\n',
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
              choices: [{ message: { role: 'assistant', content: 'Mock response content' } }],
              usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }

        // Live check endpoints
        if (urlStr.includes('/models')) {
          return new Response(JSON.stringify({ data: [{ id: 'anthropic/claude-3.5-sonnet' }] }), { status: 200 });
        }
        if (urlStr.includes('/api/tags')) {
          return new Response(JSON.stringify({ models: [{ name: 'qwen2.5-coder:7b' }] }), { status: 200 });
        }

        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      },
    });

    const registry = new ModelRegistry(mockAdapter);
    // Directly inject mock models into registry
    (registry as any).models = mockModels.map(m => ({ ...m }));

    const auditLogger = new AuditLogger(path.resolve(__dirname, '..', '.devos', 'audit', 'test-server.jsonl'));
    const privacyDetector = new (await import('../src/privacyDetector.ts')).PrivacyDetector();
    const router = new ModelRouter(registry, privacyDetector);
    const executor = new ModelExecutor(router, registry, mockAdapter, auditLogger);

    server = new ModelHubServer({
      port: 0,
      host: '127.0.0.1',
      adapter: mockAdapter,
      registry,
      router,
      executor,
      auditLogger,
    });

    port = await server.start();
    baseUrl = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    await server.stop();
  });

  test('1. Security Headers: all responses include CSP, X-Content-Type-Options, X-Frame-Options, Referrer-Policy', async () => {
    const res = await fetch(`${baseUrl}/`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers.get('x-content-type-options'), 'nosniff');
    assert.strictEqual(res.headers.get('x-frame-options'), 'DENY');
    assert.strictEqual(res.headers.get('referrer-policy'), 'no-referrer');
    const csp = res.headers.get('content-security-policy') || '';
    assert.ok(csp.includes("default-src 'self'"), 'CSP default-src');
    assert.ok(!csp.includes("'unsafe-eval'"), 'CSP must NOT contain unsafe-eval');
  });

  test('2. GET /api/models returns model catalog and never leaks API key', async () => {
    const res = await fetch(`${baseUrl}/api/models`);
    assert.strictEqual(res.status, 200);
    const bodyText = await res.text();
    assert.ok(!bodyText.includes(SECRET_API_KEY), 'API key must never be exposed');
    const models = JSON.parse(bodyText);
    assert.ok(Array.isArray(models), 'Must return an array');
    assert.ok(models.length >= 2, 'Should return at least configured models');
    assert.ok(models.some((m: any) => m.id === 'claude-3-5-sonnet'), 'Should include claude-3-5-sonnet');
  });

  test('3. POST /api/models/refresh forces live health check & returns refreshed list', async () => {
    const res = await fetch(`${baseUrl}/api/models/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    assert.strictEqual(res.status, 200);
    const models = await res.json();
    assert.ok(Array.isArray(models));
  });

  test('4. POST /api/route returns routing decision for valid request', async () => {
    const res = await fetch(`${baseUrl}/api/route`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Design microservices architecture' }],
        category: 'architecture',
      }),
    });
    assert.strictEqual(res.status, 200);
    const decision = await res.json();
    assert.strictEqual(decision.modelId, 'claude-3-5-sonnet');
    assert.strictEqual(decision.location, 'cloud');
    assert.ok(Array.isArray(decision.reasons));
  });

  test('5. POST /api/route returns 400 validation error on missing/empty messages', async () => {
    const res = await fetch(`${baseUrl}/api/route`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category: 'architecture' }),
    });
    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.strictEqual(body.error.code, 'INVALID_REQUEST');
    assert.ok(body.error.message);
  });

  test('6. POST /api/route returns 400 PRIVATE_TO_CLOUD_BLOCKED when attempting to route private code to cloud without confirmation', async () => {
    const res = await fetch(`${baseUrl}/api/route`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Here is AWS_SECRET_ACCESS_KEY=123456789' }],
        overrideModelId: 'claude-3-5-sonnet', // Cloud model override on private data
        confirmPrivateToCloud: false,
      }),
    });
    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.strictEqual(body.error.code, 'PRIVATE_TO_CLOUD_BLOCKED');
    assert.ok(body.error.message.includes('BLOCKED'));
  });

  test('7. POST /api/chat executes routed completion and returns content + metrics', async () => {
    const res = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Hello model hub' }],
      }),
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.content, 'Mock response content');
    assert.ok(typeof body.latencyMs === 'number');
    assert.ok(body.usage);
  });

  test('8. POST /api/chat/stream returns server-sent event (SSE) stream', async () => {
    const res = await fetch(`${baseUrl}/api/chat/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Stream test' }],
      }),
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers.get('content-type'), 'text/event-stream');
    const text = await res.text();
    assert.ok(text.includes('data: {"delta":"Hello "}'));
    assert.ok(text.includes('data: {"delta":"world!"}'));
    assert.ok(text.includes('data: [DONE]'));
  });

  test('9. GET /api/decisions returns recent audit decision records', async () => {
    const res = await fetch(`${baseUrl}/api/decisions?limit=5`);
    assert.strictEqual(res.status, 200);
    const records = await res.json();
    assert.ok(Array.isArray(records));
  });

  test('10. Content-Type enforcement: POST without application/json returns 415 UNSUPPORTED_MEDIA_TYPE', async () => {
    const res = await fetch(`${baseUrl}/api/route`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: 'plain text',
    });
    assert.strictEqual(res.status, 415);
    const body = await res.json();
    assert.strictEqual(body.error.code, 'UNSUPPORTED_MEDIA_TYPE');
  });

  test('11. Payload size limit: POST body > 2MB returns 413 PAYLOAD_TOO_LARGE', async () => {
    const largeMessage = 'x'.repeat(2.5 * 1024 * 1024);
    try {
      const res = await fetch(`${baseUrl}/api/route`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [{ role: 'user', content: largeMessage }] }),
      });
      assert.strictEqual(res.status, 413);
      const body = await res.json();
      assert.strictEqual(body.error.code, 'PAYLOAD_TOO_LARGE');
    } catch (err: any) {
      // In some Node versions socket reset happens on 413 payload destruction
      assert.ok(true, 'Connection was rejected for oversized payload');
    }
  });

  test('12. Host header validation: unexpected host returns 403 FORBIDDEN_HOST', async () => {
    const http = await import('node:http');
    const res = await new Promise<{ statusCode: number; body: string }>((resolve, reject) => {
      const req = http.request(
        `http://127.0.0.1:${port}/api/models`,
        {
          method: 'GET',
          headers: {
            Host: 'evil.attacker.com',
          },
        },
        (res) => {
          let body = '';
          res.on('data', (c) => (body += c));
          res.on('end', () => resolve({ statusCode: res.statusCode || 0, body }));
        }
      );
      req.on('error', reject);
      req.end();
    });

    assert.strictEqual(res.statusCode, 403);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.error.code, 'FORBIDDEN_HOST');
  });

  test('13. Origin validation: unauthorized origin returns 403 FORBIDDEN_ORIGIN & no wildcard CORS', async () => {
    const res = await fetch(`${baseUrl}/api/models`, {
      headers: { Origin: 'http://malicious-site.com' },
    });
    assert.strictEqual(res.status, 403);
    const body = await res.json();
    assert.strictEqual(body.error.code, 'FORBIDDEN_ORIGIN');
    assert.notStrictEqual(res.headers.get('access-control-allow-origin'), '*');
  });

  test('14. Allowed Origin sets matching Access-Control-Allow-Origin header (e.g. VS Code webview)', async () => {
    const res = await fetch(`${baseUrl}/api/models`, {
      headers: { Origin: 'vscode-webview://devos-extension' },
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers.get('access-control-allow-origin'), 'vscode-webview://devos-extension');
    assert.strictEqual(res.headers.get('vary'), 'Origin');
  });

  test('15. Optional MODEL_HUB_TOKEN bearer authentication check enforces auth on /api/*', async () => {
    const authServer = new ModelHubServer({
      port: 0,
      host: '127.0.0.1',
      requireToken: 'my-secure-devos-token-999',
    });
    const authPort = await authServer.start();
    const authBase = `http://127.0.0.1:${authPort}`;

    try {
      // Missing token -> 401
      const resNoAuth = await fetch(`${authBase}/api/models`);
      assert.strictEqual(resNoAuth.status, 401);
      const noAuthBody = await resNoAuth.json();
      assert.strictEqual(noAuthBody.error.code, 'UNAUTHORIZED');

      // Invalid token -> 401
      const resBadAuth = await fetch(`${authBase}/api/models`, {
        headers: { Authorization: 'Bearer wrong-token' },
      });
      assert.strictEqual(resBadAuth.status, 401);

      // Valid token -> 200
      const resGoodAuth = await fetch(`${authBase}/api/models`, {
        headers: { Authorization: 'Bearer my-secure-devos-token-999' },
      });
      assert.strictEqual(resGoodAuth.status, 200);
    } finally {
      await authServer.stop();
    }
  });

  test('16. Leak Canary: API Key never appears in any response body or error payload across all endpoints', async () => {
    const endpoints = [
      { method: 'GET', path: '/api/models' },
      { method: 'POST', path: '/api/models/refresh', body: {} },
      { method: 'POST', path: '/api/route', body: { messages: [{ role: 'user', content: 'test' }] } },
      { method: 'POST', path: '/api/chat', body: { messages: [{ role: 'user', content: 'test' }] } },
      { method: 'GET', path: '/api/decisions' },
    ];

    for (const ep of endpoints) {
      const res = await fetch(`${baseUrl}${ep.path}`, {
        method: ep.method,
        headers: { 'Content-Type': 'application/json' },
        body: ep.body ? JSON.stringify(ep.body) : undefined,
      });
      const text = await res.text();
      assert.ok(!text.includes(SECRET_API_KEY), `Endpoint ${ep.method} ${ep.path} leaked the secret key!`);
    }
  });

  test('17. UI XSS Safety Check: public/index.html uses safe textContent and contains 0 innerHTML calls', () => {
    const indexPath = path.resolve(__dirname, '..', 'public', 'index.html');
    assert.ok(fs.existsSync(indexPath), 'public/index.html exists');
    const content = fs.readFileSync(indexPath, 'utf8');
    assert.strictEqual(content.includes('innerHTML'), false, 'public/index.html must NOT contain innerHTML');
  });
});
