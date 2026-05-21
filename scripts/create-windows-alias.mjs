import { copyFile } from "node:fs/promises";
import path from "node:path";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const pkg = require("../package.json");

const root = path.resolve(new URL("..", import.meta.url).pathname);
const releaseDir = path.join(root, "release");
const installerPath = path.join(releaseDir, `BackPing Setup ${pkg.version}.exe`);
const latestInstallerPath = path.join(releaseDir, "BackPing-latest-windows-x64.exe");

if (!existsSync(installerPath)) {
  throw new Error(`Missing Windows installer: ${installerPath}`);
}

await copyFile(installerPath, latestInstallerPath);
console.log(`Created ${latestInstallerPath}`);
