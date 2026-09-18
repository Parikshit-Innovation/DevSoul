export type ProviderName = "gemini" | "ollama" | "ide";

export const config = {
  provider: (process.env.LLM_PROVIDER as ProviderName) || "gemini",
  gemini: {
    apiKey: process.env.GEMINI_API_KEY || "",
    model: process.env.GEMINI_MODEL || "gemini-1.5-flash",
  },
  ollama: {
    baseUrl: process.env.OLLAMA_BASE_URL || "http://localhost:11434",
    model: process.env.OLLAMA_MODEL || "qwen2.5-coder",
  },
};
