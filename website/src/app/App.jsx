import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { api, setCsrf } from "./client.js";
import { ActionForm, Avatar, ErrorNotice, Icon, Loading, useResource } from "./ui.jsx";
import { Overview, Analytics, Activity, Notifications } from "./pages/Insights.jsx";
import { ReportsPage, ReportPage, ShareReportPage } from "./pages/Reports.jsx";
import { Projects, Teams, Members } from "./pages/People.jsx";
import { Billing, Settings } from "./pages/Settings.jsx";

const path = location.pathname;
const params = new URLSearchParams(location.search);
const navigation = [
  ["Workspace", [["/dashboard", "Overview", "grid"], ["/reports", "All reports", "bug"], ["/projects", "Projects", "folder"], ["/teams", "Teams", "team"], ["/members", "Members", "users"]]],
  ["Insights", [["/analytics", "Analytics", "grid"], ["/activity", "Activity", "message"]]],
  ["Manage", [["/billing", "Plans & billing", "card"], ["/settings", "Settings", "settings"]]],
];
const authErrors = { google_unconfigured: "Google sign-in is being set up. Please contact your workspace administrator.", oauth_state: "Your sign-in session expired. Please try again.", oauth_cancelled: "Sign-in was cancelled. You can try again when you're ready.", oauth_failed: "Google could not complete sign-in. Please try again." };
function Login({ session }) {
  const next = path === "/login" ? params.get("returnTo") || "/dashboard" : path + location.search + location.hash;
  const returnTo = /^\/(dashboard|reports|projects|teams|members|analytics|activity|settings|billing|notifications|invite)([/?#]|$)/.test(next) && !next.includes("\\") ? next : "/dashboard";
  return <div className="auth-page"><a className="brand auth-brand" href="/"><img src="/brand/mark.svg" width="34" height="34" alt="" />bugshaper</a><div className="auth-layout"><section className="auth-story"><p className="eyebrow">LESS BACK-AND-FORTH. MORE FIXES.</p><h1>Good software<br />is a <span>team effort.</span></h1><p>Bring your bugs, your evidence, and your people into one focused workspace.</p><div className="auth-benefits">{[["bug", "The full picture", "Screenshots, diagnostics, and reproduction steps together."], ["users", "Your team, in sync", "Shared reports, assignments, and conversations."], ["shield", "A workspace you control", "Clear roles, expiring invitations, and private projects."]].map(([icon, title, description]) => <div key={title}><Icon name={icon} /><div><strong>{title}</strong><p>{description}</p></div></div>)}</div><p className="auth-credit">Built for the people who care about what they ship.</p></section><section className="auth-card"><span className="empty-icon"><img src="/brand/mark.svg" width="38" height="38" alt="" /></span><h2>Welcome to Bugshaper</h2><p className="muted">Sign in or create an account. Let's get your bugs into shape.</p>{params.get("error") && <p role="alert" className="form-error">{authErrors[params.get("error")] || "Sign-in failed. Please try again."}</p>}<a className="button google-button" href={"/auth/google?" + new URLSearchParams({ returnTo })}><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="#4285F4" d="M21.6 12.2c0-.7-.1-1.5-.2-2.2H12v4.2h5.4a4.6 4.6 0 0 1-2 3v2.5h3.3c1.9-1.8 2.9-4.4 2.9-7.5Z"/><path fill="#34A853" d="M12 22c2.7 0 5-.9 6.7-2.4l-3.3-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H3v2.6A10 10 0 0 0 12 22Z"/><path fill="#FBBC05" d="M6.4 14a6 6 0 0 1 0-4V7.4H3a10 10 0 0 0 0 9.2L6.4 14Z"/><path fill="#EA4335" d="M12 6c1.5 0 2.8.5 3.8 1.5l2.9-2.9A10 10 0 0 0 3 7.4L6.4 10A6 6 0 0 1 12 6Z"/></svg>Continue with Google</a>{!session.googleReady && <p className="auth-note">Google sign-in needs to be connected by the administrator.</p>}{session.demo && <><div className="auth-divider"><span>take a look around</span></div><ActionForm label="Explore the demo workspace" onSubmit={async () => { await api("/auth/demo", "POST", {}); location.assign(returnTo); }}><p className="auth-note">Local demo · Sample reports · No Google account needed</p></ActionForm></>}<p className="auth-legal">By continuing, you acknowledge our <a href="/terms">Terms</a> and <a href="/privacy">Privacy notice</a>.</p><div className="auth-bottom"><Icon name="shield" size={16} /> Secure sign-in. No password to remember.</div></section></div><footer className="auth-footer"><span>A Wrenyn product</span><a href="/docs">Need a hand? Read the docs</a></footer></div>;
}
function Invite({ session }) {
  const [result, setResult] = useState(null);
  const [secret] = useState(() => { const value = location.hash.slice(1); history.replaceState(null, "", "/invite"); return value; });
  return <div className="invite-page"><a className="brand" href="/"><img src="/brand/mark.svg" width="32" height="32" alt="" />bugshaper</a><section className="auth-card"><Icon name="users" size={36} /><h1>You're invited.</h1><p className="muted">Join your team and start shaping better software.</p><p>Signed in as <strong>{session.user.email}</strong></p>{result ? <a className="button" href="/dashboard" onClick={() => localStorage.setItem("bugshaper.workspace", result)}>Open workspace</a> : secret ? <ActionForm label="Accept invitation" onSubmit={async () => { const data = await api("/api/v1/invitations/accept", "POST", { token: secret }); localStorage.setItem("bugshaper.workspace", data.workspaceId); setResult(data.workspaceId); }}><p className="auth-note">Invitations are tied to the email address they were sent to and expire after seven days.</p></ActionForm> : <ErrorNotice error="Open the complete invitation link your team shared with you." />}</section></div>;
}
function WorkspaceApp({ session }) {
  const [mobile, setMobile] = useState(false);
  const workspace = session.workspaces.find(w => w.id === localStorage.getItem("bugshaper.workspace")) || session.workspaces[0];
  const endpoint = resource => `/api/v1/workspaces/${workspace.id}/${resource}`;
  const notices = useResource(endpoint("notifications"));
  const canManage = ["owner", "admin"].includes(workspace.role); const canWrite = workspace.role !== "viewer";
  const context = { session, workspace, endpoint, canManage, canWrite };
  const match = path.match(/^\/reports\/([a-f0-9-]{36})$/i);
  const shareMatch = path.match(/^\/share\/([a-f0-9]{64})$/i);
  const pages = { "/dashboard": Overview, "/reports": ReportsPage, "/projects": Projects, "/teams": Teams, "/members": Members, "/analytics": Analytics, "/activity": Activity, "/billing": Billing, "/settings": Settings, "/notifications": Notifications };
  const Page = shareMatch ? ShareReportPage : match ? ReportPage : pages[path] || Overview;
  const currentTitle = shareMatch ? "Shared report" : match ? "Report details" : navigation.flatMap(x => x[1]).find(x => x[0] === path)?.[1] || "Notifications";
  const unread = notices.data?.notifications.filter(n => !n.read_at).length || 0;
  return <div className={"workspace-app" + (mobile ? " menu-open" : "")}><a className="skip-link button" href="#main">Skip to content</a>{mobile && <button className="sidebar-scrim" aria-label="Close navigation" onClick={() => setMobile(false)} />}<aside className="sidebar"><a className="brand" href="/"><img src="/brand/mark.svg" width="32" height="32" alt="" />bugshaper<span className="brand-label">WORKSPACE</span></a><div className="workspace-switch"><span className="workspace-emblem">{workspace.name.slice(0, 1)}</span><label className="sr-only" htmlFor="workspace">Switch workspace</label><select id="workspace" value={workspace.id} onChange={e => { localStorage.setItem("bugshaper.workspace", e.target.value); location.assign(match ? "/reports" : path); }}>{session.workspaces.map(w => <option value={w.id} key={w.id}>{w.name}</option>)}</select></div><nav aria-label="Workspace navigation">{navigation.map(([title, links]) => <div className="nav-group" key={title}><p>{title}</p>{links.map(([href, label, icon]) => <a key={href} href={href} className={(path === href || href === "/reports" && match) ? "active" : ""} aria-current={path === href ? "page" : undefined}><Icon name={icon} size={19} />{label}{href === "/reports" && <span className="nav-shortcut">B</span>}</a>)}</div>)}</nav><div className="sidebar-bottom"><a className="help-link" href="/docs"><Icon name="book" />Help & documentation</a><div className="profile"><Avatar name={session.user.name} /><div><strong>{session.user.name}</strong><span>{workspace.role}</span></div><button aria-label="Sign out" className="icon-button" onClick={async () => { try { await api("/auth/logout", "POST", {}); location.assign("/login"); } catch { location.assign("/login"); } }}><Icon name="logout" size={18} /></button></div></div></aside><div className="workspace-body"><header className="app-header"><div className="breadcrumbs"><button className="icon-button mobile-menu" aria-label="Open navigation" aria-expanded={mobile} onClick={() => setMobile(!mobile)}><Icon name="menu" /></button><span>{workspace.name}</span><Icon name="chevron" size={14} /><strong>{currentTitle}</strong></div><div className="top-actions"><form className="global-search" action="/reports"><Icon name="search" size={17} /><input name="q" aria-label="Search reports" placeholder="Search reports…" defaultValue={path === "/reports" ? params.get("q") || "" : ""} /></form><a className="notification-button icon-button" href="/notifications" aria-label={`${unread} unread notifications`}><Icon name="bell" />{unread > 0 && <span className="notification-count">{unread}</span>}</a><Avatar name={session.user.name} small /></div></header>{session.demo && <div className="demo-banner"><span><strong>Demo workspace</strong> · Sample data, with working team and report actions.</span><a href="/docs#production">Set up your workspace</a></div>}<main id="main" className="app-content" key={workspace.id + path}><Page {...context} reportId={match?.[1]} token={shareMatch?.[1]} /></main><footer className="app-footer"><span>Made for better software.</span><span>bugshaper <span className="muted">/</span> by Wrenyn</span></footer></div></div>;
}
function App() {
  const [session, setSession] = useState(null); const [error, setError] = useState(null);
  const shareMatch = path.match(/^\/share\/([a-f0-9]{64})$/i);
  useEffect(() => { api("/api/v1/session").then(data => { setCsrf(data.csrf); setSession(data); }).catch(setError); }, []);
  if (error) return <div className="boot-state"><ErrorNotice error={error} retry={() => location.reload()} /></div>;
  if (!session) return <Loading />;
  if (shareMatch) return <div className="workspace-app"><main id="main" className="app-content share-view"><ShareReportPage token={shareMatch[1]} /></main></div>;
  if (!session.user) return <Login session={session} />;
  if (path === "/invite") return <Invite session={session} />;
  if (path === "/login") { location.replace("/dashboard"); return <Loading />; }
  return <WorkspaceApp session={session} />;
}
createRoot(document.getElementById("root")).render(<App />);
