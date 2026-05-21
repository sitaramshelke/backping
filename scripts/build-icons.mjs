import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const iconDir = path.join(root, "assets", "icon");
const icns = path.join(iconDir, "icon.icns");
const ico = path.join(iconDir, "icon.ico");
const trayPng = path.join(iconDir, "tray-template.png");
const appPng = path.join(iconDir, "app-icon.png");

if (process.platform !== "darwin") {
  throw new Error("npm run icons currently requires macOS because it uses sips to derive committed icon assets.");
}

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

const tempDir = await mkdtemp(path.join(tmpdir(), "backping-icons-"));
try {
  const winPng = path.join(tempDir, "icon-256.png");
  await execFileAsync("sips", ["-z", "256", "256", appPng, "--out", winPng]);
  const png = await readFile(winPng);
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);

  const directory = Buffer.alloc(16);
  directory[0] = 0;
  directory[1] = 0;
  directory[2] = 0;
  directory[3] = 0;
  directory.writeUInt16LE(1, 4);
  directory.writeUInt16LE(32, 6);
  directory.writeUInt32LE(png.length, 8);
  directory.writeUInt32LE(header.length + directory.length, 12);

  await writeFile(ico, Buffer.concat([header, directory, png]));
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

await assertReadable(ico, "Windows app icon");

console.log("Verified app icon assets and refreshed assets/icon/app-icon.png and assets/icon/icon.ico.");
