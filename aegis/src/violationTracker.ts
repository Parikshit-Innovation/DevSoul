import type { Action, SeverityLevel, Target, Violation } from "./models.ts";

export class ViolationTracker {
  private violations: Map<string, Violation[]> = new Map();

  public recordViolation(
    agentId: string,
    action: Action,
    target: Target,
    reason: string,
    severity: SeverityLevel = "high",
    trustPenalty: number = 34
  ): Violation {
    const violation: Violation = {
      id: `violation-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      agentId,
      action,
      target,
      reason,
      severity,
      trustPenalty,
      timestamp: new Date().toISOString(),
    };

    if (!this.violations.has(agentId)) {
      this.violations.set(agentId, []);
    }
    this.violations.get(agentId)!.push(violation);

    return violation;
  }

  public getViolations(agentId: string): Violation[] {
    return this.violations.get(agentId) || [];
  }

  public getViolationCount(agentId: string): number {
    return (this.violations.get(agentId) || []).length;
  }

  public getCriticalViolationCount(agentId: string): number {
    const list = this.violations.get(agentId) || [];
    return list.filter((v) => v.severity === "critical" || v.severity === "high").length;
  }

  public clearViolations(agentId?: string): void {
    if (agentId) {
      this.violations.delete(agentId);
    } else {
      this.violations.clear();
    }
  }
}

export const violationTracker = new ViolationTracker();
