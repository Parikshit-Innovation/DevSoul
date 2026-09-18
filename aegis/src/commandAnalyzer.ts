import { resourceClassifier } from "./resourceClassifier.ts";
import type { ResourceClassification, SeverityLevel } from "./models.ts";

export interface CommandAnalysisResult {
  rawCommand: string;
  isUnparseable: boolean;
  tokens: string[];
  extractedFiles: { path: string; tier: ResourceClassification }[];
  dangerousFlags: { type: string; description: string; severity: SeverityLevel }[];
  requiresApproval: boolean;
  isBlocked: boolean;
  reason?: string;
}

export class CommandAnalyzer {
  /**
   * Tokenize command string into tokens respecting quotes and subshells
   */
  public tokenize(command: string): { tokens: string[]; isUnparseable: boolean } {
    if (!command || typeof command !== "string") {
      return { tokens: [], isUnparseable: true };
    }

    const tokens: string[] = [];
    let currentToken = "";
    let inSingleQuote = false;
    let inDoubleQuote = false;
    let isEscaped = false;

    for (let i = 0; i < command.length; i++) {
      const char = command[i];

      if (isEscaped) {
        currentToken += char;
        isEscaped = false;
        continue;
      }

      if (char === "\\") {
        isEscaped = true;
        continue;
      }

      if (char === "'" && !inDoubleQuote) {
        inSingleQuote = !inSingleQuote;
        continue;
      }

      if (char === '"' && !inSingleQuote) {
        inDoubleQuote = !inDoubleQuote;
        continue;
      }

      if (!inSingleQuote && !inDoubleQuote) {
        // Operators / split characters: space, ;, &&, ||, |, $(, `
        if (/\s/.test(char)) {
          if (currentToken.length > 0) {
            tokens.push(currentToken);
            currentToken = "";
          }
          continue;
        }

        if (char === ";" || char === "|" || char === "&" || char === "`") {
          if (currentToken.length > 0) {
            tokens.push(currentToken);
            currentToken = "";
          }
          tokens.push(char);
          continue;
        }
      }

      currentToken += char;
    }

    if (inSingleQuote || inDoubleQuote) {
      // Unclosed quote -> unparseable/malformed
      return { tokens, isUnparseable: true };
    }

    if (currentToken.length > 0) {
      tokens.push(currentToken);
    }

    return { tokens, isUnparseable: false };
  }

