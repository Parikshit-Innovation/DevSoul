import * as http from "node:http";
import { check } from "./middleware.ts";
import { agentRegistry } from "./agentRegistry.ts";
import { auditLogger } from "./auditLogger.ts";
import { approvalManager } from "./approvalManager.ts";
import { quarantineManager } from "./quarantineManager.ts";
import { aegisEvents } from "./events.ts";

export class AegisHttpServer {
  private server?: http.Server;
  private isRunning: boolean = false;

  public start(port: number = 4000, host: string = "127.0.0.1"): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer(async (req, res) => {
        // Enable CORS for local testing / extension UI
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type");

        if (req.method === "OPTIONS") {
          res.writeHead(204);
          res.end();
          return;
        }

        const url = new URL(req.url || "/", `http://${host}:${port}`);
        const pathname = url.pathname;

        try {
          // 1. POST /check -> evaluate security
          if (req.method === "POST" && pathname === "/check") {
            const body = await this.readJsonBody(req);
            const decision = check(body.agent || body.agentId, body.action, body.target);
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(decision));
            return;
          }

          // 2. POST /agents -> register agent
          if (req.method === "POST" && pathname === "/agents") {
            const body = await this.readJsonBody(req);
            const agent = agentRegistry.registerAgent(body);
            res.writeHead(201, { "Content-Type": "application/json" });
            res.end(JSON.stringify(agent));
            return;
          }

          // 3. GET /agents/:id or GET /agents
          if (req.method === "GET" && pathname.startsWith("/agents")) {
            const parts = pathname.split("/").filter(Boolean);
            if (parts.length === 2) {
              const agentId = parts[1];
              const agent = agentRegistry.getAgent(agentId);
              if (!agent) {
                res.writeHead(404, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "Agent not found" }));
                return;
              }
              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(JSON.stringify(agent));
              return;
            } else {
              const all = agentRegistry.listAgents();
              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(JSON.stringify(all));
              return;
            }
          }

          // 4. GET /audit -> query audit records
          if (req.method === "GET" && pathname === "/audit") {
            const agentId = url.searchParams.get("agentId") || undefined;
            const logs = auditLogger.getLogs(agentId ? { agentId } : undefined);
            const verification = auditLogger.verifyChain();
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ logs, verification }));
            return;
          }

          // 5. GET /approvals -> get pending human approvals
          if (req.method === "GET" && pathname === "/approvals") {
            const agentId = url.searchParams.get("agentId") || undefined;
            const pending = approvalManager.getPendingRequests(agentId);
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(pending));
            return;
          }

          // 6. POST /approvals/:id/resolve -> approve or deny
          if (req.method === "POST" && pathname.startsWith("/approvals/") && pathname.endsWith("/resolve")) {
            const parts = pathname.split("/").filter(Boolean);
            const requestId = parts[1];
            const body = await this.readJsonBody(req);
            const isApprove = body.status === "APPROVED";
            const resolved = isApprove
              ? approvalManager.approveRequest(requestId, body.resolvedBy || "admin")
              : approvalManager.denyRequest(requestId, body.resolvedBy || "admin");

            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(resolved));
            return;
          }

          // 7. GET /events -> Server-Sent Events (SSE) live feed
          if (req.method === "GET" && pathname === "/events") {
            res.writeHead(200, {
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-cache",
              Connection: "keep-alive",
            });

            res.write(`data: ${JSON.stringify({ type: "connected", timestamp: new Date().toISOString() })}\n\n`);

            const onDecision = (data: any) => res.write(`event: decision\ndata: ${JSON.stringify(data)}\n\n`);
            const onTrust = (data: any) => res.write(`event: trust_changed\ndata: ${JSON.stringify(data)}\n\n`);
            const onQuarantine = (data: any) => res.write(`event: quarantined\ndata: ${JSON.stringify(data)}\n\n`);

            aegisEvents.onEvent("decision", onDecision);
            aegisEvents.onEvent("trust_changed", onTrust);
            aegisEvents.onEvent("quarantined", onQuarantine);

            req.on("close", () => {
              aegisEvents.removeListener("decision", onDecision);
              aegisEvents.removeListener("trust_changed", onTrust);
              aegisEvents.removeListener("quarantined", onQuarantine);
            });
            return;
          }

          // 404 for other endpoints
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Endpoint not found" }));
        } catch (err: any) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: err?.message || "Internal server error" }));
        }
      });

      this.server.listen(port, host, () => {
        this.isRunning = true;
        resolve();
      });

      this.server.on("error", (err) => reject(err));
    });
  }

  public stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server && this.isRunning) {
        this.server.close(() => {
          this.isRunning = false;
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  private readJsonBody(req: http.IncomingMessage): Promise<any> {
    return new Promise((resolve, reject) => {
      let data = "";
      req.on("data", (chunk) => (data += chunk));
      req.on("end", () => {
        try {
          resolve(data ? JSON.parse(data) : {});
        } catch (err) {
          reject(new Error("Invalid JSON body"));
        }
      });
      req.on("error", (err) => reject(err));
    });
  }
}

export const aegisHttpServer = new AegisHttpServer();
