import * as fs from 'node:fs';
import * as path from 'node:path';
import type { AuditRecord, AuditSink, RouteDecision } from './models.ts';
import { sha256Hex, SystemContext } from './utils.ts';

export class AuditLogger {
  private inMemoryRecords: AuditRecord[] = [];
  private logFilePath: string;
  private externalSink: AuditSink | null = null;
  private maxInMemory: number = 100;

  constructor(logFilePath?: string) {
    this.logFilePath =
      logFilePath ||
      path.resolve(process.cwd(), '.devos', 'audit', 'model-hub.jsonl');
    this.ensureDirectory();
  }

  private ensureDirectory(): void {
    try {
      const dir = path.dirname(this.logFilePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    } catch {
      // Ignore if in restricted / mock filesystem
    }
  }

  public setExternalSink(sink: AuditSink | null): void {
    this.externalSink = sink;
  }

  public async record(
    decision: RouteDecision,
    promptContent: string,
    responseContent?: string,
    latencyMs?: number,
    success: boolean = true,
    error?: string
  ): Promise<AuditRecord> {
    const promptHash = sha256Hex(promptContent);
    const record: AuditRecord = {
      id: SystemContext.generateId('audit'),
      timestamp: SystemContext.nowIso(),
      taskId: decision.taskId,
      category: decision.category,
      sensitivity: decision.sensitivity,
      chosenModel: decision.modelId,
      provider: decision.provider,
      location: decision.location,
      overridden: decision.overridden,
      fallbacks: decision.fallbacks,
      reasons: decision.reasons,
      promptHash,
      promptLength: promptContent.length,
      responseLength: responseContent ? responseContent.length : undefined,
      latencyMs,
      success,
      error,
    };

    // Store in-memory
    this.inMemoryRecords.unshift(record);
    if (this.inMemoryRecords.length > this.maxInMemory) {
      this.inMemoryRecords.pop();
    }

    // Append to JSONL file
    try {
      this.ensureDirectory();
      fs.appendFileSync(this.logFilePath, JSON.stringify(record) + '\n', 'utf8');
    } catch {
      // Non-blocking file error
    }

    // Forward to external sink (Aegis) if registered
    if (this.externalSink) {
      try {
        await this.externalSink.logDecision(record);
      } catch (err: any) {
        console.warn(`Failed to forward record to external audit sink: ${err?.message}`);
      }
    }

    return record;
  }

  public getRecentDecisions(limit: number = 20): AuditRecord[] {
    return this.inMemoryRecords.slice(0, limit);
  }

  public clearAll(): void {
    this.inMemoryRecords = [];
  }
}
