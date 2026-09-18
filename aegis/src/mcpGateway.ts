import { check } from "./middleware.ts";
import { agentRegistry } from "./agentRegistry.ts";
import { approvalManager } from "./approvalManager.ts";
import { auditLogger } from "./auditLogger.ts";
import type { Action, AegisDecision, Target } from "./models.ts";

export interface McpToolCallRequest {
  name: string;
  arguments?: Record<string, any>;
  approvalTicketId?: string;
}

export interface McpToolExecutionResult<T = any> {
  success: boolean;
  decision?: AegisDecision;
  result?: T;
  error?: string;
  source: "gateway" | "aegis" | "tool";
}

export type McpToolHandler<T = any> = (args: Record<string, any>) => Promise<T> | T;

export class McpGateway {
  private toolHandlers: Map<string, McpToolHandler> = new Map();

  public registerTool<T = any>(name: string, handler: McpToolHandler<T>): void {
    this.toolHandlers.set(name, handler);
  }

  public unregisterTool(name: string): boolean {
    return this.toolHandlers.delete(name);
  }

  public clearTools(): void {
    this.toolHandlers.clear();
  }

  /**
   * Declarative mapping from MCP tool call shape to Aegis (Action, Target)
   */
  public mapToolToAction(toolCall: McpToolCallRequest): { action: Action; target: Target } {
    const name = toolCall.name;
    const args = toolCall.arguments || {};

    switch (name) {
      case "readFile":
      case "read_file":
      case "fs.read":
        return {
          action: { type: "read", details: args },
          target: { resource: args.path || args.file || args.uri || "unknown_file", type: "file" },
        };

      case "writeFile":
      case "write_file":
      case "fs.write":
        return {
          action: { type: "write", details: args },
          target: { resource: args.path || args.file || args.uri || "unknown_file", type: "file" },
        };

      case "deleteFile":
      case "delete_file":
      case "fs.delete":
        return {
          action: { type: "delete", details: args },
          target: { resource: args.path || args.file || "unknown_file", type: "file" },
        };

      case "runCommand":
      case "execute_command":
      case "terminal.execute":
        return {
          action: { type: "run_command", details: args },
          target: { resource: args.command || args.cmd || "unknown_command", type: "command" },
        };

      case "fetchUrl":
      case "http_request":
      case "network.fetch":
        return {
          action: { type: "network_call", details: args },
          target: { resource: args.url || args.endpoint || "http://unknown", type: "network" },
        };

      case "installPackage":
      case "package.install":
        return {
          action: { type: "install_package", details: args },
          target: { resource: args.packageName || args.name || "unknown_package", type: "system" },
        };

      case "modifySchema":
      case "db.migrate":
        return {
          action: { type: "modify_schema", details: args },
          target: { resource: args.schemaFile || args.database || "database_schema", type: "database" },
        };

      case "gitPush":
      case "git.push":
        return {
          action: { type: "git_push", details: args },
          target: { resource: args.branch || args.remote || "origin/main", type: "system" },
        };

      case "gitCommit":
      case "git.commit":
        return {
          action: { type: "git_commit", details: args },
          target: { resource: args.message || "commit", type: "system" },
        };

      default:
        return {
          action: { type: name, details: args },
          target: { resource: args.path || args.target || args.resource || name, type: "custom" },
        };
    }
  }

  /**
   * Execute MCP tool through complete Aegis authorization pipeline
   */
  public async executeTool<T = any>(
    agentId: string,
    toolCall: McpToolCallRequest
  ): Promise<McpToolExecutionResult<T>> {
    const toolName = toolCall.name;
    const args = toolCall.arguments || {};
    const agent = agentRegistry.getAgent(agentId);

    // 1. Gateway Tool Allow-List Check
    const allowedTools: string[] = agent?.metadata?.allowedMcpTools || [];
    const isToolAllowed =
      allowedTools.includes("*") ||
      allowedTools.includes(toolName) ||
      allowedTools.some((t) => t.toLowerCase() === toolName.toLowerCase());

    if (!isToolAllowed && agent) {
      auditLogger.log({
        agentId,
        agentRole: agent.role,
        agentState: agent.state || "ACTIVE",
        action: { type: toolName, details: args },
        target: { resource: toolName, type: "tool" },
        decision: "BLOCK",
        reason: `MCP Gateway Block: Tool '${toolName}' is not in agent's declared MCP allow-list [${allowedTools.join(", ")}]`,
        trustBefore: agent.trustScore || 100,
        trustAfter: agent.trustScore || 100,
        quarantineStatus: agent.state || "ACTIVE",
        decidedBy: "mcp_gateway",
      });

      return {
        success: false,
        source: "gateway",
        error: `MCP Gateway Denied: Tool '${toolName}' is not allowed for agent '${agentId}'`,
      };
    }

    // 2. Map tool to Action/Target and run Aegis Check
    const { action, target } = this.mapToolToAction(toolCall);
    const decision = check(agentId, action, target);

    if (decision.decision === "BLOCK") {
      return {
        success: false,
        decision,
        source: "aegis",
        error: `Aegis Security Block: ${decision.reason}`,
      };
    }

    if (decision.decision === "APPROVE") {
      // Check if caller supplied an approval ticket
      if (toolCall.approvalTicketId) {
        const consumeRes = approvalManager.consumeApproval(
          toolCall.approvalTicketId,
          agentId,
          action,
          target
        );
        if (!consumeRes.success) {
          return {
            success: false,
            decision,
            source: "aegis",
            error: `Human approval ticket validation failed: ${consumeRes.error}`,
          };
        }
      } else {
        return {
          success: false,
          decision,
          source: "aegis",
          error: `Aegis Human Approval Required: ${decision.reason} (Ticket ID: ${decision.approvalRequest?.id})`,
        };
      }
    }

    // 3. Forward to Tool Execution
    const handler = this.toolHandlers.get(toolName);
    if (!handler) {
      return {
        success: false,
        decision,
        source: "tool",
        error: `MCP Tool '${toolName}' is permitted by Aegis but has no registered executor handler`,
      };
    }

    try {
      const result = await handler(args);
      return {
        success: true,
        decision,
        source: "tool",
        result,
      };
    } catch (err: any) {
      return {
        success: false,
        decision,
        source: "tool",
        error: `Tool execution failed: ${err?.message || String(err)}`,
      };
    }
  }
}

export const mcpGateway = new McpGateway();
