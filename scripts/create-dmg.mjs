import { execFile } from "node:child_process";
import { mkdir, rm, cp, symlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { createRequire } from "node:module";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const pkg = require("../package.json");

const root = path.resolve(new URL("..", import.meta.url).pathname);
const releaseDir = path.join(root, "release");
const appPath = path.join(releaseDir, "mac-arm64", "BackPing.app");
const stagingDir = path.join(releaseDir, "dmg-staging");
const stagedApp = path.join(stagingDir, "BackPing.app");
const applicationsLink = path.join(stagingDir, "Applications");
const dmgPath = path.join(releaseDir, `BackPing-${pkg.version}-arm64.dmg`);

if (!existsSync(appPath)) {
  throw new Error(`Missing packaged app: ${appPath}`);
}

await rm(stagingDir, { recursive: true, force: true });
await mkdir(stagingDir, { recursive: true });
await cp(appPath, stagedApp, { recursive: true });
await symlink("/Applications", applicationsLink);
await rm(dmgPath, { force: true });

await execFileAsync("hdiutil", [
  "create",
  "-volname",
  "BackPing",
  "-fs",
  "HFS+",
  "-srcfolder",
  stagingDir,
  "-ov",
  dmgPath
]);

await rm(stagingDir, { recursive: true, force: true });
console.log(`Created ${dmgPath}`);
