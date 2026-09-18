import { createHash } from "node:crypto";
import type { Action, ApprovalRequest, Target } from "./models.ts";
import { SystemContext } from "./utils.ts";

export class ApprovalManager {
  private requests: Map<string, ApprovalRequest> = new Map();
  private defaultTtlMs: number = 10 * 60 * 1000; // 10 minutes

  public computeActionHash(agentId: string, action: Action, target: Target): string {
    const raw = `${agentId}::${action.type}::${target.resource}::${JSON.stringify(action.details || {})}`;
    return createHash("sha256").update(raw).digest("hex");
  }

  public createRequest(
    agentId: string,
    action: Action,
    target: Target,
    reason: string,
    ttlMs: number = this.defaultTtlMs
  ): ApprovalRequest {
    const now = SystemContext.now();
    const actionHash = this.computeActionHash(agentId, action, target);

    const request: ApprovalRequest = {
      id: SystemContext.generateId("appr"),
      agentId,
      action,
      target,
      reason,
      status: "WAITING_FOR_HUMAN",
      actionHash,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
    };

    this.requests.set(request.id, request);
    return request;
  }

  public approveRequest(requestId: string, resolvedBy: string = "human_admin"): ApprovalRequest {
    const request = this.getRequest(requestId);
    if (!request) {
      throw new Error(`Approval request with ID '${requestId}' not found`);
    }

    if (this.isExpired(request)) {
      request.status = "EXPIRED";
      request.resolvedAt = SystemContext.nowIso();
      request.resolvedBy = resolvedBy;
      throw new Error(`Cannot approve request '${requestId}': Request has expired`);
    }

    if (request.status === "CONSUMED") {
      throw new Error(`Cannot approve request '${requestId}': Request was already consumed`);
    }

    request.status = "APPROVED";
    request.resolvedAt = SystemContext.nowIso();
    request.resolvedBy = resolvedBy;

    return request;
  }

  public denyRequest(requestId: string, resolvedBy: string = "human_admin"): ApprovalRequest {
    const request = this.getRequest(requestId);
    if (!request) {
      throw new Error(`Approval request with ID '${requestId}' not found`);
    }

    request.status = "DENIED";
    request.resolvedAt = SystemContext.nowIso();
    request.resolvedBy = resolvedBy;

    return request;
  }

  /**
   * Single-use consumption of an approved request
   */
  public consumeApproval(
    requestId: string,
    agentId: string,
    action: Action,
    target: Target
  ): { success: boolean; error?: string } {
    const request = this.getRequest(requestId);
    if (!request) {
      return { success: false, error: `Approval ticket '${requestId}' does not exist` };
    }

    if (this.isExpired(request)) {
      request.status = "EXPIRED";
      return { success: false, error: `Approval ticket '${requestId}' has expired` };
    }

    if (request.status === "CONSUMED") {
      return { success: false, error: `Replay attack detected: Approval ticket '${requestId}' has already been consumed` };
    }

    if (request.status !== "APPROVED") {
      return { success: false, error: `Approval ticket '${requestId}' is not in APPROVED state (current status: ${request.status})` };
    }

    // Verify action hash binding
    const currentHash = this.computeActionHash(agentId, action, target);
    if (request.actionHash && request.actionHash !== currentHash) {
      return {
        success: false,
        error: `Approval ticket '${requestId}' does not match action payload hash (ticket bound to different action/target)`,
      };
    }

    // Mark as consumed
    request.status = "CONSUMED";
    request.consumedAt = SystemContext.nowIso();

    return { success: true };
  }

  public isExpired(request: ApprovalRequest): boolean {
    if (!request.expiresAt) return false;
    const nowTime = SystemContext.now().getTime();
    const expireTime = new Date(request.expiresAt).getTime();
    return nowTime > expireTime;
  }

  public getRequest(requestId: string): ApprovalRequest | undefined {
    const req = this.requests.get(requestId);
    if (req && req.status === "WAITING_FOR_HUMAN" && this.isExpired(req)) {
      req.status = "EXPIRED";
    }
    return req;
  }

  public getPendingRequests(agentId?: string): ApprovalRequest[] {
    const all = Array.from(this.requests.values()).filter((r) => {
      if (r.status === "WAITING_FOR_HUMAN") {
        if (this.isExpired(r)) {
          r.status = "EXPIRED";
          return false;
        }
        return true;
      }
      return false;
    });

    if (agentId) {
      return all.filter((r) => r.agentId === agentId);
    }
    return all;
  }

  public clearAll(): void {
    this.requests.clear();
  }
}

export const approvalManager = new ApprovalManager();
