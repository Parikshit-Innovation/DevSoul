import { payloadScanner } from "./payloadScanner.ts";

export interface NetworkSecurityCheckResult {
  isBlocked: boolean;
  isAllowed: boolean;
  hostname: string;
  reason?: string;
  hasExfiltrationRisk: boolean;
}

export class NetworkSecurity {
  private allowedHosts: Set<string> = new Set([
    "api.openai.com",
    "api.anthropic.com",
    "api.github.com",
    "registry.npmjs.org",
    "pypi.org",
  ]);

  private allowLocalhost: boolean = false;

  public setAllowedHosts(hosts: string[]): void {
    this.allowedHosts = new Set(hosts.map((h) => h.toLowerCase().trim()));
  }

  public addAllowedHost(host: string): void {
    this.allowedHosts.add(host.toLowerCase().trim());
  }

  public setAllowLocalhost(allow: boolean): void {
    this.allowLocalhost = allow;
  }

  public evaluateUrl(urlStr: string, payload?: any): NetworkSecurityCheckResult {
    if (!urlStr || typeof urlStr !== "string") {
      return {
        isBlocked: true,
        isAllowed: false,
        hostname: "",
        reason: "Invalid or empty URL string",
        hasExfiltrationRisk: false,
      };
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(urlStr.startsWith("http") ? urlStr : `http://${urlStr}`);
    } catch {
      return {
        isBlocked: true,
        isAllowed: false,
        hostname: urlStr,
        reason: `Malformed URL destination: '${urlStr}'`,
        hasExfiltrationRisk: false,
      };
    }

    const hostname = parsedUrl.hostname.toLowerCase();

    // 1. Block Cloud Metadata IP (AWS/GCP/Azure link-local: 169.254.169.254)
    if (hostname === "169.254.169.254" || hostname === "metadata.google.internal") {
      return {
        isBlocked: true,
        isAllowed: false,
        hostname,
        reason: "Access to cloud metadata endpoint (169.254.169.254) is strictly BLOCKED (SSRF protection)",
        hasExfiltrationRisk: true,
      };
    }

    // 2. Localhost / Loopback check
    const isLoopback =
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1" ||
      hostname === "0.0.0.0";

    if (isLoopback && !this.allowLocalhost) {
      return {
        isBlocked: true,
        isAllowed: false,
        hostname,
        reason: `Loopback access to '${hostname}' is restricted unless explicitly configured`,
        hasExfiltrationRisk: false,
      };
    }

    // 3. Private Network Range check (10.x, 192.168.x, 172.16-31.x)
    if (
      /^10\./.test(hostname) ||
      /^192\.168\./.test(hostname) ||
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname)
    ) {
      return {
        isBlocked: true,
        isAllowed: false,
        hostname,
        reason: `Private internal IP destination '${hostname}' is blocked to prevent internal network scanning`,
        hasExfiltrationRisk: false,
      };
    }

    // 4. Check payload for detected secret exfiltration
    const payloadScan = payloadScanner.scan(payload);
    if (payloadScan.hasSecrets) {
      return {
        isBlocked: true,
        isAllowed: false,
        hostname,
        reason: `Network payload contains detected secrets/credentials being transmitted to '${hostname}'`,
        hasExfiltrationRisk: true,
      };
    }

    // 5. Allowed Host Check
    const isExplicitlyAllowed = this.allowedHosts.has(hostname);

    return {
      isBlocked: false,
      isAllowed: isExplicitlyAllowed,
      hostname,
      reason: isExplicitlyAllowed ? undefined : `Host '${hostname}' is not in approved network allow-list`,
      hasExfiltrationRisk: false,
    };
  }
}

export const networkSecurity = new NetworkSecurity();
