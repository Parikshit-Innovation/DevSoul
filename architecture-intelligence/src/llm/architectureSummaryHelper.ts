import { generate } from "./llmRouter";
import { TechnologyStack, ComponentOutput } from "../schema/architecture.schema";
import yaml from "js-yaml";

// ── Types returned by this helper ─────────────────────────────────────────────

export interface ArchitectureNarrative {
  architecture_summary: string;
  components: ComponentOutput[];
  design_constraints: string[];
}

// ── Fallback generators (used when LLM call fails or JSON parse fails) ────────

function buildFallbackNarrative(
  techStack: TechnologyStack,
  projectId: string
): ArchitectureNarrative {
  return {
    architecture_summary: `A web application with a ${techStack.frontend} frontend and a ${techStack.backend} API.`,
    components: [
      {
        name: "frontend",
        description: `Handles the frontend layer of the ${projectId} application.`,
      },
      {
        name: "backend",
        description: `Handles the backend layer of the ${projectId} application.`,
      },
      {
        name: "database",
        description: `Handles the database layer of the ${projectId} application.`,
      },
    ],
    design_constraints: [],
  };
}

// ── Main exported helper ──────────────────────────────────────────────────────

/**
 * Calls the active LLM provider once to generate:
 *   - architecture_summary  (one sentence)
 *   - components            (array of 3: frontend, backend, database)
 *   - design_constraints    (2-5 short strings derived from requirements)
 *
 * Falls back to template strings if the LLM call fails or returns invalid JSON.
 */
export async function generateArchitectureNarrative(
  requirements: any,
  techStack: TechnologyStack,
  projectId: string
): Promise<ArchitectureNarrative> {
  // ── Serialize requirements content for the prompt ────────────────────────
  const requirementsText: string = (() => {
    try {
      return yaml.dump(requirements, { lineWidth: 120 }).trim();
    } catch {
      return JSON.stringify(requirements, null, 2);
    }
  })();

  const prompt = `You are an expert software architect generating structured documentation.

PROJECT ID: ${projectId}
TECHNOLOGY STACK:
  - Frontend: ${techStack.frontend}
  - Backend:  ${techStack.backend}
  - Database: ${techStack.database}

FULL REQUIREMENTS:
${requirementsText}

Your task: produce a JSON object (no markdown, no code fences, raw JSON only) that matches EXACTLY this structure:
{
  "architecture_summary": "<one sentence summarizing the stack and its purpose for this specific project>",
  "components": [
    { "name": "frontend",  "description": "<one-line description of what the frontend does FOR THIS PROJECT>" },
    { "name": "backend",   "description": "<one-line description of what the backend does FOR THIS PROJECT>" },
    { "name": "database",  "description": "<one-line description of what the database stores FOR THIS PROJECT>" }
  ],
  "design_constraints": [
    "<constraint 1 derived from the requirements above>",
    "<constraint 2 derived from the requirements above>"
  ]
}

Rules:
1. architecture_summary must mention the frontend and backend technologies.
2. Each component description must be specific to the project requirements, NOT generic filler.
3. design_constraints must be 2–5 items derived ONLY from the requirements listed above.
4. Respond with ONLY the JSON object — no explanation, no markdown, no code fences.`;

  // ── Call LLM ─────────────────────────────────────────────────────────────
  let rawResponse: string;
  try {
    rawResponse = await generate(prompt);
  } catch (e) {
    console.warn(
      `⚠  LLM generate() failed: ${(e as Error).message} — using fallback narrative.`
    );
    return buildFallbackNarrative(techStack, projectId);
  }

  // ── Parse JSON response ───────────────────────────────────────────────────
  try {
    // Strip any accidental markdown code fences the model might add
    const cleaned = rawResponse
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "")
      .trim();

    const parsed = JSON.parse(cleaned) as {
      architecture_summary?: unknown;
      components?: unknown;
      design_constraints?: unknown;
    };

    // Validate shape minimally before trusting it
    if (
      typeof parsed.architecture_summary !== "string" ||
      !Array.isArray(parsed.components) ||
      !Array.isArray(parsed.design_constraints)
    ) {
      throw new Error("LLM response JSON has unexpected shape.");
    }

    const components = (parsed.components as any[])
      .filter((c) => typeof c?.name === "string" && typeof c?.description === "string")
      .map((c) => ({ name: String(c.name), description: String(c.description) }));

    const design_constraints = (parsed.design_constraints as any[])
      .filter((s) => typeof s === "string")
      .map((s) => String(s));

    return {
      architecture_summary: parsed.architecture_summary,
      components,
      design_constraints,
    };
  } catch (e) {
    console.warn(
      `⚠  Could not parse LLM JSON response: ${(e as Error).message} — using fallback narrative.`
    );
    return buildFallbackNarrative(techStack, projectId);
  }
}
