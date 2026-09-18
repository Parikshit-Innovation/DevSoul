import { describe, test } from 'node:test';
import * as assert from 'node:assert';
import { ProviderAdapter } from '../src/adapters.ts';
import type { ModelEntry } from '../src/models.ts';

describe('Model Hub Provider Adapters Wire & Shape Verification', () => {
  const mockOpenRouterModel: ModelEntry = {
    id: 'claude-3-5-sonnet',
    provider: 'openrouter',
    remoteName: 'anthropic/claude-3.5-sonnet',
    displayName: 'Claude 3.5 Sonnet',
    location: 'cloud',
    strengths: ['architecture'],
    costPer1MInputUsd: 3.0,
    costPer1MOutputUsd: 15.0,
    latencyTier: 'medium',
    enabled: true,
  };

  const mockOllamaModel: ModelEntry = {
    id: 'qwen-2-5-coder-7b',
    provider: 'ollama',
    remoteName: 'qwen2.5-coder:7b',
    displayName: 'Qwen 2.5 Coder 7B',
    location: 'local',
    strengths: ['refactor_simple'],
    latencyTier: 'medium',
    enabled: true,
  };

  test('1. OpenRouter request carries correct URL, auth header, attribution headers, and OpenAI payload body', async () => {
    let capturedUrl = '';
    let capturedHeaders: Record<string, string> = {};
    let capturedBody: any = null;

    const adapter = new ProviderAdapter({
      openRouterApiKey: 'test-sk-openrouter-12345',
      openRouterBaseUrl: 'https://openrouter.ai/api/v1',
      fetchFn: async (url, init) => {
        capturedUrl = String(url);
        capturedHeaders = (init?.headers || {}) as Record<string, string>;
        capturedBody = JSON.parse(String(init?.body || '{}'));
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: 'OpenRouter response success' } }],
            usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      },
    });

    const res = await adapter.executeChat(mockOpenRouterModel, [
      { role: 'user', content: 'Explain microservices architecture' },
    ]);

    assert.strictEqual(capturedUrl, 'https://openrouter.ai/api/v1/chat/completions');
    assert.strictEqual(capturedHeaders['Authorization'], 'Bearer test-sk-openrouter-12345');
    assert.strictEqual(capturedHeaders['HTTP-Referer'], 'https://github.com/DevOS');
    assert.strictEqual(capturedHeaders['X-Title'], 'DevOS Model Hub');
    assert.strictEqual(capturedBody.model, 'anthropic/claude-3.5-sonnet');
    assert.strictEqual(capturedBody.messages[0].content, 'Explain microservices architecture');
    assert.strictEqual(res.content, 'OpenRouter response success');
    assert.strictEqual(res.usage?.totalTokens, 15);
  });

  test('2. Ollama request carries local OpenAI-compatible endpoint without requiring API key', async () => {
    let capturedUrl = '';
    let capturedBody: any = null;

    const adapter = new ProviderAdapter({
      ollamaBaseUrl: 'http://localhost:11434',
      fetchFn: async (url, init) => {
        capturedUrl = String(url);
        capturedBody = JSON.parse(String(init?.body || '{}'));
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: 'Local Ollama response' } }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      },
    });

    const res = await adapter.executeChat(mockOllamaModel, [
      { role: 'user', content: 'Refactor this loop' },
    ]);

    assert.strictEqual(capturedUrl, 'http://localhost:11434/v1/chat/completions');
    assert.strictEqual(capturedBody.model, 'qwen2.5-coder:7b');
    assert.strictEqual(capturedBody.messages[0].content, 'Refactor this loop');
    assert.strictEqual(res.content, 'Local Ollama response');
  });

  test('3. OpenRouter catalog discovery calls GET /models', async () => {
    let capturedUrl = '';
    const adapter = new ProviderAdapter({
      openRouterBaseUrl: 'https://openrouter.ai/api/v1',
      fetchFn: async (url) => {
        capturedUrl = String(url);
        return new Response(
          JSON.stringify({
            data: [{ id: 'anthropic/claude-3.5-sonnet' }, { id: 'openai/gpt-4o' }],
          })
        );
      },
    });

    const res = await adapter.fetchOpenRouterAvailableModels();
    assert.strictEqual(capturedUrl, 'https://openrouter.ai/api/v1/models');
    assert.strictEqual(res.success, true);
    assert.ok(res.models.includes('anthropic/claude-3.5-sonnet'));
  });

  test('4. Ollama model tag discovery calls GET /api/tags and parses model names', async () => {
    let capturedUrl = '';
    const adapter = new ProviderAdapter({
      ollamaBaseUrl: 'http://localhost:11434',
      fetchFn: async (url) => {
        capturedUrl = String(url);
        return new Response(
          JSON.stringify({
            models: [
              { name: 'qwen2.5-coder:7b', size: 4500000000 },
              { name: 'llama3.2:3b', size: 2000000000 },
            ],
          })
        );
      },
    });

    const res = await adapter.fetchOllamaAvailableModels();
    assert.strictEqual(capturedUrl, 'http://localhost:11434/api/tags');
    assert.strictEqual(res.success, true);
    assert.ok(res.models.includes('qwen2.5-coder:7b'));
    assert.ok(res.models.includes('llama3.2:3b'));
  });

  test('5. SSE streaming chat generator yields chunks correctly', async () => {
    const sseStream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            'data: {"choices":[{"delta":{"content":"Hello "}}]}\n\n' +
            'data: {"choices":[{"delta":{"content":"from "}}]}\n\n' +
            'data: {"choices":[{"delta":{"content":"Ollama!"}}]}\n\n' +
            'data: [DONE]\n\n'
          )
        );
        controller.close();
      },
    });

    const adapter = new ProviderAdapter({
      ollamaBaseUrl: 'http://localhost:11434',
      fetchFn: async () => {
        return new Response(sseStream, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        });
      },
    });

    const chunks: string[] = [];
    const stream = adapter.executeChatStream(mockOllamaModel, [
      { role: 'user', content: 'Stream test' },
    ]);

    for await (const chunk of stream) {
      chunks.push(chunk);
    }

    assert.deepStrictEqual(chunks, ['Hello ', 'from ', 'Ollama!']);
  });
});
