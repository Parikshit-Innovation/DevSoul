/**
 * DevSoul Agent Factory — LLM Provider Interface
 * An abstraction so the Planner backend can be swapped without rewriting the Factory.
 */

export interface LLMProviderConfig {
  provider: string;
  model: string;
  apiKey?: string;
  baseUrl?: string;
}

export interface LLMRequest {
  systemPrompt: string;
  userPrompt: string;
  /** Maximum tokens for the response */
  maxTokens: number;
  /** Response MIME type hint */
  responseMimeType?: string;
}

export interface LLMResponse {
  text: string;
  tokensUsed?: number;
}

export interface LLMProvider {
  readonly providerName: string;
  readonly modelName: string;

  /**
   * Send a single prompt to the LLM and return its text response.
   * Implementors must NOT retry on failure.
   */
  complete(request: LLMRequest): Promise<LLMResponse>;
}
