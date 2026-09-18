/**
 * DevSoul Agent Factory — AgentConfig Types
 * The fully configured agent specification produced by the Factory service.
 * This is what gets persisted to agents.yaml and consumed by the future Agent Runtime.
 */

export type AgentLifecycleState = "CREATED" | "QUEUED" | "RUNNING" | "IDLE" | "DONE" | "FAILED";

export interface AgentBackend {
  provider: string;
  model: string;
}

export interface AgentContext {
  include_requirements: boolean;
  include_architecture: boolean;
}

export interface AgentScope {
  /** Glob patterns for readable paths */
  read: string[];
  /** Glob patterns for writable paths — empty for read-only agents */
  write: string[];
}

export interface AgentBudget {
  max_steps: number;
  max_tokens: number;
}

export interface AgentLifecycle {
  state: AgentLifecycleState;
}

/**
 * A fully resolved agent configuration — all trusted fields set by the Factory, not the LLM.
 */
export interface AgentConfig {
  id: string;
  role: string;
  task: string;
  reason: string;
  depends_on: string[];
  tools: string[];
  requirement_ids: string[];
  architecture_components: string[];
  success_criteria: string[];
  /** Assigned by Factory, not the LLM */
  backend: AgentBackend;
  /** Assigned by Factory, not the LLM */
  context: AgentContext;
  /** Assigned by Factory, not the LLM */
  scope: AgentScope;
  /** Assigned by Factory, not the LLM */
  budget: AgentBudget;
  /** Assigned by Factory, not the LLM */
  lifecycle: AgentLifecycle;
}

/**
 * Top-level agents.yaml document structure.
 */
export interface AgentsYamlDocument {
  version: number;
  project: {
    id: string;
    name: string;
  };
  task: string;
  source: {
    requirements: string;
    architecture: string;
  };
  planning: {
    provider: string;
    model: string;
    status: string;
  };
  agents: AgentConfig[];
}
