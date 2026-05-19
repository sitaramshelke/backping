import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const SERVICE = "BackPing";
const SECURITY = "/usr/bin/security";

export class Keychain {
  async get(account: string): Promise<string | undefined> {
    try {
      const { stdout } = await execFileAsync(SECURITY, [
        "find-generic-password",
        "-s",
        SERVICE,
        "-a",
        account,
        "-w"
      ]);
      return stdout.trim() || undefined;
    } catch {
      return undefined;
    }
  }

  async set(account: string, value: string): Promise<void> {
    try {
      await execFileAsync(SECURITY, [
        "add-generic-password",
        "-s",
        SERVICE,
        "-a",
        account,
        "-w",
        value,
        "-U"
      ]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Unable to save secret to macOS Keychain: ${message}`);
    }
  }

  async delete(account: string): Promise<void> {
    try {
      await execFileAsync(SECURITY, [
        "delete-generic-password",
        "-s",
        SERVICE,
        "-a",
        account
      ]);
    } catch {
      // Missing Keychain entries are fine.
    }
  }
}
