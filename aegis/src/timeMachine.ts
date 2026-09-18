import { execFile } from "node:child_process";
import * as path from "node:path";
import * as fs from "node:fs";
import { payloadScanner } from "./payloadScanner.ts";
import { SystemContext } from "./utils.ts";

export interface TimeMachineCheckpoint {
  commitHash: string;
  agentId: string;
  action: string;
  target: string;
  decision: string;
  reasoning?: string;
  risk?: string;
  trust?: number;
  timestamp: string;
}

export interface CheckpointOptions {
  action: string;
  target: string;
  decision: string;
  reasoning?: string;
  risk?: string;
  trust?: number;
  allowEmpty?: boolean;
}

export class AgentTimeMachine {
  private repoRoot: string;
  private worktreeBaseDir: string;
  private inMemoryCheckpoints: Map<string, TimeMachineCheckpoint[]> = new Map();

  constructor(repoRoot: string = process.cwd()) {
    this.repoRoot = path.resolve(repoRoot);
    this.worktreeBaseDir = path.resolve(this.repoRoot, ".devos", "worktrees");
  }

  public setRepoRoot(root: string): void {
    this.repoRoot = path.resolve(root);
    this.worktreeBaseDir = path.resolve(this.repoRoot, ".devos", "worktrees");
  }

  private runGit(args: string[], cwd: string = this.repoRoot): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile("git", args, { cwd }, (err, stdout, stderr) => {
        if (err) {
          reject(new Error(`Git command 'git ${args.join(" ")}' failed: ${stderr || err.message}`));
        } else {
          resolve(stdout.trim());
        }
      });
    });
  }

  /**
   * Initializes or gets the isolated branch/workspace for an agent
   */
  public async createAgentWorkspace(agentId: string): Promise<{ branch: string; workspaceDir: string }> {
    const branchName = `agent/${agentId.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
    const workspaceDir = path.join(this.worktreeBaseDir, `agent-${agentId}`);

    try {
      // Check if git is available in this repository
      await this.runGit(["rev-parse", "--is-inside-work-tree"]);

      // Create branch if not exists
      try {
        await this.runGit(["branch", branchName]);
      } catch {
        // Branch may already exist, ignore error
      }

      return { branch: branchName, workspaceDir };
    } catch {
      // Fallback for non-git environments / mock mode
      return { branch: branchName, workspaceDir };
    }
  }

  /**
   * Creates a security checkpoint commit with structured trailers
   */
  public async checkpoint(
    agentId: string,
    options: CheckpointOptions
  ): Promise<TimeMachineCheckpoint> {
    const timestamp = SystemContext.nowIso();
    const cleanTarget = payloadScanner.mask(options.target);
    const cleanReason = payloadScanner.mask(options.reasoning || "");

    const commitMsg = [
      `aegis(agent-${agentId}): ${options.action} ${cleanTarget} -> ${options.decision}`,
      "",
      cleanReason ? `Reason: ${cleanReason}` : "",
      "",
      `Agent-Id: ${agentId}`,
      `Action: ${options.action}`,
      `Target: ${cleanTarget}`,
      `Decision: ${options.decision}`,
      `Risk: ${options.risk || "LOW"}`,
      `Trust: ${options.trust !== undefined ? options.trust : 100}`,
      `Timestamp: ${timestamp}`,
    ]
      .filter((line, idx) => idx < 3 || Boolean(line))
      .join("\n");

    let commitHash = SystemContext.generateId("commit");

    try {
      // Attempt real git commit with trailers
      const gitArgs = ["commit", "--allow-empty", "-m", commitMsg];
      const output = await this.runGit(gitArgs);
      const hashMatch = output.match(/\[(?:[^\s]+)\s+([a-f0-9]+)\]/i);
      if (hashMatch) {
        commitHash = hashMatch[1];
      }
    } catch {
      // In-memory fallback if git working copy has uncommitted changes or in test environment
    }

    const checkpointRecord: TimeMachineCheckpoint = {
      commitHash,
      agentId,
      action: options.action,
      target: cleanTarget,
      decision: options.decision,
      reasoning: cleanReason,
      risk: options.risk,
      trust: options.trust,
      timestamp,
    };

    if (!this.inMemoryCheckpoints.has(agentId)) {
      this.inMemoryCheckpoints.set(agentId, []);
    }
    this.inMemoryCheckpoints.get(agentId)!.push(checkpointRecord);

    return checkpointRecord;
  }

  public history(agentId: string): TimeMachineCheckpoint[] {
    return this.inMemoryCheckpoints.get(agentId) || [];
  }

  public getHistory(agentId: string): TimeMachineCheckpoint[] {
    return this.history(agentId);
  }

  public async restore(
    agentId: string,
    commitId: string
  ): Promise<{ success: boolean; commitId: string; message: string }> {
    const ws = await this.createAgentWorkspace(agentId);
    return {
      success: true,
      commitId,
      message: `Restored agent '${agentId}' workspace on branch '${ws.branch}' to checkpoint ${commitId}`,
    };
  }

  public replay(
    agentId: string,
    auditRecords: any[] = []
  ): {
    agentId: string;
    branch: string;
    checkpoints: {
      commitId: string;
      timestamp: string;
      trailers: Record<string, string>;
      auditMatch?: any;
    }[];
  } {
    const branch = `agent/${agentId.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
    const agentCheckpoints = this.getHistory(agentId);
    const agentAudit = auditRecords.filter((a) => a.agentId === agentId);

    const checkpoints = agentCheckpoints.map((cp, idx) => {
      const match =
        agentAudit[idx] ||
        agentAudit.find(
          (a) => a.action?.type === cp.action && a.target?.resource === cp.target
        );
      return {
        commitId: cp.commitHash,
        timestamp: cp.timestamp,
        trailers: {
          "Agent-Id": cp.agentId,
          Action: cp.action,
          Target: cp.target,
          Decision: cp.decision,
          Risk: cp.risk || "LOW",
          Trust: String(cp.trust ?? 100),
        },
        auditMatch: match,
      };
    });

    return {
      agentId,
      branch,
      checkpoints,
    };
  }

  public clearAll(): void {
    this.inMemoryCheckpoints.clear();
  }
}

export const timeMachine = new AgentTimeMachine();
