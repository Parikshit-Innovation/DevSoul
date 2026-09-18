export class TrustManager {
  private trustScores: Map<string, number> = new Map();
  private defaultInitialScore: number = 100;
  private probationAgents: Set<string> = new Set();
  private cleanActionStreak: Map<string, number> = new Map();

  constructor(defaultScore: number = 100) {
    this.defaultInitialScore = defaultScore;
  }

  public getTrust(agentId: string, initialScore?: number): number {
    if (!this.trustScores.has(agentId)) {
      const init = initialScore !== undefined ? initialScore : this.defaultInitialScore;
      this.trustScores.set(agentId, init);
    }
    return this.trustScores.get(agentId)!;
  }

  public setTrust(agentId: string, score: number): void {
    const clamped = Math.max(0, Math.min(100, score));
    this.trustScores.set(agentId, clamped);
  }

  public setProbation(agentId: string, isProbation: boolean): void {
    if (isProbation) {
      this.probationAgents.add(agentId);
    } else {
      this.probationAgents.delete(agentId);
    }
  }

  public isProbation(agentId: string): boolean {
    return this.probationAgents.has(agentId);
  }

  public applyPenalty(
    agentId: string,
    penalty: number,
    initialIfNew?: number
  ): { trustBefore: number; trustAfter: number } {
    const trustBefore = this.getTrust(agentId, initialIfNew);
    const trustAfter = Math.max(0, trustBefore - penalty);
    this.setTrust(agentId, trustAfter);
    this.cleanActionStreak.set(agentId, 0);
    return { trustBefore, trustAfter };
  }

  /**
   * Slow, capped recovery for clean allowed actions (+1 every 3 clean actions, up to 100, disabled during probation)
   */
  public recordCleanAction(agentId: string): { trustBefore: number; trustAfter: number; recovered: boolean } {
    const trustBefore = this.getTrust(agentId);

    // No recovery if in probation or already at 100
    if (this.isProbation(agentId) || trustBefore >= 100) {
      return { trustBefore, trustAfter: trustBefore, recovered: false };
    }

    const currentStreak = (this.cleanActionStreak.get(agentId) || 0) + 1;
    this.cleanActionStreak.set(agentId, currentStreak);

    if (currentStreak >= 3) {
      const trustAfter = Math.min(100, trustBefore + 1);
      this.setTrust(agentId, trustAfter);
      this.cleanActionStreak.set(agentId, 0);
      return { trustBefore, trustAfter, recovered: trustAfter > trustBefore };
    }

    return { trustBefore, trustAfter: trustBefore, recovered: false };
  }

  public resetTrust(agentId: string, score?: number): void {
    const s = score !== undefined ? score : this.defaultInitialScore;
    this.setTrust(agentId, s);
    this.cleanActionStreak.set(agentId, 0);
    this.probationAgents.delete(agentId);
  }

  public clearAll(): void {
    this.trustScores.clear();
    this.probationAgents.clear();
    this.cleanActionStreak.clear();
  }
}

export const trustManager = new TrustManager();
