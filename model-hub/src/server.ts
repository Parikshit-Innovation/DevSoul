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
}

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

  constructor(options: ServerOptions = {}) {
    this.port = options.port || Number(process.env.MODEL_HUB_PORT) || 3000;
    this.host = options.host || '127.0.0.1';
    this.publicDir = path.resolve(__dirname, '..', 'public');

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

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const urlObj = new URL(req.url || '/', `http://${this.host}:${this.port}`);
    const pathname = urlObj.pathname;
    const method = (req.method || 'GET').toUpperCase();

    // Enable CORS for local DevOS integrations & VS Code extension
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // 1. Static UI serving
    if (method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
      const htmlPath = path.join(this.publicDir, 'index.html');
      if (fs.existsSync(htmlPath)) {
        const content = fs.readFileSync(htmlPath, 'utf8');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(content);
        return;
      }
    }

    // 2. GET /api/models — List all configured models and their live status
    if (method === 'GET' && pathname === '/api/models') {
      const models = this.registry.getAllModels();
      // Ensure API keys / internal tokens are never returned
      this.sendJson(res, 200, models);
      return;
    }

    // 3. POST /api/models/refresh — Force live health check & tag refresh
    if (method === 'POST' && pathname === '/api/models/refresh') {
      const models = await this.registry.refreshAvailability(true);
      this.sendJson(res, 200, models);
      return;
    }

    // 4. POST /api/route — Dry-run preview route decision without execution
    if (method === 'POST' && pathname === '/api/route') {
      const body = await this.readJsonBody<RouteRequest>(req);
      if (!body || !body.messages || !Array.isArray(body.messages)) {
        this.sendJson(res, 400, {
          error: {
            code: 'INVALID_REQUEST',
            message: 'Request body must include a valid messages array',
          },
        });
        return;
      }

      try {
        const decision = await this.router.route(body);
        this.sendJson(res, 200, decision);
      } catch (err: any) {
        const statusCode =
          err.code === 'PRIVATE_TO_CLOUD_BLOCKED'
            ? 400
            : err.code === 'NO_LOCAL_MODEL_AVAILABLE' || err.code === 'NO_MODEL_AVAILABLE'
            ? 503
            : 400;

        this.sendJson(res, statusCode, {
          error: {
            code: err.code || 'ROUTING_FAILED',
            message: err.message,
          },
        });
      }
      return;
    }

    // 5. POST /api/chat — Route and execute completion
    if (method === 'POST' && pathname === '/api/chat') {
      const body = await this.readJsonBody<RouteRequest>(req);
      if (!body || !body.messages || !Array.isArray(body.messages)) {
        this.sendJson(res, 400, {
          error: {
            code: 'INVALID_REQUEST',
            message: 'Request body must include a valid messages array',
          },
        });
        return;
      }

      try {
        const result = await this.executor.chat(body);
        this.sendJson(res, 200, result);
      } catch (err: any) {
        const statusCode =
          err.code === 'PRIVATE_TO_CLOUD_BLOCKED'
            ? 400
            : err.code === 'NO_LOCAL_MODEL_AVAILABLE' || err.code === 'NO_MODEL_AVAILABLE'
            ? 503
            : 500;

        this.sendJson(res, statusCode, {
          error: {
            code: err.code || 'EXECUTION_FAILED',
            message: err.message,
          },
        });
      }
      return;
    }

    // 6. POST /api/chat/stream — Streaming completion via SSE
    if (method === 'POST' && pathname === '/api/chat/stream') {
      const body = await this.readJsonBody<RouteRequest>(req);
      if (!body || !body.messages || !Array.isArray(body.messages)) {
        this.sendJson(res, 400, {
          error: {
            code: 'INVALID_REQUEST',
            message: 'Request body must include a valid messages array',
          },
        });
        return;
      }

      try {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        });

        const generator = this.executor.chatStream(body);
        for await (const delta of generator) {
          res.write(`data: ${JSON.stringify({ delta })}\n\n`);
        }
        res.write('data: [DONE]\n\n');
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

    // 7. GET /api/decisions — Query recent decisions & audit log
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

  private readJsonBody<T>(req: http.IncomingMessage): Promise<T | null> {
    return new Promise((resolve) => {
      let data = '';
      req.on('data', (chunk) => {
        data += chunk;
        if (data.length > 2 * 1024 * 1024) {
          // 2MB size limit
          req.destroy();
          resolve(null);
        }
      });
      req.on('end', () => {
        if (!data.trim()) {
          resolve(null);
          return;
        }
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve(null);
        }
      });
      req.on('error', () => resolve(null));
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
