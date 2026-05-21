import { LogLevel, SocketModeClient } from "@slack/socket-mode";
import type { KnownBlock } from "@slack/types";
import { WebClient } from "@slack/web-api";
import type { BackPingRequest, NotifierProvider, NotifyInput, ProviderSendResult } from "../../shared/types.js";
import { formatNotificationMessage, formatRequestMessage, shortenCwd } from "../../shared/format.js";
import type { AppConfig } from "../config.js";
import type { SecretStore } from "../secret-store.js";
import type { RequestManager } from "../request-manager.js";

const BOT_TOKEN_ACCOUNT = "slack-bot-token";
const APP_TOKEN_ACCOUNT = "slack-app-token";
const SLACK_CONNECT_TIMEOUT_MS = 10_000;
const SLACK_API_TIMEOUT_MS = 10_000;
const SLACK_BOT_TOKEN_PATTERN = /^xoxb-[A-Za-z0-9-]+$/;
const SLACK_APP_TOKEN_PATTERN = /^xapp-[A-Za-z0-9-]+$/;
const SLACK_USER_ID_PATTERN = /^[UW][A-Z0-9]{2,}$/;

interface SlackConfigInput {
  botToken?: string;
  appToken?: string;
  userId?: string;
}

interface SlackMessageEvent {
  type?: string;
  subtype?: string;
  bot_id?: string;
  user?: string;
  text?: string;
  channel?: string;
  ts?: string;
  thread_ts?: string;
}

interface SlackMessageEnvelope {
  ack?: () => Promise<void>;
  event?: SlackMessageEvent;
}

interface SlackAction {
  action_id?: string;
  value?: string;
}

interface SlackInteractiveBody {
  type?: string;
  user?: { id?: string };
  channel?: { id?: string };
  message?: { ts?: string };
  actions?: SlackAction[];
}

interface SlackInteractiveEnvelope {
  ack?: () => Promise<void>;
  body?: SlackInteractiveBody;
}

export function isSlackBotTokenLike(token: string): boolean {
  return SLACK_BOT_TOKEN_PATTERN.test(token.trim());
}

export function isSlackAppTokenLike(token: string): boolean {
  return SLACK_APP_TOKEN_PATTERN.test(token.trim());
}

export function isSlackUserIdLike(userId: string): boolean {
  return SLACK_USER_ID_PATTERN.test(userId.trim());
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(label)), ms);
      })
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

function escapeSlack(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}

function slackChoiceActionId(choiceIndex: number): string {
  return `backping_answer_${choiceIndex}`;
}

function slackActionValue(requestId: string, choiceIndex: number): string {
  return `answer:${requestId}:${choiceIndex}`;
}

export function formatSlackRequestMrkdwn(request: BackPingRequest): string {
  const lines: string[] = [];
  lines.push(`*${escapeSlack(request.agent)} needs input*`);
  lines.push("");

  if (request.displayCwd) {
    lines.push(`*Directory:* \`${escapeSlack(request.displayCwd)}\``);
  }

  lines.push(`*Request:* \`${escapeSlack(request.id)}\``);
  lines.push("");

  if (request.context) {
    lines.push("*Context:*");
    lines.push(escapeSlack(request.context));
    lines.push("");
  }

  lines.push("*Question:*");
  lines.push(escapeSlack(request.question));

  if (request.choices.length > 0) {
    lines.push("");
    lines.push("*Choices:*");
    request.choices.forEach((choice, index) => {
      lines.push(`${index + 1}. ${escapeSlack(choice)}`);
    });
  }

  return lines.join("\n");
}

export function buildSlackRequestBlocks(request: BackPingRequest): KnownBlock[] {
  const blocks: KnownBlock[] = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: truncate(formatSlackRequestMrkdwn(request), 3000)
      }
    }
  ];

  if (request.choices.length > 0) {
    for (let start = 0; start < request.choices.length; start += 5) {
      blocks.push({
        type: "actions",
        block_id: truncate(`backping_choices_${request.id}_${start / 5}`, 255),
        elements: request.choices.slice(start, start + 5).map((choice, offset) => {
          const index = start + offset;
          return {
            type: "button",
            text: {
              type: "plain_text",
              text: truncate(choice, 75),
              emoji: true
            },
            action_id: slackChoiceActionId(index),
            value: slackActionValue(request.id, index)
          };
        })
      } as KnownBlock);
    }
  }

  return blocks;
}

