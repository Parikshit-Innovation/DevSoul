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

let isGeminiBroken = false;

export async function chooseTechStack(
  requirements: any,
  key: string,
  prompt: string
): Promise<string> {
  if (isGeminiBroken) {
    return ollamaProvider.chooseTechStack(requirements, key, prompt);
  }
  
  const provider = getActiveProvider();
  try {
    return await provider.chooseTechStack(requirements, key, prompt);
  } catch (err: any) {
    if (provider.name !== "ollama" && (err?.message?.includes("503") || err?.message?.includes("429"))) {
      console.warn(`\n  ⚠  ${provider.name} overloaded. Breaking circuit and permanently falling back to ollama...`);
      isGeminiBroken = true;
      return ollamaProvider.chooseTechStack(requirements, key, prompt);
    }
    throw err;
  }
}

export async function analyzeStack(
  requirements: any,
  key: string,
  proposed: string[]
): Promise<string> {
  if (isGeminiBroken) {
    return ollamaProvider.analyzeStack(requirements, key, proposed);
  }

  const provider = getActiveProvider();
  try {
    return await provider.analyzeStack(requirements, key, proposed);
  } catch (err: any) {
    if (provider.name !== "ollama" && (err?.message?.includes("503") || err?.message?.includes("429"))) {
      console.warn(`\n  ⚠  ${provider.name} overloaded. Breaking circuit and permanently falling back to ollama...`);
      isGeminiBroken = true;
      return ollamaProvider.analyzeStack(requirements, key, proposed);
    }
    throw err;
  }
}

export async function generate(prompt: string): Promise<string> {
  if (isGeminiBroken) {
    return ollamaProvider.generate(prompt);
  }

  const provider = getActiveProvider();
  try {
    return await provider.generate(prompt);
  } catch (err: any) {
    if (provider.name !== "ollama" && (err?.message?.includes("503") || err?.message?.includes("429"))) {
      console.warn(`\n  ⚠  ${provider.name} overloaded. Breaking circuit and permanently falling back to ollama...`);
      isGeminiBroken = true;
      return ollamaProvider.generate(prompt);
    }
    throw err;
  }
}
