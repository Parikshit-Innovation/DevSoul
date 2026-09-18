/**
 * DevSoul Agent Factory — Google Gemini LLM Adapter
 * Implements the LLMProvider interface using the @google/generative-ai SDK.
 * API key is read from the environment — never hardcoded.
 */

import { GoogleGenerativeAI } from "@google/generative-ai";
import type { LLMProvider, LLMRequest, LLMResponse } from "./provider.interface.js";

export class GeminiProvider implements LLMProvider {
  public readonly providerName = "google";
  public readonly modelName: string;

  private readonly client: GoogleGenerativeAI;

  constructor(apiKey: string, model = "gemini-1.5-flash") {
    if (!apiKey || apiKey.trim().length === 0) {
      throw new Error(
        "GeminiProvider: GEMINI_API_KEY is not set. " +
          "Add GEMINI_API_KEY=<your-key> to your .env file."
      );
    }
    this.client = new GoogleGenerativeAI(apiKey);
    this.modelName = model;
  }

  async complete(request: LLMRequest): Promise<LLMResponse> {
    const generationConfig: Record<string, unknown> = {
      maxOutputTokens: request.maxTokens,
    };

    // Request JSON output when the MIME type is application/json
    if (request.responseMimeType === "application/json") {
      generationConfig["responseMimeType"] = "application/json";
    }

    const model = this.client.getGenerativeModel({
      model: this.modelName,
      systemInstruction: request.systemPrompt,
      generationConfig,
    });

    const result = await model.generateContent(request.userPrompt);
    const response = result.response;
    const text = response.text();

    return {
      text,
      tokensUsed: response.usageMetadata?.totalTokenCount,
    };
  }
}

/**
 * Factory function — creates a GeminiProvider from environment variables.
 * Returns null if GEMINI_API_KEY is not configured (allows callers to degrade gracefully).
 */
export function createGeminiProviderFromEnv(): GeminiProvider | null {
  const apiKey = process.env["GEMINI_API_KEY"];
  if (!apiKey) {
    return null;
  }
  const model = process.env["GEMINI_MODEL"] ?? "gemini-1.5-flash";
  return new GeminiProvider(apiKey, model);
}
