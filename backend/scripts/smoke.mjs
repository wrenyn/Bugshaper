#!/usr/bin/env node
/** Hit /healthz on a running Bugshaper instance. Usage: node scripts/smoke.mjs [origin] */
const origin = (process.argv[2] || process.env.BUGSHAPER_ORIGIN || "http://127.0.0.1:4318").replace(/\/$/, "");
const response = await fetch(origin + "/healthz", { signal: AbortSignal.timeout(10000) });
const body = await response.json().catch(() => ({}));
if (!response.ok || body.status !== "ok") {
  console.error(`Smoke failed for ${origin}/healthz → ${response.status}`, body);
  process.exit(1);
}
console.log(`Smoke ok: ${origin}/healthz`);