export class SlackProvider implements NotifierProvider {
  readonly name = "slack" as const;
  private web: WebClient | undefined;
  private socket: SocketModeClient | undefined;
  private startPromise: Promise<void> | undefined;
  private dmChannelId: string | undefined;
  private botUserId: string | undefined;
  private connected = false;

  constructor(
    private readonly config: AppConfig,
    private readonly secretStore: SecretStore,
    private readonly requestManager: RequestManager,
    private readonly onStateChanged: () => void = () => {}
  ) {}

  async start(): Promise<void> {
    if (this.startPromise) {
      await this.startPromise;
      return;
    }

    if (this.socket) {
      return;
    }

    this.startPromise = this.startInternal();
    try {
      await this.startPromise;
    } finally {
      this.startPromise = undefined;
    }
  }

  private async startInternal(): Promise<void> {
    if (this.socket) {
      return;
    }

    const credentials = await this.getCredentials();
    const userId = this.config.getSettings().slackUserId;
    if (!credentials.botToken || !credentials.appToken || !userId) {
      this.connected = false;
      return;
    }

    try {
      const web = new WebClient(credentials.botToken);
      const identity = await this.verifyBotAndOpenDm(web, userId);
      const socket = new SocketModeClient({
        appToken: credentials.appToken,
        logLevel: LogLevel.ERROR
      });

      this.web = web;
      this.socket = socket;
      this.dmChannelId = identity.dmChannelId;
      this.botUserId = identity.botUserId;
      this.registerHandlers(socket);

      await withTimeout(
        socket.start(),
        SLACK_CONNECT_TIMEOUT_MS,
        "Timed out connecting to Slack Socket Mode. Check your network and Slack app token."
      );

      this.connected = true;
      this.config.updateSettings({
        slackBotUserId: identity.botUserId,
        slackTeamId: identity.teamId,
        slackTeamName: identity.teamName,
        slackLastError: undefined
      });
    } catch (error) {
      await this.resetConnection();
      this.config.updateSettings({ slackLastError: errorMessage(error) });
    } finally {
      this.onStateChanged();
    }
  }

  async stop(): Promise<void> {
    await this.resetConnection();
  }

  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  async setConfig(input: SlackConfigInput): Promise<void> {
    const updates: Partial<ReturnType<AppConfig["getSettings"]>> = { slackLastError: undefined };

    if (input.botToken !== undefined && input.botToken.trim()) {
      const botToken = input.botToken.trim();
      if (!isSlackBotTokenLike(botToken)) {
        throw new Error("Slack bot token should start with xoxb-.");
      }
      await this.secretStore.set(BOT_TOKEN_ACCOUNT, botToken);
    }

    if (input.appToken !== undefined && input.appToken.trim()) {
      const appToken = input.appToken.trim();
      if (!isSlackAppTokenLike(appToken)) {
        throw new Error("Slack app-level token should start with xapp-.");
      }
      await this.secretStore.set(APP_TOKEN_ACCOUNT, appToken);
    }

    if (input.userId !== undefined) {
      const userId = input.userId.trim();
      if (userId && !isSlackUserIdLike(userId)) {
        throw new Error("Slack user ID should look like U123ABCDEF or W123ABCDEF.");
      }
      updates.slackUserId = userId || undefined;
    }

    this.config.updateSettings(updates);
  }

  async testConnection(): Promise<{ teamName?: string; botUserId?: string }> {
    const credentials = await this.requireCredentials();
    const userId = this.requireUserId();
    const web = new WebClient(credentials.botToken);

    try {
      await this.verifyAppToken(credentials.appToken);
      const identity = await this.verifyBotAndOpenDm(web, userId);
      this.botUserId = identity.botUserId;
      this.dmChannelId = identity.dmChannelId;
      this.config.updateSettings({
        slackBotUserId: identity.botUserId,
        slackTeamId: identity.teamId,
        slackTeamName: identity.teamName,
        slackLastError: undefined
      });
      this.onStateChanged();
      return {
        teamName: identity.teamName,
        botUserId: identity.botUserId
      };
    } catch (error) {
      const message = errorMessage(error);
      this.config.updateSettings({ slackLastError: message });
      this.onStateChanged();
      throw new Error(`Could not connect to Slack: ${message}`);
    }
  }

  async deleteConfig(): Promise<void> {
    await Promise.all([
      this.secretStore.delete(BOT_TOKEN_ACCOUNT),
      this.secretStore.delete(APP_TOKEN_ACCOUNT)
    ]);
    this.config.updateSettings({
      slackUserId: undefined,
      slackBotUserId: undefined,
      slackTeamId: undefined,
      slackTeamName: undefined,
      slackLastError: undefined
    });
    await this.stop();
  }

