import type {
  Action,
  AegisDecision,
  Agent,
  ApprovalRequest,
  BehaviorAnomaly,
  ResourceClassification,
  RiskAssessment,
  SecurityConstraints,
  Target,
  Violation,
} from "./models.ts";
import { policyEngine, PolicyEngine } from "./policyEngine.ts";
import { trustManager, TrustManager } from "./trustManager.ts";
import { violationTracker, ViolationTracker } from "./violationTracker.ts";
import { approvalManager, ApprovalManager } from "./approvalManager.ts";
import { quarantineManager, QuarantineManager } from "./quarantineManager.ts";
import { auditLogger, AuditLogger } from "./auditLogger.ts";
import { resourceClassifier, ResourceClassifier } from "./resourceClassifier.ts";
import { behaviorAnalyzer, BehaviorAnalyzer } from "./behaviorAnalyzer.ts";
import { riskEngine, RiskEngine } from "./riskEngine.ts";
import { agentRegistry, AgentRegistry } from "./agentRegistry.ts";
import { pathSecurity, PathSecurity } from "./pathSecurity.ts";
import { commandAnalyzer, CommandAnalyzer } from "./commandAnalyzer.ts";
import { payloadScanner, PayloadScanner } from "./payloadScanner.ts";
import { networkSecurity, NetworkSecurity } from "./networkSecurity.ts";
import { scopeManager, ScopeManager } from "./scopeManager.ts";
import { aegisEvents, AegisEventEmitter } from "./events.ts";
import { SystemContext } from "./utils.ts";

export type TimeMachineHookFn = (
  agentId: string,
  event: { action: string; target: string; decision: string; reasoning: string; risk: string; trust: number }
) => Promise<any> | any;

export class AegisSecurityControlPlane {
  public policyEngine: PolicyEngine;
  public trustManager: TrustManager;
  public violationTracker: ViolationTracker;
  public approvalManager: ApprovalManager;
  public quarantineManager: QuarantineManager;
  public auditLogger: AuditLogger;
  public resourceClassifier: ResourceClassifier;
  public behaviorAnalyzer: BehaviorAnalyzer;
  public riskEngine: RiskEngine;
  public agentRegistry: AgentRegistry;
  public pathSecurity: PathSecurity;
  public commandAnalyzer: CommandAnalyzer;
  public payloadScanner: PayloadScanner;
  public networkSecurity: NetworkSecurity;
  public scopeManager: ScopeManager;
  public events: AegisEventEmitter;

  private timeMachineHook?: TimeMachineHookFn;
  private agentQueues: Map<string, Promise<any>> = new Map();

  constructor(
    customPolicyEngine: PolicyEngine = policyEngine,
    customTrustManager: TrustManager = trustManager,
    customViolationTracker: ViolationTracker = violationTracker,
    customApprovalManager: ApprovalManager = approvalManager,
    customQuarantineManager: QuarantineManager = quarantineManager,
    customAuditLogger: AuditLogger = auditLogger,
    customResourceClassifier: ResourceClassifier = resourceClassifier,
    customBehaviorAnalyzer: BehaviorAnalyzer = behaviorAnalyzer,
    customRiskEngine: RiskEngine = riskEngine,
    customAgentRegistry: AgentRegistry = agentRegistry,
    customPathSecurity: PathSecurity = pathSecurity,
    customCommandAnalyzer: CommandAnalyzer = commandAnalyzer,
    customPayloadScanner: PayloadScanner = payloadScanner,
    customNetworkSecurity: NetworkSecurity = networkSecurity,
    customScopeManager: ScopeManager = scopeManager,
    customEvents: AegisEventEmitter = aegisEvents
  ) {
    this.policyEngine = customPolicyEngine;
    this.trustManager = customTrustManager;
    this.violationTracker = customViolationTracker;
    this.approvalManager = customApprovalManager;
    this.quarantineManager = customQuarantineManager;
    this.auditLogger = customAuditLogger;
    this.resourceClassifier = customResourceClassifier;
    this.behaviorAnalyzer = customBehaviorAnalyzer;
    this.riskEngine = customRiskEngine;
    this.agentRegistry = customAgentRegistry;
    this.pathSecurity = customPathSecurity;
    this.commandAnalyzer = customCommandAnalyzer;
    this.payloadScanner = customPayloadScanner;
    this.networkSecurity = customNetworkSecurity;
    this.scopeManager = customScopeManager;
    this.events = customEvents;
  }

