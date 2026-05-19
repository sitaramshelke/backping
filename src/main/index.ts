import { app, BrowserWindow, clipboard, ipcMain, Menu, nativeImage, shell, Tray } from "electron";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AppConfig } from "./config.js";
import { HistoryStore } from "./history-store.js";
import { Keychain } from "./keychain.js";
import { McpHttpServer } from "./mcp-server.js";
import { TelegramProvider } from "./providers/telegram.js";
import { SlackProvider } from "./providers/slack.js";
import { RequestManager } from "./request-manager.js";
import { agentInstructionSnippet, codexConfigSnippet } from "../shared/format.js";
import type { NotifierProvider, RelayProviderName, RelayStatus } from "../shared/types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let tray: Tray | undefined;
let settingsWindow: BrowserWindow | undefined;
let appConfig: AppConfig;
let keychain: Keychain;
let historyStore: HistoryStore;
let requestManager: RequestManager;
let telegramProvider: TelegramProvider;
let slackProvider: SlackProvider;
let mcpServer: McpHttpServer;

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}

app.on("second-instance", () => {
  showSettingsWindow();
});

function presentSettingsWindow(): void {
  if (!settingsWindow) {
    return;
  }

  if (settingsWindow.isMinimized()) {
    settingsWindow.restore();
  }
  settingsWindow.show();
  settingsWindow.moveTop();
  settingsWindow.focus();

  // Accessory apps do not always activate their windows when launched from another app.
  settingsWindow.setAlwaysOnTop(true, "floating");
  setTimeout(() => settingsWindow?.setAlwaysOnTop(false), 350);
}

function trayIcon() {
  const trayPath = path.join(app.getAppPath(), "assets", "icon", "tray-template.png");
  const image = nativeImage.createFromBuffer(fs.readFileSync(trayPath));
  image.setTemplateImage(true);
  return image;
}

function bootstrap(): void {
  appConfig = new AppConfig();
  keychain = new Keychain();
  historyStore = new HistoryStore();
  requestManager = new RequestManager(
    historyStore,
    () => getCurrentProvider(),
    () => appConfig.getSettings().historyLimit
  );
  telegramProvider = new TelegramProvider(appConfig, keychain, requestManager, () => {
    updateTray();
    sendStateChanged();
  });
  slackProvider = new SlackProvider(appConfig, keychain, requestManager, () => {
    updateTray();
    sendStateChanged();
  });
  mcpServer = new McpHttpServer(appConfig, requestManager);

  requestManager.on("changed", () => {
    updateTray();
    sendStateChanged();
  });
}

function startMcpServerInBackground(): void {
  void mcpServer.start()
    .catch((error) => {
      console.error("BackPing MCP server failed to start:", error);
    })
    .finally(() => {
      updateTray();
      sendStateChanged();
    });
}

function startProviderInBackground(): void {
  void startCurrentProvider()
    .catch((error) => {
      console.error("BackPing provider failed to start:", error);
    })
    .finally(() => {
      updateTray();
      sendStateChanged();
    });
}

function getProviderName(): RelayProviderName {
  return appConfig.getSettings().provider ?? "telegram";
}

function getCurrentProvider(): NotifierProvider | undefined {
  return getProviderName() === "slack" ? slackProvider : telegramProvider;
}

async function startCurrentProvider(): Promise<void> {
  if (getProviderName() === "slack") {
    await telegramProvider?.stop();
    await slackProvider?.start();
    return;
  }

  await slackProvider?.stop();
  await telegramProvider?.start();
}

function createTray(): void {
  tray = new Tray(trayIcon());
  tray.setToolTip("BackPing");
  updateTray();
}

function updateTray(): void {
  if (!tray) {
    return;
  }

  const state = getRelayStatusSync();
  const menu = Menu.buildFromTemplate([
    { label: `MCP: ${state.mcpRunning ? "Running" : "Stopped"} on ${state.port}`, enabled: false },
    { label: `Provider: ${state.provider === "slack" ? "Slack" : "Telegram"}`, enabled: false },
    { label: `Telegram: ${state.telegramConnected ? "Connected" : "Not connected"}`, enabled: false },
    { label: `Slack: ${state.slackConnected ? "Connected" : "Not connected"}`, enabled: false },
    { label: `Pending: ${state.pendingCount}`, enabled: false },
    { type: "separator" },
    { label: "Settings", click: () => showSettingsWindow() },
    { label: "Copy MCP Config", click: () => copyCodexConfig() },
    { type: "separator" },
    { label: "Quit", click: () => app.quit() }
  ]);
  tray.setContextMenu(menu);
}

