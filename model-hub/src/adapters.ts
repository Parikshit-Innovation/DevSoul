import type {
  ChatMessage,
  ChatResult,
  ChatStreamChunk,
  ModelEntry,
  ModelStatus,
  RouteDecision,
  TokenUsage,
} from './models.ts';
import { redactAuthHeader, SystemContext } from './utils.ts';

export interface ProviderResponse {
  content: string;
  usage?: TokenUsage;
  latencyMs: number;
}

export interface AdapterOptions {
  openRouterApiKey?: string;
  openRouterBaseUrl?: string;
  ollamaBaseUrl?: string;
  cloudTimeoutMs?: number;
  localTimeoutMs?: number;
  fetchFn?: typeof fetch;
}

export class ProviderAdapter {
  private openRouterApiKey: string;
  private openRouterBaseUrl: string;
  private ollamaBaseUrl: string;
  private cloudTimeoutMs: number;
  private localTimeoutMs: number;
  private customFetch: typeof fetch;

  constructor(options: AdapterOptions = {}) {
    this.openRouterApiKey =
      options.openRouterApiKey || process.env.OPENROUTER_API_KEY || '';
    this.openRouterBaseUrl = (
      options.openRouterBaseUrl ||
      process.env.OPENROUTER_BASE_URL ||
      'https://openrouter.ai/api/v1'
    ).replace(/\/+$/, '');
    this.ollamaBaseUrl = (
      options.ollamaBaseUrl ||
      process.env.OLLAMA_BASE_URL ||
      'http://localhost:11434'
    ).replace(/\/+$/, '');
    this.cloudTimeoutMs = options.cloudTimeoutMs || 30000;
    this.localTimeoutMs = options.localTimeoutMs || 60000;
    this.customFetch = options.fetchFn || globalThis.fetch;
  }

  public setFetch(fn: typeof fetch): void {
    this.customFetch = fn;
  }

  public setOpenRouterApiKey(key: string): void {
    this.openRouterApiKey = key;
  }

  public getOpenRouterBaseUrl(): string {
    return this.openRouterBaseUrl;
  }

  public getOllamaBaseUrl(): string {
    return this.ollamaBaseUrl;
  }

