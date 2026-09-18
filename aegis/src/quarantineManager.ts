import type {
  AgentState,
  AuditRecord,
  BehaviorAnomaly,
  ResourceClassification,
  Violation,
} from "./models.ts";
import { SystemContext } from "./utils.ts";
import { trustManager } from "./trustManager.ts";

export interface QuarantineRecord {
  agentId: string;
  quarantinedAt: string;
  reason: string;
  releasedAt?: string;
  releasedBy?: string;
  releaseReason?: string;
}

export interface ResourceAccessSummary {
  granted: { resource: string; action: string; timestamp: string }[];
  attemptedAndBlocked: { resource: string; action: string; reason: string; timestamp: string }[];
}

export interface InvestigationReport {
  agentId: string;
  status: AgentState;
  currentTrust?: number;
  quarantineReason?: string;
  quarantinedAt?: string;
  totalViolations: number;
  violations: Violation[];
  recentAuditLogs: AuditRecord[];
  resourcesAccessed: string[];
  resources: ResourceAccessSummary;
  decisionTimeline: {
    seq?: number;
    timestamp: string;
    action: string;
    target: string;
    decision: string;
    ruleId?: string;
    trustChange: string;
  }[];
  trustTrajectory: { timestamp: string; score: number }[];
  gitWorktreeStatus?: {
    branch?: string;
    headCommit?: string;
    checkpointCount?: number;
  };
  anomaliesDetected?: BehaviorAnomaly[];
  summary: string;
  recommendedAction: string;
  generatedAt: string;
}

export class QuarantineManager {
  private agentStates: Map<string, AgentState> = new Map();
  private quarantineHistory: Map<string, QuarantineRecord> = new Map();
  private quarantineThresholdTrust: number = 20;

  constructor(thresholdTrust: number = 20) {
    this.quarantineThresholdTrust = thresholdTrust;
  }

  public getAgentState(agentId: string): AgentState {
    return this.agentStates.get(agentId) || "ACTIVE";
  }

  public isQuarantined(agentId: string): boolean {
    return this.getAgentState(agentId) === "QUARANTINED";
  }

  public shouldQuarantine(trustScore: number, violationCount: number): boolean {
    return trustScore <= this.quarantineThresholdTrust || violationCount >= 2;
  }

  public quarantineAgent(agentId: string, reason: string): QuarantineRecord {
    this.agentStates.set(agentId, "QUARANTINED");
    const record: QuarantineRecord = {
      agentId,
      quarantinedAt: SystemContext.nowIso(),
      reason,
    };
    this.quarantineHistory.set(agentId, record);
    return record;
  }

  /**
   * Release an agent from quarantine by an administrator, placing them on probation
   */
  public releaseFromQuarantine(
    agentId: string,
    adminId: string,
    reason: string,
    probationTrust: number = 50
  ): QuarantineRecord {
    if (!this.isQuarantined(agentId)) {
      throw new Error(`Cannot release agent '${agentId}': Agent is not currently quarantined`);
    }

    this.agentStates.set(agentId, "ACTIVE");
    trustManager.setTrust(agentId, probationTrust);
    trustManager.setProbation(agentId, true);

    const record = this.quarantineHistory.get(agentId) || {
      agentId,
      quarantinedAt: SystemContext.nowIso(),
      reason: "Quarantined by policy",
    };

    record.releasedAt = SystemContext.nowIso();
    record.releasedBy = adminId;
    record.releaseReason = reason;

    this.quarantineHistory.set(agentId, record);
    return record;
  }

  public getQuarantineInfo(agentId: string): QuarantineRecord | undefined {
    return this.quarantineHistory.get(agentId);
  }

  public generateInvestigationReport(
    agentId: string,
    auditLogs: AuditRecord[] = [],
    violations: Violation[] = [],
    currentTrust?: number,
    anomalies: BehaviorAnomaly[] = [],
    gitWorktreeStatus?: { branch?: string; headCommit?: string; checkpointCount?: number }
  ): InvestigationReport {
    const status = this.getAgentState(agentId);
    const qInfo = this.quarantineHistory.get(agentId);
    const agentViolations = violations.filter((v) => v.agentId === agentId);
    const agentLogs = auditLogs.filter((l) => l.agentId === agentId);

    const granted: { resource: string; action: string; timestamp: string }[] = [];
    const attemptedAndBlocked: { resource: string; action: string; reason: string; timestamp: string }[] = [];
    const decisionTimeline: InvestigationReport["decisionTimeline"] = [];
    const trustTrajectory: { timestamp: string; score: number }[] = [];

    for (const log of agentLogs) {
      if (log.decision === "ALLOW" || log.decision === "RESTRICT") {
        granted.push({
          resource: log.target.resource,
          action: log.action.type,
          timestamp: log.timestamp,
        });
      } else if (log.decision === "BLOCK") {
        attemptedAndBlocked.push({
          resource: log.target.resource,
          action: log.action.type,
          reason: log.reason,
          timestamp: log.timestamp,
        });
      }

      decisionTimeline.push({
        seq: (log as any).seq,
        timestamp: log.timestamp,
        action: log.action.type,
        target: log.target.resource,
        decision: log.decision,
        ruleId: (log as any).ruleId,
        trustChange: `${log.trustBefore} -> ${log.trustAfter}`,
      });

      trustTrajectory.push({
        timestamp: log.timestamp,
        score: log.trustAfter,
      });
    }

    const summary =
      status === "QUARANTINED"
        ? `Agent '${agentId}' is in QUARANTINED containment. Root cause: ${qInfo?.reason || "Repeated security violations"}. It accumulated ${agentViolations.length} violations across ${agentLogs.length} total operations.`
        : `Agent '${agentId}' is ${status} with trust score ${currentTrust ?? 100} and ${agentViolations.length} recorded violations.`;

    const recommendedAction =
      status === "QUARANTINED"
        ? "Call releaseFromQuarantine(agentId, adminId, reason) after investigating git worktree diffs and resolving threat."
        : "No administrative containment required at this time.";

    return {
      agentId,
      status,
      currentTrust: currentTrust ?? trustManager.getTrust(agentId),
      quarantineReason: qInfo?.reason,
      quarantinedAt: qInfo?.quarantinedAt,
      totalViolations: agentViolations.length,
      violations: agentViolations,
      recentAuditLogs: agentLogs,
      resourcesAccessed: Array.from(new Set(agentLogs.map((l) => l.target.resource))),
      resources: {
        granted,
        attemptedAndBlocked,
      },
      decisionTimeline,
      trustTrajectory,
      gitWorktreeStatus,
      anomaliesDetected: anomalies,
      summary,
      recommendedAction,
      generatedAt: SystemContext.nowIso(),
    };
  }

  public clearAll(): void {
    this.agentStates.clear();
    this.quarantineHistory.clear();
  }
}

export const quarantineManager = new QuarantineManager();
