/**
 * DevSoul Agent Factory — Pipeline Event Types
 * Defines the events emitted as the pipeline progresses and the overall result shape.
 */

export type PipelineEventType =
  | "PRECHECK_STARTED"
  | "PRECHECK_COMPLETED"
  | "PLANNER_STARTED"
  | "PLANNER_COMPLETED"
  | "VALIDATION_STARTED"
  | "VALIDATION_PASSED"
  | "VALIDATION_FAILED"
  | "FACTORY_STARTED"
  | "AGENTS_CREATED"
  | "YAML_SAVED"
  | "PIPELINE_FAILED";

export interface PipelineEvent {
  type: PipelineEventType;
  timestamp: string;
  message?: string;
  data?: unknown;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface PipelineResult {
  success: boolean;
  error?: string;
  events: PipelineEvent[];
  validation?: ValidationResult;
  agentsYamlPath?: string;
  agentsYamlContents?: string;
}
