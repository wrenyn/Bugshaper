import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHmac } from "node:crypto";
import { Readable } from "node:stream";
import { EventEmitter } from "node:events";
import { createPlatform } from "../routes/platform.mjs";
import { platformConfig } from "../helpers/config.mjs";
import { repository } from "../models/repository.mjs";
import { authService } from "../controllers/auth.mjs";
import { makeBundle } from "../helpers/bundle.js";
import { withDb } from "./helpers.mjs";

async function harness(t, options = {}) {
  const db = await withDb(t);
  let time = Date.now(); const now = () => time;
  const config = { ...platformConfig({}), ...options.config };
  const fetcher = options.fetcher || (async () => { throw new Error("Unexpected external request"); });
  const handler = await createPlatform(db, { config, now, fetcher });
  const repo = repository(db, now); const auth = authService(repo, config, now, fetcher);
  async function call(path, { as, method = "GET", data, headers = {}, raw } = {}) {
    const payload = raw ?? (data === undefined ? "" : JSON.stringify(data));
    const req = Readable.from(payload ? [Buffer.from(payload)] : []);
    Object.assign(req, { url: path, method, socket: { remoteAddress: "127.0.0.1" }, headers: { "content-type": "application/json", origin: config.origin, ...(as ? { cookie: as.cookie.split(";")[0], "x-csrf-token": as.csrf } : {}), ...headers } });
    let resolve; const completion = new Promise(r => { resolve = r; });
    const res = Object.assign(new EventEmitter(), { writeHead(status, responseHeaders) { this.status = status; this.headers = responseHeaders; this.headersSent = true; }, end(value) {
      const text = String(value || ""); resolve({ status: this.status, headers: this.headers, text, data: this.headers?.["content-type"]?.includes("json") ? JSON.parse(text) : null });
    } });
    await handler(req, res, new URL(path, config.origin)); return completion;
  }
  async function identity(name, email = name.toLowerCase() + "@example.com") {
    const user = await auth.upsertProfile({ sub: name, email, name, email_verified: true });
    const wid = (await repo.one("SELECT workspace_id FROM memberships WHERE user_id=?", user.id)).workspace_id;
    return { ...user, wid, ...(await auth.createSession(user.id)), endpoint: path => `/api/v1/workspaces/${wid}/${path}` };
  }
  return { db, repo, auth, config, call, identity, advance: ms => { time += ms; } };
}

