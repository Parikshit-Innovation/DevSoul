import type {
  Action,
  Agent,
  BehaviorAnomaly,
  DecisionType,
  PolicyRule,
  ResourceClassification,
  RiskAssessment,
  SeverityLevel,
  Target,
} from "./models.ts";
import { resourceClassifier, ResourceClassifier } from "./resourceClassifier.ts";

export interface PolicyEvaluationResult {
  decision: DecisionType;
  reason: string;
  severity: SeverityLevel;
  trustPenalty: number;
  requireHumanApproval: boolean;
  resourceClassification: ResourceClassification;
}

export class PolicyEngine {
  private customPolicies: PolicyRule[] = [];
  public classifier: ResourceClassifier = resourceClassifier;

  // High-risk actions requiring human approval
  private approvalRequiredActions: string[] = [
    "install_package",
    "install package",
    "remove_package",
    "update_package",
    "modify_schema",
    "modify database schema",
    "database schema",
    "schema migration",
    "git_push",
    "git push",
    "deploy",
    "drop_table",
  ];

  // Sensitive targets requiring human approval
  private approvalRequiredTargets: RegExp[] = [
    /package\.json$/i,
    /schema(\.prisma|\.sql|\.yaml|\.json)?$/i,
    /database[_-]?schema/i,
  ];

  public addPolicy(policy: PolicyRule): void {
    this.customPolicies.push(policy);
  }

  public clearCustomPolicies(): void {
    this.customPolicies = [];
  }

  public isSensitiveFile(resource: string): boolean {
    const classification = this.classifier.classify(resource);
    return classification === "SENSITIVE" || classification === "CRITICAL";
  }

  private isApprovalRequired(actionType: string, targetResource: string): boolean {
    const normAction = actionType.toLowerCase().trim();
    const normTarget = targetResource.toLowerCase().trim();

    if (this.approvalRequiredActions.includes(normAction)) {
      return true;
    }

    if (this.approvalRequiredTargets.some((pattern) => pattern.test(normTarget))) {
      if (
        normAction === "write" ||
        normAction === "modify" ||
        normAction === "delete" ||
        normAction.includes("modify")
      ) {
        return true;
      }
    }

    return false;
  }

  public evaluate(
    agent: Agent,
    action: Action,
    target: Target,
    riskAssessment?: RiskAssessment,
    anomalies: BehaviorAnomaly[] = []
  ): PolicyEvaluationResult {
    const resource = target.resource || "";
    const actionType = action.type || "read";
    const classification = this.classifier.classify(resource);

    // 1. Check custom policies first
    for (const policy of this.customPolicies) {
      const matchPattern =
        typeof policy.resourcePattern === "string"
          ? resource.includes(policy.resourcePattern)
          : policy.resourcePattern.test(resource);

      const matchAction =
        !policy.actions || policy.actions.length === 0 || policy.actions.includes(actionType);

      const matchRole =
        !policy.roles || !agent.role || policy.roles.includes(agent.role);

      if (matchPattern && matchAction && matchRole) {
        let decision: DecisionType = "ALLOW";
        if (policy.effect === "deny") decision = "BLOCK";
        else if (policy.effect === "approve") decision = "APPROVE";
        else if (policy.effect === "restrict") decision = "RESTRICT";

        return {
          decision,
          reason:
            policy.description ||
            `Policy rule '${policy.name}' matched with effect ${policy.effect.toUpperCase()}`,
          severity: policy.severity || (decision === "BLOCK" ? "high" : "low"),
          trustPenalty: policy.trustPenalty ?? (decision === "BLOCK" ? 34 : 0),
          requireHumanApproval: policy.requireHumanApproval ?? (decision === "APPROVE"),
          resourceClassification: classification,
        };
      }
    }

    // 2. Critical Exfiltration / Probing Sequence Detection -> BLOCK immediately
    const criticalAnomaly = anomalies.find(
      (a) => a.type === "EXFILTRATION_PATTERN" || a.type === "PROBING_SEQUENCE"
    );
    if (criticalAnomaly) {
      return {
        decision: "BLOCK",
        reason: `Threat detected [${criticalAnomaly.type}]: ${criticalAnomaly.description}`,
        severity: "critical",
        trustPenalty: 40,
        requireHumanApproval: false,
        resourceClassification: classification,
      };
    }

    // 3. Sensitive / Critical File Protection -> BLOCK
    if (classification === "CRITICAL" || classification === "SENSITIVE") {
      return {
        decision: "BLOCK",
        reason: `Access to sensitive resource '${resource}' is blocked by policy`,
        severity: "critical",
        trustPenalty: 34,
        requireHumanApproval: false,
        resourceClassification: classification,
      };
    }

    // 4. Role Mismatch / Scope Violation -> APPROVE or RESTRICT
    const roleMismatch = anomalies.find((a) => a.type === "ROLE_MISMATCH");
    if (roleMismatch) {
      return {
        decision: "APPROVE",
        reason: `Role conflict detected: ${roleMismatch.description}. Human approval required.`,
        severity: "high",
        trustPenalty: 0,
        requireHumanApproval: true,
        resourceClassification: classification,
      };
    }

    // 5. High-Risk Action Check -> APPROVE (Human Approval Required)
    if (this.isApprovalRequired(actionType, resource) || riskAssessment?.level === "HIGH") {
      return {
        decision: "APPROVE",
        reason: `High-risk action '${actionType}' on '${resource}' requires human approval`,
        severity: "medium",
        trustPenalty: 0,
        requireHumanApproval: true,
        resourceClassification: classification,
      };
    }

    // 6. Untrusted External Network Call -> RESTRICT
    if (
      actionType.toLowerCase() === "network_call" &&
      (resource.startsWith("http://external-untrusted") || resource.startsWith("http://"))
    ) {
      return {
        decision: "RESTRICT",
        reason: `External network call to untrusted target '${resource}' is restricted`,
        severity: "high",
        trustPenalty: 10,
        requireHumanApproval: false,
        resourceClassification: classification,
      };
    }

    // 7. Default -> ALLOW
    return {
      decision: "ALLOW",
      reason: `Action '${actionType}' on '${resource}' permitted by security policy`,
      severity: "low",
      trustPenalty: 0,
      requireHumanApproval: false,
      resourceClassification: classification,
    };
  }
}

export const policyEngine = new PolicyEngine();
