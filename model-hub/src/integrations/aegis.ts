import type {
  AuditRecord,
  AuditSink,
  RouteRequest,
  Sensitivity,
  SensitivityProvider,
} from '../models.ts';

export interface AegisLike {
  check?(agent: any, action: any, target: any): Promise<any> | any;
  resourceClassifier?: {
    classify(target: string | { uri?: string; path?: string }): { isSensitive?: boolean; sensitivity?: string };
  };
  payloadScanner?: {
    scan(payload: string): { hasSensitiveData?: boolean; findings?: any[] };
  };
  auditLogger?: {
    logEvent?(event: any): Promise<any> | any;
  };
}

/**
 * Concrete Aegis Integration Adapter implementing SensitivityProvider and AuditSink
 */
export class AegisAdapter implements SensitivityProvider, AuditSink {
  private aegis: AegisLike | null = null;
  private defaultAgentId: string;

  constructor(aegis?: AegisLike, defaultAgentId: string = 'devos-model-hub') {
    this.aegis = aegis || null;
    this.defaultAgentId = defaultAgentId;
  }

  public setAegis(aegis: AegisLike | null): void {
    this.aegis = aegis;
  }

  /**
   * Evaluate task sensitivity by querying Aegis Resource Classifier & Payload Scanner
   */
  public async evaluateSensitivity(request: RouteRequest): Promise<Sensitivity> {
    if (!this.aegis) {
      return request.sensitivity || 'public';
    }

    try {
      // 1. Check target files via Aegis Resource Classifier
      if (request.filePaths && request.filePaths.length > 0 && this.aegis.resourceClassifier) {
        for (const filePath of request.filePaths) {
          const classification = this.aegis.resourceClassifier.classify(filePath);
          if (
            classification?.isSensitive ||
            classification?.sensitivity === 'sensitive' ||
            classification?.sensitivity === 'confidential' ||
            classification?.sensitivity === 'restricted'
          ) {
            return 'private';
          }
        }
      }

      // 2. Scan message payloads via Aegis Payload Scanner if available
      if (request.messages && this.aegis.payloadScanner) {
        const fullContent = request.messages.map((m) => m.content || '').join('\n');
        const scan = this.aegis.payloadScanner.scan(fullContent);
        if (scan?.hasSensitiveData || (scan?.findings && scan.findings.length > 0)) {
          return 'private';
        }
      }

      // 3. Optional full Aegis policy check
      if (typeof this.aegis.check === 'function' && request.filePaths && request.filePaths.length > 0) {
        for (const filePath of request.filePaths) {
          const decision = await this.aegis.check(
            { id: this.defaultAgentId, name: 'DevOS Model Hub', role: 'router' },
            { type: 'READ_RESOURCE', resource: filePath },
            { path: filePath }
          );
          if (decision && (decision.status === 'BLOCK' || decision.status === 'RESTRICT' || decision.status === 'APPROVE')) {
            return 'private';
          }
        }
      }

      return request.sensitivity || 'public';
    } catch {
      // Fail-safe to private if Aegis evaluation throws or detects threat
      return 'private';
    }
  }

  /**
   * Forward Model Hub routing decisions to Aegis Audit Logger
   */
  public async logDecision(record: AuditRecord): Promise<void> {
    if (!this.aegis?.auditLogger?.logEvent) {
      return;
    }

    try {
      await this.aegis.auditLogger.logEvent({
        eventType: 'MODEL_ROUTING_DECISION',
        timestamp: record.timestamp,
        agentId: this.defaultAgentId,
        details: {
          taskId: record.taskId,
          category: record.category,
          sensitivity: record.sensitivity,
          chosenModel: record.chosenModel,
          location: record.location,
          overridden: record.overridden,
          promptHash: record.promptHash,
          promptLength: record.promptLength,
          latencyMs: record.latencyMs,
          success: record.success,
        },
      });
    } catch (err: any) {
      // Non-blocking logger failure
      console.warn(`[AegisAdapter] Failed to forward audit event to Aegis: ${err?.message}`);
    }
  }
}

export function createAegisIntegration(aegis?: AegisLike): AegisAdapter {
  return new AegisAdapter(aegis);
}