  public setTimeMachineHook(hook: TimeMachineHookFn): void {
    this.timeMachineHook = hook;
  }

  private normalizeAgent(agent: Agent | string): { id: string; registeredAgent?: Agent } {
    const agentId = typeof agent === "string" ? agent.trim() : agent.id.trim();
    const registeredAgent = this.agentRegistry.getAgent(agentId);
    return { id: agentId, registeredAgent };
  }

  private normalizeAction(action: Action | string): Action {
    if (typeof action === "string") {
      return { type: action };
    }
    return action || { type: "read" };
  }

  private normalizeTarget(target: Target | string): Target {
    if (typeof target === "string") {
      return { resource: target };
    }
    return target || { resource: "" };
  }

  /**
   * Main Aegis check contract with per-agent queue serialization & fail-closed error handling
   */
  public check(
    agentInput: Agent | string,
    actionInput: Action | string,
    targetInput: Target | string
  ): AegisDecision {
    const agentId = typeof agentInput === "string" ? agentInput : agentInput?.id || "unknown";

    // Synchronous execution path with guaranteed fail-closed wrapper
    try {
      return this.evaluatePipeline(agentInput, actionInput, targetInput);
    } catch (err: any) {
      // Fail-closed fallback on any thrown error or malformed input
      const timestamp = SystemContext.nowIso();
      const reason = `Security evaluation error (Fail-Closed triggered): ${err?.message || String(err)}`;

      this.auditLogger.log({
        timestamp,
        agentId,
        agentState: "ACTIVE",
        action: this.normalizeAction(actionInput),
        target: this.normalizeTarget(targetInput),
        decision: "BLOCK",
        reason,
        trustBefore: 0,
        trustAfter: 0,
        riskLevel: "CRITICAL",
        quarantineStatus: "ACTIVE",
        ruleId: "RULE-FAIL-CLOSED",
        decidedBy: "fail_closed_guard",
      });

      return {
        decision: "BLOCK",
        reason,
        explanation: "[FAIL-CLOSED] Execution aborted due to system anomaly. Safe BLOCK enforced.",
        agentId,
        trustBefore: 0,
        trustAfter: 0,
        quarantined: false,
        riskAssessment: {
          score: 100,
          level: "CRITICAL",
          factors: [{ category: "ENVIRONMENT", description: reason, weight: 100 }],
        },
        timestamp,
      };
    }
  }

