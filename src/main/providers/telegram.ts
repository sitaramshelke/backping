import { Bot, InlineKeyboard, type Context } from "grammy";
import type { BackPingRequest, NotifierProvider, NotifyInput, ProviderSendResult } from "../../shared/types.js";
import { formatNotificationMessage, formatRequestMessage } from "../../shared/format.js";
import type { AppConfig } from "../config.js";
import type { SecretStore } from "../secret-store.js";
import type { RequestManager } from "../request-manager.js";

const TOKEN_ACCOUNT = "telegram-bot-token";
const TELEGRAM_TOKEN_PATTERN = /^\d+:[A-Za-z0-9_-]+$/;
const TELEGRAM_CONNECT_TIMEOUT_MS = 10_000;

export function isTelegramBotTokenLike(token: string): boolean {
  return TELEGRAM_TOKEN_PATTERN.test(token.trim());
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

export class TelegramProvider implements NotifierProvider {
  readonly name = "telegram" as const;
  private bot: Bot | undefined;
  private connected = false;
  private botUsername: string | undefined;

  constructor(
    private readonly config: AppConfig,
    private readonly secretStore: SecretStore,
    private readonly requestManager: RequestManager,
    private readonly onStateChanged: () => void = () => {}
  ) {}

  async start(): Promise<void> {
    if (this.bot) {
      return;
    }

    const token = await this.getToken();
    if (!token) {
      this.connected = false;
      return;
    }

    const bot = new Bot(token);
    this.registerHandlers(bot);

    try {
      await withTimeout(
        bot.init(),
        TELEGRAM_CONNECT_TIMEOUT_MS,
        "Timed out connecting to Telegram. Check your network and whether Telegram is reachable."
      );
      this.bot = bot;
      const me = bot.botInfo;
      this.botUsername = me.username;
      this.config.updateSettings({ telegramBotUsername: me.username, telegramLastError: undefined });
      void bot.start().catch((error) => {
        if (this.bot === bot) {
          this.config.updateSettings({ telegramLastError: errorMessage(error) });
        }
        this.connected = false;
        this.onStateChanged();
      });
      this.connected = true;
    } catch (error) {
      this.bot = undefined;
      this.connected = false;
      this.config.updateSettings({ telegramLastError: errorMessage(error) });
    } finally {
      this.onStateChanged();
    }
  }

  async stop(): Promise<void> {
    if (!this.bot) {
      return;
    }

    await this.bot.stop();
    this.bot = undefined;
    this.connected = false;
  }

  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  async setToken(token: string): Promise<void> {
    const normalizedToken = token.trim();
    if (!isTelegramBotTokenLike(normalizedToken)) {
      throw new Error("Telegram bot token should look like 123456789:ABCDEF_from_BotFather.");
    }

    await this.secretStore.set(TOKEN_ACCOUNT, normalizedToken);
    this.botUsername = undefined;
    this.config.updateSettings({ telegramBotUsername: undefined, telegramLastError: undefined });
  }

  async testConnection(): Promise<{ botUsername?: string }> {
    const token = await this.getToken();
    if (!token) {
      throw new Error("Save a Telegram bot token before testing the connection.");
    }

    const probe = new Bot(token);
    try {
      await withTimeout(
        probe.init(),
        TELEGRAM_CONNECT_TIMEOUT_MS,
        "Timed out connecting to Telegram. Check your network and whether Telegram is reachable."
      );
      const botUsername = probe.botInfo.username;
      this.botUsername = botUsername;
      this.config.updateSettings({ telegramBotUsername: botUsername, telegramLastError: undefined });
      this.onStateChanged();
      return { botUsername };
    } catch (error) {
      const message = errorMessage(error);
      this.config.updateSettings({ telegramLastError: message });
      this.onStateChanged();
      throw new Error(`Could not connect to Telegram: ${message}`);
    }
  }

  async deleteToken(): Promise<void> {
    await this.secretStore.delete(TOKEN_ACCOUNT);
    this.config.updateSettings({ telegramLastError: undefined });
    await this.stop();
  }

  async getToken(): Promise<string | undefined> {
    return this.secretStore.get(TOKEN_ACCOUNT);
  }

  async isConfigured(): Promise<boolean> {
    const token = await this.getToken();
    const settings = this.config.getSettings();
    return Boolean(token && settings.telegramChatId);
  }

  isConnected(): boolean {
    return this.connected;
  }

  async sendRequest(request: BackPingRequest): Promise<ProviderSendResult> {
    const bot = await this.requireBot();
    const chatId = this.requireChatId();
    const sent = await bot.api.sendMessage(chatId, formatRequestMessage(request), {
      reply_markup: this.choiceKeyboard(request)
    });

    return { providerMessageId: String(sent.message_id) };
  }

  async sendNotification(input: NotifyInput): Promise<ProviderSendResult> {
    const bot = await this.requireBot();
    const chatId = this.requireChatId();
    const sent = await bot.api.sendMessage(chatId, formatNotificationMessage(input));
    return { providerMessageId: String(sent.message_id) };
  }

  async hasToken(): Promise<boolean> {
    return Boolean(await this.getToken());
  }

  getBotUsername(): string | undefined {
    return this.botUsername ?? this.config.getSettings().telegramBotUsername;
  }

  private registerHandlers(bot: Bot): void {
    bot.command("start", async (ctx) => {
      await this.handleStart(ctx);
    });

    bot.on("message:text", async (ctx) => {
      await this.handleTextMessage(ctx);
    });

    bot.on("callback_query:data", async (ctx) => {
      await this.handleCallbackQuery(ctx);
    });

    bot.catch(() => {
      this.connected = false;
    });
  }

  private async handleStart(ctx: Context): Promise<void> {
    if (!ctx.chat) {
      return;
    }

    const chatId = String(ctx.chat.id);
    const settings = this.config.getSettings();
    if (settings.telegramChatId && settings.telegramChatId !== chatId) {
      console.warn("Rejected Telegram /start from an unconfigured chat.");
      await ctx.reply("BackPing is already linked to another Telegram chat. Clear Telegram settings before linking a different chat.");
      return;
    }

    this.config.updateSettings({
      telegramChatId: chatId,
      telegramUsername: ctx.from?.username ?? ctx.from?.first_name
    });
    await ctx.reply(
      [
        "BackPing connected.",
        "",
        "I will send agent questions here when BackPing is running."
      ].join("\n")
    );
  }

  private async handleTextMessage(ctx: Context): Promise<void> {
    if (!ctx.chat || !ctx.message?.text || ctx.from?.is_bot) {
      return;
    }

    const chatId = String(ctx.chat.id);
    const settings = this.config.getSettings();

    if (!settings.telegramChatId || chatId !== settings.telegramChatId) {
      return;
    }

    const answer = ctx.message.text.trim();
    if (!answer) {
      return;
    }

    const replyTo = ctx.message.reply_to_message?.message_id;
    if (replyTo && this.requestManager.resolveByProviderMessage(String(replyTo), answer)) {
      await ctx.reply("Answered.", { reply_parameters: { message_id: ctx.message.message_id } });
      return;
    }

    const result = this.requestManager.resolveLoose(answer);
    if (result === "resolved") {
      await ctx.reply("Answered.", { reply_parameters: { message_id: ctx.message.message_id } });
      return;
    }

    if (result === "ambiguous") {
      await ctx.reply(
        "I have multiple pending questions. Reply to the specific question message, or tap one of its buttons."
      );
    }
  }

  private async handleCallbackQuery(ctx: Context): Promise<void> {
    const data = ctx.callbackQuery?.data;
    const message = ctx.callbackQuery?.message;
    if (!data || !message) {
      return;
    }

    const settings = this.config.getSettings();
    if (settings.telegramChatId && String(message.chat.id) !== settings.telegramChatId) {
      return;
    }

    const parsed = this.parseCallbackData(data);
    if (!parsed) {
      return;
    }

    const request = this.requestManager.list().find((item) => item.id === parsed.requestId);
    const answer = request?.choices[parsed.choiceIndex];
    if (!answer) {
      await ctx.answerCallbackQuery({ text: "That choice is no longer available." });
      return;
    }

    const resolved = this.requestManager.resolveByRequestId(parsed.requestId, answer);
    await ctx.answerCallbackQuery({ text: resolved ? "Answered." : "Question is no longer pending." });
  }

  private async requireBot(): Promise<Bot> {
    if (!this.bot) {
      await this.start();
    }

    if (!this.bot) {
      throw new Error("Telegram bot token is not configured.");
    }

    return this.bot;
  }

  private requireChatId(): string {
    const chatId = this.config.getSettings().telegramChatId;
    if (!chatId) {
      throw new Error("Telegram chat is not connected. Send /start to the bot first.");
    }
    return chatId;
  }

  private callbackData(requestId: string, choiceIndex: number): string {
    return `answer:${requestId}:${choiceIndex}`;
  }

  private choiceKeyboard(request: BackPingRequest): InlineKeyboard | undefined {
    if (request.choices.length === 0) {
      return undefined;
    }

    const keyboard = new InlineKeyboard();
    request.choices.forEach((choice, index) => {
      keyboard.text(choice, this.callbackData(request.id, index)).row();
    });
    return keyboard;
  }

  private parseCallbackData(data: string): { requestId: string; choiceIndex: number } | undefined {
    const match = data.match(/^answer:(.+):(\d+)$/);
    if (!match) {
      return undefined;
    }

    return {
      requestId: match[1],
      choiceIndex: Number.parseInt(match[2], 10)
    };
  }
}
