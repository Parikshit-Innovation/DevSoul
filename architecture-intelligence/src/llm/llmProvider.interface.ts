export interface LlmProvider {
  name: string;

  /**
   * Given the full requirements context, a question key, and the question
   * prompt, return exactly one technology name (or a short comma-separated
   * list when the question calls for multiple choices).
   */
  chooseTechStack(
    requirements: any,
    key: string,
    prompt: string
  ): Promise<string>;

  /**
   * Given a comma-separated list of technologies the user proposed plus the
   * full requirements context, return an analysis / recommendation as plain text.
   */
  analyzeStack(
    requirements: any,
    key: string,
    proposed: string[]
  ): Promise<string>;

  /**
   * Free-form generation: send a prompt and return the model's raw text response.
   * Used by architectureSummaryHelper for structured JSON generation.
   */
  generate(prompt: string): Promise<string>;
}
