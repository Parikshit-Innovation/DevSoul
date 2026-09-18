import { LlmProvider } from "../llmProvider.interface";
import { config } from "../config";

async function ollamaPost(prompt: string): Promise<string> {
  const res = await fetch(`${config.ollama.baseUrl}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: config.ollama.model,
      prompt,
      stream: false,
    }),
  });
  const data = await res.json();
  return (data.response || "TBD").trim();
}

export const ollamaProvider: LlmProvider = {
  name: "ollama",

  async chooseTechStack(requirements, key, prompt) {
    try {
      return await ollamaPost(
        `Project: ${requirements.project || "Unknown"}
Requirements: ${JSON.stringify(requirements.requirements || [])}

Question (${key}): ${prompt}
Reply with ONLY the technology name.`
      );
    } catch {
      console.warn(`⚠  Ollama unreachable for "${key}", using TBD`);
      return "TBD";
    }
  },

  async analyzeStack(requirements, key, proposed) {
    try {
      return await ollamaPost(
        `Project: ${requirements.project || "Unknown"}
Requirements: ${JSON.stringify(requirements.requirements || [])}

The user proposed for "${key}": ${proposed.join(", ")}.
Recommend the best one. Format:
Recommended: <tech>
Reason: <one sentence>
Alternatives: <others>`
      );
    } catch {
      console.warn(`⚠  Ollama unreachable for analysis of "${key}"`);
      return `Recommended: ${proposed[0]}\nReason: Ollama unavailable.\nAlternatives: ${proposed.slice(1).join(", ")}`;
    }
  },

  async generate(prompt: string): Promise<string> {
    try {
      return await ollamaPost(prompt);
    } catch {
      throw new Error("Ollama unreachable for generate()");
    }
  },
};
