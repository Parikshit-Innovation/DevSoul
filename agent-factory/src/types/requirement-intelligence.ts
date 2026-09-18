/**
 * DevSoul Agent Factory — Requirement Intelligence Input Types
 * Contract for the output produced by the Requirement Intelligence module.
 * Mock fixtures and future real RI outputs must satisfy this interface.
 */

export interface RIRequirement {
  /** Unique requirement identifier (e.g. REQ-001) */
  id: string;
  /** Human-readable description of the requirement */
  description: string;
  /** Priority level for planning decisions */
  priority: "critical" | "high" | "medium" | "low";
  /** Measurable conditions that must be true for the requirement to be complete */
  acceptance_criteria: string[];
}

export interface RIConstraints {
  /** Maximum number of agents the Factory may create for this project */
  max_agents: number;
  /** Maximum tokens the Planner may use */
  max_planning_tokens: number;
  /** Maximum steps any single agent may take during execution */
  max_agent_steps: number;
  /** Tools that agents are allowed to use */
  allowed_tools: string[];
  /** Root directory of the project */
  project_root: string;
}

export interface RequirementIntelligenceOutput {
  /** Unique project identifier — must match the Architecture Intelligence project_id */
  project_id: string;
  /** Human-readable project name */
  project_name: string;
  /** Brief summary of the project */
  summary: string;
  /** Structured list of requirements */
  requirements: RIRequirement[];
  /** Planning and execution constraints */
  constraints: RIConstraints;
}
