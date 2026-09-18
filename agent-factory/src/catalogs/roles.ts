/**
 * DevSoul Agent Factory — Role Catalog
 * Central registry of allowed agent roles.
 * The Planner may only propose roles listed here.
 * New roles must be explicitly added by a developer — the LLM cannot invent roles.
 */

export const ALLOWED_ROLES = [
  "planner",
  "frontend",
  "backend",
  "database",
  "testing",
  "integration",
  "documentation",
] as const;

export type AllowedRole = (typeof ALLOWED_ROLES)[number];

export function isAllowedRole(role: string): role is AllowedRole {
  return (ALLOWED_ROLES as readonly string[]).includes(role);
}

export const ROLE_DESCRIPTIONS: Record<AllowedRole, string> = {
  planner: "Decomposes a high-level task into subtasks and coordinates other agents.",
  frontend: "Implements user interface components and client-side logic.",
  backend: "Implements server-side APIs, business logic, and service integrations.",
  database: "Designs and manages data models, migrations, and queries.",
  testing: "Writes and executes test suites to validate functionality.",
  integration: "Integrates disparate components, services, or external APIs.",
  documentation: "Produces technical documentation, READMEs, and API docs.",
};
