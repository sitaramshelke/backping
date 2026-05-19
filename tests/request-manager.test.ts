import { afterEach, describe, expect, it, vi } from "vitest";
import type { BackPingRequest, NotifierProvider, NotifyInput, ProviderSendResult } from "../src/shared/types.js";
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
  sendRequestHandler: ((request: BackPingRequest) => Promise<ProviderSendResult>) | undefined;

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
    if (this.sendRequestHandler) {
      return this.sendRequestHandler(request);
    }
    return { providerMessageId: `msg-${request.id}` };
  }
  async sendNotification(_input: NotifyInput): Promise<ProviderSendResult> {
    return { providerMessageId: "notify-1" };
  }
}

function createManager(provider = new FakeProvider()) {
  const history = new MemoryHistory();
  const manager = new RequestManager(history, () => provider, () => 100);
  return { manager, provider, history };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("RequestManager", () => {
  it("creates async pending requests", async () => {
    const { manager, provider } = createManager();
    const result = await manager.ask({
      question: "Which option?",
      agent: "Codex",
      cwd: "/tmp/project",
      mode: "async"
    });

    expect(result.status).toBe("pending");
    expect(manager.listPending()).toHaveLength(1);
    expect(provider.sentRequests[0].displayCwd).toBe("/tmp/project");
  });

  it("resolves concurrent waiting requests independently", async () => {
    const { manager, provider } = createManager();
    const first = manager.ask({ question: "First?", mode: "wait", timeoutSeconds: 10 });
    const second = manager.ask({ question: "Second?", mode: "wait", timeoutSeconds: 10 });

    await vi.waitFor(() => expect(provider.sentRequests).toHaveLength(2));
    manager.resolveByProviderMessage(`msg-${provider.sentRequests[1].id}`, "second answer");
    manager.resolveByProviderMessage(`msg-${provider.sentRequests[0].id}`, "first answer");

    await expect(first).resolves.toMatchObject({ status: "answered", answer: "first answer" });
    await expect(second).resolves.toMatchObject({ status: "answered", answer: "second answer" });
  });

  it("times out waiting requests", async () => {
    vi.useFakeTimers();
    const { manager } = createManager();
    const result = manager.ask({ question: "Still there?", mode: "wait", timeoutSeconds: 1 });

    await vi.advanceTimersByTimeAsync(1100);
    await expect(result).resolves.toMatchObject({ status: "timed_out", answer: null });
  });

  it("times out async requests without a waiter", async () => {
    vi.useFakeTimers();
    const { manager } = createManager();
    const result = await manager.ask({ question: "Async timeout?", mode: "async", timeoutSeconds: 1 });

    expect(result.status).toBe("pending");
    expect(manager.listPending()).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(1100);
    expect(manager.listPending()).toHaveLength(0);
    expect(manager.list()[0]).toMatchObject({ status: "timed_out" });
  });

  it("fails requests when the provider send hangs", async () => {
    vi.useFakeTimers();
    const provider = new FakeProvider();
    provider.sendRequestHandler = () => new Promise<ProviderSendResult>(() => {});
    const { manager } = createManager(provider);

    const result = manager.ask({ question: "Will this send?", mode: "wait", timeoutSeconds: 30 });
    await vi.waitFor(() => expect(provider.sentRequests).toHaveLength(1));

    await vi.advanceTimersByTimeAsync(15_100);
    await expect(result).resolves.toMatchObject({
      status: "failed",
      answer: null,
      error: "Provider sendRequest timed out."
    });
  });

  it("cancels pending requests", async () => {
    const { manager, provider } = createManager();
    const result = manager.ask({ question: "Cancel me?", mode: "wait", timeoutSeconds: 10 });

    await vi.waitFor(() => expect(provider.sentRequests).toHaveLength(1));
    expect(manager.cancel(provider.sentRequests[0].id)).toBe(true);
    await expect(result).resolves.toMatchObject({ status: "cancelled" });
  });

  it("marks loose replies ambiguous when several requests are pending", async () => {
    const { manager } = createManager();
    await manager.ask({ question: "A?", mode: "async" });
    await manager.ask({ question: "B?", mode: "async" });

    expect(manager.resolveLoose("answer")).toBe("ambiguous");
  });
});
