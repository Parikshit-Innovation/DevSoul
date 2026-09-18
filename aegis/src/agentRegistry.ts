import type { Agent, AgentRole, AgentState } from "./models.ts";

export interface AgentManifest {
  id: string;
  name?: string;
  role?: AgentRole;
  allowedPaths?: string[];
  allowedMcpTools?: string[];
  initialTrust?: number;
  capabilities?: string[];
  metadata?: Record<string, any>;
}

export class AgentRegistry {
  private agents: Map<string, Agent> = new Map();

  constructor() {
    this.seedDefaultAgents();
  }

  public registerAgent(manifest: AgentManifest): Agent {
    if (!manifest.id || typeof manifest.id !== "string") {
      throw new Error("Agent manifest requires a valid non-empty 'id'");
    }

    const agent: Agent = {
      id: manifest.id.trim(),
      name: manifest.name || manifest.id,
      role: manifest.role || "custom",
      allowedPaths: manifest.allowedPaths || ["**"],
      capabilities: manifest.capabilities || [],
      metadata: {
        allowedMcpTools: manifest.allowedMcpTools || [],
        ...manifest.metadata,
      },
      trustScore: manifest.initialTrust !== undefined ? manifest.initialTrust : 100,
      state: "ACTIVE",
    };

    this.agents.set(agent.id, agent);
    return agent;
  }

  public getAgent(agentId: string): Agent | undefined {
    return this.agents.get(agentId);
  }

  public hasAgent(agentId: string): boolean {
    return this.agents.has(agentId);
  }

  public listAgents(): Agent[] {
    return Array.from(this.agents.values());
  }

  public unregisterAgent(agentId: string): boolean {
    return this.agents.delete(agentId);
  }

  public clearAll(): void {
    this.agents.clear();
  }

  public seedDefaultAgents(): void {
    const defaults: AgentManifest[] = [
      {
        id: "frontend-01",
        name: "Frontend Developer Agent",
        role: "frontend",
        allowedPaths: ["src/frontend/**", "src/components/**", "public/**", "package.json", "README.md"],
        allowedMcpTools: ["readFile", "writeFile", "listDirectory", "gitStatus"],
        initialTrust: 100,
      },
      {
        id: "frontend-agent-01",
        name: "Frontend Specialist Agent",
        role: "frontend",
        allowedPaths: ["src/frontend/**", "src/components/**", "public/**", "package.json", "README.md"],
        allowedMcpTools: ["readFile", "writeFile", "listDirectory"],
        initialTrust: 100,
      },
      {
        id: "backend-01",
        name: "Backend Service Agent",
        role: "backend",
        allowedPaths: ["src/**", "database/**", "migrations/**", "package.json", "README.md"],
        allowedMcpTools: ["readFile", "writeFile", "installPackage", "runCommand", "listDirectory"],
        initialTrust: 100,
      },
      {
        id: "devops-agent",
        name: "DevOps & Infrastructure Agent",
        role: "devops",
        allowedPaths: ["**"],
        allowedMcpTools: ["readFile", "writeFile", "runCommand", "deploy", "gitPush"],
        initialTrust: 100,
      },
      {
        id: "reviewer-01",
        name: "Code Reviewer Agent",
        role: "reviewer",
        allowedPaths: ["src/**", "docs/**", "README.md"],
        allowedMcpTools: ["readFile", "listDirectory"],
        initialTrust: 100,
      },
      {
        id: "agent-demo-001",
        name: "Standard Demo Agent",
        role: "fullstack",
        allowedPaths: ["**"],
        allowedMcpTools: ["readFile", "writeFile"],
        initialTrust: 92,
      },
      {
        id: "frontend-001",
        name: "Frontend Test Agent 1",
        role: "frontend",
        allowedPaths: ["src/frontend/**", "src/**", "README.md"],
        allowedMcpTools: ["readFile"],
        initialTrust: 100,
      },
      {
        id: "frontend-002",
        name: "Frontend Test Agent 2",
        role: "frontend",
        allowedPaths: ["src/frontend/**", "src/**"],
        allowedMcpTools: ["readFile"],
        initialTrust: 92,
      },
      {
        id: "frontend-003",
        name: "Frontend Test Agent 3",
        role: "frontend",
        allowedPaths: ["src/frontend/**", "src/**"],
        allowedMcpTools: ["readFile"],
        initialTrust: 92,
      },
      {
        id: "rogue-agent-007",
        name: "Rogue Test Agent",
        role: "custom",
        allowedPaths: ["src/**"],
        allowedMcpTools: ["readFile"],
        initialTrust: 92,
      },
      {
        id: "mcp-agent-01",
        name: "MCP Gateway Test Agent",
        role: "custom",
        allowedPaths: ["src/**"],
        allowedMcpTools: ["readFile", "writeFile"],
        initialTrust: 100,
      },
      {
        id: "worker-01",
        name: "General Worker Agent",
        role: "custom",
        allowedPaths: ["src/**"],
        allowedMcpTools: ["readFile"],
        initialTrust: 100,
      },
    ];

    for (const d of defaults) {
      this.registerAgent(d);
    }
  }
}

export const agentRegistry = new AgentRegistry();
export const registerAgent = (manifest: AgentManifest): Agent => agentRegistry.registerAgent(manifest);