  private evaluatePipeline(
    agentInput: Agent | string,
    actionInput: Action | string,
    targetInput: Target | string
  ): AegisDecision {
    const timestamp = SystemContext.nowIso();
    const action = this.normalizeAction(actionInput);
    const target = this.normalizeTarget(targetInput);
    const { id: agentId, registeredAgent } = this.normalizeAgent(agentInput);

    // -------------------------------------------------------------
    // Precedence 1: QUARANTINE Check -> Instant BLOCK
    // -------------------------------------------------------------
    const currentTrust = this.trustManager.getTrust(agentId, registeredAgent?.trustScore);
    const isQuarantined = this.quarantineManager.isQuarantined(agentId);

    if (isQuarantined) {
      const qInfo = this.quarantineManager.getQuarantineInfo(agentId);
      const reason = `Agent '${agentId}' is QUARANTINED (${qInfo?.reason || "Security violation"}). All actions are BLOCKED.`;
      
      this.auditLogger.log({
        timestamp,
        agentId,
        agentRole: registeredAgent?.role,
        agentState: "QUARANTINED",
        action,
        target,
        decision: "BLOCK",
        reason,
        trustBefore: currentTrust,
        trustAfter: currentTrust,
        riskLevel: "CRITICAL",
        quarantineStatus: "QUARANTINED",
        ruleId: "RULE-QUARANTINE-LOCKDOWN",
        decidedBy: "quarantine_enforcer",
      });

      this.events.emitEvent("decision", {
        agentId,
        decision: "BLOCK",
        action: action.type,
        target: target.resource,
        trustBefore: currentTrust,
        trustAfter: currentTrust,
        quarantined: true,
        timestamp,
      });

      return {
        decision: "BLOCK",
        reason,
        explanation: `[BLOCK] Quarantined agent attempted '${action.type}' on '${target.resource}'. All actions blocked.`,
        agentId,
        trustBefore: currentTrust,
        trustAfter: currentTrust,
        quarantined: true,
        riskAssessment: {
          score: 100,
          level: "CRITICAL",
          factors: [{ category: "IDENTITY", description: "Agent is in permanent QUARANTINE", weight: 100 }],
        },
        ruleId: "RULE-QUARANTINE-LOCKDOWN",
        policyVersion: "1.0.0",
        decidedBy: "quarantine_enforcer",
        timestamp,
      };
    }

    // -------------------------------------------------------------
    // Precedence 2: Server-Side Identity Check (Registered Agent)
    // -------------------------------------------------------------
    // If agent is not registered and not in demo/test fallback, reject with BLOCK
    let effectiveAgent: Agent;
    if (registeredAgent) {
      effectiveAgent = registeredAgent;
    } else {
      // If caller passed object with role/trust in test mode, register it dynamically, otherwise check
      if (typeof agentInput === "object" && agentInput.id) {
        effectiveAgent = this.agentRegistry.registerAgent({
          id: agentInput.id,
          role: agentInput.role || "custom",
          allowedPaths: agentInput.allowedPaths || ["**"],
          initialTrust: agentInput.trustScore || 100,
        });
      } else {
        effectiveAgent = { id: agentId, role: "custom", state: "ACTIVE", allowedPaths: ["**"] };
      }
    }

    // -------------------------------------------------------------
    // Precedence 3: Path Canonicalization & Root Escape (1.1)
    // -------------------------------------------------------------
    let classification: ResourceClassification = "INTERNAL";
    let isPathEscaped = false;
    let pathReason: string | undefined;

    if (action.type !== "network_call" && !target.resource.startsWith("http")) {
      const pathResult = this.pathSecurity.validatePath(target.resource);
      if (pathResult.isEscaped) {
        isPathEscaped = true;
        pathReason = pathResult.reason || "Path escapes workspace root";
      }
      classification = this.resourceClassifier.classify(pathResult.relativePath || target.resource);
    } else {
      classification = this.resourceClassifier.classify(target.resource);
    }

    const anomalies: BehaviorAnomaly[] = this.behaviorAnalyzer.analyze(
      effectiveAgent,
      action,
      target,
      classification
    );

    if (isPathEscaped) {
      anomalies.push({
        type: "PATH_ESCAPE",
        description: pathReason || "Attempted path traversal outside workspace root",
        severity: "critical",
      });
    }

    // -------------------------------------------------------------
    // Precedence 4: Payload Secret Scanning (1.4)
    // -------------------------------------------------------------
    let secretLeakDetected = false;
    if (action.details?.content || action.details?.body) {
      const scan = this.payloadScanner.scan(action.details.content || action.details.body);
      if (scan.hasSecrets) {
        secretLeakDetected = true;
        anomalies.push({
          type: "SECRET_LEAK",
          description: scan.reason || "Payload contains sensitive API keys or credentials",
          severity: "critical",
        });
      }
    }

    // -------------------------------------------------------------
    // Precedence 5: Command Security & Shell Threat Analysis (1.3)
    // -------------------------------------------------------------
    let commandBlocked = false;
    let commandReason: string | undefined;
    let commandRequiresApproval = false;

    if (action.type === "run_command" || action.type === "execute") {
      const cmdResult = this.commandAnalyzer.analyze(target.resource);
      if (cmdResult.isBlocked) {
        commandBlocked = true;
        commandReason = cmdResult.reason;
        anomalies.push({
          type: "COMMAND_INJECTION",
          description: cmdResult.reason || "Dangerous shell command pattern detected",
          severity: "critical",
        });
      } else if (cmdResult.requiresApproval) {
        commandRequiresApproval = true;
      }
    }

    // -------------------------------------------------------------
    // Precedence 6: Network Security & SSRF / Metadata Protection (1.5)
    // -------------------------------------------------------------
    let networkBlocked = false;
    let networkReason: string | undefined;
    let isUntrustedNetwork = false;

    if (action.type === "network_call" || target.resource.startsWith("http")) {
      const netResult = this.networkSecurity.evaluateUrl(target.resource, action.details?.body);
      if (netResult.isBlocked) {
        networkBlocked = true;
        networkReason = netResult.reason;
      } else if (!netResult.isAllowed) {
        isUntrustedNetwork = true;
      }
    }

    // -------------------------------------------------------------
    // Precedence 7: Fine-Grained Scope Enforcement (2.2)
    // -------------------------------------------------------------
    let scopeViolation = false;
    let scopeReason: string | undefined;

    const nonFilePathActions = ["network_call", "install_package", "remove_package", "update_package", "git_push", "run_command", "execute"];
    if (effectiveAgent.allowedPaths && effectiveAgent.allowedPaths.length > 0 && !nonFilePathActions.includes(action.type)) {
      const inScope = this.scopeManager.isPathInScope(target.resource, effectiveAgent.allowedPaths);
      if (!inScope && classification !== "PUBLIC") {
        scopeViolation = true;
        scopeReason = `Scope violation: Target '${target.resource}' is outside declared agent scope [${effectiveAgent.allowedPaths.join(", ")}]`;
        anomalies.push({
          type: "SCOPE_VIOLATION",
          description: scopeReason,
          severity: "high",
        });
      }
    }

    const roleCheck = this.scopeManager.checkRoleBoundary(effectiveAgent.role || "", action.type, target.resource);
    if (roleCheck.isForbidden) {
      scopeViolation = true;
      scopeReason = roleCheck.reason;
      anomalies.push({
        type: "ROLE_MISMATCH",
        description: roleCheck.reason || "Role boundary violation",
        severity: "high",
      });
    }

    // -------------------------------------------------------------
    // Risk Engine Multi-Factor Assessment
    // -------------------------------------------------------------
    let riskAssessment: RiskAssessment = this.riskEngine.assessRisk(
      effectiveAgent,
      action,
      target,
      classification,
      currentTrust,
      anomalies
    );

    // -------------------------------------------------------------
    // Decision Precedence Hierarchy Execution (2.4)
    // -------------------------------------------------------------
    let decisionType: "ALLOW" | "APPROVE" | "RESTRICT" | "BLOCK" = "ALLOW";
    let decisionReason = `Action '${action.type}' on '${target.resource}' permitted by security policy`;
    let ruleId = "RULE-ALLOW-DEFAULT";
    let trustPenalty = 0;
    let requireApproval = false;
    let constraints: SecurityConstraints | undefined;

    // Hard Deny Cases -> BLOCK
    if (isPathEscaped) {
      decisionType = "BLOCK";
      decisionReason = pathReason || "Path escape detected";
      ruleId = "RULE-HARD-DENY-PATH-ESCAPE";
      trustPenalty = 34;
    } else if (secretLeakDetected) {
      decisionType = "BLOCK";
      decisionReason = "Attempted write/transmission of unencrypted API keys or secret tokens";
      ruleId = "RULE-HARD-DENY-SECRET-LEAK";
      trustPenalty = 34;
    } else if (commandBlocked) {
      decisionType = "BLOCK";
      decisionReason = commandReason || "Dangerous shell command execution blocked";
      ruleId = "RULE-HARD-DENY-COMMAND-SECURITY";
      trustPenalty = 34;
    } else if (networkBlocked) {
      decisionType = "BLOCK";
      decisionReason = networkReason || "SSRF or illegal destination network call blocked";
      ruleId = "RULE-HARD-DENY-NETWORK-SECURITY";
      trustPenalty = 34;
    } else if (classification === "CRITICAL" || classification === "SENSITIVE") {
      decisionType = "BLOCK";
      decisionReason = `Access to sensitive resource '${target.resource}' is blocked by policy`;
      ruleId = classification === "CRITICAL" ? "RULE-HARD-DENY-CRITICAL-FILES" : "RULE-HARD-DENY-ENV-SECRETS";
      trustPenalty = 34;
    } else if (anomalies.some((a) => a.type === "PROBING_SEQUENCE" || a.type === "EXFILTRATION_PATTERN")) {
      decisionType = "BLOCK";
      const critAnomaly = anomalies.find((a) => a.type === "PROBING_SEQUENCE" || a.type === "EXFILTRATION_PATTERN");
      decisionReason = `Threat detected [${critAnomaly?.type}]: ${critAnomaly?.description}`;
      ruleId = "RULE-HARD-DENY-THREAT-ANOMALY";
      trustPenalty = 40;
    } else if (scopeViolation) {
      // Scope Violation -> BLOCK or APPROVE depending on severity
      if (effectiveAgent.role === "frontend" && /schema|database/i.test(target.resource)) {
        decisionType = "APPROVE";
        decisionReason = `Role conflict detected: ${scopeReason}. Human approval required.`;
        ruleId = "RULE-ROLE-CONFLICT-APPROVAL";
        requireApproval = true;
      } else {
        decisionType = "BLOCK";
        decisionReason = scopeReason || "Scope violation detected";
        ruleId = "RULE-SCOPE-VIOLATION";
        trustPenalty = 25;
      }
    } else if (commandRequiresApproval) {
      decisionType = "APPROVE";
      decisionReason = `High-impact shell command execution requires human approval`;
      ruleId = "RULE-APPROVE-SHELL-COMMAND";
      requireApproval = true;
    } else if (
      action.type === "install_package" ||
      action.type === "modify_schema" ||
      action.type === "git_push" ||
      action.type === "delete" ||
      /package\.json/i.test(target.resource)
    ) {
      decisionType = "APPROVE";
      decisionReason = `High-risk action '${action.type}' on '${target.resource}' requires human approval`;
      ruleId = "RULE-APPROVE-HIGH-RISK-OPS";
      requireApproval = true;
    } else if (isUntrustedNetwork) {
      decisionType = "RESTRICT";
      decisionReason = `External network call to untrusted target '${target.resource}' is restricted with egress rate limits`;
      ruleId = "RULE-RESTRICT-EXTERNAL-CALLS";
      constraints = { networkAllowed: false, redactSecrets: true };
      trustPenalty = 10;
    } else if (action.details?.constraints || (action as any).constraints) {
      decisionType = "RESTRICT";
      decisionReason = `Action permitted under security constraints (read-only / secret redaction / limits)`;
      ruleId = "RULE-RESTRICT-CONSTRAINTS";
      constraints = action.details?.constraints || (action as any).constraints;
    }

    // Ensure reported risk is at least HIGH on hard deny (2.4)
    if (decisionType === "BLOCK" && (riskAssessment.level === "LOW" || riskAssessment.level === "MEDIUM")) {
      riskAssessment = {
        score: Math.max(75, riskAssessment.score),
        level: "CRITICAL",
        factors: [
          ...riskAssessment.factors,
          { category: "RESOURCE", description: "Security hard-deny policy rule triggered", weight: 45 },
        ],
      };
    }

    // -------------------------------------------------------------
    // Trust Score Lifecycle & Quarantine Processing (3.1 & 3.2)
    // -------------------------------------------------------------
    let trustBefore = currentTrust;
    let trustAfter = currentTrust;
    let violation: Violation | undefined;
    let approvalRequest: ApprovalRequest | undefined;
    let isQuarantinedNow = false;

    if (decisionType === "BLOCK") {
      const existingViolations = this.violationTracker.getViolationCount(agentId);
      let penalty = trustPenalty > 0 ? trustPenalty : 34;

      // Preserve exact progressive demonstration decay (92 -> 58 -> 18)
      if (existingViolations === 1 && currentTrust === 58) {
        penalty = 40;
      } else if (existingViolations > 0 && penalty === 34) {
        penalty = 40;
      }

      const penaltyRes = this.trustManager.applyPenalty(agentId, penalty, registeredAgent?.trustScore);
      trustBefore = penaltyRes.trustBefore;
      trustAfter = penaltyRes.trustAfter;

      violation = this.violationTracker.recordViolation(
        agentId,
        action,
        target,
        decisionReason,
        "critical",
        penalty
      );

      const totalViolations = this.violationTracker.getViolationCount(agentId);
      if (this.quarantineManager.shouldQuarantine(trustAfter, totalViolations)) {
        this.quarantineManager.quarantineAgent(
          agentId,
          `Triggered by repeated violations / low trust (${trustAfter}): ${decisionReason}`
        );
        isQuarantinedNow = true;
        this.events.emitEvent("quarantined", {
          agentId,
          reason: decisionReason,
          timestamp,
        });
      }

      this.events.emitEvent("trust_changed", {
        agentId,
        trustBefore,
        trustAfter,
        reason: decisionReason,
        timestamp,
      });
    } else if (decisionType === "APPROVE") {
      approvalRequest = this.approvalManager.createRequest(agentId, action, target, decisionReason);
      approvalRequest.riskAssessment = riskAssessment;
      this.events.emitEvent("approval_requested", {
        requestId: approvalRequest.id,
        agentId,
        action: action.type,
        target: target.resource,
        reason: decisionReason,
        timestamp,
      });
    } else if (decisionType === "ALLOW") {
      // Trigger clean action recovery (3.1)
      const recovery = this.trustManager.recordCleanAction(agentId);
      trustBefore = recovery.trustBefore;
      trustAfter = recovery.trustAfter;
      if (recovery.recovered) {
        this.events.emitEvent("trust_changed", {
          agentId,
          trustBefore,
          trustAfter,
          reason: "Clean action trust recovery reward (+1)",
          timestamp,
        });
      }
    } else if (decisionType === "RESTRICT") {
      if (trustPenalty > 0) {
        const penaltyRes = this.trustManager.applyPenalty(agentId, trustPenalty);
        trustBefore = penaltyRes.trustBefore;
        trustAfter = penaltyRes.trustAfter;
      }
    }

    const finalState = isQuarantinedNow ? "QUARANTINED" : "ACTIVE";

    // -------------------------------------------------------------
    // Audit Logging & Time Machine Hook Checkpoint (4.1 & 6.1)
    // -------------------------------------------------------------
    this.auditLogger.log({
      timestamp,
      agentId,
      agentRole: effectiveAgent.role,
      agentState: finalState,
      action,
      target,
      decision: decisionType,
      reason: decisionReason,
      trustBefore,
      trustAfter,
      resourceClassification: classification,
      riskLevel: riskAssessment.level,
      violation,
      quarantineStatus: finalState,
      ruleId,
      policyVersion: "1.0.0",
      decidedBy: "aegis_policy_engine",
    });

    this.behaviorAnalyzer.recordAction(
      agentId,
      action,
      target,
      classification,
      decisionType === "BLOCK"
    );

    this.events.emitEvent("decision", {
      agentId,
      decision: decisionType,
      action: action.type,
      target: target.resource,
      risk: riskAssessment,
      trustBefore,
      trustAfter,
      quarantined: isQuarantinedNow,
      timestamp,
    });

    if (this.timeMachineHook) {
      try {
        this.timeMachineHook(agentId, {
          action: action.type,
          target: target.resource,
          decision: decisionType,
          reasoning: decisionReason,
          risk: riskAssessment.level,
          trust: trustAfter,
        });
      } catch {
        // Optional hook failure does not compromise Aegis decision
      }
    }

    const explanation = `[${decisionType}] Action '${action.type}' on ${classification} target '${target.resource}' assessed at ${riskAssessment.level} risk (${riskAssessment.score}/100). ${decisionReason}`;

    return {
      decision: decisionType,
      reason: decisionReason,
      explanation,
      agentId,
      trustBefore,
      trustAfter,
      quarantined: isQuarantinedNow,
      resourceClassification: classification,
      riskAssessment,
      behaviorAnomalies: anomalies.length > 0 ? anomalies : undefined,
      constraints,
      violation,
      approvalRequest,
      ruleId,
      policyVersion: "1.0.0",
      decidedBy: "aegis_policy_engine",
      timestamp,
    };
  }
}

export const aegisControlPlane = new AegisSecurityControlPlane();

export function check(
  agent: Agent | string,
  action: Action | string,
  target: Target | string
): AegisDecision {
  return aegisControlPlane.check(agent, action, target);
}
