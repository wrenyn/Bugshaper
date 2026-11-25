import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

if (process.env.NODE_ENV === "production") throw new Error("The demo server cannot run in production.");

const backendRoot = fileURLToPath(new URL("..", import.meta.url));
const websiteRoot = join(backendRoot, "..", "website");
if (existsSync(join(websiteRoot, "package.json"))) {
  execFileSync(process.execPath, ["build.mjs"], { cwd: websiteRoot, stdio: "inherit" });
} else if (!existsSync(join(backendRoot, "public", "www", "asset-manifest.json"))) {
  throw new Error("Build the website package first, or place a built site in backend/public/www.");
}

process.env.BUGSHAPER_DEMO = "true";
process.env.DATABASE_URL = process.env.DATABASE_URL || process.env.BUGSHAPER_DEMO_DATABASE_URL || "postgres://bugshaper:bugshaper@127.0.0.1:5432/bugshaper_demo";
for (const key of ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "DODO_PAYMENTS_API_KEY", "DODO_PAYMENTS_WEBHOOK_KEY", "RESEND_API_KEY"]) {
  delete process.env[key];
}
process.env.DODO_PAYMENTS_ENVIRONMENT = "test_mode";
await import("../start.mjs");