  async isConfigured(): Promise<boolean> {
    const credentials = await this.getCredentials();
    return Boolean(credentials.botToken && credentials.appToken && this.config.getSettings().slackUserId);
  }

  isConnected(): boolean {
    return this.connected;
  }

  async sendRequest(request: BackPingRequest): Promise<ProviderSendResult> {
    const slack = await this.requireSlack();
    const sent = await withTimeout(
      slack.web.chat.postMessage({
        channel: slack.channelId,
        text: formatRequestMessage(request),
        blocks: buildSlackRequestBlocks(request)
      }),
      SLACK_API_TIMEOUT_MS,
      "Timed out sending Slack message."
    );

    if (!sent.ts) {
      throw new Error("Slack did not return a message timestamp for the request.");
    }

    return { providerMessageId: sent.ts };
  }

  async sendNotification(input: NotifyInput): Promise<ProviderSendResult> {
    const slack = await this.requireSlack();
    const sent = await withTimeout(
      slack.web.chat.postMessage({
        channel: slack.channelId,
        text: formatNotificationMessage(input),
        blocks: this.notificationBlocks(input)
      }),
      SLACK_API_TIMEOUT_MS,
      "Timed out sending Slack notification."
    );
    return { providerMessageId: sent.ts };
  }

  async hasBotToken(): Promise<boolean> {
    return Boolean(await this.secretStore.get(BOT_TOKEN_ACCOUNT));
  }

  async hasAppToken(): Promise<boolean> {
    return Boolean(await this.secretStore.get(APP_TOKEN_ACCOUNT));
  }

  private registerHandlers(socket: SocketModeClient): void {
    socket.on("connected", () => {
      if (this.socket !== socket) {
        return;
      }
      this.connected = true;
      this.config.updateSettings({ slackLastError: undefined });
      this.onStateChanged();
    });

    socket.on("disconnected", (error?: unknown) => {
      if (this.socket !== socket) {
        return;
      }
      this.connected = false;
      if (error) {
        this.config.updateSettings({ slackLastError: errorMessage(error) });
      }
      this.onStateChanged();
    });

    socket.on("error", (error: unknown) => {
      if (this.socket !== socket) {
        return;
      }
      this.connected = false;
      this.config.updateSettings({ slackLastError: errorMessage(error) });
      this.onStateChanged();
    });

    socket.on("message", (envelope: SlackMessageEnvelope) => {
      void this.handleTextMessage(envelope);
    });

    socket.on("interactive", (envelope: SlackInteractiveEnvelope) => {
      void this.handleInteractive(envelope);
    });
  }

  private async handleTextMessage(envelope: SlackMessageEnvelope): Promise<void> {
    await envelope.ack?.();

    const event = envelope.event;
    if (!event?.text || !event.channel || !event.ts || event.subtype || event.bot_id) {
      return;
    }

    const settings = this.config.getSettings();
    if (!settings.slackUserId || event.user !== settings.slackUserId) {
      return;
    }

    if (this.dmChannelId && event.channel !== this.dmChannelId) {
      return;
    }

    if (this.botUserId && event.user === this.botUserId) {
      return;
    }

    const answer = event.text.trim();
    if (!answer) {
      return;
    }

    if (event.thread_ts && this.requestManager.resolveByProviderMessage(event.thread_ts, answer)) {
      await this.reply(event.channel, event.thread_ts, "Answered.");
      return;
    }

    if (this.requestManager.listPending().length > 0) {
      await this.reply(
        event.channel,
        event.ts,
        "Reply in the specific question thread, or use one of its buttons, so BackPing can route the answer cleanly."
      );
    }
  }

  private async handleInteractive(envelope: SlackInteractiveEnvelope): Promise<void> {
    await envelope.ack?.();

    const body = envelope.body;
    const settings = this.config.getSettings();
    if (!body || !settings.slackUserId || body.user?.id !== settings.slackUserId) {
      return;
    }

    const action = body.actions?.[0];
    const parsed = action?.value ? this.parseActionValue(action.value) : undefined;
    const channel = body.channel?.id;
    const threadTs = body.message?.ts;
    if (!parsed || !channel || !threadTs) {
      return;
    }

    const request = this.requestManager.list().find((item) => item.id === parsed.requestId);
    const answer = request?.choices[parsed.choiceIndex];
    if (!answer) {
      await this.reply(channel, threadTs, "That choice is no longer available.");
      return;
    }

    const resolved = this.requestManager.resolveByRequestId(parsed.requestId, answer);
    await this.reply(channel, threadTs, resolved ? `Answered: ${answer}` : "Question is no longer pending.");
  }

