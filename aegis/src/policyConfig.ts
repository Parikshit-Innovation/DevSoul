import * as fs from "node:fs";
import * as path from "node:path";
import type { PolicyRule, SeverityLevel } from "./models.ts";

export interface PolicyConfigFile {
  policyVersion: string;
  updatedAt: string;
  riskThresholds: {
    medium: number;
    high: number;
    critical: number;
  };
  trustPenalties: {
    low: number;
    medium: number;
    high: number;
    critical: number;
  };
  quarantineThreshold: number;
  probingWindowSeconds: number;
  networkPolicy: {
    allowedHosts: string[];
    allowLocalhost: boolean;
  };
  rules: PolicyRule[];
}

export const DEFAULT_POLICY_CONFIG: PolicyConfigFile = {
  policyVersion: "1.0.0",
  updatedAt: new Date().toISOString(),
  riskThresholds: {
    medium: 25,
    high: 50,
    critical: 75,
  },
  trustPenalties: {
    low: 0,
    medium: 15,
    high: 25,
    critical: 34,
  },
  quarantineThreshold: 20,
  probingWindowSeconds: 60,
  networkPolicy: {
    allowedHosts: [
      "api.openai.com",
      "api.anthropic.com",
      "api.github.com",
      "registry.npmjs.org",
      "pypi.org",
    ],
    allowLocalhost: false,
  },
  rules: [
    {
      id: "RULE-HARD-DENY-CRITICAL-FILES",
      name: "Hard Deny for Cryptographic and Cloud Credentials",
      effect: "deny",
      resourcePattern: "(id_rsa|\\.pem|\\.key|service[-_]?account.*\\.json|\\.tfstate|\\.aws)",
      severity: "critical",
      trustPenalty: 40,
    },
    {
      id: "RULE-HARD-DENY-ENV-SECRETS",
      name: "Sensitive Environment Variables Protection",
      effect: "deny",
      resourcePattern: "(^|[/\\\\])\\.env($|\\..*)",
      severity: "critical",
      trustPenalty: 34,
    },
    {
      id: "RULE-APPROVE-HIGH-RISK-OPS",
      name: "Human Approval for High-Impact Operations",
      effect: "approve",
      resourcePattern: "(package\\.json|schema|migrations)",
      actions: ["install_package", "modify_schema", "git_push", "delete", "drop_table"],
      severity: "high",
      requireHumanApproval: true,
    },
    {
      id: "RULE-RESTRICT-EXTERNAL-CALLS",
      name: "Restricted Network Calls",
      effect: "restrict",
      resourcePattern: "http",
      actions: ["network_call"],
      severity: "medium",
      trustPenalty: 10,
    },
  ],
};

export class PolicyConfigManager {
  private currentConfig: PolicyConfigFile;
  private configFilePath?: string;

  constructor(initialConfig: PolicyConfigFile = DEFAULT_POLICY_CONFIG) {
    this.currentConfig = JSON.parse(JSON.stringify(initialConfig));
  }

  public getConfig(): PolicyConfigFile {
    return this.currentConfig;
  }

  public setConfig(config: PolicyConfigFile): void {
    this.validate(config);
    this.currentConfig = config;
  }

  public loadFromFile(filePath: string): void {
    const resolvedPath = path.resolve(filePath);
    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`Policy config file not found at '${resolvedPath}'`);
    }

    const raw = fs.readFileSync(resolvedPath, "utf-8");
    const parsed = JSON.parse(raw);
    this.validate(parsed);
    this.currentConfig = parsed;
    this.configFilePath = resolvedPath;
  }

  public reload(): void {
    if (this.configFilePath) {
      this.loadFromFile(this.configFilePath);
    }
  }

  public validate(config: any): void {
    if (!config || typeof config !== "object") {
      throw new Error("Invalid policy configuration: Must be a valid JSON object");
    }
    if (!config.policyVersion || typeof config.policyVersion !== "string") {
      throw new Error("Policy configuration missing 'policyVersion'");
    }
    if (!config.riskThresholds || typeof config.riskThresholds.critical !== "number") {
      throw new Error("Policy configuration missing valid 'riskThresholds'");
    }
    if (!config.trustPenalties || typeof config.trustPenalties.critical !== "number") {
      throw new Error("Policy configuration missing valid 'trustPenalties'");
    }
  }
}

export const policyConfigManager = new PolicyConfigManager();
