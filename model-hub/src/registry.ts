import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ModelEntry, ModelHubConfig, ModelStatus } from './models.ts';
import { ProviderAdapter } from './adapters.ts';
import { SystemContext } from './utils.ts';

export class ModelRegistry {
  private models: Map<string, ModelEntry> = new Map();
  private statusCache: Map<string, ModelStatus> = new Map();
  private lastCheckedAt: number = 0;
  private ttlMs: number = 30000;
  private adapter: ProviderAdapter;
  private configPath: string;

  constructor(
    adapter: ProviderAdapter,
    configPath: string = path.resolve(process.cwd(), 'models.config.json')
  ) {
    this.adapter = adapter;
    this.configPath = configPath;
    this.loadFromConfig();
  }

  public loadFromConfig(overrideConfig?: ModelHubConfig): void {
    let config: ModelHubConfig;

    if (overrideConfig) {
      config = overrideConfig;
    } else {
      try {
        if (fs.existsSync(this.configPath)) {
          const raw = fs.readFileSync(this.configPath, 'utf8');
          config = JSON.parse(raw);
        } else {
          // Fallback if config file not found
          config = {
            models: [],
            settings: {
              defaultCloudModelId: 'claude-3-5-sonnet',
              defaultLocalModelId: 'qwen-2-5-coder-7b',
              healthCheckTtlSeconds: 30,
              requestTimeoutMs: { cloud: 30000, local: 60000 },
              privateGlobs: ['.env*'],
              privateProject: false,
            },
          };
        }
      } catch (err: any) {
        throw new Error(`Failed to load model-hub configuration from ${this.configPath}: ${err.message}`);
      }
    }

    this.models.clear();
    this.statusCache.clear();
    this.ttlMs = (config.settings?.healthCheckTtlSeconds || 30) * 1000;

    for (const entry of config.models) {
      this.models.set(entry.id, { ...entry });
      // Initialize with optimistic default
      this.statusCache.set(entry.id, {
        ...entry,
        available: entry.enabled,
        reason: entry.enabled ? 'Pending initial health check' : 'Model disabled in configuration',
        checkedAt: 0,
      });
    }
  }

  public registerModel(entry: ModelEntry): void {
    this.models.set(entry.id, { ...entry });
    this.statusCache.set(entry.id, {
      ...entry,
      available: entry.enabled,
      reason: entry.enabled ? 'Newly registered model' : 'Disabled',
      checkedAt: 0,
    });
  }

  public getModel(id: string): ModelStatus | undefined {
    return this.statusCache.get(id);
  }

  public getAllModels(): ModelStatus[] {
    return Array.from(this.statusCache.values());
  }

  public getAvailableModels(): ModelStatus[] {
    return this.getAllModels().filter((m) => m.enabled && m.available);
  }

  public getAvailableLocalModels(): ModelStatus[] {
    return this.getAvailableModels().filter((m) => m.location === 'local');
  }

  public getAvailableCloudModels(): ModelStatus[] {
    return this.getAvailableModels().filter((m) => m.location === 'cloud');
  }

  /**
   * Refreshes health and catalog status for all configured models
   */
  public async refreshAvailability(force: boolean = false): Promise<ModelStatus[]> {
    const now = SystemContext.nowMs();
    if (!force && this.lastCheckedAt > 0 && now - this.lastCheckedAt < this.ttlMs) {
      return this.getAllModels();
    }

    // Query both providers in parallel
    const [openRouterRes, ollamaRes] = await Promise.all([
      this.adapter.fetchOpenRouterAvailableModels(),
      this.adapter.fetchOllamaAvailableModels(),
    ]);

    const openRouterSet = new Set(
      openRouterRes.models.map((m) => m.toLowerCase().trim())
    );
    const ollamaSet = new Set(
      ollamaRes.models.map((m) => m.toLowerCase().trim())
    );

    for (const model of this.models.values()) {
      if (!model.enabled) {
        this.statusCache.set(model.id, {
          ...model,
          available: false,
          reason: 'Model disabled in configuration (models.config.json)',
          checkedAt: now,
        });
        continue;
      }

      if (model.provider === 'openrouter') {
        if (!openRouterRes.success) {
          this.statusCache.set(model.id, {
            ...model,
            available: false,
            reason: openRouterRes.error || 'OpenRouter API unreachable or API key missing',
            checkedAt: now,
          });
        } else {
          // Check if remoteName is present in OpenRouter catalogue
          const remoteNormalized = model.remoteName.toLowerCase().trim();
          const found = openRouterSet.has(remoteNormalized) || openRouterSet.has(remoteNormalized.split(':')[0]);

          if (found) {
            this.statusCache.set(model.id, {
              ...model,
              available: true,
              reason: 'Available on OpenRouter',
              checkedAt: now,
            });
          } else {
            this.statusCache.set(model.id, {
              ...model,
              available: false,
              reason: `Model '${model.remoteName}' not found in live OpenRouter catalog`,
              checkedAt: now,
            });
          }
        }
      } else if (model.provider === 'ollama') {
        if (!ollamaRes.success) {
          this.statusCache.set(model.id, {
            ...model,
            available: false,
            reason: `Ollama is not running (run: ollama serve) [${ollamaRes.error || 'Connection refused'}]`,
            checkedAt: now,
          });
        } else {
          const remoteNormalized = model.remoteName.toLowerCase().trim();
          const baseModelName = remoteNormalized.split(':')[0];
          
          // Match full tag (e.g. qwen2.5-coder:7b) or base tag
          const found =
            ollamaSet.has(remoteNormalized) ||
            Array.from(ollamaSet).some((o) => o.startsWith(remoteNormalized) || o.startsWith(baseModelName));

          if (found) {
            this.statusCache.set(model.id, {
              ...model,
              available: true,
              reason: 'Model pulled and ready in Ollama',
              checkedAt: now,
            });
          } else {
            this.statusCache.set(model.id, {
              ...model,
              available: false,
              reason: `Model not pulled locally in Ollama (run: ollama pull ${model.remoteName})`,
              checkedAt: now,
            });
          }
        }
      }
    }

    this.lastCheckedAt = now;
    return this.getAllModels();
  }

  /**
   * Sets manual mock status for testing
   */
  public setModelAvailability(modelId: string, available: boolean, reason?: string): void {
    const existing = this.statusCache.get(modelId);
    if (existing) {
      this.statusCache.set(modelId, {
        ...existing,
        available,
        reason: reason || (available ? 'Mocked available' : 'Mocked unavailable'),
        checkedAt: SystemContext.nowMs(),
      });
    }
  }
}
