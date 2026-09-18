export type TaskCategory =
  | 'architecture'
  | 'refactor_simple'
  | 'boilerplate'
  | 'documentation'
  | 'debugging'
  | 'code_review'
  | 'test_generation'
  | 'general';

export type Sensitivity = 'public' | 'private';

export type ModelProvider = 'openrouter' | 'ollama';

export type ModelLocation = 'cloud' | 'local';

export type LatencyTier = 'fast' | 'medium' | 'slow';

export interface ModelEntry {
  id: string; // Internal stable id, e.g. "claude-3-5-sonnet", "qwen-2-5-coder-7b"
  provider: ModelProvider;
  remoteName: string; // Provider name, e.g. "anthropic/claude-3.5-sonnet", "qwen2.5-coder:7b"
  displayName: string;
  location: ModelLocation;
  strengths: TaskCategory[];
  costPer1MInputUsd?: number | null;
  costPer1MOutputUsd?: number | null;
  latencyTier: LatencyTier;
  contextWindow?: number;
  enabled: boolean;
}

export interface ModelStatus extends ModelEntry {
  available: boolean;
  reason?: string;
  checkedAt: number;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface RouteRequest {
  taskId?: string;
  messages: ChatMessage[];
  category?: TaskCategory;
  sensitivity?: Sensitivity;
  filePaths?: string[];
  overrideModelId?: string;
  confirmPrivateToCloud?: boolean;
  maxCostTier?: 'free' | 'cheap' | 'any';
  preferLowLatency?: boolean;
}

export interface RouteDecision {
  taskId: string;
  modelId: string;
  provider: ModelProvider;
  remoteName: string;
  location: ModelLocation;
  category: TaskCategory;
  sensitivity: Sensitivity;
  overridden: boolean;
  reasons: string[];
  fallbacks: string[]; // Ordered model IDs, guaranteed privacy-filtered
  decidedAt: number;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface ChatResult {
  content: string;
  modelUsed: string;
  provider: ModelProvider;
  decision: RouteDecision;
  usage?: TokenUsage;
  latencyMs: number;
  estimatedCostUsd?: number;
}

export interface ChatStreamChunk {
  delta: string;
  done: boolean;
  modelUsed?: string;
  usage?: TokenUsage;
  latencyMs?: number;
  estimatedCostUsd?: number;
}

export interface RoutingRule {
  name: string;
  when: {
    category?: TaskCategory;
    sensitivity?: Sensitivity;
  };
  prefer: string[]; // Ordered list of preferred model IDs
}

export interface ModelHubSettings {
  defaultCloudModelId: string;
  defaultLocalModelId: string;
  healthCheckTtlSeconds: number;
  requestTimeoutMs: {
    cloud: number;
    local: number;
  };
  privateGlobs: string[];
  privateProject: boolean;
}

export interface ModelHubConfig {
  models: ModelEntry[];
  settings: ModelHubSettings;
}

/**
 * Optional hook: Aegis or external security engines can inject sensitivity opinions
 */
export interface SensitivityProvider {
  evaluateSensitivity(request: RouteRequest): Promise<Sensitivity | null> | Sensitivity | null;
}

export interface AuditRecord {
  id: string;
  timestamp: string;
  taskId: string;
  category: TaskCategory;
  sensitivity: Sensitivity;
  chosenModel: string;
  provider: ModelProvider;
  location: ModelLocation;
  overridden: boolean;
  fallbacks: string[];
  reasons: string[];
  promptHash: string;
  promptLength: number;
  responseLength?: number;
  latencyMs?: number;
  success: boolean;
  error?: string;
}

/**
 * Optional hook: Forward audit entries to Aegis hash-chained log or custom SIEM
 */
export interface AuditSink {
  logDecision(record: AuditRecord): Promise<void> | void;
}
