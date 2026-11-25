import { randomUUID } from "node:crypto";
import { body, fail, hash, json, text, token, transaction } from "../helpers/http.mjs";

const managers = ["owner", "admin"];
const inviteRoles = ["admin", "member", "viewer"];

function parseDocument(d) {
  return typeof d === "string" ? JSON.parse(d) : d;
}

export function workspaceService(repo, config, now, fetcher) {
  async function team(workspaceId, teamId) {
    const row = await repo.one("SELECT * FROM teams WHERE workspace_id=? AND id=?", workspaceId, teamId);
    if (!row) fail(404, "Team unavailable.");
    return row;
  }
  async function accept(req, res, user) {
    const input = await body(req);
    const invitation = await repo.one("SELECT * FROM invitations WHERE digest=? AND revoked_at IS NULL AND accepted_at IS NULL AND expires_at>?", hash(text(input.token, "invitation token", 100)), now());
    if (!invitation) fail(404, "This invitation is unavailable or has expired.");
    if (invitation.email.toLowerCase() !== user.email.toLowerCase()) fail(403, "Sign in with the email address this invitation was sent to.");
    await transaction(repo.db, async () => {
      const existing = await repo.one("SELECT 1 FROM memberships WHERE workspace_id=? AND user_id=?", invitation.workspace_id, user.id);
      if (!existing) {
        const used = await repo.usage(invitation.workspace_id);
        if (used.members + used.invitations > (await repo.entitlement(invitation.workspace_id)).members) fail(402, "The workspace needs more seats before you can join.");
        await repo.run("INSERT INTO memberships VALUES (?,?,?,?)", invitation.workspace_id, user.id, invitation.role, now());
      }
      if (invitation.team_id) await repo.run("INSERT INTO team_members VALUES (?,?,?) ON CONFLICT DO NOTHING", invitation.workspace_id, invitation.team_id, user.id);
      await repo.run("UPDATE invitations SET accepted_at=? WHERE id=?", now(), invitation.id);
      await repo.activity(invitation.workspace_id, user.id, "member.joined", `${user.name} joined the workspace`);
    });
    return json(res, 200, { workspaceId: invitation.workspace_id });
  }
  async function handle(req, res, user, workspaceId, resource, id, child, url) {
    const method = req.method;
    const workspace = await repo.membership(workspaceId, user.id);
    const manage = () => repo.membership(workspaceId, user.id, managers);
    if (resource === "settings" && method === "GET") return json(res, 200, { workspace, role: workspace.role, usage: await repo.usage(workspaceId), plan: await repo.entitlement(workspaceId) });
    if (resource === "settings" && method === "PATCH") {
      await manage();
      const input = await body(req);
      const name = text(input.name, "workspace name", 80);
      await transaction(repo.db, async () => {
        await repo.run("UPDATE workspaces SET name=? WHERE id=?", name, workspaceId);
        await repo.activity(workspaceId, user.id, "workspace.updated", `Renamed workspace to ${name}`);
      });
      return json(res, 200, { ok: true });
    }
    if (resource === "members" && method === "GET") return json(res, 200, {
      members: await repo.all("SELECT u.id,u.name,u.email,m.role,m.joined_at FROM memberships m JOIN users u ON m.user_id=u.id WHERE m.workspace_id=? ORDER BY m.joined_at,u.name", workspaceId),
      invitations: managers.includes(workspace.role) ? await repo.all("SELECT id,email,role,team_id,expires_at,accepted_at,revoked_at,created_at FROM invitations WHERE workspace_id=? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at>? ORDER BY created_at DESC", workspaceId, now()) : [],
    });
    if (resource === "members" && id && ["PATCH", "DELETE"].includes(method)) {
      await manage();
      const member = await repo.one("SELECT * FROM memberships WHERE workspace_id=? AND user_id=?", workspaceId, id);
      if (!member) fail(404, "Member unavailable.");
      if (member.role === "owner" || id === user.id || (workspace.role !== "owner" && member.role === "admin")) fail(403, "Only the owner can manage other administrators. You cannot change your own membership.");
      if (method === "PATCH") {
        const input = await body(req);
        if (!inviteRoles.includes(input.role) || (input.role === "admin" && workspace.role !== "owner")) fail(403, "Only the owner can grant administrator access.");
        await transaction(repo.db, async () => {
          await repo.run("UPDATE memberships SET role=? WHERE workspace_id=? AND user_id=?", input.role, workspaceId, id);
          await repo.activity(workspaceId, user.id, "member.role_changed", `Changed member role to ${input.role}`);
        });
      } else await transaction(repo.db, async () => {
        const assigned = await repo.all("SELECT id,document FROM workspace_reports WHERE workspace_id=? AND assignee_id=?", workspaceId, id);
        for (const report of assigned) {
          const document = parseDocument(report.document);
          document.assignee = "";
          await repo.run("UPDATE workspace_reports SET assignee_id=NULL,document=?,version=version+1,updated_at=? WHERE workspace_id=? AND id=?", JSON.stringify(document), now(), workspaceId, report.id);
        }
        await repo.run("DELETE FROM memberships WHERE workspace_id=? AND user_id=?", workspaceId, id);
        await repo.activity(workspaceId, user.id, "member.removed", "Removed a workspace member");
      });
      return json(res, 200, { ok: true });
    }
    if (resource === "invitations" && method === "POST") {
      await manage();
      const input = await body(req);
      const email = text(input.email, "email", 254).toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400, "Enter a valid email address.");
      const role = input.role || "member";
      if (!inviteRoles.includes(role) || (role === "admin" && workspace.role !== "owner")) fail(403, "You cannot invite this role.");
      if (input.teamId) await team(workspaceId, input.teamId);
      const secret = token();
      const inviteId = randomUUID();
      const expires = now() + 604800000;
      await transaction(repo.db, async () => {
        if (await repo.one("SELECT 1 FROM memberships m JOIN users u ON m.user_id=u.id WHERE m.workspace_id=? AND u.email=?", workspaceId, email)) fail(409, "This person is already a workspace member.");
        if (await repo.one("SELECT 1 FROM invitations WHERE workspace_id=? AND email=? AND revoked_at IS NULL AND accepted_at IS NULL AND expires_at>?", workspaceId, email, now())) fail(409, "An active invitation already exists for this email. Revoke it to create a new one.");
        await repo.capacity(workspaceId, "members");
        await repo.run("INSERT INTO invitations VALUES (?,?,?,?,?,?,?,?,NULL,NULL,?)", inviteId, workspaceId, hash(secret), email, role, input.teamId || null, user.id, expires, now());
        await repo.activity(workspaceId, user.id, "member.invited", `Invited ${email} as ${role}`);
      });
      const inviteUrl = config.origin + "/invite#" + secret;
      let delivery = "link";
      if (config.resendKey && config.emailFrom) {
        try {
          const response = await fetcher("https://api.resend.com/emails", { method: "POST", signal: AbortSignal.timeout(10000), headers: { authorization: "Bearer " + config.resendKey, "content-type": "application/json", "idempotency-key": inviteId },
            body: JSON.stringify({ from: config.emailFrom, to: [email], subject: `Join ${workspace.name} on Bugshaper`, text: `${user.name} invited you to ${workspace.name} on Bugshaper.\n\nSign in with ${email} and accept your invitation:\n${inviteUrl}\n\nThis invitation expires in seven days.` }) });
          delivery = response.ok ? "sent" : "failed";
        } catch { delivery = "failed"; }
      }
      return json(res, 201, { id: inviteId, inviteUrl, expiresAt: expires, delivery });
    }
    if (resource === "invitations" && id && method === "DELETE") {
      await manage();
      const changed = (await repo.run("UPDATE invitations SET revoked_at=? WHERE workspace_id=? AND id=? AND accepted_at IS NULL AND revoked_at IS NULL", now(), workspaceId, id)).changes;
      if (!changed) fail(404, "Invitation unavailable.");
      await repo.activity(workspaceId, user.id, "invitation.revoked", "Revoked an invitation");
      return json(res, 200, { ok: true });
    }
    if (resource === "teams" && method === "GET") {
      const teams = await repo.all("SELECT t.*, (SELECT count(*)::int FROM team_members tm WHERE tm.team_id=t.id AND tm.workspace_id=t.workspace_id) AS memberCount FROM teams t WHERE workspace_id=? ORDER BY created_at", workspaceId);
      return json(res, 200, {
        teams: await Promise.all(teams.map(async (t) => ({
          ...t,
          members: await repo.all("SELECT u.id,u.name,u.email FROM team_members tm JOIN users u ON u.id=tm.user_id WHERE tm.workspace_id=? AND tm.team_id=? ORDER BY u.name", workspaceId, t.id),
        }))),
      });
    }
    if (resource === "teams" && !id && method === "POST") {
      await manage();
      const input = await body(req);
      const name = text(input.name, "team name", 80);
      const description = text(input.description || "", "description", 500, false);
      const teamId = randomUUID();
      if ((await repo.one("SELECT count(*)::int AS n FROM teams WHERE workspace_id=?", workspaceId)).n >= 100) fail(422, "A workspace supports up to 100 teams.");
      await transaction(repo.db, async () => {
        await repo.run("INSERT INTO teams VALUES (?,?,?,?,?)", teamId, workspaceId, name, description, now());
        await repo.run("INSERT INTO team_members VALUES (?,?,?)", workspaceId, teamId, user.id);
        await repo.activity(workspaceId, user.id, "team.created", `Created team ${name}`);
      });
      return json(res, 201, { id: teamId });
    }
    if (resource === "teams" && id && child === "members" && method === "POST") {
      await manage();
      await team(workspaceId, id);
      const input = await body(req);
      await repo.membership(workspaceId, text(input.userId, "member ID"));
      await transaction(repo.db, async () => {
        await repo.run("INSERT INTO team_members VALUES (?,?,?) ON CONFLICT DO NOTHING", workspaceId, id, input.userId);
        await repo.activity(workspaceId, user.id, "team.member_added", "Added a member to a team");
      });
      return json(res, 200, { ok: true });
    }
    if (resource === "teams" && id && method === "DELETE") {
      await manage();
      const current = await team(workspaceId, id);
      const memberId = url.searchParams.get("member");
      await transaction(repo.db, async () => {
        if (memberId) await repo.run("DELETE FROM team_members WHERE workspace_id=? AND team_id=? AND user_id=?", workspaceId, id, memberId);
        else await repo.run("DELETE FROM teams WHERE workspace_id=? AND id=?", workspaceId, id);
        await repo.activity(workspaceId, user.id, memberId ? "team.member_removed" : "team.deleted", `${memberId ? "Updated" : "Deleted"} team ${current.name}`);
      });
      return json(res, 200, { ok: true });
    }
    if (resource === "projects" && method === "GET") return json(res, 200, { projects: await repo.all("SELECT p.*,(SELECT count(*)::int FROM workspace_reports r WHERE r.workspace_id=p.workspace_id AND r.project_id=p.id) AS reportCount FROM projects p WHERE p.workspace_id=? ORDER BY p.created_at", workspaceId) });
    if (resource === "projects" && method === "POST") {
      await manage();
      const input = await body(req);
      const name = text(input.name, "project name", 80);
      const description = text(input.description || "", "description", 500, false);
      let site = "";
      if (input.url) {
        try {
          const parsed = new URL(input.url);
          if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error();
          site = parsed.origin;
        } catch { fail(400, "Use a valid HTTP or HTTPS project URL."); }
      }
      const projectId = randomUUID();
      await transaction(repo.db, async () => {
        await repo.capacity(workspaceId, "projects");
        await repo.run("INSERT INTO projects VALUES (?,?,?,?,?,?)", projectId, workspaceId, name, description, site, now());
        await repo.activity(workspaceId, user.id, "project.created", `Created project ${name}`);
      });
      return json(res, 201, { id: projectId });
    }
    if (resource === "activity" && method === "GET") {
      const before = Number(url.searchParams.get("before") || Number.MAX_SAFE_INTEGER);
      if (!Number.isSafeInteger(before) || before < 0) fail(400, "Invalid activity cursor.");
      const entries = await repo.all("SELECT a.*,u.name AS actor FROM workspace_activity a LEFT JOIN users u ON u.id=a.user_id WHERE a.workspace_id=? AND a.sequence<? ORDER BY a.sequence DESC LIMIT 51", workspaceId, before);
      return json(res, 200, { entries: entries.slice(0, 50), nextCursor: entries.length > 50 ? entries[49].sequence : null });
    }
    if (resource === "notifications" && method === "GET") return json(res, 200, { notifications: await repo.all("SELECT * FROM notifications WHERE workspace_id=? AND user_id=? ORDER BY created_at DESC LIMIT 100", workspaceId, user.id) });
    if (resource === "notifications" && method === "PATCH") {
      await repo.run("UPDATE notifications SET read_at=? WHERE workspace_id=? AND user_id=? AND read_at IS NULL", now(), workspaceId, user.id);
      return json(res, 200, { ok: true });
    }
    fail(404, "Route unavailable.");
  }
  return { handle, accept };
}