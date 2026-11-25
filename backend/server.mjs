import { createServer } from "node:http";
import { createHash, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { createPlatform, createLegacyRouter, loadStaticAssets, serveStatic } from "./routes/index.mjs";
import { platformConfig } from "./helpers/config.mjs";
import { openDatabase } from "./helpers/pg.mjs";

const digest = (value) => createHash("sha256").update(value).digest();
function matches(value, key) {
  return Boolean(key) && typeof value === "string" && value.length > 0 && timingSafeEqual(digest(value), digest(key));
}

function send(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store", "x-content-type-options": "nosniff" });
  res.end(JSON.stringify(body));
}

export async function createApi({
  databaseUrl = process.env.DATABASE_URL,
  db: existingDb = null,
  ownerKey = null,
  agentKey,
  investigate,
  now = Date.now,
  platform = {},
} = {}) {
  if (!existingDb && !databaseUrl) throw new Error("DATABASE_URL is required (PostgreSQL connection string).");
  const legacyEnabled = ownerKey != null;
  if (legacyEnabled && (typeof ownerKey !== "string" || ownerKey.length < 32 ||
    (agentKey && (agentKey.length < 32 || matches(agentKey, ownerKey))))) {
    throw new Error("Configure distinct keys of at least 32 characters.");
  }
  if (!legacyEnabled && agentKey) throw new Error("BUGSHAPER_AGENT_KEY requires BUGSHAPER_OWNER_KEY.");

  const db = existingDb || await openDatabase(databaseUrl);
  await db.exec(readFileSync(new URL("./db/schema.sql", import.meta.url), "utf8"));

  const config = platform.config ?? platformConfig();
  const handlePlatform = await createPlatform(db, { now, ...platform, config: platform.config ?? config });
  const handleLegacy = createLegacyRouter(db, {
    ownerKey,
    agentKey,
    investigate,
    now,
    trustProxy: platform.config?.trustProxy ?? config.trustProxy,
  });
  const assets = loadStaticAssets({ origin: platform.config?.origin || process.env.BUGSHAPER_ORIGIN || "http://localhost:4318" });

  async function handle(req, res) {
    const url = new URL(req.url, "http://localhost");
    if (serveStatic(assets, req, res, url.pathname)) return;
    if (await handlePlatform(req, res, url)) return;
    if (await handleLegacy(req, res, url)) return;
    send(res, 404, { error: "Route unavailable." });
  }

  const server = createServer({ requestTimeout: 60_000, headersTimeout: 60_000, keepAliveTimeout: 5_000 }, (req, res) => {
    handle(req, res).catch(() => {
      if (!res.headersSent && !res.destroyed) send(res, 500, { error: "Request failed." });
    });
  });
  if (!existingDb) server.on("close", () => { db.close().catch(() => {}); });
  return server;
}
