import { createServer } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import type { BackPingRequest, BackPingSettings, NotifierProvider, NotifyInput, ProviderSendResult } from "../src/shared/types.js";
import { McpHttpServer } from "../src/main/mcp-server.js";
import { RequestManager, type RequestHistory } from "../src/main/request-manager.js";

class MemoryHistory implements RequestHistory {
  requests: BackPingRequest[] = [];
  list(): BackPingRequest[] {
    return this.requests;
  }
  save(requests: BackPingRequest[]): void {
    this.requests = [...requests];
  }
}

class FakeProvider implements NotifierProvider {
  readonly name = "telegram" as const;
  sentRequests: BackPingRequest[] = [];

  async start(): Promise<void> {}
  async stop(): Promise<void> {}
  async isConfigured(): Promise<boolean> {
    return true;
  }
  isConnected(): boolean {
    return true;
  }
  async sendRequest(request: BackPingRequest): Promise<ProviderSendResult> {
    this.sentRequests.push(request);
    return { providerMessageId: `msg-${request.id}` };
  }
  async sendNotification(_input: NotifyInput): Promise<ProviderSendResult> {
    return { providerMessageId: "notify-1" };
  }
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Could not allocate port"));
        return;
      }
      const port = address.port;
      server.close(() => resolve(port));
    });
  });
}

describe("MCP HTTP integration", () => {
  let server: McpHttpServer | undefined;
  let client: Client | undefined;

  afterEach(async () => {
    await client?.close();
    await server?.stop();
    client = undefined;
    server = undefined;
  });

  it("calls ask_user over Streamable HTTP and resolves independently", async () => {
    const port = await freePort();
    const settings: BackPingSettings = {
      port,
      authToken: "test-token",
      historyLimit: 100,
      telegramChatId: "1"
    };
    const config = { getSettings: () => settings };
    const provider = new FakeProvider();
    const manager = new RequestManager(new MemoryHistory(), () => provider, () => 100);
    server = new McpHttpServer(config, manager);
    await server.start();

    client = new Client({ name: "backping-test", version: "1.0.1" });
    const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
      requestInit: {
        headers: {
          Authorization: "Bearer test-token"
        }
      }
    });
    await client.connect(transport);

    const resultPromise = client.request(
      {
        method: "tools/call",
        params: {
          name: "ask_user",
          arguments: {
            question: "Proceed?",
            agent: "Codex",
            cwd: "/tmp/backping",
            mode: "wait",
            timeout_seconds: 10
          }
        }
      },
      CallToolResultSchema
    );

    await vi.waitFor(() => expect(provider.sentRequests).toHaveLength(1));
    manager.resolveByRequestId(provider.sentRequests[0].id, "yes");

    const result = await resultPromise;
    expect(result.content[0]).toMatchObject({ type: "text" });
    expect(JSON.parse(result.content[0].type === "text" ? result.content[0].text : "{}")).toMatchObject({
      status: "answered",
      answer: "yes"
    });
  });
});
