#!/usr/bin/env node
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { platformConfig } from "../helpers/config.mjs";

const backendRoot = fileURLToPath(new URL("..", import.meta.url));
const file = process.argv[2] || resolve(backendRoot, ".env.production");
const path = resolve(file);
if (!existsSync(path)) {
  console.error(`Missing ${file}. Copy backend/.env.production.example and fill values.`);
  process.exit(1);
}

const env = { ...process.env };
for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
  if (!line || line.trim().startsWith("#")) continue;
  const index = line.indexOf("=");
  if (index < 1) continue;
  const key = line.slice(0, index).trim();
  let value = line.slice(index + 1).trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
  env[key] = value;
}

try {
  const config = platformConfig(env);
  const checks = [
    ["NODE_ENV", env.NODE_ENV || "(unset)"],
    ["Origin", config.origin],
    ["Google", config.googleClientId ? "configured" : "missing"],
    ["Database", env.DATABASE_URL ? "DATABASE_URL set" : "missing"],
    ["Media", config.s3.bucket ? `s3://${config.s3.bucket}` : config.mediaDir || "BYTEA blobs"],
    ["Billing", config.dodoKey ? config.dodoEnvironment : "disabled"],
    ["Email", config.resendKey ? "Resend configured" : "invite links only"],
  ];
  for (const [label, value] of checks) console.log(`${label.padEnd(10)} ${value}`);
  if (!env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
  if (env.NODE_ENV === "production" && !config.googleClientId) throw new Error("Production Google OAuth is required.");
  console.log(`OK: ${file} passes Bugshaper config checks.`);
} catch (error) {
  console.error(`Invalid ${file}: ${error.message}`);
  process.exit(1);
}
