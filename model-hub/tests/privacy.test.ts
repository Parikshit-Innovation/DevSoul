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
});
