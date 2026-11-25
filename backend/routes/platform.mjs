import { randomUUID } from "node:crypto";
import { migrate } from "../models/database.mjs";
import { repository } from "../models/repository.mjs";
import { mediaStore } from "../models/media.mjs";
import { platformConfig, plans } from "../helpers/config.mjs";
import { body, fail, json, text } from "../helpers/http.mjs";
import { authService } from "../controllers/auth.mjs";
import { workspaceService } from "../controllers/workspaces.mjs";
import { reportsService } from "../controllers/reports.mjs";
import { billingService } from "../controllers/billing.mjs";
import { seedDemo } from "../controllers/demo.mjs";
import { createRateLimiter } from "../middleware/rate-limit.mjs";
import { handlePlatformError } from "../middleware/errors.mjs";

export async function createPlatform(db, { config = platformConfig(), now = Date.now, fetcher = fetch } = {}) {
  await migrate(db);
  const repo = repository(db, now);
  const media = mediaStore({
    BUGSHAPER_MEDIA_DIR: config.mediaDir,
    BUGSHAPER_S3_BUCKET: config.s3?.bucket,
    BUGSHAPER_S3_REGION: config.s3?.region,
    BUGSHAPER_S3_ACCESS_KEY: config.s3?.accessKey,
    BUGSHAPER_S3_SECRET_KEY: config.s3?.secretKey,
    BUGSHAPER_S3_ENDPOINT: config.s3?.endpoint,
  }, fetcher);
  const auth = authService(repo, config, now, fetcher);
  const workspaces = workspaceService(repo, config, now, fetcher);
  const reports = reportsService(repo, now, media);
  const billing = billingService(repo, config, now, fetcher);
  const rateLimit = createRateLimiter({ now, trustProxy: config.trustProxy, resolveIdentity: (req) => auth.resolve(req) });
  if (config.demo) await seedDemo(repo, now);

  async function route(req, res, url) {
    const path = url.pathname;
    const method = req.method;
    if (path === "/healthz" && method === "GET") {
      await db.prepare("SELECT 1").get();
      return json(res, 200, { status: "ok" });
    }
    if (path.startsWith("/auth/") || path === "/api/v1/session") {
      if (!["/auth/google", "/auth/google/callback", "/auth/demo", "/auth/logout", "/api/v1/session"].includes(path)) fail(404, "Route unavailable.");
      if (path === "/auth/demo" && (!config.demo || method !== "POST")) fail(404, "Route unavailable.");
      if (path === "/auth/demo" && req.headers.origin !== config.origin) fail(403, "Invalid request origin.");
      return auth.handle(req, res, url);
    }
    if (path === "/api/v1/plans" && method === "GET") return json(res, 200, { plans: Object.values(plans) });
    if (path === "/api/webhooks/dodo" && method === "POST") return billing.webhook(req, res);
    const sharedMatch = path.match(/^\/api\/v1\/shared\/([a-f0-9]{64})$/);
    if (sharedMatch && method === "GET") return reports.viewShared(req, res, sharedMatch[1]);
    const user = await auth.requireSession(req, !["GET", "HEAD"].includes(method));
    if (path === "/api/v1/invitations/accept" && method === "POST") return workspaces.accept(req, res, user);
    if (path === "/api/v1/workspaces" && method === "POST") {
      const input = await body(req);
      if ((await repo.one("SELECT count(*)::int AS n FROM memberships WHERE user_id=? AND role='owner'", user.id)).n >= 10) fail(422, "You can own up to ten workspaces.");
      return json(res, 201, { id: await auth.createWorkspace(user.id, text(input.name, "workspace name", 80)) });
    }
    const [, wid, resource, id, child] = path.match(/^\/api\/v1\/workspaces\/([0-9a-f-]{36})\/(settings|members|invitations|teams|projects|reports|submissions|analytics|activity|billing|notifications|shares)(?:\/([^/]+))?(?:\/([^/]+))?$/) || [];
    if (!wid) fail(404, "Route unavailable.");
    await repo.membership(wid, user.id);
    if (resource === "reports") return reports.handle(req, res, user, wid, id, child, url);
    if (resource === "submissions" && method === "POST") return reports.importBundle(req, res, user, wid);
    if (resource === "analytics" && method === "GET") return json(res, 200, await reports.analytics(wid));
    if (resource === "shares") return reports.shares(req, res, user, wid, id, child, url);
    if (resource === "billing") return billing.handle(req, res, user, wid, id);
    if (resource === "notifications" && method === "PATCH") {
      await repo.run("UPDATE notifications SET read_at=? WHERE workspace_id=? AND user_id=? AND read_at IS NULL", now(), wid, user.id);
      return json(res, 200, { ok: true });
    }
    return workspaces.handle(req, res, user, wid, resource, id, child, url);
  }

  return async (req, res, url) => {
    if (!(url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/") || url.pathname === "/healthz")) return false;
    const requestId = randomUUID();
    try {
      if (url.pathname !== "/healthz") await rateLimit(req);
      await route(req, res, url);
      if (!res.headersSent) fail(405, "Method unavailable.");
    } catch (error) {
      handlePlatformError(error, res, requestId);
    }
    return true;
  };
}