test("workspace isolation, role enforcement, report versions, notifications, and removal", async t => {
  const h = await harness(t); const alice = await h.identity("Alice"); const bob = await h.identity("Bob");
  assert.equal((await h.call(alice.endpoint("reports"))).status, 401);
  assert.equal((await h.call(alice.endpoint("reports"), { as: bob })).status, 404);
  assert.equal((await h.call(alice.endpoint("settings"), { as: alice, method: "PATCH", data: { name: "Changed" }, headers: { "x-csrf-token": "wrong" } })).status, 403);
  assert.equal((await h.call(alice.endpoint("settings"), { as: alice, method: "PATCH", data: { name: "Changed" }, headers: { origin: "https://evil.example" } })).status, 403);
  const project = await h.call(alice.endpoint("projects"), { as: alice, method: "POST", data: { name: "Web" } }); assert.equal(project.status, 201);
  const foreignProject = await h.call(bob.endpoint("projects"), { as: bob, method: "POST", data: { name: "Private" } });
  assert.equal((await h.call(alice.endpoint("reports"), { as: alice, method: "POST", data: { title: "Cross tenant", projectId: foreignProject.data.id } })).status, 400);
  const invitation = await h.call(alice.endpoint("invitations"), { as: alice, method: "POST", data: { email: bob.email, role: "viewer" } }); assert.equal(invitation.status, 201);
  const accept = await h.call("/api/v1/invitations/accept", { as: bob, method: "POST", data: { token: new URL(invitation.data.inviteUrl).hash.slice(1) } }); assert.equal(accept.status, 200);
  const report = await h.call(alice.endpoint("reports"), { as: alice, method: "POST", data: { title: "Broken checkout", projectId: project.data.id, assigneeId: bob.id, severity: "High" } }); assert.equal(report.status, 201);
  const id = report.data.report.id; const path = alice.endpoint("reports/" + id);
  assert.equal((await h.call(path, { as: bob })).data.report.title, "Broken checkout");
  assert.equal((await h.call(path, { as: bob, method: "PATCH", data: { revision: 1, title: "Unauthorized" } })).status, 403);
  assert.equal((await h.call(path + "/comments", { as: bob, method: "POST", data: { text: "Viewer cannot comment" } })).status, 403);
  assert.equal((await h.call(alice.endpoint("billing"), { as: bob })).status, 200);
  assert.equal((await h.call(alice.endpoint("billing/checkout"), { as: bob, method: "POST", data: { plan: "pro" } })).status, 403);
  assert.equal((await h.call(path, { as: alice, method: "PATCH", data: { revision: 1, status: "Triaged" } })).status, 200);
  assert.equal((await h.call(path, { as: alice, method: "PATCH", data: { revision: 1, status: "Resolved" } })).status, 409);
  assert.equal((await h.call(path + "/comments", { as: alice, method: "POST", data: { text: "Reproduced on staging." } })).status, 201);
  assert.equal((await h.call(path + "/comments", { as: bob })).data.comments[0].author, "Alice");
  assert.equal((await h.call(alice.endpoint("notifications"), { as: bob })).data.notifications.length, 2);
  const promoted = await h.call(alice.endpoint("members/" + bob.id), { as: alice, method: "PATCH", data: { role: "member" } }); assert.equal(promoted.status, 200);
  assert.equal((await h.call(path + "/comments", { as: bob, method: "POST", data: { text: "I can comment now." } })).status, 201);
  assert.equal((await h.call(path, { as: bob, method: "DELETE" })).status, 403);
  const analytics = (await h.call(alice.endpoint("analytics"), { as: alice })).data;
  assert.equal(analytics.total, 1); assert.equal(analytics.open, 1); assert.equal(analytics.bySeverity.find(x => x.name === "High").count, 1);
  assert.equal((await h.call(alice.endpoint("members/" + bob.id), { as: alice, method: "DELETE" })).status, 200);
  assert.equal((await h.call(path, { as: bob })).status, 404);
  assert.equal((await h.call(path, { as: alice })).data.report.assigneeId, null);
  assert.equal((await h.call(path, { as: alice })).data.report.assignee, "");
  assert.equal((await makeBundle((await h.call(path, { as: alice })).data.report)).report.title, "Broken checkout");
});

test("email-bound, expiring invitations, team membership, and reserved seat limits", async t => {
  const h = await harness(t); const owner = await h.identity("Owner"); const invitee = await h.identity("Invitee"); const stranger = await h.identity("Stranger");
  const team = await h.call(owner.endpoint("teams"), { as: owner, method: "POST", data: { name: "Engineering" } }); assert.equal(team.status, 201);
  const invite = await h.call(owner.endpoint("invitations"), { as: owner, method: "POST", data: { email: invitee.email, teamId: team.data.id } }); assert.equal(invite.status, 201);
  assert.equal((await h.call(owner.endpoint("invitations"), { as: owner, method: "POST", data: { email: invitee.email } })).status, 409);
  const secret = new URL(invite.data.inviteUrl).hash.slice(1);
  assert.equal((await h.call("/api/v1/invitations/accept", { as: stranger, method: "POST", data: { token: secret } })).status, 403);
  assert.equal((await h.call("/api/v1/invitations/accept", { as: invitee, method: "POST", data: { token: secret } })).status, 200);
  assert.equal((await h.call("/api/v1/invitations/accept", { as: invitee, method: "POST", data: { token: secret } })).status, 404);
  const teams = (await h.call(owner.endpoint("teams"), { as: invitee })).data.teams;
  assert.deepEqual(teams[0].members.map(m => m.id).sort(), [owner.id, invitee.id].sort());
  const reserved = await h.call(owner.endpoint("invitations"), { as: owner, method: "POST", data: { email: "third@example.com" } }); assert.equal(reserved.status, 201);
  assert.equal((await h.call(owner.endpoint("invitations"), { as: owner, method: "POST", data: { email: "fourth@example.com" } })).status, 402);
  assert.equal((await h.call(owner.endpoint("invitations/" + reserved.data.id), { as: owner, method: "DELETE" })).status, 200);
  const expired = await h.call(owner.endpoint("invitations"), { as: owner, method: "POST", data: { email: stranger.email } });
  h.advance(604800001); const newSession = await h.auth.createSession(stranger.id);
  assert.equal((await h.call("/api/v1/invitations/accept", { as: { ...stranger, ...newSession }, method: "POST", data: { token: new URL(expired.data.inviteUrl).hash.slice(1) } })).status, 404);
});

