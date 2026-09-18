import type { LLMProvider, LLMRequest, LLMResponse } from "./provider.interface.js";

export class FallbackProvider implements LLMProvider {
  public readonly providerName = "fallback";
  public readonly modelName: string;

  private primary: LLMProvider;
  private fallback: LLMProvider;
  public circuitBroken = false;

  constructor(primary: LLMProvider, fallback: LLMProvider) {
    this.primary = primary;
    this.fallback = fallback;
    this.modelName = `${primary.modelName} (fallback: ${fallback.modelName})`;
  }

  async complete(request: LLMRequest): Promise<LLMResponse> {
    if (this.circuitBroken) {
      return await this.fallback.complete(request);
    }

    try {
      return await this.primary.complete(request);
    } catch (err: any) {
      const errMsg = err.message || "";
      if (errMsg.includes("429") || errMsg.includes("503") || errMsg.includes("Too Many Requests")) {
        this.circuitBroken = true;
        console.warn(`\n  ⚠  LLM overloaded (${errMsg}). Breaking circuit and permanently falling back to ${this.fallback.providerName}...`);
        return await this.fallback.complete(request);
      }
      throw err;
    }
  }
}
