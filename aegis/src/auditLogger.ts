import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type { AuditRecord } from "./models.ts";
import { SystemContext } from "./utils.ts";
import { payloadScanner } from "./payloadScanner.ts";

export class AuditLogger {
  private logs: AuditRecord[] = [];
  private logFilePath?: string;
  private autoFlushToFile: boolean = false;

  constructor(logFilePath?: string) {
    if (logFilePath) {
      this.setLogFilePath(logFilePath);
    }
  }

  public setLogFilePath(filePath: string): void {
    this.logFilePath = path.resolve(filePath);
    this.autoFlushToFile = true;
    const dir = path.dirname(this.logFilePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  private safeStringify(obj: any): string {
    const seen = new WeakSet();
    try {
      return JSON.stringify(obj, (key, value) => {
        if (typeof value === "object" && value !== null) {
          if (seen.has(value)) {
            return "[Circular]";
          }
          seen.add(value);
        }
        return value;
      });
    } catch {
      return String(obj);
    }
  }

  public computeHash(recordWithoutHash: Omit<AuditRecord, "hash">): string {
    const payload = this.safeStringify({
      seq: recordWithoutHash.seq,
      prevHash: recordWithoutHash.prevHash,
      timestamp: recordWithoutHash.timestamp,
      agentId: recordWithoutHash.agentId,
      agentRole: recordWithoutHash.agentRole,
      agentState: recordWithoutHash.agentState,
      action: recordWithoutHash.action,
      target: recordWithoutHash.target,
      decision: recordWithoutHash.decision,
      reason: recordWithoutHash.reason,
      trustBefore: recordWithoutHash.trustBefore,
      trustAfter: recordWithoutHash.trustAfter,
      ruleId: recordWithoutHash.ruleId,
      policyVersion: recordWithoutHash.policyVersion,
      decidedBy: recordWithoutHash.decidedBy,
    });

    return createHash("sha256").update(payload).digest("hex");
  }

  public log(
    entry: Omit<AuditRecord, "id" | "timestamp" | "seq" | "prevHash" | "hash"> & {
      timestamp?: string;
    }
  ): AuditRecord {
    const seq = this.logs.length + 1;
    const prevHash = this.logs.length > 0 ? this.logs[this.logs.length - 1].hash : "0".repeat(64);
    const timestamp = entry.timestamp || SystemContext.nowIso();

    // Mask secrets in reason or details
    const maskedReason = payloadScanner.mask(entry.reason);
    const maskedTargetResource = payloadScanner.mask(entry.target.resource);

    const recordData: Omit<AuditRecord, "hash"> = {
      id: SystemContext.generateId("audit"),
      seq,
      prevHash,
      timestamp,
      agentId: entry.agentId,
      agentRole: entry.agentRole,
      agentState: entry.agentState,
      action: entry.action,
      target: {
        ...entry.target,
        resource: maskedTargetResource,
      },
      decision: entry.decision,
      reason: maskedReason,
      trustBefore: entry.trustBefore,
      trustAfter: entry.trustAfter,
      resourceClassification: entry.resourceClassification,
      riskLevel: entry.riskLevel,
      violation: entry.violation,
      quarantineStatus: entry.quarantineStatus,
      ruleId: entry.ruleId || "RULE-DEFAULT",
      policyVersion: entry.policyVersion || "1.0.0",
      decidedBy: entry.decidedBy || "policy_engine",
    };

    const hash = this.computeHash(recordData);
    const fullRecord: AuditRecord = {
      ...recordData,
      hash,
    };

    this.logs.push(fullRecord);

    if (this.autoFlushToFile && this.logFilePath) {
      try {
        fs.appendFileSync(this.logFilePath, JSON.stringify(fullRecord) + "\n", "utf-8");
      } catch {
        // Silently continue if file write fails in restricted environments
      }
    }

    return fullRecord;
  }

  /**
   * Cryptographic verification of the SHA-256 hash chain
   */
  public verifyChain(): { isValid: boolean; errorIndex?: number; reason?: string } {
    if (this.logs.length === 0) {
      return { isValid: true };
    }

    for (let i = 0; i < this.logs.length; i++) {
      const record = this.logs[i];

      // 1. Verify sequence order
      if (record.seq !== i + 1) {
        return {
          isValid: false,
          errorIndex: i,
          reason: `Invalid sequence index at position ${i}: expected ${i + 1}, found ${record.seq}`,
        };
      }

      // 2. Verify prevHash link
      const expectedPrev = i === 0 ? "0".repeat(64) : this.logs[i - 1].hash;
      if (record.prevHash !== expectedPrev) {
        return {
          isValid: false,
          errorIndex: i,
          reason: `Hash chain broken at seq ${record.seq}: prevHash does not match previous record's hash`,
        };
      }

      // 3. Verify record payload integrity
      const { hash, ...recordWithoutHash } = record;
      const computed = this.computeHash(recordWithoutHash);
      if (computed !== record.hash) {
        return {
          isValid: false,
          errorIndex: i,
          reason: `Tamper detected at seq ${record.seq}: payload hash ${record.hash} does not match computed ${computed}`,
        };
      }
    }

    return { isValid: true };
  }

  public getLogs(filter?: { agentId?: string }): AuditRecord[] {
    if (filter?.agentId) {
      return this.logs.filter((log) => log.agentId === filter.agentId);
    }
    return [...this.logs];
  }

  public getFormattedTimeline(agentId?: string): string[] {
    const list = this.getLogs(agentId ? { agentId } : undefined);
    return list.map((l) => {
      const timeStr = new Date(l.timestamp).toLocaleTimeString("en-US", {
        hour12: false,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
      const roleStr = l.agentRole ? `[${l.agentRole}]` : "";
      const classStr = l.resourceClassification ? `(${l.resourceClassification})` : "";
      const actStr = `${l.action.type} ${l.target.resource} ${classStr}`.trim();
      let line = `[${timeStr}] Agent(${l.agentId}${roleStr}) ${actStr} -> ${l.decision}`;
      if (l.trustBefore !== l.trustAfter) {
        line += ` | Trust: ${l.trustBefore} -> ${l.trustAfter}`;
      }
      if (l.riskLevel) {
        line += ` | Risk: ${l.riskLevel}`;
      }
      if (l.quarantineStatus === "QUARANTINED") {
        line += ` | [🚨 QUARANTINED]`;
      }
      return line;
    });
  }

  public clearLogs(): void {
    this.logs = [];
  }
}

export const auditLogger = new AuditLogger();
