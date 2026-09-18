import type {
  AuditRecord,
  ChatResult,
  ModelStatus,
  RouteDecision,
  RouteRequest,
} from './models.ts';

export interface ModelHubClientOptions {
  baseUrl?: string;
  token?: string;
  fetchFn?: typeof fetch;
}

/**
 * Lightweight HTTP Client for DevOS modules (Gateway, VS Code extension, Agents)
 * to interact with the Model Hub daemon.
 */
export class ModelHubClient {
  private baseUrl: string;
  private token?: string;
  private fetchFn: typeof fetch;

  constructor(options: ModelHubClientOptions = {}) {
    this.baseUrl = (options.baseUrl || process.env.MODEL_HUB_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '');
    this.token = options.token || process.env.MODEL_HUB_TOKEN;
    this.fetchFn = options.fetchFn || globalThis.fetch;
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }
    return headers;
  }

  /**
   * Get all registered models and their live availability status
   */
  public async getModels(): Promise<ModelStatus[]> {
    const res = await this.fetchFn(`${this.baseUrl}/api/models`, {
      method: 'GET',
      headers: this.getHeaders(),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: { message: res.statusText } }));
      throw new Error(`Failed to get models [HTTP ${res.status}]: ${err?.error?.message || res.statusText}`);
    }
    return res.json();
  }

  /**
   * Force a live health check and refresh provider tags/models
   */
  public async refreshModels(): Promise<ModelStatus[]> {
    const res = await this.fetchFn(`${this.baseUrl}/api/models/refresh`, {
      method: 'POST',
      headers: this.getHeaders(),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: { message: res.statusText } }));
      throw new Error(`Failed to refresh models [HTTP ${res.status}]: ${err?.error?.message || res.statusText}`);
    }
    return res.json();
  }

  /**
   * Dry-run preview of routing decision without executing LLM call
   */
  public async route(request: RouteRequest): Promise<RouteDecision> {
    const res = await this.fetchFn(`${this.baseUrl}/api/route`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(request),
    });
    const data = await res.json();
    if (!res.ok) {
      const error: any = new Error(data?.error?.message || `Routing failed with HTTP ${res.status}`);
      error.code = data?.error?.code || 'ROUTING_FAILED';
      throw error;
    }
    return data;
  }

  /**
   * Route and execute chat completion
   */
  public async chat(request: RouteRequest): Promise<ChatResult> {
    const res = await this.fetchFn(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(request),
      signal: request.signal,
    });
    const data = await res.json();
    if (!res.ok) {
      const error: any = new Error(data?.error?.message || `Execution failed with HTTP ${res.status}`);
      error.code = data?.error?.code || 'EXECUTION_FAILED';
      throw error;
    }
    return data;
  }

  /**
   * Route and stream chat completion delta chunks
   */
  public async *chatStream(request: RouteRequest): AsyncGenerator<string, void, void> {
    const res = await this.fetchFn(`${this.baseUrl}/api/chat/stream`, {
      method: 'POST',
      headers: {
        ...this.getHeaders(),
        Accept: 'text/event-stream',
      },
      body: JSON.stringify(request),
      signal: request.signal,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: { message: res.statusText } }));
      throw new Error(`Stream request failed [HTTP ${res.status}]: ${err?.error?.message || res.statusText}`);
    }

    const body = res.body;
    if (!body) {
      throw new Error('Response body is null');
    }

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
          if (trimmed === 'data: [DONE]') return;

          if (trimmed.startsWith('data: ')) {
            const jsonStr = trimmed.slice(6).trim();
            try {
              const parsed = JSON.parse(jsonStr);
              if (parsed.delta) yield parsed.delta;
              if (parsed.error) throw new Error(parsed.error);
            } catch (err: any) {
              if (err.message && !err.message.includes('JSON')) throw err;
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Get recent routing decisions and audits
   */
  public async getDecisions(limit: number = 20): Promise<AuditRecord[]> {
    const res = await this.fetchFn(`${this.baseUrl}/api/decisions?limit=${limit}`, {
      method: 'GET',
      headers: this.getHeaders(),
    });
    if (!res.ok) {
      throw new Error(`Failed to fetch decisions [HTTP ${res.status}]`);
    }
    return res.json();
  }
}
