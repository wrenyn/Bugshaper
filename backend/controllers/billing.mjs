import { createHmac, randomUUID } from "node:crypto";
import { plans } from "../helpers/config.mjs";
import { body, equal, fail, json, rawBody, transaction } from "../helpers/http.mjs";

export function verifyDodoSignature(raw, headers, secret, now) {
  const id = headers["webhook-id"]; const timestamp = headers["webhook-timestamp"]; const signatures = headers["webhook-signature"];
  if (!secret || typeof id !== "string" || id.length > 200 || typeof timestamp !== "string" || !/^\d+$/.test(timestamp) || typeof signatures !== "string" || Math.abs(now / 1000 - Number(timestamp)) > 300) fail(401, "Invalid webhook signature.");
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  if (key.length < 16) fail(503, "Webhook signing key is not configured correctly.");
  const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${raw}`).digest("base64");
  if (!signatures.split(" ").some(signature => { const [version, value] = signature.split(","); return version === "v1" && equal(value, expected); })) fail(401, "Invalid webhook signature.");
  return id;
}

export function billingService(repo, config, now, fetcher) {
  const inFlight = new Set();
  async function provider(path, data, idempotencyKey) {
    if (!config.dodoKey) fail(503, "Billing is not configured yet. Your workspace remains on its current plan.");
    let response;
    try {
      response = await fetcher(config.dodoBase + path, { method: data === undefined ? "GET" : "POST", signal: AbortSignal.timeout(20000), headers: { authorization: "Bearer " + config.dodoKey, "content-type": "application/json", ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}) }, body: data === undefined ? undefined : JSON.stringify(data) });
    } catch { fail(502, "Dodo Payments is temporarily unavailable. Please try again."); }
    if (!response.ok) fail(502, "Dodo Payments could not complete this request. Please try again.");
    return response.json();
  }
  function safeProviderUrl(value) {
    let url; try { url = new URL(value); } catch { fail(502, "Invalid payment provider response."); }
    if (url.protocol !== "https:" || !(url.hostname === "dodopayments.com" || url.hostname.endsWith(".dodopayments.com"))) fail(502, "Invalid payment provider URL.");
    return url.href;
  }
  async function handle(req, res, user, workspaceId, action) {
    await repo.membership(workspaceId, user.id);
    const current = await repo.subscription(workspaceId);
    if (req.method === "GET" && !action) return json(res, 200, { subscription: { status: current.status, next_billing_at: current.next_billing_at }, hasCustomer: Boolean(current.customer_id), hasSubscription: Boolean(current.subscription_id && !["cancelled", "expired", "failed"].includes(current.status)), plan: await repo.entitlement(workspaceId), plans: Object.values(plans), usage: await repo.usage(workspaceId), checkoutReady: Boolean(config.dodoKey && config.dodoWebhookKey && config.products.pro && config.products.business), environment: config.dodoEnvironment });
    await repo.membership(workspaceId, user.id, ["owner"]);
    if (req.method === "POST" && action === "portal") {
      if (!current.customer_id) fail(409, "Subscribe to a paid plan before opening the billing portal.");
      const result = await provider(`/customers/${encodeURIComponent(current.customer_id)}/customer-portal/session?send_email=false&return_url=${encodeURIComponent(config.origin + "/billing")}`, {});
      return json(res, 200, { url: safeProviderUrl(result.link) });
    }
    if (req.method === "POST" && action === "checkout") {
      const input = await body(req); const plan = input.plan;
      if (!["pro", "business"].includes(plan)) fail(400, "Choose a paid plan.");
      if (!config.products[plan] || !config.dodoWebhookKey) fail(503, "This plan is not configured for checkout yet.");
      if (current.subscription_id && !["cancelled", "expired", "failed"].includes(current.status)) fail(409, "Manage your existing subscription in the billing portal to avoid a duplicate subscription.");
      if (inFlight.has(workspaceId)) fail(409, "Checkout is already being prepared.");
      inFlight.add(workspaceId);
      try {
        let pending = await repo.one("SELECT * FROM billing_attempts WHERE workspace_id=? AND resolved_at IS NULL ORDER BY created_at DESC LIMIT 1", workspaceId);
        if (pending?.checkout_id && pending.checkout_url) {
          const state = await provider("/checkouts/" + encodeURIComponent(pending.checkout_id));
          if (["failed", "cancelled"].includes(state.payment_status)) {
            await repo.run("UPDATE billing_attempts SET resolved_at=? WHERE id=?", now(), pending.id); pending = null;
          } else {
            if (pending.plan !== plan) fail(409, "A checkout is already open for another plan. Resume that plan's checkout before starting another.");
            if (state.payment_status === "succeeded" || state.payment_status === "processing") fail(409, "Payment is being confirmed. Refresh billing shortly; do not start another checkout.");
            return json(res, 200, { url: safeProviderUrl(pending.checkout_url) });
          }
        }
        if (pending && pending.plan !== plan) fail(409, "Another checkout is being prepared. Resume that plan to continue.");
        let customerId = current.customer_id;
        if (!customerId) {
          const customer = await provider("/customers", { email: user.email, name: user.name, metadata: { workspace_id: workspaceId } }, "customer-" + workspaceId);
          if (typeof customer.customer_id !== "string") fail(502, "Invalid customer response.");
          customerId = customer.customer_id;
          await repo.run("UPDATE subscriptions SET customer_id=? WHERE workspace_id=?", customerId, workspaceId);
        }
        const attemptId = pending?.id || randomUUID();
        if (!pending) await repo.run("INSERT INTO billing_attempts(id,workspace_id,plan,product_id,customer_id,created_at) VALUES (?,?,?,?,?,?)", attemptId, workspaceId, plan, config.products[plan], customerId, now());
        const checkout = await provider("/checkouts", { product_cart: [{ product_id: config.products[plan], quantity: 1 }], customer: { customer_id: customerId }, return_url: config.origin + "/billing?checkout=returned", metadata: { workspace_id: workspaceId, checkout_attempt_id: attemptId }, customization: { theme: "dark" } }, attemptId);
        if (typeof checkout.session_id !== "string") fail(502, "Invalid checkout response.");
        const checkoutUrl = safeProviderUrl(checkout.checkout_url);
        await repo.run("UPDATE billing_attempts SET checkout_id=?,checkout_url=? WHERE id=?", checkout.session_id, checkoutUrl, attemptId);
        await repo.activity(workspaceId, user.id, "billing.checkout_started", `Started ${plans[plan].name} checkout`);
        return json(res, 200, { url: checkoutUrl });
      } finally { inFlight.delete(workspaceId); }
    }
    fail(405, "Method unavailable.");
  }
  async function webhook(req, res) {
    if (!config.dodoWebhookKey) fail(503, "Webhook receiver is not configured.");
    const raw = await rawBody(req, 1024 * 1024);
    const id = verifyDodoSignature(raw, req.headers, config.dodoWebhookKey, now());
    if (await repo.one("SELECT 1 FROM billing_events WHERE id=?", id)) return json(res, 200, { received: true, duplicate: true });
    let event; try { event = JSON.parse(raw); } catch { fail(400, "Invalid webhook body."); }
    if (typeof event.type !== "string" || !event.data || !Number.isFinite(Date.parse(event.timestamp))) fail(400, "Invalid webhook event.");
    const eventAt = Date.parse(event.timestamp);
    if (!event.type.startsWith("subscription.")) {
      await repo.run("INSERT INTO billing_events VALUES (?,?,?,?) ON CONFLICT DO NOTHING", id, event.type, eventAt, now());
      return json(res, 200, { received: true });
    }
    const subscriptionId = event.data.subscription_id;
    if (typeof subscriptionId !== "string") fail(400, "Missing subscription ID.");
    const subscription = await provider("/subscriptions/" + encodeURIComponent(subscriptionId));
    const known = await repo.one("SELECT * FROM subscriptions WHERE subscription_id=?", subscriptionId);
    const attempt = subscription.metadata?.checkout_attempt_id ? await repo.one("SELECT * FROM billing_attempts WHERE id=?", subscription.metadata.checkout_attempt_id) : null;
    if (!known && !attempt) return json(res, 200, { received: true, ignored: true });
    const workspaceId = known?.workspace_id || attempt.workspace_id;
    const current = await repo.subscription(workspaceId);
    const plan = Object.keys(config.products).find(key => config.products[key] && config.products[key] === subscription.product_id);
    if (!plan || subscription.customer?.customer_id !== current.customer_id || (attempt && (attempt.customer_id !== current.customer_id || attempt.workspace_id !== workspaceId)) || (!known && attempt.product_id !== subscription.product_id) || subscription.subscription_id !== subscriptionId) fail(400, "Subscription does not match a configured workspace purchase.");
    if (current.subscription_id && current.subscription_id !== subscriptionId && !["cancelled", "expired", "failed"].includes(current.status)) fail(409, "Another subscription is already linked to this workspace.");
    const validStatuses = ["pending", "active", "on_hold", "paused", "cancelled", "failed", "expired", "past_due"];
    if (!validStatuses.includes(subscription.status)) fail(400, "Unsupported subscription status.");
    await transaction(repo.db, async () => {
      if (await repo.one("SELECT 1 FROM billing_events WHERE id=?", id)) return;
      if (eventAt >= current.event_at) {
        await repo.run("UPDATE subscriptions SET plan=?,status=?,subscription_id=?,product_id=?,next_billing_at=?,event_at=? WHERE workspace_id=?", plan, subscription.status, subscriptionId, subscription.product_id, subscription.next_billing_date || null, eventAt, workspaceId);
        await repo.activity(workspaceId, null, "billing.subscription_updated", `Subscription is ${subscription.status} (${plans[plan].name})`);
      }
      await repo.run("INSERT INTO billing_events VALUES (?,?,?,?)", id, event.type, eventAt, now());
      if (attempt) await repo.run("UPDATE billing_attempts SET resolved_at=? WHERE id=?", now(), attempt.id);
    });
    return json(res, 200, { received: true });
  }
  return { handle, webhook };
}