  /**
   * Health check / tag discovery for OpenRouter
   */
  public async fetchOpenRouterAvailableModels(): Promise<{ success: boolean; models: string[]; error?: string }> {
    const url = `${this.openRouterBaseUrl}/models`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://github.com/DevOS',
      'X-Title': 'DevOS Model Hub',
    };
    if (this.openRouterApiKey) {
      headers['Authorization'] = `Bearer ${this.openRouterApiKey}`;
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);
      const res = await this.customFetch(url, {
        method: 'GET',
        headers,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!res.ok) {
        return {
          success: false,
          models: [],
          error: `OpenRouter /models returned HTTP ${res.status} (${res.statusText})`,
        };
      }

      const json: any = await res.json();
      const modelList = Array.isArray(json?.data)
        ? json.data.map((m: any) => m.id || m.name).filter(Boolean)
        : [];

      return { success: true, models: modelList };
    } catch (err: any) {
      return {
        success: false,
        models: [],
        error: `Failed to connect to OpenRouter at ${url}: ${err?.message || 'Network error'}`,
      };
    }
  }

  /**
   * Health check / tag discovery for Ollama
   */
  public async fetchOllamaAvailableModels(): Promise<{ success: boolean; models: string[]; error?: string }> {
    const url = `${this.ollamaBaseUrl}/api/tags`;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6000);
      const res = await this.customFetch(url, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!res.ok) {
        return {
          success: false,
          models: [],
          error: `Ollama /api/tags returned HTTP ${res.status} (${res.statusText})`,
        };
      }

      const json: any = await res.json();
      const modelList: string[] = [];
      if (Array.isArray(json?.models)) {
        for (const m of json.models) {
          if (m?.name) modelList.push(m.name);
          if (m?.model) modelList.push(m.model);
        }
      }

      return { success: true, models: Array.from(new Set(modelList)) };
    } catch (err: any) {
      return {
        success: false,
        models: [],
        error: `Ollama server not reachable at ${url}: ${err?.message || 'Connection refused'}`,
      };
    }
  }

  /**
   * Execute chat completion against OpenAI-compatible endpoint
   */
  public async executeChat(
    model: ModelEntry,
    messages: ChatMessage[],
    timeoutMs?: number,
    signal?: AbortSignal
  ): Promise<ProviderResponse> {
    const isCloud = model.location === 'cloud';
    const effectiveTimeout = timeoutMs ?? (isCloud ? this.cloudTimeoutMs : this.localTimeoutMs);

    let endpointUrl: string;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (model.provider === 'openrouter') {
      endpointUrl = `${this.openRouterBaseUrl}/chat/completions`;
      if (this.openRouterApiKey) {
        headers['Authorization'] = `Bearer ${this.openRouterApiKey}`;
      }
      headers['HTTP-Referer'] = 'https://github.com/DevOS';
      headers['X-Title'] = 'DevOS Model Hub';
    } else {
      // Ollama OpenAI-compatible endpoint
      endpointUrl = `${this.ollamaBaseUrl}/v1/chat/completions`;
      headers['Authorization'] = 'Bearer ollama';
    }

    const payload = {
      model: model.remoteName,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      stream: false,
    };

    const startTime = SystemContext.nowMs();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), effectiveTimeout);
    if (signal) {
      if (signal.aborted) controller.abort();
      else signal.addEventListener('abort', () => controller.abort(), { once: true });
    }

    const maxRetries = 2;
    let attempt = 0;

    try {
      while (true) {
        const response = await this.customFetch(endpointUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
          signal: controller.signal,
        });

        // Bounded exponential backoff exclusively for HTTP 429 (Too Many Requests / Rate Limit)
        if (response.status === 429 && attempt < maxRetries && !controller.signal.aborted) {
          attempt++;
          const backoffMs = Math.min(50 * Math.pow(2, attempt), 500);
          await new Promise((r) => setTimeout(r, backoffMs));
          continue;
        }

        clearTimeout(timer);
        const latencyMs = SystemContext.nowMs() - startTime;

        if (!response.ok) {
          let errBody: string = '';
          try {
            errBody = await response.text();
          } catch {}

          const cleanHeaders = redactAuthHeader(headers);
          throw new Error(
            `Provider ${model.provider} request to ${endpointUrl} failed with HTTP ${response.status} (${response.statusText}): ${errBody}`
          );
        }

        const data: any = await response.json();
        const content =
          data?.choices?.[0]?.message?.content ??
          data?.choices?.[0]?.text ??
          '';

        const usage: TokenUsage | undefined = data?.usage
          ? {
              promptTokens: data.usage.prompt_tokens || 0,
              completionTokens: data.usage.completion_tokens || 0,
              totalTokens: data.usage.total_tokens || 0,
            }
          : undefined;

        return {
          content,
          usage,
          latencyMs,
        };
      }
    } catch (err: any) {
      clearTimeout(timer);
      const latencyMs = SystemContext.nowMs() - startTime;
      if (err.name === 'AbortError') {
        if (signal?.aborted) {
          throw new Error(`Request to model '${model.id}' aborted by client`);
        }
        throw new Error(
          `Request to model '${model.id}' timed out after ${effectiveTimeout}ms`
        );
      }
      throw err;
    }
  }

  /**
   * Execute streaming chat completion against OpenAI-compatible endpoint
   */
  public async *executeChatStream(
    model: ModelEntry,
    messages: ChatMessage[],
    timeoutMs?: number,
    signal?: AbortSignal
  ): AsyncGenerator<string, { usage?: TokenUsage; latencyMs: number }, void> {
    const isCloud = model.location === 'cloud';
    const effectiveTimeout = timeoutMs ?? (isCloud ? this.cloudTimeoutMs : this.localTimeoutMs);

    let endpointUrl: string;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    };

    if (model.provider === 'openrouter') {
      endpointUrl = `${this.openRouterBaseUrl}/chat/completions`;
      if (this.openRouterApiKey) {
        headers['Authorization'] = `Bearer ${this.openRouterApiKey}`;
      }
      headers['HTTP-Referer'] = 'https://github.com/DevOS';
      headers['X-Title'] = 'DevOS Model Hub';
    } else {
      endpointUrl = `${this.ollamaBaseUrl}/v1/chat/completions`;
      headers['Authorization'] = 'Bearer ollama';
    }

    const payload = {
      model: model.remoteName,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      stream: true,
    };

    const startTime = SystemContext.nowMs();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), effectiveTimeout);
    if (signal) {
      if (signal.aborted) controller.abort();
      else signal.addEventListener('abort', () => controller.abort(), { once: true });
    }

    let response: Response;
    try {
      response = await this.customFetch(endpointUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      clearTimeout(timer);
    } catch (err: any) {
      clearTimeout(timer);
      if (err.name === 'AbortError' && signal?.aborted) {
        throw new Error(`Streaming request to model '${model.id}' aborted by client`);
      }
      throw err;
    }

    if (!response.ok) {
      let errBody = '';
      try {
        errBody = await response.text();
      } catch {}
      throw new Error(
        `Streaming request failed with HTTP ${response.status}: ${errBody}`
      );
    }

    const body = response.body;
    if (!body) {
      throw new Error('Response body is null, cannot stream');
    }

    // Process stream chunks
    let finalUsage: TokenUsage | undefined;
    const reader = body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith(':')) continue;
          if (trimmed === 'data: [DONE]') return { usage: finalUsage, latencyMs: SystemContext.nowMs() - startTime };

          if (trimmed.startsWith('data: ')) {
            const dataStr = trimmed.slice(6).trim();
            try {
              const parsed = JSON.parse(dataStr);
              const delta = parsed?.choices?.[0]?.delta?.content || '';
              if (delta) {
                yield delta;
              }
              if (parsed?.usage) {
                finalUsage = {
                  promptTokens: parsed.usage.prompt_tokens || 0,
                  completionTokens: parsed.usage.completion_tokens || 0,
                  totalTokens: parsed.usage.total_tokens || 0,
                };
              }
            } catch {
              // Ignore partial JSON parse errors in stream
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    const latencyMs = SystemContext.nowMs() - startTime;
    return { usage: finalUsage, latencyMs };
  }
}
