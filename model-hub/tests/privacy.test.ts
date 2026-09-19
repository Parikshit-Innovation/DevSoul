import { describe, test, beforeEach } from 'node:test';
import * as assert from 'node:assert';
import { PrivacyDetector } from '../src/privacyDetector.ts';
import type { RouteRequest, SensitivityProvider } from '../src/models.ts';

describe('Model Hub Privacy Detector Suite', () => {
  let detector: PrivacyDetector;

  beforeEach(() => {
    detector = new PrivacyDetector();
  });

  test('1. Normal public prompt with no secrets is marked PUBLIC', async () => {
    const req: RouteRequest = {
      messages: [{ role: 'user', content: 'Create a simple TypeScript hello world function.' }],
    };
    const res = await detector.evaluate(req);
    assert.strictEqual(res.sensitivity, 'public');
    assert.strictEqual(res.isPrivate, false);
  });

  test('2. Explicit private sensitivity flag enforces PRIVATE', async () => {
    const req: RouteRequest = {
      messages: [{ role: 'user', content: 'Generic public text' }],
      sensitivity: 'private',
    };
    const res = await detector.evaluate(req);
    assert.strictEqual(res.sensitivity, 'private');
    assert.strictEqual(res.isPrivate, true);
  });

  test('3. Private file globs (.env, secrets/**, *.pem) escalate to PRIVATE', async () => {
    const cases = [
      ['.env'],
      ['.env.local'],
      ['src/secrets/keys.json'],
      ['certs/server.pem'],
      ['keys/id_rsa.key'],
      ['config/credentials.json'],
    ];

    for (const [filePath] of cases) {
      const req: RouteRequest = {
        messages: [{ role: 'user', content: 'Inspect this file' }],
        filePaths: [filePath],
      };
      const res = await detector.evaluate(req);
      assert.strictEqual(res.sensitivity, 'private', `Failed to detect private path: ${filePath}`);
    }
  });

  test('4. AWS Access Key in message escalates to PRIVATE', async () => {
    const req: RouteRequest = {
      messages: [
        { role: 'user', content: 'Deploy with AWS key AKIAIOSFODNN7EXAMPLE to S3' },
      ],
    };
    const res = await detector.evaluate(req);
    assert.strictEqual(res.sensitivity, 'private');
    assert.ok(res.detectedPatterns.includes('AWS_ACCESS_KEY'));
  });

  test('5. Stripe Secret Key escalates to PRIVATE', async () => {
    const req: RouteRequest = {
      messages: [
        { role: 'user', content: 'Stripe webhook: sk_live_51Abcdefghijklmnopqrstuv' },
      ],
    };
    const res = await detector.evaluate(req);
    assert.strictEqual(res.sensitivity, 'private');
    assert.ok(res.detectedPatterns.includes('STRIPE_SECRET_KEY'));
  });

  test('6. Google Cloud API Key escalates to PRIVATE', async () => {
    const req: RouteRequest = {
      messages: [
        { role: 'user', content: 'Init maps with AIzaSyD-1234567890abcdefghijklmnopqr' },
      ],
    };
    const res = await detector.evaluate(req);
    assert.strictEqual(res.sensitivity, 'private');
    assert.ok(res.detectedPatterns.includes('GOOGLE_API_KEY'));
  });

  test('7. GitHub Personal Access Token escalates to PRIVATE', async () => {
    const req: RouteRequest = {
      messages: [
        { role: 'user', content: 'Clone with token ghp_123456789012345678901234567890123456' },
      ],
    };
    const res = await detector.evaluate(req);
    assert.strictEqual(res.sensitivity, 'private');
    assert.ok(res.detectedPatterns.includes('GITHUB_TOKEN'));
  });

  test('8. Private Key Header block escalates to PRIVATE', async () => {
    const privateKey = `-----BEGIN RSA PRIVATE KEY-----
MIIEowIBAAKCAQEA0m5g...
-----END RSA PRIVATE KEY-----`;
    const req: RouteRequest = {
      messages: [{ role: 'user', content: `Load cert:\n${privateKey}` }],
    };
    const res = await detector.evaluate(req);
    assert.strictEqual(res.sensitivity, 'private');
    assert.ok(res.detectedPatterns.includes('PRIVATE_KEY_BLOCK'));
  });

  test('9. Explicit credential assignments escalate to PRIVATE', async () => {
    const req: RouteRequest = {
      messages: [
        { role: 'user', content: 'const config = { password: "SuperSecretPassword123!" };' },
      ],
    };
    const res = await detector.evaluate(req);
    assert.strictEqual(res.sensitivity, 'private');
  });

  test('10. Project-level privateProject: true enforces PRIVATE globally', async () => {
    detector.setPrivateProject(true);
    const req: RouteRequest = {
      messages: [{ role: 'user', content: 'Completely ordinary public text' }],
    };
    const res = await detector.evaluate(req);
    assert.strictEqual(res.sensitivity, 'private');
  });

  test('11. External SensitivityProvider hook (Aegis) can escalate to PRIVATE', async () => {
    const mockAegisProvider: SensitivityProvider = {
      evaluateSensitivity: (r) => 'private',
    };
    detector.setSensitivityProvider(mockAegisProvider);

    const req: RouteRequest = {
      messages: [{ role: 'user', content: 'Hello world' }],
    };
    const res = await detector.evaluate(req);
    assert.strictEqual(res.sensitivity, 'private');
  });

  test('12. Invariant: Nothing can downgrade a PRIVATE task to PUBLIC', async () => {
    const req: RouteRequest = {
      messages: [{ role: 'user', content: 'AKIAIOSFODNN7EXAMPLE' }],
      sensitivity: 'public', // Client claims public, but content has secrets
    };
    const res = await detector.evaluate(req);
    assert.strictEqual(res.sensitivity, 'private');
  });

  test('13. Multi-role inspection: Secret in SYSTEM prompt triggers PRIVATE', async () => {
    const req: RouteRequest = {
      messages: [
        { role: 'system', content: 'System instructions with api_key: "sk-live-1234567890123456"' },
        { role: 'user', content: 'What is the weather?' },
      ],
    };
    const res = await detector.evaluate(req);
    assert.strictEqual(res.sensitivity, 'private');
    assert.ok(res.reasons.some((r) => r.includes('system')));
  });

  test('14. Multi-role inspection: Secret in TOOL or ASSISTANT message triggers PRIVATE', async () => {
    const req: RouteRequest = {
      messages: [
        { role: 'user', content: 'Call database tool' },
        { role: 'tool', content: 'Database returned connection postgres://admin:super_secret_db_pass123@db.prod.internal:5432/main' },
      ],
    };
    const res = await detector.evaluate(req);
    assert.strictEqual(res.sensitivity, 'private');
    assert.ok(res.detectedPatterns.includes('DATABASE_CONNECTION_URI'));
  });

  test('15. Adversarial: Mixed-case secret assignment triggers PRIVATE', async () => {
    const req: RouteRequest = {
      messages: [{ role: 'user', content: 'const cfg = { PaSSWoRD: "MySuperSecretPassword999!" };' }],
    };
    const res = await detector.evaluate(req);
    assert.strictEqual(res.sensitivity, 'private');
    assert.ok(res.detectedPatterns.includes('GENERIC_ASSIGNMENT_SECRET'));
  });

  test('16. Adversarial: Private paths mentioned inside message text trigger PRIVATE', async () => {
    const req: RouteRequest = {
      messages: [{ role: 'user', content: 'Please look at my .env file and fix line 5' }],
    };
    const res = await detector.evaluate(req);
    assert.strictEqual(res.sensitivity, 'private');
    assert.ok(res.matchedFilePaths.includes('.env'));
  });

  test('17. False Positive check: Harmless variable names and general docs remain PUBLIC', async () => {
    const harmlessCases = [
      'const passwordField = document.getElementById("password-input");',
      'function renderAuthTokenButton() { return "<button>Login</button>"; }',
      'In this tutorial we will learn how API keys work in web applications.',
      'const max_tokens = 500;',
      'interface SecretConfig { name: string; }',
    ];

    for (const code of harmlessCases) {
      const req: RouteRequest = {
        messages: [{ role: 'user', content: code }],
      };
      const res = await detector.evaluate(req);
      assert.strictEqual(
        res.sensitivity,
        'public',
        `Harmless code falsely marked private: "${code}" (reasons: ${res.reasons.join(', ')})`
      );
    }
  });

  test('18. CANARY TEST: Secret string appears NOWHERE in audit logs or thrown errors', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const { AuditLogger } = await import('../src/audit.ts');
    const { ModelRouter } = await import('../src/router.ts');
    const { ModelRegistry } = await import('../src/registry.ts');
    const { ProviderAdapter } = await import('../src/adapters.ts');
    const { ModelExecutor } = await import('../src/executor.ts');

    const CANARY_SECRET = 'CANARY_SECRET_SUPER_UNIQUE_STRING_4920490214809214';
    const auditFile = path.resolve(process.cwd(), '.devos', 'audit', 'canary-test.jsonl');

    if (fs.existsSync(auditFile)) {
      fs.unlinkSync(auditFile);
    }

    const auditLogger = new AuditLogger(auditFile);
    const mockAdapter = new ProviderAdapter({
      fetchFn: async () => {
        throw new Error('Simulated upstream failure with Authorization: Bearer secret-auth-token-123');
      },
    });
    const registry = new ModelRegistry(mockAdapter);
    const router = new ModelRouter(registry, detector);
    const executor = new ModelExecutor(router, registry, mockAdapter, auditLogger);

    const prompt = `Here is my secret config: API_KEY = "${CANARY_SECRET}"`;

    let thrownErrorMsg = '';
    try {
      await executor.chat({
        messages: [{ role: 'user', content: prompt }],
      });
    } catch (err: any) {
      thrownErrorMsg = err.message;
    }

    // 1. Assert CANARY is NOT in thrown error message
    assert.strictEqual(thrownErrorMsg.includes(CANARY_SECRET), false, 'Canary leaked in thrown error message');

    // 2. Assert CANARY is NOT in audit log file
    if (fs.existsSync(auditFile)) {
      const logContent = fs.readFileSync(auditFile, 'utf8');
      assert.strictEqual(logContent.includes(CANARY_SECRET), false, 'Canary leaked in audit JSONL file');
      // But verify promptHash and promptLength ARE recorded
      assert.ok(logContent.includes('promptHash'), 'Audit log contains promptHash');
      assert.ok(logContent.includes('promptLength'), 'Audit log contains promptLength');
    }

    // 3. Assert CANARY is NOT in in-memory records
    const recent = auditLogger.getRecentDecisions(10);
    const memoryDump = JSON.stringify(recent);
    assert.strictEqual(memoryDump.includes(CANARY_SECRET), false, 'Canary leaked in in-memory audit records');
  });

  test('19. Streaming failover rule: Private stream never falls back to cloud, and mid-stream failure surfaces terminal error', async () => {
    const { ModelRegistry } = await import('../src/registry.ts');
    const { ModelRouter } = await import('../src/router.ts');
    const { ModelExecutor } = await import('../src/executor.ts');
    const { AuditLogger } = await import('../src/audit.ts');
    const { ProviderAdapter } = await import('../src/adapters.ts');

    let streamAttemptCount = 0;
    const mockAdapter = new ProviderAdapter({
      fetchFn: async (url, init) => {
        streamAttemptCount++;
        // Simulate emitting 1 chunk, then network failure mid-stream
        let chunkSent = false;
        const stream = new ReadableStream({
          pull(controller) {
            if (!chunkSent) {
              chunkSent = true;
              controller.enqueue(
                new TextEncoder().encode('data: ' + JSON.stringify({ choices: [{ delta: { content: 'Partial ' } }] }) + '\n\n')
              );
            } else {
              controller.error(new Error('Socket disconnected abruptly mid-stream'));
            }
          },
        });
        return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
      },
    });

    const registry = new ModelRegistry(mockAdapter);
    registry.loadFromConfig({
      models: [
        {
          id: 'qwen-2-5-coder-7b',
          provider: 'ollama',
          remoteName: 'qwen2.5-coder:7b',
          displayName: 'Qwen 2.5 Coder 7B',
          location: 'local',
          strengths: ['general'],
          latencyTier: 'fast',
          enabled: true,
        },
        {
          id: 'fallback-local',
          provider: 'ollama',
          remoteName: 'llama3:8b',
          displayName: 'Fallback Local',
          location: 'local',
          strengths: ['general'],
          latencyTier: 'fast',
          enabled: true,
        },
      ],
      settings: {
        defaultCloudModelId: 'qwen-2-5-coder-7b',
        defaultLocalModelId: 'qwen-2-5-coder-7b',
        healthCheckTtlSeconds: 30,
        requestTimeoutMs: { cloud: 30000, local: 60000 },
        privateGlobs: ['.env*'],
        privateProject: false,
      },
    });

    const router = new ModelRouter(registry, detector);
    const auditLogger = new AuditLogger();
    const executor = new ModelExecutor(router, registry, mockAdapter, auditLogger);

    const req: RouteRequest = {
      messages: [{ role: 'user', content: 'Generate code' }],
      sensitivity: 'private',
    };

    let receivedChunks: string[] = [];
    let caughtError: any = null;

    try {
      const generator = executor.chatStream(req);
      for await (const chunk of generator) {
        receivedChunks.push(chunk);
      }
    } catch (err: any) {
      caughtError = err;
    }

    assert.ok(caughtError, 'Expected terminal error to be thrown on mid-stream failure');
    assert.ok(
      caughtError.message.includes('STREAM_TERMINATED_MID_RESPONSE'),
      `Must throw STREAM_TERMINATED_MID_RESPONSE terminal event (got: ${caughtError.message})`
    );
    assert.strictEqual(receivedChunks.length, 1);
    assert.strictEqual(receivedChunks[0], 'Partial ');
    // Assert it did NOT attempt secondary fallback after partial output was already emitted
    assert.strictEqual(streamAttemptCount, 1, 'Must not attempt secondary fallback mid-stream');
  });

  test('20. Client disconnect aborts upstream request via AbortController', async () => {
    const { ModelRegistry } = await import('../src/registry.ts');
    const { ModelRouter } = await import('../src/router.ts');
    const { ModelExecutor } = await import('../src/executor.ts');
    const { AuditLogger } = await import('../src/audit.ts');
    const { ProviderAdapter } = await import('../src/adapters.ts');

    const abortController = new AbortController();
    let upstreamAborted = false;

    const mockAdapter = new ProviderAdapter({
      fetchFn: async (url, init) => {
        if (init?.signal) {
          init.signal.addEventListener('abort', () => {
            upstreamAborted = true;
          });
        }
        let chunkSent = false;
        const stream = new ReadableStream({
          pull(controller) {
            if (!chunkSent) {
              chunkSent = true;
              controller.enqueue(
                new TextEncoder().encode('data: ' + JSON.stringify({ choices: [{ delta: { content: 'First ' } }] }) + '\n\n')
              );
            } else if (init?.signal?.aborted) {
              controller.error(new DOMException('The operation was aborted', 'AbortError'));
            }
          },
          cancel() {
            upstreamAborted = true;
          },
        });
        return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
      },
    });

    const registry = new ModelRegistry(mockAdapter);
    registry.loadFromConfig({
      models: [
        {
          id: 'qwen-2-5-coder-7b',
          provider: 'ollama',
          remoteName: 'qwen2.5-coder:7b',
          displayName: 'Qwen 2.5 Coder 7B',
          location: 'local',
          strengths: ['general'],
          latencyTier: 'fast',
          enabled: true,
        },
      ],
      settings: {
        defaultCloudModelId: 'qwen-2-5-coder-7b',
        defaultLocalModelId: 'qwen-2-5-coder-7b',
        healthCheckTtlSeconds: 30,
        requestTimeoutMs: { cloud: 30000, local: 60000 },
        privateGlobs: ['.env*'],
        privateProject: false,
      },
    });

    const router = new ModelRouter(registry, detector);
    const auditLogger = new AuditLogger();
    const executor = new ModelExecutor(router, registry, mockAdapter, auditLogger);

    const generator = executor.chatStream({
      messages: [{ role: 'user', content: 'Test stream abort' }],
      signal: abortController.signal,
    });

    // Receive first chunk
    const firstChunk = await generator.next();
    assert.strictEqual(firstChunk.value, 'First ');

    // Client disconnects
    abortController.abort();

    try {
      await generator.next();
    } catch (err: any) {
      assert.ok(
        err.message.includes('aborted') ||
        err.message.includes('STREAM_TERMINATED_MID_RESPONSE') ||
        err.message.includes('The operation was aborted')
      );
    }

    assert.strictEqual(upstreamAborted, true, 'Upstream fetch signal must be aborted when client disconnects');
  });
});
