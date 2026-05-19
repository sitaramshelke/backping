import { EventEmitter } from "node:events";
import type {
  AskMode,
  AskUserResult,
  BackPingRequest,
  CreateRequestInput,
  NotifierProvider,
  NotifyInput,
  ProviderSendResult,
  RequestStatus
} from "../shared/types.js";
import { clampText, shortenCwd } from "../shared/format.js";

const PROVIDER_SEND_TIMEOUT_MS = 15_000;

export interface RequestHistory {
  list(): BackPingRequest[];
  save(requests: BackPingRequest[], limit: number): void;
}

interface PendingWaiter {
  resolve: (result: AskUserResult) => void;
  timer: NodeJS.Timeout;
}

export type RequestManagerEvents = {
  changed: [];
};

export class RequestManager extends EventEmitter {
  private requests: BackPingRequest[];
  private readonly waiters = new Map<string, PendingWaiter>();
  private readonly asyncTimers = new Map<string, NodeJS.Timeout>();
  private readonly providerMessageToRequest = new Map<string, string>();

  constructor(
    private readonly historyStore: RequestHistory,
    private readonly getProvider: () => NotifierProvider | undefined,
    private readonly getHistoryLimit: () => number
  ) {
    super();
    this.requests = historyStore.list().map((request) => {
      if (request.status === "pending") {
        return {
          ...request,
          status: "failed" as RequestStatus,
          error: "BackPing restarted before this request was answered."
        };
      }
      return request;
    });
    this.persist();
  }

  async ask(input: CreateRequestInput): Promise<AskUserResult> {
    const mode: AskMode = input.mode ?? "wait";
    const timeoutSeconds = Math.max(1, Math.min(input.timeoutSeconds ?? 1800, 86_400));
    const now = new Date();
    const request: BackPingRequest = {
      id: this.createId(),
      question: clampText(input.question.trim(), 3000) ?? "",
      cwd: input.cwd,
      displayCwd: shortenCwd(input.cwd),
      agent: clampText(input.agent?.trim() || "Agent", 80) ?? "Agent",
      context: clampText(input.context?.trim(), 1200),
      choices: (input.choices ?? []).map((choice) => clampText(choice.trim(), 120) ?? "").filter(Boolean).slice(0, 8),
      status: "pending",
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + timeoutSeconds * 1000).toISOString()
    };

    if (!request.question) {
      return {
        status: "failed",
        request_id: request.id,
        answer: null,
        error: "Question is required."
      };
    }

    this.requests.unshift(request);
    this.persistAndNotify();

    const provider = this.getProvider();
    if (!provider || !(await provider.isConfigured())) {
      this.fail(request.id, "No messaging provider is configured.");
      return this.resultFor(request.id);
    }

    try {
      const result = await this.sendRequestWithTimeout(provider, request);
      if (result.providerMessageId) {
        this.updateRequest(request.id, { providerMessageId: result.providerMessageId });
        this.providerMessageToRequest.set(result.providerMessageId, request.id);
      }
    } catch (error) {
      this.fail(request.id, error instanceof Error ? error.message : "Failed to send request.");
      return this.resultFor(request.id);
    }

    if (mode === "async") {
      this.scheduleAsyncTimeout(request.id, timeoutSeconds);
      return {
        status: "pending",
        request_id: request.id,
        answer: null,
        created_at: request.createdAt
      };
    }

