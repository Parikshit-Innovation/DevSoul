import { z } from "zod";

// ── Technology Stack ──────────────────────────────────────────────────────────

export const TechnologyStackSchema = z.object({
  frontend: z.string(),
  backend: z.string(),
  database: z.string(),
});

// ── Component ─────────────────────────────────────────────────────────────────

export const ComponentOutputSchema = z.object({
  name: z.string(),
  description: z.string(),
});

// ── Full Architecture Output ──────────────────────────────────────────────────

export const ArchitectureOutputSchema = z.object({
  project_id: z.string(),
  architecture_summary: z.string(),
  technology_stack: TechnologyStackSchema,
  components: z.array(ComponentOutputSchema),
  design_constraints: z.array(z.string()),
  project_files: z.array(z.string()),
});

export type TechnologyStack = z.infer<typeof TechnologyStackSchema>;
export type ComponentOutput = z.infer<typeof ComponentOutputSchema>;
export type ArchitectureOutput = z.infer<typeof ArchitectureOutputSchema>;
