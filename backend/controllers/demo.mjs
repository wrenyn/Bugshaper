import { randomUUID } from "node:crypto";
import { transaction } from "../helpers/http.mjs";

export async function seedDemo(repo, now) {
  if (await repo.one("SELECT 1 FROM users WHERE google_sub='demo-owner'")) return;
  await transaction(repo.db, async () => {
    const workspace = randomUUID();
    const users = [["demo-owner", "Alex Morgan", "alex@bugshaper.example", "owner"], ["demo-maya", "Maya Chen", "maya@bugshaper.example", "admin"], ["demo-noah", "Noah Williams", "noah@bugshaper.example", "member"]].map(([sub, name, email, role]) => ({ id: randomUUID(), sub, name, email, role }));
    for (const u of users) await repo.run("INSERT INTO users VALUES (?,?,?,?,?)", u.id, u.sub, u.email, u.name, now() - 864000000);
    await repo.run("INSERT INTO workspaces VALUES (?,?,?)", workspace, "Acme Studio", now() - 864000000);
    await repo.run("INSERT INTO subscriptions(workspace_id) VALUES (?)", workspace);
    for (const u of users) await repo.run("INSERT INTO memberships VALUES (?,?,?,?)", workspace, u.id, u.role, now() - 864000000);
    const projects = ["Web app", "Marketing site"].map(name => ({ id: randomUUID(), name }));
    for (const p of projects) await repo.run("INSERT INTO projects VALUES (?,?,?,?,?,?)", p.id, workspace, p.name, p.name === "Web app" ? "Our customer-facing application" : "Website, acquisition, and onboarding", "https://example.com", now() - 864000000);
    for (const [name, desc, indices] of [["Engineering", "Build, investigate, and ship better software.", [0, 1, 2]], ["Design & QA", "Make every interaction feel right.", [0, 1]]]) {
      const id = randomUUID();
      await repo.run("INSERT INTO teams VALUES (?,?,?,?,?)", id, workspace, name, desc, now() - 864000000);
      for (const i of indices) await repo.run("INSERT INTO team_members VALUES (?,?,?)", workspace, id, users[i].id);
    }
    const samples = [
      ["Checkout button overflows on mobile", "Open", "High", 0, 1, "The checkout button extends beyond the viewport at 375px. Reproduced in Chrome on Android."],
      ["Dashboard fails to load after session refresh", "In progress", "Critical", 0, 2, "Refreshing an expired session leaves the dashboard on a loading screen."],
      ["Pricing toggle does not update the total", "Triaged", "Medium", 1, 0, "Switching between billing options keeps the previous total visible."],
      ["Search results overlap the navigation", "Open", "Medium", 0, null, "The search dropdown appears above the fixed header on smaller laptops."],
      ["Invite acceptance redirects to a blank page", "Ready for verification", "High", 0, 1, "Verify the invitation return URL after authentication."],
      ["Footer links have insufficient contrast", "Resolved", "Low", 1, 1, "Adjusted footer text contrast. Verified against the current design."],
      ["File upload stops at 99 percent", "In progress", "High", 0, 2, "The progress indicator never completes when uploading a second file."],
      ["Team avatars shift during page load", "Resolved", "Low", 0, 0, "Reserved avatar dimensions to avoid layout shift."],
      ["Keyboard focus is lost after closing a dialog", "Triaged", "Medium", 0, null, "Focus should return to the element that opened the dialog."],
      ["Mobile menu remains open after navigation", "Resolved", "Medium", 1, 0, "Navigation now closes the menu and updates the current page."],
      ["Report export uses the wrong filename", "Fix proposed", "Low", 0, 2, "Include the report title and export date in downloaded files."],
      ["Empty project view needs an action", "Open", "Low", 0, 1, "Add a clear way to create a first report from the empty project view."],
    ];
    for (let i = 0; i < samples.length; i++) {
      const [title, status, severity, p, a, description] = samples[i];
      const id = randomUUID(); const created = now() - (i * 19 + 2) * 3600000;
      const doc = { schemaVersion: 1, id, title, description, status, severity, priority: severity === "Critical" ? "Urgent" : "Normal", project: projects[p].name, assignee: a === null ? "" : users[a].name, origin: "https://example.com", createdAt: created,
        reproduction: "1. Open the affected page.\n2. Reproduce the interaction described above.\n3. Compare with the expected behavior.", expected: "The interaction completes without visual or functional errors.",
        events: i === 1 ? [{ at: created, kind: "network", origin: "https://example.com", status: 500 }] : [] };
      await repo.run("INSERT INTO workspace_reports VALUES (?,?,?,?,?,?,1,?,?)", id, workspace, projects[p].id, users[0].id, a === null ? null : users[a].id, JSON.stringify(doc), created, created + 3600000);
      await repo.run("INSERT INTO workspace_activity(workspace_id,user_id,action,detail,report_id,created_at) VALUES (?,?,?,?,?,?)", workspace, users[i % 3].id, "report.created", `Created ${title}`, id, created);
      if (i < 3) await repo.run("INSERT INTO report_comments VALUES (?,?,?,?,?,?)", randomUUID(), workspace, id, users[1].id, "I can reproduce this on staging. Added it to our next triage.", created + 1800000);
      if (a === 0) await repo.notify(workspace, users[0].id, `You were assigned: ${title}`, id);
    }
    await repo.activity(workspace, users[0].id, "workspace.created", "Welcome to your demo workspace. All data here is sample data.");
  });
}