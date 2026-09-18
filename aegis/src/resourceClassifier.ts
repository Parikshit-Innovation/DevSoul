import type { ResourceClassification } from "./models.ts";

export interface ClassifierRule {
  pattern: RegExp;
  tier: ResourceClassification;
  description: string;
}

export class ResourceClassifier {
  // Ordered rules: First matching rule takes effect
  private rules: ClassifierRule[] = [
    // 1. Safe Templates & Examples (Exception to .env/secret rules -> INTERNAL)
    {
      pattern: /(^|[/\\])\.env\.(example|sample|template|dist)$/i,
      tier: "INTERNAL",
      description: "Environment variable template file",
    },
    {
      pattern: /(^|[/\\])(secrets|credentials)\.(example|sample|template)\./i,
      tier: "INTERNAL",
      description: "Secrets template file",
    },

    // 2. Critical Tier: Cryptographic keys, credentials, cloud auth, state files
    {
      pattern: /(^|[/\\])id_(rsa|dsa|ecdsa|ed25519)($|\..*)/i,
      tier: "CRITICAL",
      description: "SSH Private Key",
    },
    {
      pattern: /(^|[/\\])\.ssh([/\\]|$)/i,
      tier: "CRITICAL",
      description: "SSH configuration or key directory",
    },
    {
      pattern: /(^|[/\\])\.aws([/\\]credentials|[/\\]config)?$/i,
      tier: "CRITICAL",
      description: "AWS credentials or configuration",
    },
    {
      pattern: /\.(pem|key|p12|pfx|pkcs12|keystore)$/i,
      tier: "CRITICAL",
      description: "Cryptographic Certificate or Private Key",
    },
    {
      pattern: /(^|[/\\])credentials(\.json|\.yaml|\.yml|\.txt)?$/i,
      tier: "CRITICAL",
      description: "Credentials data file",
    },
    {
      pattern: /(^|[/\\])secrets?(\.json|\.yaml|\.yml|\.txt)?$/i,
      tier: "CRITICAL",
      description: "Secrets configuration file",
    },
    {
      pattern: /(^|[/\\])service[-_]?account.*\.json$/i,
      tier: "CRITICAL",
      description: "Service Account credentials key",
    },
    {
      pattern: /\.tfstate(\.backup)?$/i,
      tier: "CRITICAL",
      description: "Terraform State file with embedded secrets",
    },
    {
      pattern: /(^|[/\\])master[-_]?key/i,
      tier: "CRITICAL",
      description: "Master Encryption Key",
    },

    // 3. Sensitive Tier: Environment secrets, package tokens, git config, auth tokens
    {
      pattern: /(^|[/\\])\.env($|\..*)/i,
      tier: "SENSITIVE",
      description: "Environment secrets file",
    },
    {
      pattern: /(^|[/\\])\.(npmrc|pypirc|netrc|docker[/\\]config\.json)$/i,
      tier: "SENSITIVE",
      description: "Package manager or registry authentication config",
    },
    {
      pattern: /(^|[/\\])\.git[/\\]config$/i,
      tier: "SENSITIVE",
      description: "Git repository configuration with potential tokens",
    },
    {
      pattern: /(password|api[-_]?key|auth[-_]?token|client[-_]?secret)/i,
      tier: "SENSITIVE",
      description: "Resource containing secrets or authentication tokens",
    },

    // 4. Public Tier: Documentation, License, Public assets
    {
      pattern: /(^|[/\\])(README|LICENSE|CHANGELOG|CONTRIBUTING)(\.md|\.txt)?$/i,
      tier: "PUBLIC",
      description: "Public repository documentation",
    },
    {
      pattern: /(^|[/\\])docs[/\\].*\.md$/i,
      tier: "PUBLIC",
      description: "Documentation markdown",
    },
    {
      pattern: /(^|[/\\])public[/\\]/i,
      tier: "PUBLIC",
      description: "Public static assets",
    },
  ];

  public classify(resource: string): ResourceClassification {
    const normalized = (resource || "").trim().replace(/\\/g, "/");

    for (const rule of this.rules) {
      if (rule.pattern.test(normalized)) {
        return rule.tier;
      }
    }

    // Default for regular code, configs, dependencies within the workspace
    return "INTERNAL";
  }

  public getRule(resource: string): ClassifierRule | undefined {
    const normalized = (resource || "").trim().replace(/\\/g, "/");
    return this.rules.find((r) => r.pattern.test(normalized));
  }
}

export const resourceClassifier = new ResourceClassifier();
