import { LlmProvider } from "./llmProvider.interface";
import { geminiProvider } from "./providers/geminiProvider";
import { ollamaProvider } from "./providers/ollamaProvider";
import { ideProvider } from "./providers/ideProvider";
import { config } from "./config";

const providers: Record<string, LlmProvider> = {
  gemini: geminiProvider,
  ollama: ollamaProvider,
  ide: ideProvider,
};

export function getActiveProvider(): LlmProvider {
  const p = providers[config.provider];
  if (!p) {
    console.warn(`⚠  Unknown provider "${config.provider}", falling back to gemini`);
    return geminiProvider;
  }
  return p;
}

export async function chooseTechStack(
  requirements: any,
  key: string,
  prompt: string
): Promise<string> {
  return getActiveProvider().chooseTechStack(requirements, key, prompt);
}

export async function analyzeStack(
  requirements: any,
  key: string,
  proposed: string[]
): Promise<string> {
  return getActiveProvider().analyzeStack(requirements, key, proposed);
}

export async function generate(prompt: string): Promise<string> {
  return getActiveProvider().generate(prompt);
}
