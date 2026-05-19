import crypto from "node:crypto";
import Store from "electron-store";
import type { BackPingSettings } from "../shared/types.js";

interface StoreSchema {
  settings: BackPingSettings & Record<string, unknown>;
}

function randomPort(): number {
  return 40000 + crypto.randomInt(0, 20000);
}

function randomToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export class AppConfig {
  private readonly store: Store<StoreSchema>;

  constructor() {
    this.store = new Store<StoreSchema>({
      name: "backping",
      defaults: {
        settings: {
          provider: "telegram",
          port: randomPort(),
          authToken: randomToken(),
          historyLimit: 100
        }
      }
    });
  }

  getSettings(): BackPingSettings {
    const settings = this.store.get("settings");
    const cleanSettings = { ...settings };
    delete cleanSettings["away" + "Mode"];
    return {
      ...cleanSettings,
      provider: cleanSettings.provider ?? "telegram",
      historyLimit: cleanSettings.historyLimit ?? 100
    };
  }

  updateSettings(updates: Partial<BackPingSettings>): BackPingSettings {
    const next = { ...this.getSettings(), ...updates };
    this.store.set("settings", next);
    return next;
  }

  regenerateAuthToken(): BackPingSettings {
    return this.updateSettings({ authToken: randomToken() });
  }
}
