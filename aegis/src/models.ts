export type AgentState = "ACTIVE" | "SUSPENDED" | "QUARANTINED";

export type DecisionType = "ALLOW" | "APPROVE" | "RESTRICT" | "BLOCK";

export type SeverityLevel = "low" | "medium" | "high" | "critical";

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type ResourceClassification = "PUBLIC" | "INTERNAL" | "SENSITIVE" | "CRITICAL";

export type ApprovalStatus = "WAITING_FOR_HUMAN" | "APPROVED" | "DENIED" | "EXPIRED" | "CONSUMED";

export type AgentRole =
  | "frontend"
  | "backend"
  | "fullstack"
  | "devops"
  | "security"
  | "tester"
  | "reviewer"
  | "custom"
  | string;

export interface Agent {
  id: string;
  name?: string;
  role?: AgentRole;
  type?: string;
  trustScore?: number;
  state?: AgentState;
  capabilities?: string[];
  allowedPaths?: string[];
  metadata?: Record<string, any>;
}

export type ActionType =
  | "read"
  | "write"
  | "modify"
  | "delete"
  | "execute"
  | "run_command"
  | "rename"
  | "copy"
  | "export"
  | "send"
  | "network_call"
  | "spawn_agent"
  | "install_package"
  | "remove_package"
  | "update_package"
  | "modify_schema"
  | "modify_database"
  | "git_push"
  | "git_commit"
  | string;

export interface Action {
  type: ActionType;
  details?: Record<string, any>;
  intent?: string;
  context?: Record<string, any>;
}

export interface Target {
  resource: string;
  type?: "file" | "network" | "command" | "database" | "system" | "custom" | string;
  metadata?: Record<string, any>;
}

export interface RiskFactor {
  category: "IDENTITY" | "RESOURCE" | "ACTION" | "BEHAVIOR" | "TRUST" | "ENVIRONMENT";
  description: string;
  weight: number;
}

export interface RiskAssessment {
  score: number;
  level: RiskLevel;
  factors: RiskFactor[];
}

export interface BehaviorAnomaly {
  type:
    | "ROLE_MISMATCH"
    | "PROBING_SEQUENCE"
    | "EXFILTRATION_PATTERN"
    | "REPEAT_VIOLATIONS"
    | "RAPID_PROBING"
    | "PATH_ESCAPE"
    | "SCOPE_VIOLATION"
    | "UNAUTHORIZED_AGENT"
    | "SECRET_LEAK"
    | "COMMAND_INJECTION";
  description: string;
  severity: SeverityLevel;
}

export interface Violation {
  id: string;
  agentId: string;
  action: Action;
  target: Target;
  reason: string;
  severity: SeverityLevel;
  trustPenalty: number;
  timestamp: string;
}

export interface SecurityConstraints {
  readOnly?: boolean;
  redactSecrets?: boolean;
  maxPayloadBytes?: number;
  networkAllowed?: boolean;
  allowedFields?: string[];
}

export interface ApprovalRequest {
  id: string;
  agentId: string;
  action: Action;
  target: Target;
  reason: string;
  status: ApprovalStatus;
  actionHash?: string;
  riskAssessment?: RiskAssessment;
  createdAt: string;
  expiresAt?: string;
  resolvedAt?: string;
  resolvedBy?: string;
  consumedAt?: string;
}

export interface AegisDecision {
  decision: DecisionType;
  reason: string;
  explanation?: string;
  agentId: string;
  trustBefore: number;
  trustAfter: number;
  quarantined: boolean;
  resourceClassification?: ResourceClassification;
  riskAssessment?: RiskAssessment;
  behaviorAnomalies?: BehaviorAnomaly[];
  constraints?: SecurityConstraints;
  violation?: Violation;
  approvalRequest?: ApprovalRequest;
  ruleId?: string;
  policyVersion?: string;
  decidedBy?: string;
  timestamp: string;
}

export interface AuditRecord {
  id: string;
  seq: number;
  prevHash: string;
  hash: string;
  timestamp: string;
  agentId: string;
  agentRole?: AgentRole;
  agentState: AgentState;
  action: Action;
  target: Target;
  decision: DecisionType;
  reason: string;
  trustBefore: number;
  trustAfter: number;
  resourceClassification?: ResourceClassification;
  riskLevel?: RiskLevel;
  violation?: Violation;
  quarantineStatus: AgentState;
  ruleId?: string;
  policyVersion?: string;
  decidedBy?: string;
}

export interface PolicyRule {
  id: string;
  name: string;
  description?: string;
  effect: "allow" | "deny" | "approve" | "restrict";
  resourcePattern: string | RegExp;
  actions?: string[];
  roles?: string[];
  severity?: SeverityLevel;
  trustPenalty?: number;
  requireHumanApproval?: boolean;
}
