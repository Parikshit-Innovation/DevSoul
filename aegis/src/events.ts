import { EventEmitter } from "node:events";
import type { AegisDecision, ApprovalRequest, RiskAssessment } from "./models.ts";

export interface AegisEventMap {
  decision: {
    agentId: string;
    decision: string;
    action: string;
    target: string;
    risk?: RiskAssessment;
    trustBefore: number;
    trustAfter: number;
    quarantined: boolean;
    timestamp: string;
  };
  trust_changed: {
    agentId: string;
    trustBefore: number;
    trustAfter: number;
    reason: string;
    timestamp: string;
  };
  quarantined: {
    agentId: string;
    reason: string;
    timestamp: string;
  };
  approval_requested: {
    requestId: string;
    agentId: string;
    action: string;
    target: string;
    reason: string;
    timestamp: string;
  };
  approval_resolved: {
    requestId: string;
    status: string;
    resolvedBy?: string;
    timestamp: string;
  };
}

export class AegisEventEmitter extends EventEmitter {
  public emitEvent<K extends keyof AegisEventMap>(eventName: K, data: AegisEventMap[K]): boolean {
    return this.emit(eventName, data);
  }

  public onEvent<K extends keyof AegisEventMap>(
    eventName: K,
    listener: (data: AegisEventMap[K]) => void
  ): this {
    return this.on(eventName, listener);
  }
}

export const aegisEvents = new AegisEventEmitter();