function showSettingsWindow(): void {
  if (settingsWindow) {
    presentSettingsWindow();
    return;
  }

  settingsWindow = new BrowserWindow({
    width: 760,
    height: 840,
    minWidth: 640,
    minHeight: 560,
    title: "BackPing Settings",
    show: false,
    webPreferences: {
      preload: path.join(app.getAppPath(), "src", "main", "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  settingsWindow.on("closed", () => {
    settingsWindow = undefined;
  });

  settingsWindow.once("ready-to-show", () => {
    presentSettingsWindow();
  });
  settingsWindow.loadFile(path.join(app.getAppPath(), "src", "renderer", "settings.html"));
  app.focus({ steal: true });
}

function sendStateChanged(): void {
  settingsWindow?.webContents.send("backping:state-changed");
}

async function getState(): Promise<RelayStatus & { requests: unknown[]; codexConfig: string; agentInstructions: string }> {
  const settings = appConfig.getSettings();
  const status = getRelayStatusSync();
  return {
    ...status,
    hasTelegramToken: await telegramProvider.hasToken(),
    hasSlackBotToken: await slackProvider.hasBotToken(),
    hasSlackAppToken: await slackProvider.hasAppToken(),
    requests: requestManager.list(),
    codexConfig: codexConfigSnippet(settings.port, settings.authToken),
    agentInstructions: agentInstructionSnippet()
  };
}

function getRelayStatusSync(): RelayStatus {
  const settings = appConfig.getSettings();
  return {
    mcpRunning: mcpServer?.isRunning() ?? false,
    provider: settings.provider,
    telegramConnected: telegramProvider?.isConnected() ?? false,
    slackConnected: slackProvider?.isConnected() ?? false,
    pendingCount: requestManager?.listPending().length ?? 0,
    port: settings.port,
    hasTelegramToken: false,
    hasSlackBotToken: false,
    hasSlackAppToken: false,
    telegramChatId: settings.telegramChatId,
    telegramUsername: settings.telegramUsername,
    telegramBotUsername: settings.telegramBotUsername,
    telegramLastError: settings.telegramLastError,
    slackUserId: settings.slackUserId,
    slackBotUserId: settings.slackBotUserId,
    slackTeamId: settings.slackTeamId,
    slackTeamName: settings.slackTeamName,
    slackLastError: settings.slackLastError
  };
}

function copyCodexConfig(): void {
  const settings = appConfig.getSettings();
  clipboard.writeText(codexConfigSnippet(settings.port, settings.authToken));
}

function copySlackManifest(): void {
  const manifestPath = path.join(app.getAppPath(), "slack-app-manifest.example.json");
  clipboard.writeText(fs.readFileSync(manifestPath, "utf8"));
}

function registerIpc(): void {
  ipcMain.handle("backping:get-state", async () => getState());
  ipcMain.handle("backping:save-settings", async (_event, input: { port?: number; provider?: RelayProviderName }) => {
    const current = appConfig.getSettings();
    const nextPort = input.port ? Math.max(1024, Math.min(65535, Number(input.port))) : current.port;
    const shouldRestart = nextPort !== current.port;
    const nextProvider = input.provider === "slack" || input.provider === "telegram" ? input.provider : current.provider;
    const shouldSwitchProvider = nextProvider !== current.provider;
    appConfig.updateSettings({
      port: nextPort,
      provider: nextProvider
    });
    if (shouldRestart) {
      await mcpServer.restart();
    }
    if (shouldSwitchProvider) {
      startProviderInBackground();
    }
    updateTray();
    sendStateChanged();
    return getState();
  });
  ipcMain.handle("backping:set-telegram-token", async (_event, token: string) => {
    await telegramProvider.setToken(token);
    if (getProviderName() === "telegram") {
      startProviderInBackground();
    }
    updateTray();
    sendStateChanged();
    return getState();
  });
  ipcMain.handle("backping:test-telegram-connection", async () => {
    await telegramProvider.testConnection();
    updateTray();
    sendStateChanged();
    return getState();
  });
  ipcMain.handle("backping:clear-telegram-token", async () => {
    await telegramProvider.deleteToken();
    appConfig.updateSettings({
      telegramChatId: undefined,
      telegramUsername: undefined,
      telegramBotUsername: undefined,
      telegramLastError: undefined
    });
    updateTray();
    sendStateChanged();
    return getState();
  });
  ipcMain.handle("backping:set-slack-config", async (_event, input: { botToken?: string; appToken?: string; userId?: string }) => {
    await slackProvider.setConfig(input);
    if (getProviderName() === "slack") {
      startProviderInBackground();
    }
    updateTray();
    sendStateChanged();
    return getState();
  });
  ipcMain.handle("backping:test-slack-connection", async () => {
    await slackProvider.testConnection();
    updateTray();
    sendStateChanged();
    return getState();
  });
  ipcMain.handle("backping:clear-slack-config", async () => {
    await slackProvider.deleteConfig();
    updateTray();
    sendStateChanged();
    return getState();
  });
  ipcMain.handle("backping:copy-codex-config", async () => {
    copyCodexConfig();
    return true;
  });
  ipcMain.handle("backping:copy-agent-instructions", async () => {
    clipboard.writeText(agentInstructionSnippet());
    return true;
  });
  ipcMain.handle("backping:copy-slack-manifest", async () => {
    copySlackManifest();
    return true;
  });
  ipcMain.handle("backping:open-slack-apps", async () => {
    await shell.openExternal("https://api.slack.com/apps");
    return true;
  });
  ipcMain.handle("backping:open-telegram-botfather", async () => {
    await shell.openExternal("https://t.me/BotFather");
    return true;
  });
  ipcMain.handle("backping:regenerate-auth-token", async () => {
    appConfig.regenerateAuthToken();
    await mcpServer.restart();
    copyCodexConfig();
    updateTray();
    sendStateChanged();
    return getState();
  });
  ipcMain.handle("backping:cancel-request", async (_event, requestId: string) => {
    requestManager.cancel(requestId);
    updateTray();
    sendStateChanged();
    return getState();
  });
}

app.whenReady().then(() => {
  if (process.platform === "darwin") {
    app.dock?.hide();
    app.setActivationPolicy("accessory");
  }
  registerIpc();
  bootstrap();
  createTray();
  showSettingsWindow();
  startMcpServerInBackground();
  startProviderInBackground();
  app.focus({ steal: true });
});

app.on("window-all-closed", () => {
  // Keep the menu-bar app alive when the settings window is closed.
});

app.on("before-quit", async () => {
  await telegramProvider?.stop();
  await slackProvider?.stop();
  await mcpServer?.stop();
});

app.on("activate", () => {
  showSettingsWindow();
});
