/**
 * DevSoul Agent Factory — Architecture Intelligence Input Types
 * Contract for the output produced by the Architecture Intelligence module.
 * Mock fixtures and future real AI outputs must satisfy this interface.
 */

export interface AIComponent {
  /** Component name (e.g. "frontend", "backend", "database") */
  name: string;
  /** Human-readable description of the component's role */
  description: string;
}

export interface AITechnologyStack {
  /** Frontend technology (e.g. "React") */
  frontend?: string;
  /** Backend technology (e.g. "Node.js") */
  backend?: string;
  /** Database technology (e.g. "PostgreSQL") */
  database?: string;
  /** Any additional technology entries */
  [key: string]: string | undefined;
}

export interface ArchitectureIntelligenceOutput {
  /** Unique project identifier — must match the Requirement Intelligence project_id */
  project_id: string;
  /** Short summary of the architecture */
  architecture_summary: string;
  /** Technology stack breakdown */
  technology_stack: AITechnologyStack;
  /** List of architectural components */
  components: AIComponent[];
  /** Design constraints relevant to agent planning */
  design_constraints: string[];
  /** Relevant project file paths */
  project_files: string[];
}
