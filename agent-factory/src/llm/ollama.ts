import type { LLMProvider, LLMRequest, LLMResponse } from "./provider.interface.js";

export class OllamaProvider implements LLMProvider {
  public readonly providerName = "ollama";
  public readonly modelName: string;
  private readonly baseUrl: string;

  constructor(model = "qwen2.5-coder:7b", baseUrl = "http://localhost:11434") {
    this.modelName = model;
    this.baseUrl = baseUrl;
  }

  async complete(request: LLMRequest): Promise<LLMResponse> {
    const payload: any = {
      model: this.modelName,
      prompt: `${request.systemPrompt}\n\n${request.userPrompt}`,
      stream: false,
    };

    if (request.responseMimeType === "application/json") {
      payload.format = "json";
    }

    const response = await fetch(`${this.baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as any;
    return {
      text: data.response,
      tokensUsed: data.eval_count ? data.prompt_eval_count + data.eval_count : undefined,
    };
  }
}

export function createOllamaProviderFromEnv(): OllamaProvider {
  const model = process.env["OLLAMA_MODEL"] ?? "qwen2.5-coder:7b";
  const baseUrl = process.env["OLLAMA_BASE_URL"] ?? "http://127.0.0.1:11434";
  return new OllamaProvider(model, baseUrl);
}
