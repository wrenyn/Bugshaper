import { randomBytes, randomUUID } from "node:crypto";
import { validateReport, statuses, idPattern } from "../models/report.mjs";
import { parseSubmission } from "../models/submissions.mjs";
import { maxBundleBytes } from "../helpers/portable-media.js";
import { body, fail, hash, json, text, transaction } from "../helpers/http.mjs";

function parseDocument(d) {
  return typeof d === "string" ? JSON.parse(d) : d;
}

export function reportsService(repo, now, media = {
  enabled: false,
  put: async (_w, _r, _k, data) => ({ storageKey: null, data }),
  get: async (row) => row.data,
  remove: async () => {},
}) {
  async function references(workspaceId, input, original) {
    const projectId = input.projectId === undefined ? original?.project_id || null : input.projectId || null;
    const assigneeId = input.assigneeId === undefined ? original?.assignee_id || null : input.assigneeId || null;
    const project = projectId ? await repo.one("SELECT * FROM projects WHERE workspace_id=? AND id=?", workspaceId, projectId) : null;
    const assignee = assigneeId ? await repo.one("SELECT u.* FROM users u JOIN memberships m ON u.id=m.user_id WHERE m.workspace_id=? AND u.id=?", workspaceId, assigneeId) : null;
    if (projectId && !project) fail(400, "Choose a project in this workspace.");
    if (assigneeId && !assignee) fail(400, "Choose an assignee in this workspace.");
    return { projectId, assigneeId, project: project?.name || "", assignee: assignee?.name || "" };
  }
  function validate(input) {
    try { return validateReport(input); } catch (error) { fail(400, error.message); }
  }
  async function handle(req, res, user, workspaceId, id, child, url) {
    const method = req.method;
    const workspace = await repo.membership(workspaceId, user.id);
    const write = () => repo.membership(workspaceId, user.id, ["owner", "admin", "member"]);
    if (id && !idPattern.test(id)) fail(404, "Report unavailable.");
    if (!id && method === "GET") {
      const q = text(url.searchParams.get("q") || "", "search", 160, false).toLowerCase();
      const status = url.searchParams.get("status") || "";
      const project = url.searchParams.get("project") || "";
      const severity = url.searchParams.get("severity") || "";
      const assignee = url.searchParams.get("assignee") || "";
      const openOnly = url.searchParams.get("open") === "1";
      const offset = Number(url.searchParams.get("offset") || 0);
      if ((status && !statuses.includes(status)) || !Number.isInteger(offset) || offset < 0 || offset > 100000) fail(400, "Invalid report filters.");
      if (assignee && assignee !== "none" && !idPattern.test(assignee)) fail(400, "Invalid report filters.");
      const assigneeFilter = assignee === "none" ? "AND assignee_id IS NULL"
        : assignee ? "AND assignee_id=?" : "";
      const openFilter = openOnly ? "AND coalesce(document->>'status','') <> 'Resolved'" : "";
      const conditions = `workspace_id=? AND (?='' OR position(? in lower(coalesce(document->>'title','') || ' ' || id))>0)
        AND (?='' OR document->>'status'=?) AND (?='' OR project_id=?)
        AND (?='' OR document->>'severity'=?)
        ${assigneeFilter} ${openFilter}`;
      const params = [workspaceId, q, q, status, status, project, project, severity, severity];
      if (assignee && assignee !== "none") params.push(assignee);
      const total = (await repo.one(`SELECT count(*)::int AS n FROM workspace_reports WHERE ${conditions}`, ...params)).n;
      const rows = await repo.all(`SELECT * FROM workspace_reports WHERE ${conditions} ORDER BY created_at DESC,id LIMIT 25 OFFSET ?`, ...params, offset);
      return json(res, 200, { reports: rows.map(repo.serializeReport), total, offset, nextOffset: offset + 25 < total ? offset + 25 : null });
    }
    if (!id && method === "POST") {
      await write();
      const input = await body(req);
      const refs = await references(workspaceId, input);
      const report = validate({ ...input, schemaVersion: 1, id: randomUUID(), createdAt: now(), events: [], project: refs.project, assignee: refs.assignee });
      text(report.title, "report title", 160);
      await transaction(repo.db, async () => {
        await repo.capacity(workspaceId, "reports");
        await repo.run("INSERT INTO workspace_reports VALUES (?,?,?,?,?,?,1,?,?)", report.id, workspaceId, refs.projectId, user.id, refs.assigneeId, JSON.stringify(report), now(), now());
        await repo.activity(workspaceId, user.id, "report.created", `Created ${report.title}`, report.id);
        if (refs.assigneeId !== user.id) await repo.notify(workspaceId, refs.assigneeId, `You were assigned: ${report.title}`, report.id);
      });
      return json(res, 201, { report: repo.serializeReport(await repo.report(workspaceId, report.id)) });
    }
    const row = await repo.report(workspaceId, id);
    if (!child && method === "GET") return json(res, 200, { report: repo.serializeReport(row), artifacts: (await repo.all("SELECT kind FROM workspace_artifacts WHERE workspace_id=? AND report_id=?", workspaceId, id)).map((x) => x.kind), canEdit: workspace.role !== "viewer" });
    if (!child && method === "PATCH") {
      await write();
      const input = await body(req);
      const allowed = ["revision", "title", "description", "status", "severity", "priority", "projectId", "assigneeId", "expected", "actual", "reproduction"];
      if (Object.keys(input).some((key) => !allowed.includes(key)) || !Number.isInteger(input.revision)) fail(400, "Provide editable report fields and the current revision.");
      if (input.revision !== row.version) fail(409, "This report changed. Refresh before saving.");
      const before = parseDocument(row.document);
      const refs = await references(workspaceId, input, row);
      const report = validate({ ...before, ...input, project: refs.project, assignee: refs.assignee });
      text(report.title, "title", 160);
      await transaction(repo.db, async () => {
        const changed = (await repo.run("UPDATE workspace_reports SET document=?,project_id=?,assignee_id=?,version=version+1,updated_at=? WHERE workspace_id=? AND id=? AND version=?", JSON.stringify(report), refs.projectId, refs.assigneeId, now(), workspaceId, id, input.revision)).changes;
        if (!changed) fail(409, "This report changed. Refresh before saving.");
        await repo.activity(workspaceId, user.id, "report.updated", `${report.status !== before.status ? `Moved to ${report.status}: ` : "Updated: "}${report.title}`, id);
        if (refs.assigneeId !== row.assignee_id && refs.assigneeId !== user.id) await repo.notify(workspaceId, refs.assigneeId, `You were assigned: ${report.title}`, id);
      });
      return json(res, 200, { report: repo.serializeReport(await repo.report(workspaceId, id)) });
    }
    if (!child && method === "DELETE") {
      await repo.membership(workspaceId, user.id, ["owner", "admin"]);
      const artifacts = await repo.all("SELECT * FROM workspace_artifacts WHERE workspace_id=? AND report_id=?", workspaceId, id);
      await transaction(repo.db, async () => {
        await repo.run("DELETE FROM workspace_reports WHERE workspace_id=? AND id=?", workspaceId, id);
        await repo.activity(workspaceId, user.id, "report.deleted", `Deleted ${parseDocument(row.document).title}`);
      });
      for (const artifact of artifacts) await media.remove(artifact);
      return json(res, 200, { ok: true });
    }
    if (child === "comments" && method === "GET") return json(res, 200, { comments: await repo.all("SELECT c.*,u.name AS author FROM report_comments c LEFT JOIN users u ON c.user_id=u.id WHERE c.workspace_id=? AND c.report_id=? ORDER BY c.created_at,c.id LIMIT 500", workspaceId, id) });
    if (child === "comments" && method === "POST") {
      await write();
      const input = await body(req);
      const comment = text(input.text, "comment", 4000);
      await transaction(repo.db, async () => {
        if ((await repo.one("SELECT count(*)::int AS n FROM report_comments WHERE workspace_id=? AND report_id=?", workspaceId, id)).n >= 500) fail(422, "This report has reached its comment limit.");
        await repo.run("INSERT INTO report_comments VALUES (?,?,?,?,?,?)", randomUUID(), workspaceId, id, user.id, comment, now());
        const title = parseDocument(row.document).title;
        await repo.activity(workspaceId, user.id, "report.commented", `Commented on ${title}`, id);
        for (const uid of new Set([row.author_id, row.assignee_id].filter((u) => u && u !== user.id))) await repo.notify(workspaceId, uid, `${user.name} commented on ${title}`, id);
      });
      return json(res, 201, { ok: true });
    }
    if (["screenshot", "video"].includes(child) && method === "GET") {
      const artifact = await repo.one("SELECT * FROM workspace_artifacts WHERE workspace_id=? AND report_id=? AND kind=?", workspaceId, id, child);
      if (!artifact) fail(404, "Attachment unavailable.");
      let bytes;
      try { bytes = await media.get(artifact); } catch { fail(404, "Attachment unavailable."); }
      res.writeHead(200, { "content-type": artifact.type, "cache-control": "no-store", "x-content-type-options": "nosniff", "content-disposition": `attachment; filename="bugshaper.${child === "video" ? "webm" : "png"}"` });
      return res.end(bytes);
    }
    fail(405, "Method unavailable.");
  }
  async function importBundle(req, res, user, workspaceId) {
    await repo.membership(workspaceId, user.id, ["owner", "admin", "member"]);
    const input = await body(req, maxBundleBytes);
    let projectId = null;
    let bundle = input;
    if (input.bundle && typeof input.bundle === "object" && !Array.isArray(input.bundle) && input.format !== "bugshaper-report") {
      projectId = typeof input.projectId === "string" && input.projectId ? input.projectId : null;
      bundle = input.bundle;
    } else if (typeof input.projectId === "string" && input.projectId) {
      projectId = input.projectId;
      const { projectId: _drop, ...rest } = input;
      bundle = rest;
    }
    let submission;
    try { submission = await parseSubmission(bundle); } catch (error) { fail(400, error.message); }
    const { report, artifacts } = submission;
    report.assignee = "";
    const refs = projectId ? await references(workspaceId, { projectId }) : { projectId: null, project: "" };
    report.project = refs.project;
    if (await repo.one("SELECT 1 FROM workspace_reports WHERE workspace_id=? AND id=?", workspaceId, report.id)) fail(409, "This report is already in the workspace.");
    await repo.capacity(workspaceId, "reports");
    const storedArtifacts = [];
    for (const artifact of artifacts) {
      const stored = await media.put(workspaceId, report.id, artifact.kind, artifact.data, artifact.type);
      storedArtifacts.push({ kind: artifact.kind, type: artifact.type, data: stored.data, storageKey: stored.storageKey });
    }
    try {
      await transaction(repo.db, async () => {
        if (await repo.one("SELECT 1 FROM workspace_reports WHERE workspace_id=? AND id=?", workspaceId, report.id)) fail(409, "This report is already in the workspace.");
        await repo.capacity(workspaceId, "reports");
        await repo.run("INSERT INTO workspace_reports VALUES (?,?,?,?,NULL,?,1,?,?)", report.id, workspaceId, refs.projectId, user.id, JSON.stringify(report), report.createdAt, now());
        for (const artifact of storedArtifacts) {
          await repo.run("INSERT INTO workspace_artifacts(workspace_id,report_id,kind,type,data,storage_key) VALUES (?,?,?,?,?,?)", workspaceId, report.id, artifact.kind, artifact.type, artifact.data, artifact.storageKey);
        }
        await repo.activity(workspaceId, user.id, "report.imported", `Imported ${report.title || "Untitled report"}`, report.id);
      });
    } catch (error) {
      for (const artifact of storedArtifacts) if (artifact.storageKey) await media.remove({ storage_key: artifact.storageKey });
      throw error;
    }
    return json(res, 201, { id: report.id, projectId: refs.projectId });
  }
  async function analytics(workspaceId) {
    const rows = await repo.all("SELECT document,created_at,updated_at FROM workspace_reports WHERE workspace_id=?", workspaceId);
    const reports = rows.map((row) => ({ ...parseDocument(row.document), updatedAt: row.updated_at }));
    const recent = reports.filter((r) => r.createdAt >= now() - 604800000);
    const byStatus = statuses.map((status) => ({ name: status, count: reports.filter((r) => r.status === status).length }));
    const bySeverity = ["Critical", "High", "Medium", "Low", "Unspecified"].map((severity) => ({ name: severity, count: reports.filter((r) => (r.severity || "Unspecified") === severity).length }));
    const days = Array.from({ length: 14 }, (_, i) => {
      const date = new Date(now() - (13 - i) * 86400000).toISOString().slice(0, 10);
      return { date, created: reports.filter((r) => new Date(r.createdAt).toISOString().slice(0, 10) === date).length,
        resolved: reports.filter((r) => r.status === "Resolved" && new Date(r.updatedAt).toISOString().slice(0, 10) === date).length };
    });
    return { total: reports.length, open: reports.filter((r) => r.status !== "Resolved").length, resolved: reports.filter((r) => r.status === "Resolved").length,
      critical: reports.filter((r) => r.severity === "Critical" && r.status !== "Resolved").length, unassigned: reports.filter((r) => !r.assignee && r.status !== "Resolved").length,
      thisWeek: recent.length, byStatus, bySeverity, days, usage: await repo.usage(workspaceId), plan: await repo.entitlement(workspaceId) };
  }
  async function shares(req, res, user, workspaceId, id, _child, url) {
    const method = req.method;
    await repo.membership(workspaceId, user.id);
    const write = () => repo.membership(workspaceId, user.id, ["owner", "admin", "member"]);
    if (!id && method === "GET") {
      const reportId = url.searchParams.get("reportId") || "";
      if (reportId && !idPattern.test(reportId)) fail(400, "Invalid report id.");
      const rows = reportId
        ? await repo.all("SELECT id,report_id,expires_at,created_at,created_by FROM platform_shares WHERE workspace_id=? AND report_id=? AND revoked_at IS NULL AND expires_at>? ORDER BY created_at DESC", workspaceId, reportId, now())
        : await repo.all("SELECT id,report_id,expires_at,created_at,created_by FROM platform_shares WHERE workspace_id=? AND revoked_at IS NULL AND expires_at>? ORDER BY created_at DESC LIMIT 100", workspaceId, now());
      return json(res, 200, { shares: rows });
    }
    if (!id && method === "POST") {
      await write();
      const input = await body(req);
      const reportId = text(input.reportId, "report id", 36);
      if (!idPattern.test(reportId)) fail(400, "Invalid report id.");
      await repo.report(workspaceId, reportId);
      const ttl = Number(input.ttlSeconds);
      if (!Number.isInteger(ttl) || ttl < 60 || ttl > 604800) fail(400, "Share lifetime must be 60 to 604800 seconds.");
      const key = randomBytes(32).toString("hex");
      const shareId = randomUUID();
      const expiresAt = now() + ttl * 1000;
      await repo.run(
        "INSERT INTO platform_shares(id,workspace_id,report_id,digest,created_by,expires_at,revoked_at,created_at) VALUES (?,?,?,?,?,?,NULL,?)",
        shareId, workspaceId, reportId, hash(key), user.id, expiresAt, now(),
      );
      await repo.activity(workspaceId, user.id, "report.shared", "Created a share link", reportId);
      return json(res, 201, { id: shareId, key, expiresAt, url: `/share/${key}` });
    }
    if (id && method === "DELETE") {
      await write();
      const changed = (await repo.run(
        "UPDATE platform_shares SET revoked_at=? WHERE workspace_id=? AND id=? AND revoked_at IS NULL",
        now(), workspaceId, id,
      )).changes;
      if (!changed) fail(404, "Share unavailable.");
      await repo.activity(workspaceId, user.id, "report.share_revoked", "Revoked a share link");
      return json(res, 200, { revoked: true });
    }
    fail(405, "Method unavailable.");
  }
  async function viewShared(req, res, token) {
    if (!/^[a-f0-9]{64}$/.test(token)) fail(404, "Share unavailable.");
    const share = await repo.one(
      "SELECT * FROM platform_shares WHERE digest=? AND revoked_at IS NULL AND expires_at>?",
      hash(token), now(),
    );
    if (!share) fail(404, "Share unavailable.");
    const row = await repo.report(share.workspace_id, share.report_id);
    return json(res, 200, { report: repo.serializeReport(row), workspaceId: share.workspace_id, expiresAt: share.expires_at });
  }
  return { handle, importBundle, analytics, shares, viewShared };
}