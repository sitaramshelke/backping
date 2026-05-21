const api = window.backping;
const appNotice = document.getElementById("appNotice");
const telegramSaveStatus = document.getElementById("telegramSaveStatus");
const slackSaveStatus = document.getElementById("slackSaveStatus");
const preferenceStatus = document.getElementById("preferenceStatus");
const mcpStatus = document.getElementById("mcpStatus");
let selectedProvider = "telegram";

function messageFromError(error) {
  return error && error.message ? error.message : String(error || "Unknown error");
}

function setNotice(element, kind, message) {
  element.textContent = message || "";
  element.className = message ? "notice " + kind : "notice";
}

function flashButton(button, kind) {
  if (!button) {
    return;
  }
  const className = kind === "success" ? "flash-success" : "flash-action";
  button.classList.add(className);
  setTimeout(() => button.classList.remove(className), 900);
}

function confirmButton(button, label = "Copied") {
  if (!button) {
    return;
  }
  const originalText = button.textContent;
  button.textContent = label;
  flashButton(button, "success");
  setTimeout(() => {
    button.textContent = originalText;
  }, 1400);
}

function statusTone(label, value, state) {
  if (label === "MCP") {
    return state.mcpRunning ? "ok" : "bad";
  }
  if (label === "Active Chat") {
    return "accent";
  }
  if (label === "Chat Status") {
    return value === "Connected" ? "ok" : "warn";
  }
  if (label === "Pending") {
    return Number(value) > 0 ? "warn" : "ok";
  }
  if (label === "Launch") {
    return value === "At login" ? "accent" : "";
  }
  return "";
}

function chooseProvider(provider) {
  selectedProvider = provider === "slack" ? "slack" : "telegram";
  document.querySelectorAll("[data-provider-choice]").forEach((button) => {
    button.setAttribute("aria-pressed", button.dataset.providerChoice === selectedProvider ? "true" : "false");
  });
  document.getElementById("telegramPanel").hidden = selectedProvider !== "telegram";
  document.getElementById("slackPanel").hidden = selectedProvider !== "slack";
  document.getElementById("providerHint").textContent =
    selectedProvider === "slack"
      ? "Slack will be the only active chat integration after you save."
      : "Telegram will be the only active chat integration after you save.";
}

async function refresh(options = {}) {
  if (!api) {
    setNotice(appNotice, "error", "BackPing settings API is unavailable. Restart the app and try again.");
    return;
  }

  let state;
  try {
    state = await api.getState();
  } catch (error) {
    setNotice(appNotice, "error", "Unable to load settings: " + messageFromError(error));
    return;
  }

  setNotice(appNotice, "", "");
  chooseProvider(options.preserveProvider ? selectedProvider : state.provider || "telegram");
  document.getElementById("port").value = state.port;
  document.getElementById("launchAtLogin").checked = Boolean(state.launchAtLogin);
  document.getElementById("mcpConfig").value = state.mcpConfig;
  document.getElementById("telegramInfo").textContent = [
    state.hasTelegramToken ? "Token saved." : "No token saved.",
    state.telegramChatId ? "Chat connected: " + state.telegramChatId : "No chat connected yet.",
    state.telegramBotUsername ? "Bot: @" + state.telegramBotUsername : "",
    state.telegramLastError ? "Last error: " + state.telegramLastError : ""
  ].filter(Boolean).join(" ");
  document.getElementById("slackUserId").value = state.slackUserId || "";
  document.getElementById("slackInfo").textContent = [
    state.hasSlackBotToken ? "Bot token saved." : "No bot token saved.",
    state.hasSlackAppToken ? "App token saved." : "No app token saved.",
    state.slackUserId ? "User: " + state.slackUserId : "No user ID saved.",
    state.slackTeamName ? "Workspace: " + state.slackTeamName : "",
    state.slackBotUserId ? "Bot user: " + state.slackBotUserId : "",
    state.slackLastError ? "Last error: " + state.slackLastError : ""
  ].filter(Boolean).join(" ");

  const status = document.getElementById("status");
  status.innerHTML = "";
  const activeProvider = state.provider === "slack" ? "Slack" : "Telegram";
  const activeConnected = state.provider === "slack" ? state.slackConnected : state.telegramConnected;
  [
    ["MCP", state.mcpRunning ? "Running" : "Stopped"],
    ["Active Chat", activeProvider],
    ["Chat Status", activeConnected ? "Connected" : "Not connected"],
    ["Pending", String(state.pendingCount)],
    ["Launch", state.launchAtLogin ? "At login" : "Manual"]
  ].forEach(([label, value]) => {
    const el = document.createElement("div");
    el.className = ["pill", statusTone(label, value, state)].filter(Boolean).join(" ");
    el.innerHTML = "<strong>" + label + "</strong><br>" + value;
    status.appendChild(el);
  });

  const pending = document.getElementById("pending");
  pending.innerHTML = "";
  const requests = state.requests.filter((request) => request.status === "pending");
  if (requests.length === 0) {
    pending.innerHTML = '<p class="muted">No pending requests.</p>';
  } else {
    requests.forEach((request) => {
      const el = document.createElement("div");
      el.className = "request";
      el.innerHTML = '<strong>' + request.agent + '</strong><span class="muted">' + (request.displayCwd || "") + '</span><div>' + request.question + '</div>';
      const button = document.createElement("button");
      button.textContent = "Cancel";
      button.addEventListener("click", async (event) => {
        const clickedButton = event.currentTarget;
        await api.cancelRequest(request.id);
        confirmButton(clickedButton, "Cancelled");
        await refresh();
        setNotice(appNotice, "success", "Pending request cancelled.");
      });
      el.appendChild(button);
      pending.appendChild(el);
    });
  }
}