test("plan limits and bundle imports are enforced on the server", async t => {
  const h = await harness(t); const user = await h.identity("Writer");
  for (const name of ["One", "Two"]) assert.equal((await h.call(user.endpoint("projects"), { as: user, method: "POST", data: { name } })).status, 201);
  assert.equal((await h.call(user.endpoint("projects"), { as: user, method: "POST", data: { name: "Three" } })).status, 402);
  const bundle = await makeBundle({ schemaVersion: 1, id: randomUUID(), createdAt: Date.now(), title: "Imported", events: [] });
  assert.equal((await h.call(user.endpoint("submissions"), { as: user, method: "POST", data: bundle })).status, 201);
  assert.equal((await h.call(user.endpoint("submissions"), { as: user, method: "POST", data: bundle })).status, 409);
  for (let i = 1; i < 50; i++) assert.equal((await h.call(user.endpoint("reports"), { as: user, method: "POST", data: { title: "Report " + i } })).status, 201);
  assert.equal((await h.call(user.endpoint("reports"), { as: user, method: "POST", data: { title: "Over quota", plan: "business" } })).status, 402);
  const page = await h.call(user.endpoint("reports"), { as: user }); assert.equal(page.data.total, 50); assert.equal(page.data.reports.length, 25); assert.equal(page.data.nextOffset, 25);
  assert.equal((await h.call(user.endpoint("reports?offset=25"), { as: user })).data.nextOffset, null);
});

test("Google authorization uses one-time state, PKCE, verified identity and secure expiring sessions", async t => {
  let calls = 0;
  const h = await harness(t, { config: { production: true, origin: "https://bugs.example.com", googleClientId: "client", googleClientSecret: "secret" }, fetcher: async (url, options) => {
    calls++;
    if (String(url).endsWith("/token")) { assert.ok(options.body.get("code_verifier")); assert.equal(options.body.get("redirect_uri"), "https://bugs.example.com/auth/google/callback"); return Response.json({ access_token: "provider-token" }); }
    assert.equal(options.headers.authorization, "Bearer provider-token"); return Response.json({ sub: "google123", email: "qa@example.com", name: "QA", email_verified: true });
  } });
  const start = await h.call("/auth/google?returnTo=https://evil.example");
  assert.equal(start.status, 303); const authorization = new URL(start.headers.location);
  assert.equal(authorization.searchParams.get("code_challenge_method"), "S256");
  const state = authorization.searchParams.get("state"); const oauthCookie = start.headers["set-cookie"].split(";")[0];
  assert.equal((await h.call("/auth/google/callback?state=" + state + "&code=abc")).headers.location, "/login?error=oauth_state");
  const callback = await h.call("/auth/google/callback?state=" + state + "&code=abc", { headers: { cookie: oauthCookie } }); assert.equal(callback.status, 303); assert.equal(callback.headers.location, "/dashboard");
  const sessionCookie = callback.headers["set-cookie"][1]; assert.match(sessionCookie, /__Host-bugshaper=/); assert.match(sessionCookie, /HttpOnly; SameSite=Lax/); assert.match(sessionCookie, /Secure/);
  assert.equal((await h.call("/auth/google/callback?state=" + state + "&code=abc", { headers: { cookie: oauthCookie } })).headers.location, "/login?error=oauth_state"); assert.equal(calls, 2);
  const session = await h.call("/api/v1/session", { headers: { cookie: sessionCookie.split(";")[0] } }); assert.equal(session.data.user.email, "qa@example.com");
  const as = { cookie: sessionCookie, csrf: session.data.csrf };
  assert.equal((await h.call("/auth/logout", { as, method: "POST", data: {} })).status, 200);
  assert.equal((await h.call("/api/v1/session", { as })).data.user, null);
  await assert.rejects(
    () => h.auth.upsertProfile({ sub: "notverified", email: "new@example.com", name: "No", email_verified: false }),
    /verified/,
  );
  assert.throws(() => platformConfig({ NODE_ENV: "production", BUGSHAPER_ORIGIN: "https://example.com", BUGSHAPER_DEMO: "true" }), /forbidden/);
  assert.throws(() => platformConfig({ NODE_ENV: "production", BUGSHAPER_ORIGIN: "http://example.com", GOOGLE_CLIENT_ID: "c", GOOGLE_CLIENT_SECRET: "s" }), /HTTPS/);
  assert.throws(() => platformConfig({
    NODE_ENV: "production", BUGSHAPER_ORIGIN: "https://example.com", GOOGLE_CLIENT_ID: "c", GOOGLE_CLIENT_SECRET: "s",
    DODO_PAYMENTS_API_KEY: "k", DODO_PAYMENTS_WEBHOOK_KEY: "w", DODO_PRODUCT_PRO: "p1", DODO_PRODUCT_BUSINESS: "p2",
    DODO_PAYMENTS_ENVIRONMENT: "test_mode",
  }), /live_mode/);
  const live = platformConfig({
    NODE_ENV: "production", BUGSHAPER_ORIGIN: "https://example.com", GOOGLE_CLIENT_ID: "c", GOOGLE_CLIENT_SECRET: "s",
    DODO_PAYMENTS_API_KEY: "k", DODO_PAYMENTS_WEBHOOK_KEY: "w", DODO_PRODUCT_PRO: "p1", DODO_PRODUCT_BUSINESS: "p2",
    DODO_PAYMENTS_ENVIRONMENT: "live_mode", BUGSHAPER_TRUST_PROXY: "1",
  });
  assert.equal(live.dodoEnvironment, "live_mode");
  assert.equal(live.trustProxy, true);
});