  /**
   * Analyze command string for security threats, sensitive file operands, and destructive actions
   */
  public analyze(command: string): CommandAnalysisResult {
    const { tokens, isUnparseable } = this.tokenize(command);
    const normalizedCmd = command.toLowerCase().trim();

    const dangerousFlags: { type: string; description: string; severity: SeverityLevel }[] = [];
    const extractedFiles: { path: string; tier: ResourceClassification }[] = [];

    // 1. Unparseable check -> fallback to require approval / flag
    if (isUnparseable) {
      dangerousFlags.push({
        type: "MALFORMED_COMMAND",
        description: "Command contains unclosed quotes or unparseable syntax",
        severity: "high",
      });
      return {
        rawCommand: command,
        isUnparseable: true,
        tokens,
        extractedFiles: [],
        dangerousFlags,
        requiresApproval: true,
        isBlocked: false,
        reason: "Malformed or unparseable command structure",
      };
    }

    // 2. Dangerous Execution Patterns (BLOCK)
    if (/curl.*\|\s*(ba)?sh/i.test(command) || /wget.*\|\s*(ba)?sh/i.test(command)) {
      dangerousFlags.push({
        type: "REMOTE_CODE_EXECUTION",
        description: "Piping remote network payload into shell interpreter (curl|sh)",
        severity: "critical",
      });
    }

    if (/rm\s+-[rf]{1,2}\s+([/~]|(\.\.))/i.test(command) || /del\s+\/f\s+\/s\s+\/q/i.test(command)) {
      dangerousFlags.push({
        type: "DESTRUCTIVE_COMMAND",
        description: "Destructive root/recursive directory deletion",
        severity: "critical",
      });
    }

    if (/\b(sudo|su|runas)\b/i.test(command)) {
      dangerousFlags.push({
        type: "PRIVILEGE_ESCALATION",
        description: "Attempted privilege escalation via sudo/su/runas",
        severity: "high",
      });
    }

    if (/chmod\s+(-R\s+)?777/i.test(command)) {
      dangerousFlags.push({
        type: "INSECURE_PERMISSIONS",
        description: "Setting world-writable (777) permissions",
        severity: "high",
      });
    }

    if (/git\s+push.*(--force|-f)\b/i.test(command)) {
      dangerousFlags.push({
        type: "FORCE_GIT_PUSH",
        description: "Force pushing git repository changes",
        severity: "high",
      });
    }

    if (/base64.*\|\s*(curl|nc|wget)/i.test(command) || />&\s*\/dev\/tcp/i.test(command)) {
      dangerousFlags.push({
        type: "EXFILTRATION_COMMAND",
        description: "Shell-level data exfiltration or reverse shell pipeline",
        severity: "critical",
      });
    }

    // 3. Extract file operands from reading commands (cat, type, Get-Content, grep, head, tail, etc.)
    const fileReadCommands = ["cat", "type", "get-content", "head", "tail", "grep", "rg", "more", "less"];
    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i].toLowerCase();
      if (fileReadCommands.includes(tok)) {
        // Collect following argument tokens that look like filenames
        for (let j = i + 1; j < tokens.length; j++) {
          const arg = tokens[j];
          if (arg === ";" || arg === "|" || arg === "&" || arg.startsWith("-")) {
            if (arg === ";" || arg === "|" || arg === "&") break;
            continue;
          }
          const tier = resourceClassifier.classify(arg);
          extractedFiles.push({ path: arg, tier });
        }
      } else {
        // Check any token that matches sensitive files directly
        if (
          tok.includes(".env") ||
          tok.includes("id_rsa") ||
          tok.includes(".pem") ||
          tok.includes(".key") ||
          tok.includes("credentials") ||
          tok.includes("secret")
        ) {
          const tier = resourceClassifier.classify(tokens[i]);
          if (tier === "SENSITIVE" || tier === "CRITICAL") {
            if (!extractedFiles.some((f) => f.path === tokens[i])) {
              extractedFiles.push({ path: tokens[i], tier });
            }
          }
        }
      }
    }

    // 4. Check if sensitive files were accessed in command
    const hasCriticalOrSensitive = extractedFiles.some(
      (f) => f.tier === "CRITICAL" || f.tier === "SENSITIVE"
    );

    const hasCriticalAnomaly = dangerousFlags.some((d) => d.severity === "critical");
    const hasHighAnomaly = dangerousFlags.some((d) => d.severity === "high");

    const isBlocked = hasCriticalOrSensitive || hasCriticalAnomaly;
    const requiresApproval = !isBlocked && (hasHighAnomaly || /npm\s+install|yarn\s+add|pnpm\s+add/i.test(command));

    let reason: string | undefined;
    if (hasCriticalOrSensitive) {
      const sensitiveFile = extractedFiles.find((f) => f.tier === "CRITICAL" || f.tier === "SENSITIVE");
      reason = `Command attempts to access sensitive file '${sensitiveFile?.path}'`;
    } else if (hasCriticalAnomaly) {
      reason = dangerousFlags.find((d) => d.severity === "critical")?.description;
    } else if (requiresApproval) {
      reason = dangerousFlags.find((d) => d.severity === "high")?.description || "High impact command requires approval";
    }

    return {
      rawCommand: command,
      isUnparseable: false,
      tokens,
      extractedFiles,
      dangerousFlags,
      requiresApproval,
      isBlocked,
      reason,
    };
  }
}

export const commandAnalyzer = new CommandAnalyzer();
