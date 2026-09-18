import { LlmProvider } from "../llmProvider.interface";
import { config } from "../config";

async function geminiPost(prompt: string): Promise<string> {
  if (!config.gemini.apiKey) {
    throw new Error(
      "GEMINI_API_KEY is not set. Add it to your .env file."
    );
  }

  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/` +
    `${config.gemini.model}:generateContent?key=${config.gemini.apiKey}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 512 },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini API error ${res.status}: ${err}`);
  }

  const data = await res.json();
  return (
    (data?.candidates?.[0]?.content?.parts?.[0]?.text as string) || "TBD"
  ).trim();
}

export const geminiProvider: LlmProvider = {
  name: "gemini",

  async chooseTechStack(requirements, key, prompt) {
    const systemCtx = `You are an expert software architect.
Project: ${requirements.project || "Unknown"}
Requirements:
${(requirements.requirements || []).map((r: any) => `- [${r.category}] ${r.text}`).join("\n")}`;

    const userPrompt = `${systemCtx}

Question (${key}): ${prompt}

Reply with ONLY the technology name — no explanation, no punctuation, nothing else.
Example reply: PostgreSQL`;

    try {
      return await geminiPost(userPrompt);
    } catch (e) {
      console.warn(`⚠  Gemini call failed for "${key}": ${(e as Error).message}`);
      return "TBD";
    }
  },

  async analyzeStack(requirements, key, proposed) {
    const systemCtx = `You are an expert software architect.
Project: ${requirements.project || "Unknown"}
Requirements:
${(requirements.requirements || []).map((r: any) => `- [${r.category}] ${r.text}`).join("\n")}`;

    const userPrompt = `${systemCtx}

The user proposed the following technologies for "${key}": ${proposed.join(", ")}.

Analyze each option against the project requirements and recommend the BEST single choice.
Reply in this exact format (3 lines, nothing else):
Recommended: <technology>
Reason: <one sentence why>
Alternatives: <comma-separated others that would also work>`;

    try {
      return await geminiPost(userPrompt);
    } catch (e) {
      console.warn(`⚠  Gemini analysis failed for "${key}": ${(e as Error).message}`);
      return `Recommended: ${proposed[0]}\nReason: Gemini unavailable.\nAlternatives: ${proposed.slice(1).join(", ")}`;
    }
  },

  async generate(prompt: string): Promise<string> {
    try {
      return await geminiPost(prompt);
    } catch (e) {
      throw new Error(`Gemini generate failed: ${(e as Error).message}`);
    }
  },
};
