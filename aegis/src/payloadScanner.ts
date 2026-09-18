export interface DetectedSecret {
  type: string;
  matched: string;
  index: number;
}

export interface PayloadScanResult {
  hasSecrets: boolean;
  detectedSecrets: DetectedSecret[];
  redactedPayload: string;
  reason?: string;
}

export class PayloadScanner {
  private secretPatterns: { type: string; regex: RegExp }[] = [
    {
      type: "AWS_ACCESS_KEY",
      regex: /\b(AKIA[0-9A-Z]{16})\b/g,
    },
    {
      type: "STRIPE_SECRET_KEY",
      regex: /\b(sk_live_[0-9a-zA-Z]{24,34})\b/g,
    },
    {
      type: "GOOGLE_API_KEY",
      regex: /\b(AIza[0-9A-Za-z\-_]{30,40})\b/g,
    },
    {
      type: "GITHUB_TOKEN",
      regex: /\b(ghp_[0-9a-zA-Z]{36}|github_pat_[0-9a-zA-Z_]{82})\b/g,
    },
    {
      type: "PRIVATE_KEY_HEADER",
      regex: /-----BEGIN\s+(RSA\s+|EC\s+|DSA\s+|OPENSSH\s+)?PRIVATE\s+KEY-----[\s\S]*?-----END\s+(RSA\s+|EC\s+|DSA\s+|OPENSSH\s+)?PRIVATE\s+KEY-----/gi,
    },
    {
      type: "SLACK_BOT_TOKEN",
      regex: /\b(xoxb-[0-9]{11,13}-[0-9]{11,13}-[a-zA-Z0-9]{24})\b/g,
    },
    {
      type: "GENERIC_BEARER_SECRET",
      regex: /bearer\s+([a-zA-Z0-9_\-\.]{32,})/gi,
    },
  ];

  public scan(payload: string | Record<string, any> | undefined): PayloadScanResult {
    if (!payload) {
      return { hasSecrets: false, detectedSecrets: [], redactedPayload: "" };
    }

    const contentStr = typeof payload === "string" ? payload : JSON.stringify(payload);
    const detected: DetectedSecret[] = [];
    let redacted = contentStr;

    for (const { type, regex } of this.secretPatterns) {
      // Create a fresh regex to avoid lastIndex state issues with /g flag
      const re = new RegExp(regex.source, regex.flags);
      let match: RegExpExecArray | null;

      while ((match = re.exec(contentStr)) !== null) {
        detected.push({
          type,
          matched: match[0].substring(0, 8) + "...[REDACTED]",
          index: match.index,
        });
      }

      // Mask in redacted output
      redacted = redacted.replace(re, (m) => `[REDACTED_${type}_${m.substring(0, 4)}...]`);
    }

    return {
      hasSecrets: detected.length > 0,
      detectedSecrets: detected,
      redactedPayload: redacted,
      reason:
        detected.length > 0
          ? `Payload contains detected secret credentials (${detected.map((d) => d.type).join(", ")})`
          : undefined,
    };
  }

  public mask(content: string): string {
    return this.scan(content).redactedPayload;
  }
}

export const payloadScanner = new PayloadScanner();
