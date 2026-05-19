import { access, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const iconDir = path.join(root, "assets", "icon");
const icns = path.join(iconDir, "icon.icns");
const trayPng = path.join(iconDir, "tray-template.png");
const appPng = path.join(iconDir, "app-icon.png");

async function assertReadable(file, label) {
  try {
    await access(file);
  } catch {
    throw new Error(`Missing ${label}: ${file}`);
  }
}

async function pngDimensions(file) {
  const { stdout } = await execFileAsync("sips", ["-g", "pixelWidth", "-g", "pixelHeight", file]);
  const width = Number(stdout.match(/pixelWidth:\s*(\d+)/)?.[1]);
  const height = Number(stdout.match(/pixelHeight:\s*(\d+)/)?.[1]);
  return { width, height };
}

await mkdir(iconDir, { recursive: true });
await assertReadable(icns, "macOS app icon");
await assertReadable(trayPng, "menu-bar template icon");

const tray = await pngDimensions(trayPng);
if (tray.width !== 22 || tray.height !== 22) {
  throw new Error(`Expected ${trayPng} to be 22x22, got ${tray.width}x${tray.height}`);
}

await execFileAsync("sips", ["-s", "format", "png", icns, "--out", appPng]);

console.log("Verified macOS icon assets and refreshed assets/icon/app-icon.png.");