    return new Promise<AskUserResult>((resolve) => {
      const timer = setTimeout(() => {
        this.timeout(request.id);
      }, timeoutSeconds * 1000);
      this.waiters.set(request.id, { resolve, timer });
    });
  }

  async notify(input: NotifyInput): Promise<AskUserResult> {
    const provider = this.getProvider();
    if (!provider || !(await provider.isConfigured())) {
      return {
        status: "failed",
        request_id: "notify",
        answer: null,
        error: "No messaging provider is configured."
      };
    }

    try {
      await provider.sendNotification({
        ...input,
        message: clampText(input.message.trim(), 3500) ?? ""
      });
      return {
        status: "answered",
        request_id: "notify",
        answer: "sent"
      };
    } catch (error) {
      return {
        status: "failed",
        request_id: "notify",
        answer: null,
        error: error instanceof Error ? error.message : "Failed to send notification."
      };
    }
  }

  list(): BackPingRequest[] {
    return [...this.requests];
  }

  listPending(): BackPingRequest[] {
    return this.requests.filter((request) => request.status === "pending");
  }

  resolveByRequestId(requestId: string, answer: string): boolean {
    const request = this.requests.find((item) => item.id === requestId);
    if (!request || request.status !== "pending") {
      return false;
    }

    this.updateRequest(requestId, {
      status: "answered",
      answer,
      answeredAt: new Date().toISOString()
    });
    this.resolveWaiter(requestId);
    return true;
  }

  resolveByProviderMessage(providerMessageId: string, answer: string): boolean {
    const requestId = this.providerMessageToRequest.get(providerMessageId);
    if (!requestId) {
      const request = this.requests.find((item) => item.providerMessageId === providerMessageId);
      return request ? this.resolveByRequestId(request.id, answer) : false;
    }

    return this.resolveByRequestId(requestId, answer);
  }

  resolveLoose(answer: string): "resolved" | "none" | "ambiguous" {
    const pending = this.listPending();
    if (pending.length === 0) {
      return "none";
    }
    if (pending.length > 1) {
      return "ambiguous";
    }

    this.resolveByRequestId(pending[0].id, answer);
    return "resolved";
  }

  cancel(requestId: string): boolean {
    const request = this.requests.find((item) => item.id === requestId);
    if (!request || request.status !== "pending") {
      return false;
    }

    this.updateRequest(requestId, {
      status: "cancelled",
      cancelledAt: new Date().toISOString()
    });
    this.resolveWaiter(requestId);
    return true;
  }

  private timeout(requestId: string): void {
    const request = this.requests.find((item) => item.id === requestId);
    if (!request || request.status !== "pending") {
      return;
    }

    this.updateRequest(requestId, {
      status: "timed_out",
      timedOutAt: new Date().toISOString()
    });
    this.resolveWaiter(requestId);
  }

  private fail(requestId: string, error: string): void {
    this.updateRequest(requestId, {
      status: "failed",
      error
    });
    this.resolveWaiter(requestId);
  }

  private updateRequest(requestId: string, updates: Partial<BackPingRequest>): void {
    let updatedRequest: BackPingRequest | undefined;
    let previousProviderMessageId: string | undefined;

    this.requests = this.requests.map((request) => {
      if (request.id !== requestId) {
        return request;
      }

      previousProviderMessageId = request.providerMessageId;
      updatedRequest = { ...request, ...updates };
      return updatedRequest;
    });

    if (
      previousProviderMessageId &&
      updatedRequest?.providerMessageId &&
      previousProviderMessageId !== updatedRequest.providerMessageId
    ) {
      this.providerMessageToRequest.delete(previousProviderMessageId);
    }

    if (updatedRequest && this.isTerminal(updatedRequest.status)) {
      this.cleanupRequest(updatedRequest);
    }

    this.persistAndNotify();
  }

  private resolveWaiter(requestId: string): void {
    const waiter = this.waiters.get(requestId);
    if (!waiter) {
      return;
    }

    clearTimeout(waiter.timer);
    this.waiters.delete(requestId);
    waiter.resolve(this.resultFor(requestId));
  }

  private async sendRequestWithTimeout(
    provider: NotifierProvider,
    request: BackPingRequest
  ): Promise<ProviderSendResult> {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        provider.sendRequest(request),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error("Provider sendRequest timed out.")), PROVIDER_SEND_TIMEOUT_MS);
        })
      ]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  private scheduleAsyncTimeout(requestId: string, timeoutSeconds: number): void {
    this.clearAsyncTimeout(requestId);
    const timer = setTimeout(() => {
      this.timeout(requestId);
    }, timeoutSeconds * 1000);
    timer.unref?.();
    this.asyncTimers.set(requestId, timer);
  }

  private clearAsyncTimeout(requestId: string): void {
    const timer = this.asyncTimers.get(requestId);
    if (!timer) {
      return;
    }

    clearTimeout(timer);
    this.asyncTimers.delete(requestId);
  }

  private cleanupRequest(request: BackPingRequest): void {
    if (request.providerMessageId) {
      this.providerMessageToRequest.delete(request.providerMessageId);
    }
    this.clearAsyncTimeout(request.id);
  }

  private isTerminal(status: RequestStatus): boolean {
    return status !== "pending";
  }

  private resultFor(requestId: string): AskUserResult {
    const request = this.requests.find((item) => item.id === requestId);
    if (!request) {
      return {
        status: "failed",
        request_id: requestId,
        answer: null,
        error: "Request not found."
      };
    }

    return {
      status: request.status,
      request_id: request.id,
      answer: request.answer ?? null,
      default_used: false,
      error: request.error,
      created_at: request.createdAt,
      answered_at: request.answeredAt
    };
  }

  private persistAndNotify(): void {
    this.persist();
    this.emit("changed");
  }

  private persist(): void {
    const historyLimit = this.normalizedHistoryLimit();
    const evicted = this.requests.slice(historyLimit);
    evicted.forEach((request) => this.cleanupRequest(request));
    this.requests = this.requests.slice(0, historyLimit);
    this.historyStore.save(this.requests, historyLimit);
  }

  private normalizedHistoryLimit(): number {
    const historyLimit = Number(this.getHistoryLimit());
    if (!Number.isFinite(historyLimit)) {
      return 0;
    }
    return Math.max(0, Math.trunc(historyLimit));
  }

  private createId(): string {
    const suffix = Math.random().toString(36).slice(2, 8);
    return `req_${Date.now()}_${suffix}`;
  }
}
