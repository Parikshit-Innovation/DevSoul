import { LlmProvider } from "../llmProvider.interface";

// Stub: will be wired to VS Code / Antigravity's LLM API once available.
export const ideProvider: LlmProvider = {
  name: "ide",

  async chooseTechStack(_requirements, key, _prompt) {
    console.warn(`⚠  IDE provider not implemented yet for "${key}"`);
    return "TBD";
  },

  async analyzeStack(_requirements, key, proposed) {
    console.warn(`⚠  IDE provider not implemented yet for "${key}"`);
    return `Recommended: ${proposed[0]}\nReason: IDE provider not implemented.\nAlternatives: ${proposed.slice(1).join(", ")}`;
  },

  async generate(_prompt: string): Promise<string> {
    throw new Error("IDE provider generate() not implemented yet.");
  },
};
