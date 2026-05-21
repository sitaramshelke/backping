import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { safeStorage } from "electron";
import Store from "electron-store";

const execFileAsync = promisify(execFile);

const SERVICE = "BackPing";
const SECURITY = "/usr/bin/security";

type SecretEncoding = "safeStorage";

interface SecretRecord {
  encoding: SecretEncoding;
  value: string;
}

interface SecretStoreSchema {
  secrets: Record<string, SecretRecord>;
  secretTombstones: Record<string, boolean>;
}

export class SecretStore {
  private readonly store: Store<SecretStoreSchema>;

  constructor() {
    this.store = new Store<SecretStoreSchema>({
      name: "backping-secrets",
      defaults: {
        secrets: {},
        secretTombstones: {}
      }
    });
  }

  async get(account: string): Promise<string | undefined> {
    const record = this.store.get("secrets")[account];
    if (record) {
      return this.decode(record, account);
    }

    if (this.store.get("secretTombstones")[account]) {
      return undefined;
    }

    const legacyValue = await this.getLegacyMacKeychainSecret(account);
    if (legacyValue) {
      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error(`Encrypted secret storage is not available; cannot migrate legacy secret for account ${account}.`);
      }
      await this.set(account, legacyValue);
    }
    return legacyValue;
  }

  async set(account: string, value: string): Promise<void> {
    const secrets = { ...this.store.get("secrets") };
    secrets[account] = this.encode(value);
    this.store.set("secrets", secrets);
    this.clearTombstone(account);
    await this.deleteLegacyMacKeychainSecretBestEffort(account);
  }

  async delete(account: string): Promise<void> {
    this.markTombstone(account);
    const secrets = { ...this.store.get("secrets") };
    delete secrets[account];
    this.store.set("secrets", secrets);
    await this.deleteLegacyMacKeychainSecretBestEffort(account);
  }

  private markTombstone(account: string): void {
    const tombstones = { ...this.store.get("secretTombstones") };
    tombstones[account] = true;
    this.store.set("secretTombstones", tombstones);
  }

  private clearTombstone(account: string): void {
    const tombstones = { ...this.store.get("secretTombstones") };
    delete tombstones[account];
    this.store.set("secretTombstones", tombstones);
  }

  private encode(value: string): SecretRecord {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("Encrypted secret storage is not available on this system.");
    }

    return {
      encoding: "safeStorage",
      value: safeStorage.encryptString(value).toString("base64")
    };
  }

  private decode(record: SecretRecord, account: string): string {
    try {
      const buffer = Buffer.from(record.value, "base64");
      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error("safeStorage encryption is unavailable.");
      }
      return safeStorage.decryptString(buffer);
    } catch (error) {
      throw new Error(`Failed to decrypt secret for account ${account}.`, { cause: error });
    }
  }

  private isMissingKeychainItem(error: unknown): boolean {
    if (typeof error !== "object" || error === null) {
      return false;
    }

    const candidate = error as { code?: unknown; message?: unknown; stderr?: unknown };
    const code = typeof candidate.code === "number" ? candidate.code : undefined;
    const message = `${candidate.message ?? ""}\n${candidate.stderr ?? ""}`.toLowerCase();
    return code === 44 || message.includes("could not be found") || message.includes("not found");
  }

  private async getLegacyMacKeychainSecret(account: string): Promise<string | undefined> {
    if (process.platform !== "darwin") {
      return undefined;
    }

    try {
      const { stdout } = await execFileAsync(SECURITY, [
        "find-generic-password",
        "-s",
        SERVICE,
        "-a",
        account,
        "-w"
      ]);
      const value = stdout.replace(/\r?\n$/, "");
      return value || undefined;
    } catch (error) {
      if (this.isMissingKeychainItem(error)) {
        return undefined;
      }
      console.error(`Unable to read legacy macOS Keychain secret for service ${SERVICE} account ${account}:`, error);
      throw error;
    }
  }

  private async deleteLegacyMacKeychainSecret(account: string): Promise<void> {
    if (process.platform !== "darwin") {
      return;
    }

    try {
      await execFileAsync(SECURITY, [
        "delete-generic-password",
        "-s",
        SERVICE,
        "-a",
        account
      ]);
    } catch (error) {
      if (this.isMissingKeychainItem(error)) {
        return;
      }
      console.error(`Unable to delete legacy macOS Keychain secret for service ${SERVICE} account ${account}:`, error);
      throw error;
    }
  }

  private async deleteLegacyMacKeychainSecretBestEffort(account: string): Promise<void> {
    try {
      await this.deleteLegacyMacKeychainSecret(account);
    } catch (error) {
      this.markTombstone(account);
      console.warn("Failed to remove legacy macOS Keychain secret; future migration is disabled for this account.", error);
    }
  }
}
