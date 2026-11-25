import { randomUUID } from "node:crypto";
import { fail } from "../helpers/http.mjs";
import { plans } from "../helpers/config.mjs";

export function repository(db, now) {
  const one = async (sql, ...args) => db.prepare(sql).get(...args);
  const all = async (sql, ...args) => db.prepare(sql).all(...args);
  const run = async (sql, ...args) => db.prepare(sql).run(...args);
  async function membership(workspaceId, userId, roles) {
    const row = await one(
      "SELECT w.*, m.role FROM workspaces w JOIN memberships m ON w.id=m.workspace_id WHERE w.id=? AND m.user_id=?",
      workspaceId,
      userId,
    );
    if (!row) fail(404, "Workspace unavailable.");
    if (roles && !roles.includes(row.role)) fail(403, "Your workspace role cannot perform this action.");
    return row;
  }
  async function activity(workspaceId, userId, action, detail, reportId = null) {
    await run(
      "INSERT INTO workspace_activity(workspace_id,user_id,action,detail,report_id,created_at) VALUES (?,?,?,?,?,?)",
      workspaceId,
      userId,
      action,
      detail,
      reportId,
      now(),
    );
  }
  async function notify(workspaceId, userId, title, reportId) {
    if (userId) {
      await run(
        "INSERT INTO notifications VALUES (?,?,?,?,?,NULL,?)",
        randomUUID(),
        workspaceId,
        userId,
        title,
        reportId,
        now(),
      );
    }
  }
  async function subscription(workspaceId) {
    return one("SELECT * FROM subscriptions WHERE workspace_id=?", workspaceId);
  }
  async function entitlement(workspaceId) {
    const sub = await subscription(workspaceId);
    return plans[["active", "free"].includes(sub?.status) ? sub.plan : "free"] || plans.free;
  }
  async function usage(workspaceId) {
    return {
      members: Number((await one("SELECT count(*)::int AS n FROM memberships WHERE workspace_id=?", workspaceId)).n),
      invitations: Number((
        await one(
          "SELECT count(*)::int AS n FROM invitations WHERE workspace_id=? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at>?",
          workspaceId,
          now(),
        )
      ).n),
      reports: Number((await one("SELECT count(*)::int AS n FROM workspace_reports WHERE workspace_id=?", workspaceId)).n),
      projects: Number((await one("SELECT count(*)::int AS n FROM projects WHERE workspace_id=?", workspaceId)).n),
    };
  }
  async function capacity(workspaceId, kind) {
    const used = await usage(workspaceId);
    const plan = await entitlement(workspaceId);
    if (used[kind] + (kind === "members" ? used.invitations : 0) >= plan[kind]) {
      fail(402, `Your ${plan.name} plan has reached its ${kind} limit. Manage your plan in Billing.`);
    }
  }
  const report = async (workspaceId, id) => {
    const row = await one("SELECT * FROM workspace_reports WHERE workspace_id=? AND id=?", workspaceId, id);
    if (!row) fail(404, "Report unavailable.");
    return row;
  };
  const asDocument = (value) => (typeof value === "string" ? JSON.parse(value) : value);
  const serializeReport = (row) => ({
    ...asDocument(row.document),
    projectId: row.project_id,
    assigneeId: row.assignee_id,
    revision: row.version,
    updatedAt: row.updated_at,
    authorId: row.author_id,
  });
  return { db, one, all, run, membership, activity, notify, subscription, entitlement, usage, capacity, report, serializeReport, asDocument };
}