test("trusted proxy uses X-Forwarded-For for anonymous rate limits", async t => {
  const { clientAddress } = await import("../helpers/client-ip.mjs");
  assert.equal(clientAddress({ headers: { "x-forwarded-for": "203.0.113.9, 10.0.0.1" }, socket: { remoteAddress: "10.0.0.1" } }, { trustProxy: true }), "203.0.113.9");
  assert.equal(clientAddress({ headers: { "x-forwarded-for": "203.0.113.9" }, socket: { remoteAddress: "10.0.0.1" } }, { trustProxy: false }), "10.0.0.1");
});

test("extension client can mutate with CSRF when Origin is chrome-extension", async t => {
  const h = await harness(t, { config: { ...platformConfig({}), demo: true, origin: "http://localhost:4318" } });
  const login = await h.call("/auth/demo", { method: "POST", data: {}, headers: { origin: "http://localhost:4318" } });
  assert.equal(login.status, 200);
  const cookie = login.headers["set-cookie"].split(";")[0];
  const session = await h.call("/api/v1/session", { headers: { cookie } });
  const workspace = session.data.workspaces[0].id;
  const report = { id: randomUUID(), schemaVersion: 1, title: "Ext capture", createdAt: Date.now(), events: [] };
  const bundle = await makeBundle(report);
  const uploaded = await h.call(`/api/v1/workspaces/${workspace}/submissions`, {
    method: "POST",
    data: bundle,
    headers: {
      cookie,
      origin: "chrome-extension://abcdefghijklmnop",
      "x-csrf-token": session.data.csrf,
      "x-bugshaper-client": "extension",
    },
  });
  assert.equal(uploaded.status, 201, uploaded.data?.error);
  assert.equal(uploaded.data.id, report.id);

  const projects = await h.call(`/api/v1/workspaces/${workspace}/projects`, { headers: { cookie } });
  assert.ok(projects.data.projects.length >= 1);
  const projectId = projects.data.projects[0].id;
  const tagged = { id: randomUUID(), schemaVersion: 1, title: "Ext with project", createdAt: Date.now(), events: [] };
  const taggedBundle = await makeBundle(tagged);
  taggedBundle.projectId = projectId;
  const withProject = await h.call(`/api/v1/workspaces/${workspace}/submissions`, {
    method: "POST",
    data: taggedBundle,
    headers: {
      cookie,
      origin: "chrome-extension://abcdefghijklmnop",
      "x-csrf-token": session.data.csrf,
      "x-bugshaper-client": "extension",
    },
  });
  assert.equal(withProject.status, 201, withProject.data?.error);
  assert.equal(withProject.data.projectId, projectId);
  const stored = await h.call(`/api/v1/workspaces/${workspace}/reports/${tagged.id}`, { headers: { cookie } });
  assert.equal(stored.data.report.projectId, projectId);
});

