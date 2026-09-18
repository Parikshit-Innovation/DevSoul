/**
 * DevSoul Agent Factory — Tool Catalog
 * Central registry of tools that agents are permitted to use.
 * This is the ONLY source of truth for allowlisted tools.
 * The LLM cannot invent tools. New tools require an explicit addition here
 * and a corresponding permission gate review.
 */

export const ALLOWED_TOOLS = ["read_file"] as const;

export type AllowedTool = (typeof ALLOWED_TOOLS)[number];

export function isAllowedTool(tool: string): tool is AllowedTool {
  return (ALLOWED_TOOLS as readonly string[]).includes(tool);
}

export const TOOL_DESCRIPTIONS: Record<AllowedTool, string> = {
  read_file: "Read a file from the project's allowed read paths. Write access is not granted.",
};

/**
 * Returns only the tools from the candidate list that exist in the catalog.
 * Silently filters out unknown tools — callers should validate separately.
 */
export function filterToAllowedTools(tools: string[]): AllowedTool[] {
  return tools.filter(isAllowedTool);
}