document.getElementById("saveStatus").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  await api.saveSettings({
    provider: selectedProvider
  });
  await refresh();
  confirmButton(button, "Saved");
  setNotice(preferenceStatus, "success", "Preferences saved. " + (selectedProvider === "slack" ? "Slack" : "Telegram") + " is the active integration.");
});

document.getElementById("savePort").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    await api.saveSettings({
      port: Number(document.getElementById("port").value),
      launchAtLogin: document.getElementById("launchAtLogin").checked
    });
    await refresh({ preserveProvider: true });
    confirmButton(button, "Saved");
    setNotice(mcpStatus, "success", "Local MCP settings saved.");
  } catch (error) {
    setNotice(mcpStatus, "error", "Could not save local settings: " + messageFromError(error));
  } finally {
    button.disabled = false;
  }
});

document.getElementById("copyMcp").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  await api.copyMcpConfig();
  confirmButton(button, "Copied");
  setNotice(mcpStatus, "success", "MCP config copied. Paste it into your user-level MCP config. Codex uses ~/.codex/config.toml; other clients can use the same URL and Authorization header.");
});
document.getElementById("copyInstructions").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  await api.copyAgentInstructions();
  confirmButton(button, "Copied");
  setNotice(mcpStatus, "success", "Agent memory instruction copied. Paste it into Codex/Claude memory or user-level agent instructions.");
});

document.getElementById("regenToken").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  await api.regenerateAuthToken();
  await refresh({ preserveProvider: true });
  confirmButton(button, "Regenerated");
  setNotice(mcpStatus, "success", "Auth token regenerated and MCP config copied.");
});

document.getElementById("saveTelegram").addEventListener("click", async (event) => {
  const input = document.getElementById("telegramToken");
  const button = event.currentTarget;
  const token = input.value.trim();

  if (!token) {
    setNotice(telegramSaveStatus, "error", "Paste a Telegram bot token before saving.");
    return;
  }

  button.disabled = true;
  setNotice(telegramSaveStatus, "success", "Saving Telegram token...");
  try {
    const state = await api.setTelegramToken(token);
    input.value = "";
    confirmButton(button, "Saved");
    setNotice(
      telegramSaveStatus,
      "success",
      state.telegramConnected
        ? "Token saved and Telegram polling is connected."
        : "Token saved locally. BackPing is trying to connect in the background; use Test Connection if it stays disconnected."
    );
    await refresh({ preserveProvider: true });
  } catch (error) {
    setNotice(telegramSaveStatus, "error", "Could not save Telegram token: " + messageFromError(error));
  } finally {
    button.disabled = false;
  }
});

document.getElementById("testTelegram").addEventListener("click", async (event) => {
  const button = event.currentTarget;

  button.disabled = true;
  setNotice(telegramSaveStatus, "success", "Testing Telegram connection...");
  try {
    const state = await api.testTelegramConnection();
    confirmButton(button, "Connected");
    setNotice(
      telegramSaveStatus,
      "success",
      state.telegramBotUsername
        ? "Telegram API reachable. Bot: @" + state.telegramBotUsername + ". Send /start to the bot to connect this chat."
        : "Telegram API reachable. Send /start to the bot to connect this chat."
    );
    await refresh({ preserveProvider: true });
  } catch (error) {
    setNotice(telegramSaveStatus, "error", messageFromError(error));
    await refresh({ preserveProvider: true });
  } finally {
    button.disabled = false;
  }
});

