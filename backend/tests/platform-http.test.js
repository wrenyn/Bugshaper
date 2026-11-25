import { test } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { EventEmitter } from "node:events";
import { createApi } from "../server.mjs";
import { platformConfig } from "../helpers/config.mjs";
import { TEST_DATABASE_URL, withDb } from "./helpers.mjs";

test("Node serves all application pages, protected data, demo login, and production assets", async t => {
  await withDb(t);
  const server = await createApi({
    databaseUrl: TEST_DATABASE_URL,
    ownerKey: "o".repeat(32),
    platform: { config: { ...platformConfig({}), demo: true } },
  });
  t.after(() => server.close());
  const call = (url, method = "GET", headers = {}, data) => new Promise(resolve => {
    const req = Readable.from(data === undefined ? [] : [Buffer.from(JSON.stringify(data))]);
    Object.assign(req, { url, method, headers: { origin: "http://localhost:4318", "content-type": "application/json", ...headers }, socket: { remoteAddress: "127.0.0.1" } });
    const res = Object.assign(new EventEmitter(), { writeHead(status, values) { this.status = status; this.headers = values; this.headersSent = true; }, end(value) { resolve({ status: this.status, headers: this.headers, text: String(value || ""), data: this.headers["content-type"]?.includes("json") ? JSON.parse(value) : null }); } });
    server.emit("request", req, res);
  });
  for (const route of ["/", "/pricing", "/security", "/login", "/dashboard", "/reports", "/projects", "/teams", "/members", "/analytics", "/activity", "/notifications", "/settings", "/billing", "/invite"]) {
    const result = await call(route); assert.equal(result.status, 200, route); assert.match(result.headers["content-type"], /text\/html/, route);
  }
  assert.match((await call("/dashboard.css")).text, /workspace-app/);
  assert.match((await call("/marketing.css")).text, /public-pricing-grid/);
  assert.match((await call("/dashboard.js")).headers["content-type"], /javascript/);
  assert.match((await call("/dashboard")).headers["content-security-policy"], /form-action 'self'/);
  const before = await call("/api/v1/session"); assert.equal(before.data.user, null);
  const login = await call("/auth/demo", "POST", {}, {}); assert.equal(login.status, 200); assert.match(login.headers["set-cookie"], /HttpOnly/);
  const cookie = login.headers["set-cookie"].split(";")[0];
  const session = await call("/api/v1/session", "GET", { cookie }); assert.equal(session.data.user.name, "Alex Morgan");
  const workspace = session.data.workspaces[0].id;
  const reports = await call(`/api/v1/workspaces/${workspace}/reports`, "GET", { cookie }); assert.equal(reports.data.total, 12);
  assert.equal((await call(`/api/v1/workspaces/${workspace}/reports`)).status, 401);
  assert.equal((await call("/healthz")).data.status, "ok");
});
