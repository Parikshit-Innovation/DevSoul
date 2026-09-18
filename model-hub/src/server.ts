import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RouteRequest } from './models.ts';
import { ProviderAdapter } from './adapters.ts';
import { ModelRegistry } from './registry.ts';
import { PrivacyDetector } from './privacyDetector.ts';
import { ModelRouter } from './router.ts';
import { AuditLogger } from './audit.ts';
import { ModelExecutor } from './executor.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface ServerOptions {
  port?: number;
  host?: string;
  configPath?: string;
  adapter?: ProviderAdapter;
  registry?: ModelRegistry;
  router?: ModelRouter;
  executor?: ModelExecutor;
  auditLogger?: AuditLogger;
  requireToken?: string;
}

const MAX_BODY_BYTES = 2 * 1024 * 1024; // 2MB limit

export class ModelHubServer {
  private port: number;
  private host: string;
  private server: http.Server | null = null;
  private adapter: ProviderAdapter;
  private registry: ModelRegistry;
  private privacyDetector: PrivacyDetector;
  private router: ModelRouter;
  private auditLogger: AuditLogger;
  private executor: ModelExecutor;
  private publicDir: string;
  private requireToken?: string;

  constructor(options: ServerOptions = {}) {
    this.port = options.port !== undefined ? options.port : Number(process.env.MODEL_HUB_PORT) || 3000;
    this.host = options.host || process.env.MODEL_HUB_HOST || '127.0.0.1';
    this.requireToken = options.requireToken || process.env.MODEL_HUB_TOKEN;
    this.publicDir = path.resolve(__dirname, '..', 'public');

    if (this.host !== '127.0.0.1' && this.host !== 'localhost' && this.host !== '::1') {
      console.warn(
        `⚠️ WARNING: Model Hub is bound to non-localhost address [${this.host}]! Private code and local routing endpoints may be accessible over the network.`
      );
    }

    const configPath =
      options.configPath || path.resolve(__dirname, '..', 'models.config.json');

    this.adapter = options.adapter || new ProviderAdapter();
    this.registry = options.registry || new ModelRegistry(this.adapter, configPath);
    this.privacyDetector = new PrivacyDetector();
    this.router =
      options.router || new ModelRouter(this.registry, this.privacyDetector);
    this.auditLogger = options.auditLogger || new AuditLogger();
    this.executor =
      options.executor ||
      new ModelExecutor(
        this.router,
        this.registry,
        this.adapter,
        this.auditLogger
      );
  }

  public getRegistry(): ModelRegistry {
    return this.registry;
  }

  public getRouter(): ModelRouter {
    return this.router;
  }

  public getExecutor(): ModelExecutor {
    return this.executor;
  }

  public getAuditLogger(): AuditLogger {
    return this.auditLogger;
  }

  public getPrivacyDetector(): PrivacyDetector {
    return this.privacyDetector;
  }