document.getElementById("clearTelegram").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  try {
    await api.clearTelegramToken();
    confirmButton(button, "Cleared");
    setNotice(telegramSaveStatus, "success", "Telegram token and chat connection cleared.");
    await refresh({ preserveProvider: true });
  } catch (error) {
    setNotice(telegramSaveStatus, "error", "Could not clear Telegram token: " + messageFromError(error));
  }
});

document.getElementById("openTelegram").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  await api.openTelegramBotfather();
  confirmButton(button, "Opened");
  setNotice(telegramSaveStatus, "success", "Opened BotFather in your browser.");
});

document.getElementById("saveSlack").addEventListener("click", async (event) => {
  const botTokenInput = document.getElementById("slackBotToken");
  const appTokenInput = document.getElementById("slackAppToken");
  const userIdInput = document.getElementById("slackUserId");
  const button = event.currentTarget;
  const botToken = botTokenInput.value.trim();
  const appToken = appTokenInput.value.trim();
  const userId = userIdInput.value.trim();

  if (!botToken && !appToken && !userId) {
    setNotice(slackSaveStatus, "error", "Paste a Slack token or enter your Slack user ID before saving.");
    return;
  }

  button.disabled = true;
  setNotice(slackSaveStatus, "success", "Saving Slack settings...");
  try {
    const state = await api.setSlackConfig({ botToken, appToken, userId });
    botTokenInput.value = "";
    appTokenInput.value = "";
    confirmButton(button, "Saved");
    setNotice(
      slackSaveStatus,
      "success",
      state.slackConnected
        ? "Slack settings saved and Socket Mode is connected."
        : "Slack settings saved locally. Use Test Connection after all Slack fields are configured."
    );
    await refresh({ preserveProvider: true });
  } catch (error) {
    setNotice(slackSaveStatus, "error", "Could not save Slack settings: " + messageFromError(error));
  } finally {
    button.disabled = false;
  }
});

document.getElementById("testSlack").addEventListener("click", async (event) => {
  const button = event.currentTarget;

  button.disabled = true;
  setNotice(slackSaveStatus, "success", "Testing Slack connection...");
  try {
    const state = await api.testSlackConnection();
    confirmButton(button, "Connected");
    setNotice(
      slackSaveStatus,
      "success",
      state.slackTeamName
        ? "Slack API reachable. Workspace: " + state.slackTeamName + ". Set provider to Slack when ready."
        : "Slack API reachable. Set provider to Slack when ready."
    );
    await refresh({ preserveProvider: true });
  } catch (error) {
    setNotice(slackSaveStatus, "error", messageFromError(error));
    await refresh({ preserveProvider: true });
  } finally {
    button.disabled = false;
  }
});

document.getElementById("clearSlack").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  try {
    await api.clearSlackConfig();
    document.getElementById("slackBotToken").value = "";
    document.getElementById("slackAppToken").value = "";
    document.getElementById("slackUserId").value = "";
    confirmButton(button, "Cleared");
    setNotice(slackSaveStatus, "success", "Slack tokens and user connection cleared.");
    await refresh({ preserveProvider: true });
  } catch (error) {
    setNotice(slackSaveStatus, "error", "Could not clear Slack settings: " + messageFromError(error));
  }
});

document.getElementById("copySlackManifest").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  await api.copySlackManifest();
  confirmButton(button, "Copied");
  setNotice(slackSaveStatus, "success", "Slack app manifest copied. Paste it into Slack's app manifest flow.");
});

document.getElementById("openSlackApps").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  await api.openSlackApps();
  confirmButton(button, "Opened");
  setNotice(slackSaveStatus, "success", "Opened Slack Apps in your browser.");
});

document.querySelectorAll("[data-provider-choice]").forEach((button) => {
  button.addEventListener("click", () => {
    chooseProvider(button.dataset.providerChoice);
    flashButton(button, "success");
    setNotice(preferenceStatus, "action", (selectedProvider === "slack" ? "Slack" : "Telegram") + " selected. Click Save Preferences to activate it.");
  });
});

if (api) {
  api.onStateChanged(refresh);
}
refresh();