  private async requireSlack(): Promise<{ web: WebClient; channelId: string }> {
    if (!this.web || !this.dmChannelId) {
      await this.start();
    }

    if (!this.web || !this.dmChannelId) {
      throw new Error("Slack is not connected. Check the Slack setup and use Test Connection.");
    }

    return {
      web: this.web,
      channelId: this.dmChannelId
    };
  }

  private async resetConnection(): Promise<void> {
    const socket = this.socket;
    this.socket = undefined;
    this.web = undefined;
    this.dmChannelId = undefined;
    this.connected = false;

    if (socket) {
      try {
        await socket.disconnect();
      } catch {
        // Ignore disconnect errors during shutdown/restart.
      }
    }
  }

  private async getCredentials(): Promise<{ botToken?: string; appToken?: string }> {
    const [botToken, appToken] = await Promise.all([
      this.secretStore.get(BOT_TOKEN_ACCOUNT),
      this.secretStore.get(APP_TOKEN_ACCOUNT)
    ]);
    return { botToken, appToken };
  }

  private async requireCredentials(): Promise<{ botToken: string; appToken: string }> {
    const credentials = await this.getCredentials();
    if (!credentials.botToken || !credentials.appToken) {
      throw new Error("Save both Slack tokens before testing the connection.");
    }
    return {
      botToken: credentials.botToken,
      appToken: credentials.appToken
    };
  }

  private requireUserId(): string {
    const userId = this.config.getSettings().slackUserId;
    if (!userId) {
      throw new Error("Enter your Slack user ID before testing the connection.");
    }
    return userId;
  }

  private async verifyAppToken(appToken: string): Promise<void> {
    const web = new WebClient(appToken);
    const response = await withTimeout(
      web.apps.connections.open({}),
      SLACK_API_TIMEOUT_MS,
      "Timed out validating Slack app-level token."
    );
    if (!response.ok || !response.url) {
      throw new Error("Slack app-level token is invalid or missing connections:write.");
    }
  }

  private async verifyBotAndOpenDm(
    web: WebClient,
    userId: string
  ): Promise<{ botUserId?: string; teamId?: string; teamName?: string; dmChannelId: string }> {
    const auth = await withTimeout(
      web.auth.test({}),
      SLACK_API_TIMEOUT_MS,
      "Timed out validating Slack bot token."
    );
    const conversation = await withTimeout(
      web.conversations.open({ users: userId }),
      SLACK_API_TIMEOUT_MS,
      "Timed out opening a Slack DM with your user."
    );

    const dmChannelId = conversation.channel?.id;
    if (!dmChannelId) {
      throw new Error("Slack could not open a DM with that user ID.");
    }

    return {
      botUserId: auth.user_id,
      teamId: auth.team_id,
      teamName: auth.team,
      dmChannelId
    };
  }

  private notificationBlocks(input: NotifyInput): KnownBlock[] {
    return [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: truncate(this.formatNotificationMrkdwn(input), 3000)
        }
      }
    ];
  }

  private formatNotificationMrkdwn(input: NotifyInput): string {
    const lines: string[] = [];
    lines.push(`*${escapeSlack(input.agent ?? "Agent")} notification*`);
    lines.push("");

    const displayCwd = shortenCwd(input.cwd);
    if (displayCwd) {
      lines.push(`*Directory:* \`${escapeSlack(displayCwd)}\``);
      lines.push("");
    }

    if (input.context) {
      lines.push("*Context:*");
      lines.push(escapeSlack(input.context));
      lines.push("");
    }

    lines.push(escapeSlack(input.message));
    return lines.join("\n");
  }

  private async reply(channel: string, threadTs: string, text: string): Promise<void> {
    if (!this.web) {
      return;
    }

    try {
      await this.web.chat.postMessage({
        channel,
        thread_ts: threadTs,
        text
      });
    } catch {
      // A failed acknowledgement should not prevent resolving the local request.
    }
  }

  private parseActionValue(value: string): { requestId: string; choiceIndex: number } | undefined {
    const match = value.match(/^answer:(.+):(\d+)$/);
    if (!match) {
      return undefined;
    }

    return {
      requestId: match[1],
      choiceIndex: Number.parseInt(match[2], 10)
    };
  }
}
