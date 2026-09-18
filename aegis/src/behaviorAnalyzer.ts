import type { Action, Agent, BehaviorAnomaly, ResourceClassification, Target } from "./models.ts";

export interface AgentActionHistoryItem {
  action: Action;
  target: Target;
  classification: ResourceClassification;
  timestamp: number;
  wasBlocked: boolean;
}

export class BehaviorAnalyzer {
  private history: Map<string, AgentActionHistoryItem[]> = new Map();
  private maxHistoryPerAgent: number = 20;

  public recordAction(
    agentId: string,
    action: Action,
    target: Target,
    classification: ResourceClassification,
    wasBlocked: boolean = false
  ): void {
    if (!this.history.has(agentId)) {
      this.history.set(agentId, []);
    }
    const agentHistory = this.history.get(agentId)!;
    agentHistory.push({
      action,
      target,
      classification,
      timestamp: Date.now(),
      wasBlocked,
    });

    if (agentHistory.length > this.maxHistoryPerAgent) {
      agentHistory.shift();
    }
  }

  public analyze(
    agent: Agent,
    currentAction: Action,
    currentTarget: Target,
    currentClassification: ResourceClassification
  ): BehaviorAnomaly[] {
    const anomalies: BehaviorAnomaly[] = [];
    const agentHistory = this.history.get(agent.id) || [];
    const role = (agent.role || "").toLowerCase();
    const actionType = (currentAction.type || "read").toLowerCase();
    const targetResource = currentTarget.resource.toLowerCase();

    // 1. Role Mismatch Analysis
    if (role === "frontend" || agent.id.includes("frontend")) {
      const isDbTarget = /database|schema|\.sql|prisma|migrations/i.test(targetResource);
      const isBackendAction = /modify_schema|modify_database|drop_table|migrate/i.test(actionType);
      if (isDbTarget || isBackendAction) {
        anomalies.push({
          type: "ROLE_MISMATCH",
          description: `Frontend role '${agent.role || "frontend"}' attempting database/schema modification on '${currentTarget.resource}'`,
          severity: "high",
        });
      }
    } else if (role === "reviewer" || role === "tester") {
      if (actionType === "delete" || actionType === "modify_schema" || actionType === "git_push") {
        anomalies.push({
          type: "ROLE_MISMATCH",
          description: `Read-only role '${role}' attempting mutating action '${actionType}' on '${currentTarget.resource}'`,
          severity: "high",
        });
      }
    }

    // 2. Sequential Probing / Reconnaissance Detection
    const recentSensitiveAttempts = agentHistory.filter(
      (h) => h.classification === "SENSITIVE" || h.classification === "CRITICAL"
    );
    if (
      (currentClassification === "SENSITIVE" || currentClassification === "CRITICAL") &&
      recentSensitiveAttempts.length >= 1
    ) {
      anomalies.push({
        type: "PROBING_SEQUENCE",
        description: `Sequential probing detected: Agent has attempted access to multiple sensitive resources in sequence (${recentSensitiveAttempts.length + 1} attempts)`,
        severity: "critical",
      });
    }

    // 3. Potential Exfiltration Pattern (Reading sensitive resource followed by network export/send)
    const hasReadSensitiveRecently = agentHistory.some(
      (h) => (h.classification === "SENSITIVE" || h.classification === "CRITICAL") && h.action.type === "read"
    );
    const isNetworkOrExport =
      actionType === "network_call" ||
      actionType === "send" ||
      actionType === "export" ||
      targetResource.startsWith("http");

    if (hasReadSensitiveRecently && isNetworkOrExport) {
      anomalies.push({
        type: "EXFILTRATION_PATTERN",
        description: `Potential data exfiltration pattern: Attempting external network/export call after reading sensitive resource`,
        severity: "critical",
      });
    }

    // 4. Repeated Violations Velocity
    const recentBlockedCount = agentHistory.filter((h) => h.wasBlocked).length;
    if (recentBlockedCount >= 2) {
      anomalies.push({
        type: "REPEAT_VIOLATIONS",
        description: `High violation velocity: Agent has accumulated ${recentBlockedCount} blocked operations in recent window`,
        severity: "critical",
      });
    }

    return anomalies;
  }

  public getHistory(agentId: string): AgentActionHistoryItem[] {
    return this.history.get(agentId) || [];
  }

  public clearAll(agentId?: string): void {
    if (agentId) {
      this.history.delete(agentId);
    } else {
      this.history.clear();
    }
  }
}

export const behaviorAnalyzer = new BehaviorAnalyzer();
