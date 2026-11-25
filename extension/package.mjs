import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const extensionDir = fileURLToPath(new URL("./", import.meta.url));
const outDir = fileURLToPath(new URL("./dist/", import.meta.url));
const dest = join(outDir, "bugshaper-extension.zip");
mkdirSync(outDir, { recursive: true });
try { unlinkSync(dest); } catch { /* first pack */ }

const manifest = JSON.parse(readFileSync(join(extensionDir, "manifest.json"), "utf8"));
const result = process.platform === "win32"
  ? spawnSync("powershell", ["-NoProfile", "-Command", `Compress-Archive -Path '${join(extensionDir, "*")}' -DestinationPath '${dest}' -Force`], { encoding: "utf8" })
  : spawnSync("zip", ["-r", dest, ".", "-x", "dist/*", "-x", "tests/*", "-x", "node_modules/*"], { cwd: extensionDir, encoding: "utf8" });

if (result.status !== 0) {
  console.error(result.stderr || result.stdout || "Failed to create extension zip.");
  process.exit(result.status || 1);
}
console.log(`Packed Bugshaper extension v${manifest.version} → extension/dist/bugshaper-extension.zip`);