  public start(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        this.handleRequest(req, res).catch((err) => {
          this.sendJson(
            res,
            500,
            {
              error: {
                code: 'INTERNAL_SERVER_ERROR',
                message: err?.message || 'Internal server error',
              },
            }
          );
        });
      });

      this.server.listen(this.port, this.host, () => {
        const addr = this.server?.address();
        const actualPort = typeof addr === 'object' && addr ? addr.port : this.port;
        this.port = actualPort;
        console.log(`🛡️ DevOS Model Hub & Router listening at http://${this.host}:${actualPort}`);
        // Initial health check in background
        this.registry.refreshAvailability().catch(() => {});
        resolve(actualPort);
      });

      this.server.on('error', (err) => reject(err));
    });
  }

  public stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }

  private isOriginAllowed(origin: string): boolean {
    try {
      if (origin.startsWith('vscode-webview://')) return true;
      const parsed = new URL(origin);
      const h = parsed.hostname;
      if (h === '127.0.0.1' || h === 'localhost' || h === '::1' || h === this.host) {
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  private isHostAllowed(hostHeader: string): boolean {
    try {
      // Split off port if present
      const hostname = hostHeader.split(':')[0].toLowerCase();
      if (
        hostname === '127.0.0.1' ||
        hostname === 'localhost' ||
        hostname === '::1' ||
        hostname === this.host.toLowerCase()
      ) {
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  private applySecurityHeaders(res: http.ServerResponse): void {
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self' http://127.0.0.1:* http://localhost:*; frame-ancestors 'none';"
    );
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    this.applySecurityHeaders(res);

    // 1. Host header validation (DNS rebinding protection)
    const hostHeader = req.headers['host'];
    if (hostHeader && !this.isHostAllowed(hostHeader)) {
      this.sendJson(res, 403, {
        error: {
          code: 'FORBIDDEN_HOST',
          message: `Host header '${hostHeader}' is not allowed`,
        },
      });
      return;
    }

    // 2. Origin header validation (CSRF & CORS protection — no wildcard)
    const origin = req.headers['origin'];
    if (origin) {
      if (!this.isOriginAllowed(origin)) {
        this.sendJson(res, 403, {
          error: {
            code: 'FORBIDDEN_ORIGIN',
            message: `Origin '${origin}' is not authorized to access Model Hub`,
          },
        });
        return;
      }
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }

    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    const method = (req.method || 'GET').toUpperCase();

    if (method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const urlObj = new URL(req.url || '/', `http://${this.host}:${this.port}`);
    const pathname = urlObj.pathname;

    // 3. Optional Bearer Token Authentication for /api/*
    const expectedToken = this.requireToken || process.env.MODEL_HUB_TOKEN;
    if (expectedToken && pathname.startsWith('/api/')) {
      const authHeader = req.headers['authorization'] || '';
      const parts = authHeader.split(' ');
      if (parts.length !== 2 || parts[0] !== 'Bearer' || parts[1] !== expectedToken) {
        this.sendJson(res, 401, {
          error: {
            code: 'UNAUTHORIZED',
            message: 'Invalid or missing Bearer token in Authorization header',
          },
        });
        return;
      }
    }

    // 4. Static UI serving
    if (method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
      const htmlPath = path.join(this.publicDir, 'index.html');
      if (fs.existsSync(htmlPath)) {
        const content = fs.readFileSync(htmlPath, 'utf8');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(content);
        return;
      }
    }

    // 5. Content-Type enforcement on POST requests
    if (method === 'POST') {
      const contentType = req.headers['content-type'] || '';
      if (!contentType.toLowerCase().includes('application/json')) {
        this.sendJson(res, 415, {
          error: {
            code: 'UNSUPPORTED_MEDIA_TYPE',
            message: 'Content-Type must be application/json on POST requests',
          },
        });
        return;
      }
    }

    // 6. GET /api/models — List all configured models and their live status
    if (method === 'GET' && pathname === '/api/models') {
      const models = this.registry.getAllModels();
      // Ensure API keys / internal tokens are never returned
      this.sendJson(res, 200, models);
      return;
    }

    // 7. POST /api/models/refresh — Force live health check & tag refresh
    if (method === 'POST' && pathname === '/api/models/refresh') {
      const models = await this.registry.refreshAvailability(true);
      this.sendJson(res, 200, models);
      return;
    }

    // 8. POST /api/route — Dry-run preview route decision without execution
    if (method === 'POST' && pathname === '/api/route') {
      const bodyResult = await this.readJsonBody<RouteRequest>(req, res);
      if (!bodyResult.ok) return;

      const body = bodyResult.data;
      if (!body || !body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
        this.sendJson(res, 400, {
          error: {
            code: 'INVALID_REQUEST',
            message: 'Request body must include a valid non-empty messages array',
          },
        });
        return;
      }

      try {
        const decision = await this.router.route(body);
        this.sendJson(res, 200, decision);
      } catch (err: any) {
        const isBlocked =
          err.code === 'PRIVATE_TO_CLOUD_BLOCKED' ||
          (typeof err.message === 'string' && err.message.includes('PRIVATE_TO_CLOUD_BLOCKED'));
        const statusCode =
          isBlocked
            ? 400
            : err.code === 'NO_LOCAL_MODEL_AVAILABLE' || err.code === 'NO_MODEL_AVAILABLE'
            ? 503
            : 400;

        this.sendJson(res, statusCode, {
          error: {
            code: isBlocked ? 'PRIVATE_TO_CLOUD_BLOCKED' : err.code || 'ROUTING_FAILED',
            message: err.message,
          },
        });
      }
      return;
    }

    // 9. POST /api/chat — Route and execute completion
    if (method === 'POST' && pathname === '/api/chat') {
      const bodyResult = await this.readJsonBody<RouteRequest>(req, res);
      if (!bodyResult.ok) return;

      const body = bodyResult.data;
      if (!body || !body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
        this.sendJson(res, 400, {
          error: {
            code: 'INVALID_REQUEST',
            message: 'Request body must include a valid non-empty messages array',
          },
        });
        return;
      }

      try {
        const result = await this.executor.chat(body);
        this.sendJson(res, 200, result);
      } catch (err: any) {
        const isBlocked =
          err.code === 'PRIVATE_TO_CLOUD_BLOCKED' ||
          (typeof err.message === 'string' && err.message.includes('PRIVATE_TO_CLOUD_BLOCKED'));
        const statusCode =
          isBlocked
            ? 400
            : err.code === 'NO_LOCAL_MODEL_AVAILABLE' || err.code === 'NO_MODEL_AVAILABLE'
            ? 503
            : 500;

        this.sendJson(res, statusCode, {
          error: {
            code: isBlocked ? 'PRIVATE_TO_CLOUD_BLOCKED' : err.code || 'EXECUTION_FAILED',
            message: err.message,
          },
        });
      }
      return;
    }

    // 10. POST /api/chat/stream — Streaming completion via SSE
    if (method === 'POST' && pathname === '/api/chat/stream') {
      const bodyResult = await this.readJsonBody<RouteRequest>(req, res);
      if (!bodyResult.ok) return;

      const body = bodyResult.data;
      if (!body || !body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
        this.sendJson(res, 400, {
          error: {
            code: 'INVALID_REQUEST',
            message: 'Request body must include a valid non-empty messages array',
          },
        });
        return;
      }

      // Handle client disconnect / cancellation
      const abortController = new AbortController();
      req.on('close', () => {
        if (!res.writableEnded) {
          abortController.abort();
        }
      });

      try {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        });

        const generator = this.executor.chatStream({
          ...body,
          signal: abortController.signal,
        });

        for await (const delta of generator) {
          if (abortController.signal.aborted) break;
          res.write(`data: ${JSON.stringify({ delta })}\n\n`);
        }
        if (!abortController.signal.aborted) {
          res.write('data: [DONE]\n\n');
        }
        res.end();
      } catch (err: any) {
        if (!res.headersSent) {
          this.sendJson(res, 500, {
            error: {
              code: err.code || 'STREAM_FAILED',
              message: err.message,
            },
          });
        } else {
          res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
          res.end();
        }
      }
      return;
    }

    // 11. GET /api/decisions — Query recent decisions & audit log
    if (method === 'GET' && pathname === '/api/decisions') {
      const limit = Number(urlObj.searchParams.get('limit')) || 20;
      const decisions = this.auditLogger.getRecentDecisions(limit);
      this.sendJson(res, 200, decisions);
      return;
    }

    // Default 404
    this.sendJson(res, 404, {
      error: { code: 'NOT_FOUND', message: `Route ${method} ${pathname} not found` },
    });
  }

  private sendJson(res: http.ServerResponse, statusCode: number, data: any): void {
    const body = JSON.stringify(data, null, 2);
    res.writeHead(statusCode, {
      'Content-Type': 'application/json; charset=utf-8',
    });
    res.end(body);
  }

  private readJsonBody<T>(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<{ ok: boolean; data?: T }> {
    return new Promise((resolve) => {
      let data = '';
      let tooLarge = false;

      req.on('data', (chunk) => {
        if (tooLarge) return;
        data += chunk;
        if (data.length > MAX_BODY_BYTES) {
          tooLarge = true;
          this.sendJson(res, 413, {
            error: {
              code: 'PAYLOAD_TOO_LARGE',
              message: `Request body exceeds size limit of ${MAX_BODY_BYTES} bytes (2MB)`,
            },
          });
          req.destroy();
          resolve({ ok: false });
        }
      });

      req.on('end', () => {
        if (tooLarge) return;
        if (!data.trim()) {
          this.sendJson(res, 400, {
            error: {
              code: 'EMPTY_BODY',
              message: 'Request body must not be empty',
            },
          });
          resolve({ ok: false });
          return;
        }
        try {
          const parsed = JSON.parse(data);
          resolve({ ok: true, data: parsed });
        } catch {
          this.sendJson(res, 400, {
            error: {
              code: 'INVALID_JSON',
              message: 'Malformed JSON in request body',
            },
          });
          resolve({ ok: false });
        }
      });

      req.on('error', () => {
        if (!tooLarge) {
          resolve({ ok: false });
        }
      });
    });
  }
}

// Direct execution entrypoint
if (process.argv[1] && process.argv[1].endsWith('server.ts')) {
  const server = new ModelHubServer();
  server.start().catch((err) => {
    console.error('Failed to start Model Hub server:', err);
    process.exit(1);
  });
}
