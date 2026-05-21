import type { Server as HttpServer } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import * as z from "zod/v4";
import type { Express, Request, Response } from "express";
import type { BackPingSettings, CreateRequestInput, NotifyInput } from "../shared/types.js";

const HOST = "127.0.0.1";

export function isAuthorizedHeader(value: string | undefined, authToken: string): boolean {
  return value === `Bearer ${authToken}`;
}

export interface McpSettingsSource {
  getSettings(): BackPingSettings;
}

export interface McpRequestTools {
  ask(input: CreateRequestInput): Promise<unknown>;
  notify(input: NotifyInput): Promise<unknown>;
  listPending(): unknown[];
  cancel(requestId: string): boolean;
}

export class McpHttpServer {
  private httpServer: HttpServer | undefined;

  constructor(
    private readonly config: McpSettingsSource,
    private readonly requestManager: McpRequestTools
  ) {}

  async start(): Promise<void> {
    if (this.httpServer) {
      return;
    }

    const settings = this.config.getSettings();
    const app = this.createApp(settings.authToken);

    await new Promise<void>((resolve, reject) => {
      const server = app.listen(settings.port, HOST, () => {
        this.httpServer = server;
        resolve();
      });
      server.once("error", reject);
    });
  }

  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  async stop(): Promise<void> {
    if (!this.httpServer) {
      return;
    }

    const server = this.httpServer;
    this.httpServer = undefined;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  isRunning(): boolean {
    return Boolean(this.httpServer);
  }

  private createApp(authToken: string): Express {
    const app = createMcpExpressApp({ host: HOST });

    app.get("/health", (_req: Request, res: Response) => {
      res.json({ ok: true, name: "backping", mcpRunning: this.isRunning() });
    });

    app.use("/mcp", (req, res, next) => {
      if (!isAuthorizedHeader(req.header("authorization"), authToken)) {
        res.status(401).json({
          jsonrpc: "2.0",
          error: {
            code: -32001,
            message: "Unauthorized"
          },
          id: null
        });
        return;
      }
      next();
    });

    app.post("/mcp", async (req: Request, res: Response) => {
      const server = this.createMcpServer();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined
      });

      try {
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
        res.on("close", () => {
          void transport.close();
          void server.close();
        });
      } catch (error) {
        if (!res.headersSent) {
          res.status(500).json({
            jsonrpc: "2.0",
            error: {
              code: -32603,
              message: error instanceof Error ? error.message : "Internal server error"
            },
            id: null
          });
        }
      }
    });

    app.get("/mcp", (_req: Request, res: Response) => {
      res.status(405).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Method not allowed." },
        id: null
      });
    });

    app.delete("/mcp", (_req: Request, res: Response) => {
      res.status(405).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Method not allowed." },
        id: null
      });
    });

    return app;
  }

  private createMcpServer(): McpServer {
    const server = new McpServer({
      name: "backping",
      version: "1.0.1"
    });

    server.registerTool(
      "ask_user",
      {
        title: "Ask user",
        description: "Ask the human user a question over the configured messaging provider and optionally wait for the answer.",
        inputSchema: {
          question: z.string().min(1).describe("The question to ask the user."),
          cwd: z.string().optional().describe("Current working directory for context."),
          agent: z.string().optional().describe("Name of the agent asking."),
          context: z.string().optional().describe("Short context for why the question is being asked."),
          choices: z.array(z.string()).optional().describe("Optional choices to show as buttons."),
          timeout_seconds: z.number().int().positive().optional().describe("How long to wait before timing out."),
          mode: z.enum(["wait", "async"]).optional().describe("Use wait to block for an answer, or async to return request id immediately.")
        }
      },
      async (args) => {
        const result = await this.requestManager.ask({
          question: args.question,
          cwd: args.cwd,
          agent: args.agent,
          context: args.context,
          choices: args.choices,
          timeoutSeconds: args.timeout_seconds,
          mode: args.mode
        });
        return this.jsonToolResult(result);
      }
    );

    server.registerTool(
      "notify_user",
      {
        title: "Notify user",
        description: "Send a one-way notification to the human user.",
        inputSchema: {
          message: z.string().min(1),
          cwd: z.string().optional(),
          agent: z.string().optional(),
          context: z.string().optional()
        }
      },
      async (args) => {
        const result = await this.requestManager.notify(args);
        return this.jsonToolResult(result);
      }
    );

    server.registerTool(
      "get_status",
      {
        title: "Get BackPing status",
        description: "Return BackPing status and pending request count.",
        inputSchema: {}
      },
      async () => this.jsonToolResult({
        status: "ok",
        pending_count: this.requestManager.listPending().length,
        port: this.config.getSettings().port
      })
    );

    server.registerTool(
      "list_pending_requests",
      {
        title: "List pending requests",
        description: "List currently pending human-input requests.",
        inputSchema: {}
      },
      async () => this.jsonToolResult({
        requests: this.requestManager.listPending()
      })
    );

    server.registerTool(
      "cancel_request",
      {
        title: "Cancel request",
        description: "Cancel a pending human-input request.",
        inputSchema: {
          request_id: z.string().min(1)
        }
      },
      async (args) => this.jsonToolResult({
        cancelled: this.requestManager.cancel(args.request_id),
        request_id: args.request_id
      })
    );

    return server;
  }

  private jsonToolResult(value: unknown): { content: Array<{ type: "text"; text: string }> } {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(value, null, 2)
        }
      ]
    };
  }
}