test("Dodo checkout, recovery, portal and signed idempotent subscription reconciliation", async t => {
  const secret = "whsec_" + Buffer.alloc(32, 4).toString("base64"); let metadata; let status = "active"; let fetchCount = 0; let failProvider = false; let checkouts = 0;
  const h = await harness(t, { config: { dodoKey: "test-key", dodoWebhookKey: secret, products: { pro: "p_pro", business: "p_business" } }, fetcher: async (url, options) => {
    fetchCount++;
    if (failProvider) return Response.json({}, { status: 503 });
    const path = new URL(url).pathname;
    if (path === "/customers") return Response.json({ customer_id: "cus_workspace" });
    if (path === "/checkouts") { checkouts++; const data = JSON.parse(options.body); assert.equal(data.product_cart[0].product_id, "p_pro"); assert.equal(data.customer.customer_id, "cus_workspace"); metadata = data.metadata; return Response.json({ session_id: "cks_1", checkout_url: "https://checkout.dodopayments.com/cks_1" }); }
    if (path === "/checkouts/cks_1") return Response.json({ payment_status: null });
    if (path.includes("customer-portal")) return Response.json({ link: "https://customer.dodopayments.com/session" });
    if (path === "/subscriptions/sub_1") return Response.json({ subscription_id: "sub_1", customer: { customer_id: "cus_workspace" }, product_id: "p_pro", metadata, status, next_billing_date: "2027-01-01T00:00:00Z" });
    throw new Error("Unexpected path: " + path);
  } });
  const owner = await h.identity("BillingOwner");
  const checkout = await h.call(owner.endpoint("billing/checkout"), { as: owner, method: "POST", data: { plan: "pro", productId: "p_business" } }); assert.equal(checkout.status, 200); assert.match(checkout.data.url, /^https:\/\/checkout/);
  assert.equal((await h.call(owner.endpoint("billing/checkout"), { as: owner, method: "POST", data: { plan: "pro" } })).status, 200); assert.equal(checkouts, 1);
  assert.equal((await h.call(owner.endpoint("billing/checkout"), { as: owner, method: "POST", data: { plan: "business" } })).status, 409);
  assert.equal((await h.call(owner.endpoint("billing"), { as: owner })).data.plan.id, "free");
  const eventTime = Date.now();
  function event(id, type = "subscription.active", at = eventTime) {
    const raw = JSON.stringify({ type, timestamp: new Date(at).toISOString(), data: { subscription_id: "sub_1" } }); const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = createHmac("sha256", Buffer.from(secret.slice(6), "base64")).update(`${id}.${timestamp}.${raw}`).digest("base64");
    return { method: "POST", raw, headers: { "webhook-id": id, "webhook-timestamp": timestamp, "webhook-signature": "v1," + signature } };
  }
  assert.equal((await h.call("/api/webhooks/dodo", { ...event("bad"), headers: { ...event("bad").headers, "webhook-signature": "v1,wrong" } })).status, 401);
  assert.equal((await h.call("/api/webhooks/dodo", event("paid"))).status, 200);
  assert.equal((await h.call(owner.endpoint("billing"), { as: owner })).data.plan.id, "pro");
  const before = fetchCount; assert.equal((await h.call("/api/webhooks/dodo", event("paid"))).data.duplicate, true); assert.equal(fetchCount, before);
  assert.equal((await h.call(owner.endpoint("billing/checkout"), { as: owner, method: "POST", data: { plan: "business" } })).status, 409);
  assert.match((await h.call(owner.endpoint("billing/portal"), { as: owner, method: "POST", data: {} })).data.url, /customer\.dodopayments/);
  status = "cancelled"; failProvider = true;
  assert.equal((await h.call("/api/webhooks/dodo", event("cancelled", "subscription.cancelled", eventTime + 1000))).status, 502);
  assert.equal(await h.repo.one("SELECT 1 FROM billing_events WHERE id='cancelled'"), undefined);
  failProvider = false;
  assert.equal((await h.call("/api/webhooks/dodo", event("cancelled", "subscription.cancelled", eventTime + 1000))).status, 200);
  assert.equal((await h.call(owner.endpoint("billing"), { as: owner })).data.plan.id, "free");
  assert.equal((await h.call("/api/webhooks/dodo", event("delayed", "subscription.active", eventTime - 1000))).status, 200);
  assert.equal((await h.call(owner.endpoint("billing"), { as: owner })).data.plan.id, "free");
  const expired = event("expired"); expired.headers["webhook-timestamp"] = "100";
  assert.equal((await h.call("/api/webhooks/dodo", expired)).status, 401);
});

test("migrations and sessions persist across database reopen", async t => {
  const h = await harness(t);
  const person = await h.identity("PersistUser", "persist-user@example.com");
  const resolved = await h.auth.resolve({ headers: { cookie: person.cookie.split(";")[0] } });
  assert.equal(resolved.id, person.id);
  assert.equal((await h.db.prepare("SELECT count(*)::int AS n FROM platform_migrations").get()).n, 5);
});
