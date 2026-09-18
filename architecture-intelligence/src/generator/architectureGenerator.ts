import {
  ArchitectureOutput,
  ArchitectureOutputSchema,
  TechnologyStack,
} from "../schema/architecture.schema";
import { generateArchitectureNarrative } from "../llm/architectureSummaryHelper";

/**
 * Build a validated ArchitectureOutput from the project ID, requirements, and
 * the flat answers map collected by the interview loop.
 *
 * - technology_stack is pulled directly from three interview keys.
 * - architecture_summary, components, and design_constraints come from a
 *   single LLM call via generateArchitectureNarrative() (with fallback).
 * - project_files is built by convention from the component shape.
 */
export async function buildArchitecture(
  projectId: string,
  requirements: any,
  interviewAnswers: Record<string, string>
): Promise<ArchitectureOutput> {
  // ── 1. Build technology_stack from the three primary interview keys ───────
  const techStack: TechnologyStack = {
    frontend: interviewAnswers.frontend_framework || "TBD",
    backend: interviewAnswers.backend_runtime || "TBD",
    database: interviewAnswers.db_relational || "TBD",
  };

  // ── 2. Get narrative from LLM (falls back to templates gracefully) ─────────
  const narrative = await generateArchitectureNarrative(
    requirements,
    techStack,
    projectId
  );

  // ── 3. Build project_files by convention ──────────────────────────────────
  const useDatabase =
    techStack.database.toLowerCase() !== "none" &&
    techStack.database.toLowerCase() !== "tbd" &&
    techStack.database !== "";

  const project_files: string[] = [
    "src/frontend/",
    "src/backend/",
    ...(useDatabase ? ["database/"] : []),
    "docs/",
  ];

  // ── 4. Assemble and validate against Zod schema ───────────────────────────
  const result: ArchitectureOutput = ArchitectureOutputSchema.parse({
    project_id: projectId,
    architecture_summary: narrative.architecture_summary,
    technology_stack: techStack,
    components: narrative.components,
    design_constraints: narrative.design_constraints,
    project_files,
  });

  return result;
}
