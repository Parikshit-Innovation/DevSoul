export type * from "./models.ts";
export * from "./utils.ts";
export * from "./pathSecurity.ts";
export * from "./resourceClassifier.ts";
export * from "./commandAnalyzer.ts";
export * from "./payloadScanner.ts";
export * from "./networkSecurity.ts";
export * from "./scopeManager.ts";
export * from "./agentRegistry.ts";
export * from "./policyConfig.ts";
export * from "./behaviorAnalyzer.ts";
export * from "./riskEngine.ts";
export * from "./policyEngine.ts";
export * from "./trustManager.ts";
export * from "./violationTracker.ts";
export * from "./approvalManager.ts";
export * from "./quarantineManager.ts";
export * from "./auditLogger.ts";
export * from "./events.ts";
export * from "./httpServer.ts";
export * from "./mcpGateway.ts";
export * from "./timeMachine.ts";
export * from "./middleware.ts";

import { check } from "./middleware.ts";
import { mcpGateway } from "./mcpGateway.ts";
import type { McpToolCallRequest } from "./mcpGateway.ts";

/**
 * Legacy wrapper for MCP Tool Call Interception
 */
export async function mcpToolInterceptor<T>(
  agentId: string,
  toolName: string,
  params: Record<string, any>,
  executeTool: () => Promise<T>
): Promise<{ success: boolean; decision: any; result?: T; error?: string }> {
  // Register ad-hoc tool handler if not already present
  mcpGateway.registerTool(toolName, executeTool);

  const execResult = await mcpGateway.executeTool<T>(agentId, {
    name: toolName,
    arguments: params,
  });

  return {
    success: execResult.success,
    decision: execResult.decision,
    result: execResult.result,
    error: execResult.error,
  };
}

export default check;
