import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createDiscussion } from "../models/collaboration.mjs";
import { classify, idPattern, statuses, validateReport } from "../models/report.mjs";
import { createSubmissionStore, parseSubmission } from "../models/submissions.mjs";
import { maxBundleBytes } from "../helpers/portable-media.js";
import { clientAddress } from "../helpers/client-ip.mjs";

const digest = (value) => createHash("sha256").update(value).digest();
const maxBody = 192 * 1024;

function parseDocument(d) {
  return typeof d === "string" ? JSON.parse(d) : d;
}

function matches(value, key) {
  return Boolean(key) && typeof value === "string" && value.length > 0 && timingSafeEqual(digest(value), digest(key));
}

function send(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store", "x-content-type-options": "nosniff" });
  res.end(JSON.stringify(body));
}

async function readJson(req, limit = maxBody) {
  if (req.headers["content-type"]?.split(";")[0] !== "application/json") throw new Error("Use application/json.");
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > limit) throw new Error("Request exceeds the size limit.");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

/** Legacy /v1 bearer-token API (local CLI, MCP, viewer). */
export function createLegacyController(db, { ownerKey, agentKey, investigate, now = Date.now, trustProxy = false } = {}) {
  const audit = db.prepare("INSERT INTO audit VALUES (?, ?, ?, ?)");
  const get = db.prepare("SELECT document FROM reports WHERE id = ?");
  const insert = db.prepare("INSERT INTO reports VALUES (?, ?, ?) ON CONFLICT DO NOTHING");
  const findShare = db.prepare("SELECT report_id FROM shares WHERE digest = ? AND expires_at > ?");
  const discussion = createDiscussion(db, now);
  const submissions = createSubmissionStore(db);
  const findContributor = db.prepare("SELECT report_id FROM contributors WHERE digest = ? AND expires_at > ?");
  const buckets = new Map();
  let modelBudget = { day: -1, requests: 0 };

  return async function handleLegacy(req, res, { pathname, searchParams, method }) {
    const address = clientAddress(req, { trustProxy });
    const minute = Math.floor(now() / 60_000);
    if (buckets.get(address)?.minute !== minute) {
      for (const [key, value] of buckets) if (value.minute !== minute) buckets.delete(key);
      if (buckets.size >= 4096) return send(res, 429, { error: "Rate limit exceeded." });
      buckets.set(address, { minute, count: 0 });
    }
    if (++buckets.get(address).count > 120) return send(res, 429, { error: "Rate limit exceeded." });
    const credential = req.headers.authorization?.match(/^Bearer ([^ ]+)$/)?.[1] ?? "";
    const keyDigest = /^[a-f0-9]{64}$/.test(credential) ? digest(credential).toString("hex") : null;
    const contributor = keyDigest ? await findContributor.get(keyDigest, now()) : null;
    const principal = matches(credential, ownerKey) ? "owner" : matches(credential, agentKey) ? "agent" :
      contributor ? "contributor:" + keyDigest.slice(0, 12) : null;

    if (pathname === "/v1/shared" && method === "GET") {
      const shared = principal || !/^[a-f0-9]{64}$/.test(credential) ? null : await findShare.get(digest(credential).toString("hex"), now());
      if (!shared) return send(res, 404, { error: "Share unavailable." });
      const row = await get.get(shared.report_id);
      if (!row) return send(res, 404, { error: "Share unavailable." });
      await audit.run(now(), "share", "read", shared.report_id);
      return send(res, 200, { report: parseDocument(row.document) });
    }

    if (!principal) return send(res, 401, { error: "Authentication required." });
    const contributorPath = contributor ? "/v1/reports/" + contributor.report_id : null;
    if (contributor && ![contributorPath, contributorPath + "/discussion", contributorPath + "/artifacts/screenshot",
      contributorPath + "/artifacts/video"].includes(pathname)) {
      return send(res, 404, { error: "Report unavailable." });
    }
    if (method !== "GET" && principal !== "owner" &&
        !(contributor && method === "POST" && pathname.endsWith("/discussion"))) {
      return send(res, 403, { error: "This credential cannot perform this action." });
    }

    if (pathname === "/v1/submissions" && method === "POST") {
      let submission;
      try { submission = await parseSubmission(await readJson(req, maxBundleBytes)); }
      catch (error) { return send(res, 400, { error: error.message }); }
      const { id } = submission.report;
      const status = await submissions.save(submission, async () => { await audit.run(now(), principal, "submit", id); });
      if (status === 409) return send(res, 409, { error: "Report ID already exists with different content." });
      return send(res, status, { id, path: "/reports/" + id });
    }

    if (pathname === "/v1/reports" && method === "GET") {
      const limit = Number(searchParams.get("limit") ?? "20");
      const offset = Number(searchParams.get("offset") ?? "0");
      if (!Number.isInteger(limit) || limit < 1 || limit > 50 || !Number.isInteger(offset) || offset < 0 || offset > 10000) {
        return send(res, 400, { error: "Invalid pagination." });
      }
      const search = (searchParams.get("q") ?? "").trim().toLowerCase();
      const status = searchParams.get("status") ?? "";
      const project = searchParams.get("project") ?? "";
      const severity = searchParams.get("severity") ?? "";
      const assignee = searchParams.get("assignee") ?? "";
      const category = searchParams.get("category") ?? "";
      const sort = searchParams.get("sort") ?? "newest";
      if (search.length > 160 || project.length > 120 || severity.length > 40 || assignee.length > 120 || category.length > 80 ||
          !["newest", "oldest"].includes(sort) ||
          (status && !statuses.includes(status))) {
        return send(res, 400, { error: "Invalid report filter." });
      }
      const order = sort === "oldest" ? "ASC" : "DESC";
      const rows = await db.prepare(`SELECT document FROM reports
        WHERE (? = '' OR (document::jsonb)->>'status' = ?)
        AND (? = '' OR (document::jsonb)->>'project' = ?)
        AND (? = '' OR (document::jsonb)->>'severity' = ?)
        AND (? = '' OR (document::jsonb)->>'assignee' = ?)
        AND (? = '' OR (document::jsonb)->>'category' = ?)
        AND (? = '' OR position(? in lower(concat_ws(' ', id, (document::jsonb)->>'title',
          (document::jsonb)->>'project', (document::jsonb)->>'category',
          (document::jsonb)->>'assignee'))) > 0)
        ORDER BY created_at ${order}, id ${order} LIMIT ? OFFSET ?`
      ).all(status, status, project, project, severity, severity, assignee, assignee, category, category, search, search, limit + 1, offset);
      const dashboard = searchParams.get("view") === "dashboard";
      const reports = rows.slice(0, limit).map(({ document }) => {
        const { id, createdAt, title, status, category, project, severity, assignee } = parseDocument(document);
        return { id, createdAt, title, status, category, ...(dashboard ? { project, severity, assignee } : {}) };
      });
      await audit.run(now(), principal, "list", null);
      return send(res, 200, { reports, ...(dashboard ? { canEdit: principal === "owner" } : {}),
        nextOffset: rows.length > limit && offset + limit <= 10000 ? offset + limit : null });
    }

    if (pathname === "/v1/reports" && method === "POST") {
      let report;
      try { report = validateReport(await readJson(req)); }
      catch (error) { return send(res, 400, { error: error.message }); }
      const document = JSON.stringify(report);
      if (!(await insert.run(report.id, report.createdAt, document)).changes) {
        if ((await get.get(report.id))?.document === document) return send(res, 200, { id: report.id });
        return send(res, 409, { error: "Report ID already exists." });
      }
      await audit.run(now(), principal, "create", report.id);
      return send(res, 201, { id: report.id });
    }

    const [, id, suffix, artifact] = pathname.match(/^\/v1\/reports\/([^/]+)(?:\/(shares|contributors|discussion|investigation|artifacts\/(screenshot|video)))?$/) ?? [];
    if (!id || !idPattern.test(id)) return send(res, 404, { error: "Route unavailable." });
    const row = await get.get(id);
    if (!row) return send(res, 404, { error: "Report unavailable." });
    if (artifact && method === "GET") {
      if (principal === "agent") return send(res, 403, { error: "This credential cannot view media." });
      const attachment = await submissions.get(id, artifact);
      if (!attachment) return send(res, 404, { error: "Attachment unavailable." });
      res.writeHead(200, { "content-type": attachment.type, "content-length": attachment.data.length,
        "cache-control": "no-store", "x-content-type-options": "nosniff",
        "content-disposition": artifact === "screenshot" ? 'attachment; filename="bugshaper.png"' : 'attachment; filename="bugshaper.webm"' });
      return res.end(attachment.data);
    }
    if (!suffix && method === "GET") {
      const report = parseDocument(row.document);
      await audit.run(now(), principal, "read", id);
      return send(res, 200, { report, artifacts: principal === "agent" ? [] : await submissions.kinds(id),
        classification: classify(report.events), canComment: principal === "owner" || Boolean(contributor), canShare: principal === "owner", canInvestigate: principal === "owner" && Boolean(investigate) });
    }
    if (!suffix && method === "DELETE") {
      await db.prepare("DELETE FROM reports WHERE id = ?").run(id);
      await audit.run(now(), principal, "delete", id);
      return send(res, 200, { deleted: true });
    }
    if (suffix === "investigation" && method === "POST") {
      if (!investigate) return send(res, 503, { error: "The investigation provider is disabled." });
      let consent;
      try { consent = (await readJson(req)).consent; }
      catch { return send(res, 400, { error: "Provide explicit consent to send diagnostic signals." }); }
      if (consent !== true) return send(res, 400, { error: "Provide explicit consent to send diagnostic signals." });
      const report = parseDocument(row.document);
      if (!report.events.length) return send(res, 422, { error: "No diagnostics are available." });
      const day = Math.floor(now() / 86_400_000);
      if (modelBudget.day !== day) modelBudget = { day, requests: 0 };
      if (modelBudget.requests >= 20) return send(res, 429, { error: "Daily investigation limit reached." });
      modelBudget.requests++;
      const controller = new AbortController();
      const cancel = () => controller.abort();
      res.once("close", cancel);
      try {
        await audit.run(now(), principal, "investigate", id);
        const result = await investigate(report, controller.signal);
        return send(res, 200, { result });
      } catch {
        if (!res.destroyed) return send(res, 502, { error: "The investigation provider could not return a valid result." });
      } finally {
        res.removeListener("close", cancel);
      }
      return;
    }
    if (!suffix && method === "PATCH") {
      let report;
      try { report = await discussion.patch(id, principal, row.document, await readJson(req)); }
      catch (error) { return send(res, 400, { error: error.message }); }
      return report ? send(res, 200, { report }) : send(res, 409, { error: "Report changed. Refresh and try again." });
    }
    if (suffix === "discussion" && method === "GET") return send(res, 200, { entries: await discussion.list(id) });
    if (suffix === "discussion" && method === "POST") {
      let entry;
      try { entry = await discussion.comment(id, principal, await readJson(req)); }
      catch (error) { return send(res, 400, { error: error.message }); }
      return send(res, 201, { entry });
    }
    if ((suffix === "shares" || suffix === "contributors") && method === "POST") {
      let duration;
      try { duration = (await readJson(req)).ttlSeconds; }
      catch { return send(res, 400, { error: "Invalid share request." }); }
      if (!Number.isInteger(duration) || duration < 60 || duration > 604800) {
        return send(res, 400, { error: "Share lifetime must be 60 to 604800 seconds." });
      }
      const key = randomBytes(32).toString("hex");
      const expiresAt = now() + duration * 1000;
      const insertKey = suffix === "shares" ? "INSERT INTO shares VALUES (?, ?, ?)" : "INSERT INTO contributors VALUES (?, ?, ?)";
      await db.prepare(insertKey).run(digest(key).toString("hex"), id, expiresAt);
      await audit.run(now(), principal, "create-" + suffix, id);
      return send(res, 201, { key, expiresAt });
    }
    if ((suffix === "shares" || suffix === "contributors") && method === "DELETE") {
      const deleteKeys = suffix === "shares" ? "DELETE FROM shares WHERE report_id = ?" : "DELETE FROM contributors WHERE report_id = ?";
      await db.prepare(deleteKeys).run(id);
      await audit.run(now(), principal, "revoke-" + suffix, id);
      return send(res, 200, { revoked: true });
    }
    return send(res, 405, { error: "Method unavailable." });
  };
}