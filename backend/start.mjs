import { investigationProvider } from "./controllers/investigate.mjs";
import { createApi } from "./server.mjs";
import { randomBytes } from "node:crypto";

const port = Number(process.env.BUGSHAPER_PORT ?? 4318);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid BUGSHAPER_PORT.");
const production = process.env.NODE_ENV === "production";
const configuredOwner = process.env.BUGSHAPER_OWNER_KEY;
if (configuredOwner && configuredOwner.length < 32) throw new Error("BUGSHAPER_OWNER_KEY must be at least 32 characters.");
if (process.env.BUGSHAPER_AGENT_KEY && process.env.BUGSHAPER_AGENT_KEY.length < 32) throw new Error("BUGSHAPER_AGENT_KEY must be at least 32 characters.");
const ownerKey = configuredOwner || (production ? null : randomBytes(32).toString("hex"));
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required (PostgreSQL connection string).");

const server = await createApi({
  databaseUrl: process.env.DATABASE_URL,
  ownerKey,
  agentKey: process.env.BUGSHAPER_AGENT_KEY,
  investigate: investigationProvider({ key: process.env.BUGSHAPER_OPENAI_KEY, model: process.env.BUGSHAPER_OPENAI_MODEL }),
});
const host = process.env.BUGSHAPER_HOST || (production ? "0.0.0.0" : "127.0.0.1");
server.listen(port, host, () => console.log("Bugshaper listening at " + (process.env.BUGSHAPER_ORIGIN || "http://localhost:" + port)));
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => { server.close(() => process.exit(0)); setTimeout(() => process.exit(1), 10000).unref(); });
