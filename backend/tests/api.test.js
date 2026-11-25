import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { createApi } from "../server.mjs";
import { createHandler } from "../../cli/mcp.mjs";
import { TEST_DATABASE_URL, withDb } from "./helpers.mjs";

test("report access, idempotent upload, share expiry, and revocation", async (t) => {
  await withDb(t);
  const ownerKey = "o".repeat(32);
  const agentKey = "a".repeat(32);
  let now = Date.now();
  let providerCalls = 0;
  const server = await createApi({ databaseUrl: TEST_DATABASE_URL, ownerKey, agentKey, now: () => now, investigate: async (report) => {
    providerCalls++;
    return { summary: "Service unavailable", evidenceAt: [report.events[0].at] };
  } });
  t.after(() => server.close());
  const call = (url, token, method = "GET", body) => new Promise((resolve) => {
    const request = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
    Object.assign(request, { url, method, socket: { remoteAddress: "127.0.0.1" },
      headers: { authorization: "Bearer " + token, "content-type": "application/json" } });
    const response = Object.assign(new EventEmitter(), {
      writeHead(status, headers) { this.status = status; this.headers = headers; this.headersSent = true; },
      end(text) { resolve({ status: this.status, json: async () => JSON.parse(text), text: String(text), headers: this.headers }); },
    });
    server.emit("request", request, response);
  });
  const id = randomUUID();
  const report = { id, schemaVersion: 1, title: "Failed fetch", createdAt: now,
    events: [{ at: now, kind: "network", status: 500, origin: "https://example.test/x?secret=raw" }] };
  assert.equal((await call("/v1/reports", "", "POST", report)).status, 401);
  assert.equal((await call("/v1/reports", agentKey, "POST", report)).status, 403);
  assert.equal((await call("/v1/reports", ownerKey, "POST", report)).status, 201);
  assert.equal((await call("/v1/reports", ownerKey, "POST", report)).status, 200);
  const path = "/v1/reports/" + id;
  const stored = await (await call(path, agentKey)).json();
  assert.equal(stored.report.events[0].origin, "https://example.test");
  assert.equal(stored.classification[0].category, "Network");
  const dashboard = await call("/dashboard", "");
  assert.equal(dashboard.status, 200);
  assert.match(dashboard.text, /Reports dashboard/);
  assert.match(dashboard.headers["referrer-policy"], /no-referrer/);
  assert.equal((await call("/v1/reports?view=dashboard", "")).status, 401);
  assert.equal((await call("/v1/reports?view=dashboard&status=Unknown", ownerKey)).status, 400);
  assert.deepEqual((await (await call("/v1/reports?view=dashboard&q=FAILED", agentKey)).json()).reports.map(item => item.id), [id]);
  assert.equal((await (await call("/v1/reports?view=dashboard", agentKey)).json()).canEdit, false);
  assert.equal((await (await call("/v1/reports?view=dashboard", ownerKey)).json()).canEdit, true);

  const mcp = createHandler(async (path) => (await call(path, agentKey)).json());
  const rpc = (id, method, params) => mcp({ jsonrpc: "2.0", id, method, params });
  assert.equal((await rpc(1, "initialize", { protocolVersion: "2025-06-18" })).result.protocolVersion, "2025-06-18");
  await mcp({ jsonrpc: "2.0", method: "notifications/initialized" });
  const output = await rpc(2, "tools/call", { name: "get_network_requests", arguments: { id } });
  assert.equal(JSON.parse(output.result.content[0].text).data[0].status, 500);
  assert.equal((await rpc(3, "tools/call", { name: "get_bug_report", arguments: { id: "../files" } })).error.code, -32602);

  async function share() {
    return (await call(path + "/shares", ownerKey, "POST", { ttlSeconds: 60 })).json();
  }
  assert.equal((await call("/v1/shared", "unknown")).status, 404);
  const { key } = await share();
  assert.equal((await call("/v1/shared", key)).status, 200);
  now += 60_000;
  assert.equal((await call("/v1/shared", key)).status, 404);
  const second = await share();
  assert.equal((await call(path + "/shares", ownerKey, "DELETE")).status, 200);
  assert.equal((await call("/v1/shared", second.key)).status, 404);
  const viewer = await call("/viewer", "");
  assert.equal(viewer.status, 200);
  assert.match(viewer.text, /Bugshaper report viewer/);
  assert.match(viewer.headers["content-security-policy"], /default-src 'none'/);
  const invite = await (await call(path + "/contributors", ownerKey, "POST", { ttlSeconds: 60 })).json();
  assert.equal((await call("/v1/reports", invite.key)).status, 404);
  assert.equal((await call("/v1/reports/" + randomUUID(), invite.key)).status, 404);
  assert.equal((await call(path, invite.key)).status, 200);
  assert.equal((await call(path, invite.key, "PATCH", { status: "Resolved" })).status, 403);
  assert.equal((await call(path + "/discussion", invite.key, "POST", { text: "Checked against staging.", at: report.createdAt })).status, 201);
  assert.equal((await call(path + "/discussion", second.key, "POST", { text: "Forbidden" })).status, 401);
  assert.equal((await call(path, ownerKey, "PATCH", { createdAt: 0 })).status, 400);
  assert.equal((await call(path, ownerKey, "PATCH", { status: "Resolved", assignee: "QA" })).status, 200);
  const filtered = await (await call("/v1/reports?view=dashboard&status=Resolved&assignee=QA", ownerKey)).json();
  assert.deepEqual(filtered.reports.map(item => [item.id, item.assignee]), [[id, "QA"]]);
  const { entries } = await (await call(path + "/discussion", ownerKey)).json();
  assert.deepEqual(entries.map(({ kind }) => kind), ["comment", "edit"]);
  assert.equal(entries[1].body.to, "Resolved");
  assert.equal((await call(path + "/investigation", agentKey, "POST", { consent: true })).status, 403);
  assert.equal((await call(path + "/investigation", ownerKey, "POST", { consent: false })).status, 400);
  assert.equal(providerCalls, 0);
  assert.equal((await call(path + "/investigation", ownerKey, "POST", { consent: true })).status, 200);
  assert.equal(providerCalls, 1);
  assert.equal((await call(path + "/contributors", ownerKey, "DELETE")).status, 200);
  assert.equal((await call(path, invite.key)).status, 401);
  assert.equal((await call(path, ownerKey, "DELETE")).status, 200);
  assert.equal((await call(path, agentKey)).status, 404);
});

test("legacy /v1 API is disabled when owner key is omitted", async (t) => {
  await withDb(t);
  const server = await createApi({ databaseUrl: TEST_DATABASE_URL, ownerKey: null });
  t.after(() => server.close());
  const result = await new Promise((resolve) => {
    const request = Object.assign(Readable.from([]), { url: "/v1/reports", method: "GET", socket: { remoteAddress: "127.0.0.1" }, headers: {} });
    const response = Object.assign(new EventEmitter(), {
      writeHead(status) { this.status = status; this.headersSent = true; },
      end(text) { resolve({ status: this.status, body: String(text) }); },
    });
    server.emit("request", request, response);
  });
  assert.equal(result.status, 404);
  assert.match(result.body, /Legacy API unavailable/);
});
