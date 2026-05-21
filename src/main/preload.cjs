const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("backping", {
  getState: () => ipcRenderer.invoke("backping:get-state"),
  saveSettings: (settings) => ipcRenderer.invoke("backping:save-settings", settings),
  setTelegramToken: (token) => ipcRenderer.invoke("backping:set-telegram-token", token),
  testTelegramConnection: () => ipcRenderer.invoke("backping:test-telegram-connection"),
  clearTelegramToken: () => ipcRenderer.invoke("backping:clear-telegram-token"),
  setSlackConfig: (settings) => ipcRenderer.invoke("backping:set-slack-config", settings),
  testSlackConnection: () => ipcRenderer.invoke("backping:test-slack-connection"),
  clearSlackConfig: () => ipcRenderer.invoke("backping:clear-slack-config"),
  copyMcpConfig: () => ipcRenderer.invoke("backping:copy-mcp-config"),
  copyAgentInstructions: () => ipcRenderer.invoke("backping:copy-agent-instructions"),
  copySlackManifest: () => ipcRenderer.invoke("backping:copy-slack-manifest"),
  openSlackApps: () => ipcRenderer.invoke("backping:open-slack-apps"),
  openTelegramBotfather: () => ipcRenderer.invoke("backping:open-telegram-botfather"),
  regenerateAuthToken: () => ipcRenderer.invoke("backping:regenerate-auth-token"),
  cancelRequest: (requestId) => ipcRenderer.invoke("backping:cancel-request", requestId),
  onStateChanged: (callback) => {
    ipcRenderer.on("backping:state-changed", callback);
  }
});
