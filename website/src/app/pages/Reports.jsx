import { useEffect, useState } from "react";
import { api, date, dateTime, download } from "../client.js";
import { ActionForm, Avatar, Badge, ConfirmButton, Empty, Icon, Modal, PageHead, Resource, useResource } from "../ui.jsx";
import { makeBundle, lifecycle } from "../../lib/bundle.js";
import { maxBundleBytes } from "../../lib/portable-media.js";

function syncUrl(query) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (!value) continue;
    if (key === "assignee" && value === "me") params.set("assignee", "me");
    else if (key === "unassigned" && value) params.set("assignee", "unassigned");
    else if (key !== "unassigned") params.set(key, value);
  }
  const next = params.toString() ? `/reports?${params}` : "/reports";
  if (next !== location.pathname + location.search) history.replaceState(null, "", next);
}

function readQuery(session) {
  const initial = new URLSearchParams(location.search);
  const assigneeParam = initial.get("assignee") || "";
  return {
    q: initial.get("q") || "",
    status: initial.get("status") || "",
    severity: initial.get("severity") || "",
    project: initial.get("project") || "",
    assignee: assigneeParam === "me" ? session.user.id : assigneeParam === "unassigned" ? "" : assigneeParam,
    unassigned: assigneeParam === "unassigned",
    preset: initial.get("preset") || "",
  };
}

export function ReportsTable({ reports, members = [], canWrite, endpoint, onChanged }) {
  async function patch(report, values) {
    await api(endpoint("reports/" + report.id), "PATCH", { revision: report.revision, ...values });
    onChanged?.();
  }
  return reports.length ? <div className="table-scroll"><table className="reports-table"><thead><tr><th>Report</th><th>Status</th><th>Severity</th><th>Assignee</th><th>Created</th></tr></thead><tbody>{reports.map(report => <tr key={report.id}><td><a className="report-title" href={"/reports/" + report.id}><span className="report-id">{report.id.slice(0, 8).toUpperCase()}</span><strong>{report.title || "Untitled report"}</strong></a><span className="table-project">{report.project || "No project"}</span></td><td>{canWrite ? <select className="inline-select" aria-label="Status" value={report.status} onChange={e => patch(report, { status: e.target.value })}>{lifecycle.map(s => <option key={s}>{s}</option>)}</select> : <Badge>{report.status}</Badge>}</td><td><Badge>{report.severity || "Unspecified"}</Badge></td><td>{canWrite ? <select className="inline-select" aria-label="Assignee" value={report.assigneeId || ""} onChange={e => patch(report, { assigneeId: e.target.value || null })}><option value="">Unassigned</option>{members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select> : report.assignee ? <span className="assignee"><Avatar name={report.assignee} small /><span>{report.assignee}</span></span> : <span className="muted">Unassigned</span>}</td><td className="nowrap muted">{date(report.createdAt)}</td></tr>)}</tbody></table></div> : <Empty icon="bug" title="No reports here yet">Create your first report, import a browser capture, or try a different filter.</Empty>;
}
function ReportFields({ report = {}, projects = [], members = [] }) {
  return <><label>Title<input name="title" defaultValue={report.title} maxLength={160} required placeholder="What went wrong?" autoFocus /></label><label>Description<textarea name="description" defaultValue={report.description} rows={4} maxLength={4000} placeholder="A clear description helps your team get to the fix." /></label><div className="form-grid"><label>Project<select name="projectId" defaultValue={report.projectId || ""}><option value="">No project</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label><label>Assignee<select name="assigneeId" defaultValue={report.assigneeId || ""}><option value="">Unassigned</option>{members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label><label>Status<select name="status" defaultValue={report.status || "Open"}>{lifecycle.map(s => <option key={s}>{s}</option>)}</select></label><label>Severity<select name="severity" defaultValue={report.severity || "Medium"}>{["Critical", "High", "Medium", "Low"].map(s => <option key={s}>{s}</option>)}</select></label><label>Priority<select name="priority" defaultValue={report.priority || "Normal"}>{["Urgent", "High", "Normal", "Low"].map(p => <option key={p}>{p}</option>)}</select></label></div><details><summary>Reproduction & expected behavior</summary><label>Reproduction steps<textarea name="reproduction" maxLength={4000} rows={3} defaultValue={report.reproduction} placeholder="1. Open…" /></label><label>Expected behavior<textarea name="expected" maxLength={4000} rows={2} defaultValue={report.expected} /></label><label>Actual behavior<textarea name="actual" maxLength={4000} rows={2} defaultValue={report.actual} /></label></details></>;
}
export function ReportsPage({ endpoint, canWrite, session }) {
  const [query, setQuery] = useState(() => readQuery(session));
  const [offset, setOffset] = useState(0); const [modal, setModal] = useState(new URLSearchParams(location.search).has("new") ? "new" : "");
  const [filterDraft, setFilterDraft] = useState(query.q);
  useEffect(() => {
    const fromHeader = new URLSearchParams(location.search).get("q");
    if (fromHeader != null && fromHeader !== query.q) {
      setFilterDraft(fromHeader);
      setQuery((current) => ({ ...current, q: fromHeader, preset: "" }));
      setOffset(0);
    }
  }, []);
  useEffect(() => {
    const urlQuery = {
      q: query.q,
      status: query.preset === "open" ? "" : query.status,
      severity: query.severity,
      project: query.project,
      assignee: query.preset === "mine" ? "me" : query.unassigned ? "unassigned" : (query.assignee === session.user.id ? "me" : query.assignee),
      preset: query.preset || "",
    };
    syncUrl(urlQuery);
  }, [query, session.user.id]);
  const listParams = {
    q: query.q,
    status: query.preset === "open" ? "" : query.status,
    severity: query.severity,
    project: query.project,
    assignee: query.preset === "mine" || query.assignee === session.user.id
      ? session.user.id
      : (query.unassigned || query.preset === "unassigned" ? "none" : query.assignee),
    open: query.preset === "open" ? "1" : "",
    offset,
  };
  const resource = useResource(endpoint("reports?") + new URLSearchParams(listParams), 0, 30000);
  const projects = useResource(endpoint("projects")); const members = useResource(endpoint("members"));
  function filter(patch) {
    setQuery((current) => ({ ...current, ...patch, preset: patch.preset === undefined ? "" : patch.preset }));
    setOffset(0);
  }
  function applyPreset(name) {
    if (name === "open") filter({ preset: "open", status: "", assignee: "", unassigned: false });
    else if (name === "unassigned") filter({ preset: "unassigned", status: "", assignee: "", unassigned: true });
    else if (name === "mine") filter({ preset: "mine", status: "", assignee: session.user.id, unassigned: false });
    else filter({ preset: "", status: "", assignee: "", unassigned: false });
  }
  return <><PageHead eyebrow="FROM FIRST SIGNAL TO VERIFIED FIX" title="Reports" description="All the context. A clear owner. One place to move work forward.">{canWrite && <><button className="secondary" onClick={() => setModal("import")}><Icon name="upload" size={18} />Import capture</button><button onClick={() => setModal("new")}><Icon name="plus" size={18} />New report</button></>}</PageHead><div className="report-tabs"><button className={!query.preset && !query.assignee && !query.unassigned ? "selected" : ""} onClick={() => applyPreset("")}>All reports</button><button className={query.preset === "open" ? "selected" : ""} onClick={() => applyPreset("open")}>Open</button><button className={query.unassigned || query.preset === "unassigned" ? "selected" : ""} onClick={() => applyPreset("unassigned")}>Unassigned</button><button className={query.preset === "mine" || query.assignee === session.user.id ? "selected" : ""} onClick={() => applyPreset("mine")}>Assigned to me</button><span className="muted">{resource.data?.total ?? "…"} reports</span></div><section className="panel"><div className="filter-bar"><form className="filter-search" onSubmit={e => { e.preventDefault(); filter({ q: filterDraft }); }}><Icon name="search" size={18} /><input aria-label="Search reports" placeholder="Search reports…" value={filterDraft} onChange={e => setFilterDraft(e.target.value)} maxLength={160} /><button className="secondary">Search</button></form><label className="filter-select"><span className="sr-only">Status</span><select value={query.preset === "open" ? "" : query.status} onChange={e => filter({ status: e.target.value, preset: "" })}><option value="">All statuses</option>{lifecycle.map(s => <option key={s}>{s}</option>)}</select></label><label className="filter-select"><span className="sr-only">Severity</span><select value={query.severity} onChange={e => filter({ severity: e.target.value })}><option value="">All severities</option>{["Critical", "High", "Medium", "Low"].map(s => <option key={s}>{s}</option>)}</select></label><label className="filter-select"><span className="sr-only">Project</span><select value={query.project} onChange={e => filter({ project: e.target.value })}><option value="">All projects</option>{projects.data?.projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label></div><Resource resource={resource}>{data => <><ReportsTable reports={data.reports} members={members.data?.members} canWrite={canWrite} endpoint={endpoint} onChanged={resource.reload} /><div className="pagination"><span>{data.total ? `${data.offset + 1}–${data.offset + data.reports.length} of ${data.total}` : "0 reports"}</span><div><button className="secondary" disabled={!offset} onClick={() => setOffset(Math.max(0, offset - 25))}>Previous</button><button className="secondary" disabled={data.nextOffset === null} onClick={() => setOffset(data.nextOffset)}>Next</button></div></div></>}</Resource></section>{modal === "new" && <Modal title="Create a report" wide onClose={() => setModal("")}><ActionForm label="Create report" disabled={projects.loading || members.loading || Boolean(projects.error || members.error)} onSubmit={async values => { const result = await api(endpoint("reports"), "POST", values); location.assign("/reports/" + result.report.id); }}><ReportFields projects={projects.data?.projects} members={members.data?.members} />{(projects.error || members.error) && <p className="form-error">Could not load projects or members. Close this dialog and refresh.</p>}</ActionForm></Modal>}{modal === "import" && <Modal title="Import a browser capture" onClose={() => setModal("")}><ActionForm label="Import report" onSubmit={async (_, form) => { const file = form.elements.bundle.files[0]; if (file.size > maxBundleBytes) throw new Error("Choose a bundle under 41 MB."); const result = await api(endpoint("submissions"), "POST", JSON.parse(await file.text())); location.assign("/reports/" + result.id); }}><p className="muted">Export a Bugshaper bundle from the extension. Report text, sanitized diagnostics, and selected attachments will be shared with this workspace.</p><label>Bugshaper JSON bundle<input type="file" name="bundle" accept=".json,application/json" required /></label></ActionForm></Modal>}</>;
}
export function ReportPage({ endpoint, reportId, canWrite, canManage, session }) {
  const resource = useResource(endpoint("reports/" + reportId));
  const comments = useResource(endpoint("reports/" + reportId + "/comments"), 0, 30000);
  const shares = useResource(endpoint("shares?reportId=" + reportId));
  const projects = useResource(endpoint("projects")); const members = useResource(endpoint("members"));
  const [edit, setEdit] = useState(false); const [tab, setTab] = useState("overview"); const [notice, setNotice] = useState("");
  const [shareModal, setShareModal] = useState(false); const [createdShare, setCreatedShare] = useState(null);
  return <><a href="/reports" className="back-link">All reports</a><Resource resource={resource}>{data => { const report = data.report; return <><PageHead eyebrow={"REPORT / " + report.id.slice(0, 8).toUpperCase()} title={report.title || "Untitled report"}><button className="secondary" onClick={() => setShareModal(true)}><Icon name="users" size={18} />Share</button><button className="secondary" onClick={async () => { try { download("bugshaper-" + report.id.slice(0, 8) + ".json", JSON.stringify(await makeBundle(report), null, 2), "application/json"); } catch (e) { setNotice(e.message); } }}><Icon name="download" size={18} />Export metadata</button>{canWrite && <button onClick={() => setEdit(true)}>Edit report</button>}</PageHead>{notice && <p className="form-error" role="status">{notice}</p>}<div className="detail-tags"><Badge>{report.status}</Badge><Badge>{report.severity || "Unspecified"}</Badge><span className="muted">Created {dateTime(report.createdAt)}</span><button className="text-button" onClick={resource.reload}>Refresh</button></div><div className="detail-grid"><section><div className="report-tabs" role="tablist" aria-label="Report sections">{["overview", "evidence", "discussion"].map(t => <button key={t} className={tab === t ? "selected" : ""} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>{t[0].toUpperCase() + t.slice(1)}{t === "discussion" && comments.data ? ` (${comments.data.comments.length})` : ""}</button>)}</div>{tab === "overview" && <article className="panel report-body">{[["Description", report.description], ["Reproduction steps", report.reproduction], ["Expected behavior", report.expected], ["Actual behavior", report.actual]].map(([heading, content]) => <section key={heading}><h2>{heading}</h2><p className="preserve-lines">{content || "No details added yet."}</p></section>)}</article>}{tab === "evidence" && <section className="panel report-body"><h2>Captured evidence</h2>{data.artifacts.map(kind => <div className="artifact" key={kind}>{kind === "screenshot" ? <img src={endpoint(`reports/${reportId}/screenshot`)} alt="Screenshot captured with this report" /> : <video controls preload="metadata" src={endpoint(`reports/${reportId}/video`)} />}<a href={endpoint(`reports/${reportId}/${kind}`)} download>Download {kind}</a></div>)}{report.events.length ? <ol className="evidence-list">{report.events.map((event, i) => <li key={i}><Badge>{event.kind}</Badge><time>{dateTime(event.at)}</time><pre>{JSON.stringify(event, null, 2)}</pre></li>)}</ol> : !data.artifacts.length && <Empty icon="bug" title="No capture attached">Import a browser capture to include sanitized diagnostics, screenshots, or recording evidence.</Empty>}</section>}{tab === "discussion" && <section className="panel report-body"><h2>Keep the conversation in context</h2><Resource resource={comments}>{result => result.comments.length ? <ol className="comments">{result.comments.map(c => <li key={c.id}><Avatar name={c.author || "Former member"} /><div><strong>{c.author || "Former member"}</strong><time>{dateTime(c.created_at)}</time><p className="preserve-lines">{c.body}</p></div></li>)}</ol> : <Empty icon="message" title="Start a conversation">Add what you found, ask a question, or leave a verification note.</Empty>}</Resource>{canWrite && <ActionForm label="Post comment" onSubmit={async (values, form) => { await api(endpoint(`reports/${reportId}/comments`), "POST", values); form.reset(); comments.reload(); }}><label>Add a comment<textarea name="text" rows={4} maxLength={4000} required placeholder="Share an update with your team…" /></label></ActionForm>}</section>}</section><aside className="panel report-properties"><h2>Report properties</h2><dl><dt>Project</dt><dd>{report.project || "No project"}</dd><dt>Assignee</dt><dd>{report.assignee ? <span className="assignee"><Avatar name={report.assignee} small />{report.assignee}</span> : "Unassigned"}</dd><dt>Priority</dt><dd>{report.priority || "Normal"}</dd><dt>Reported by</dt><dd>{members.data?.members.find(m => m.id === report.authorId)?.name || "Workspace member"}</dd><dt>Last updated</dt><dd>{dateTime(report.updatedAt)}</dd><dt>Source</dt><dd>{report.origin || "Manual report"}</dd></dl>{canManage && <ConfirmButton message="Delete this report and its comments and attachments? This cannot be undone." onConfirm={async () => { await api(endpoint("reports/" + reportId), "DELETE"); location.assign("/reports"); }}>Delete report</ConfirmButton>}</aside></div>{edit && <Modal title="Edit report" wide onClose={() => setEdit(false)}><ActionForm label="Save report" disabled={projects.loading || members.loading || Boolean(projects.error || members.error)} onSubmit={async values => { await api(endpoint("reports/" + reportId), "PATCH", { ...values, revision: report.revision }); setEdit(false); resource.reload(); }}><ReportFields report={report} projects={projects.data?.projects} members={members.data?.members} /></ActionForm></Modal>}{shareModal && <Modal title="Share this report" onClose={() => { setShareModal(false); setCreatedShare(null); }}><p className="muted">Anyone with the link can view report metadata until the link expires. No workspace sign-in required.</p>{createdShare && <label>Share link<input readOnly value={location.origin + createdShare.url} onFocus={e => e.target.select()} /><p className="success">Expires {dateTime(createdShare.expiresAt)}</p></label>}{canWrite && <ActionForm label="Create link" onSubmit={async values => { const result = await api(endpoint("shares"), "POST", { reportId, ttlSeconds: Number(values.ttlSeconds) }); setCreatedShare(result); shares.reload(); }}><label>Lifetime<select name="ttlSeconds" defaultValue="86400"><option value="3600">1 hour</option><option value="86400">1 day</option><option value="604800">7 days</option></select></label></ActionForm>}<Resource resource={shares}>{data => data.shares?.length ? <ul className="share-list">{data.shares.map(share => <li key={share.id}><span>Expires {dateTime(share.expires_at)}</span>{canWrite && <ConfirmButton message="Revoke this share link?" onConfirm={async () => { await api(endpoint("shares/" + share.id), "DELETE"); shares.reload(); }}>Revoke</ConfirmButton>}</li>)}</ul> : <p className="muted">No active share links.</p>}</Resource></Modal>}</>; }}</Resource></>;
}

export function ShareReportPage({ token: tokenProp }) {
  const token = tokenProp || location.pathname.split("/")[2] || "";
  const [state, setState] = useState({ loading: true, error: "", report: null, expiresAt: null });
  useEffect(() => {
    fetch("/api/v1/shared/" + token, { headers: { accept: "application/json" } })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || "Share unavailable.");
        setState({ loading: false, error: "", report: data.report, expiresAt: data.expiresAt });
      })
      .catch((error) => setState({ loading: false, error: error.message, report: null, expiresAt: null }));
  }, [token]);
  if (state.loading) return <div className="boot-state"><p className="muted">Opening shared report…</p></div>;
  if (state.error) return <div className="boot-state"><p className="form-error" role="alert">{state.error}</p><a className="button" href="/login">Sign in</a></div>;
  const report = state.report;
  return <div className="invite-page"><a className="brand" href="/"><img src="/brand/mark.svg" width="32" height="32" alt="" />bugshaper</a><section className="auth-card" style={{ maxWidth: 720, textAlign: "left" }}><p className="eyebrow">SHARED REPORT</p><h1>{report.title || "Untitled report"}</h1><div className="detail-tags"><Badge>{report.status}</Badge><Badge>{report.severity || "Unspecified"}</Badge>{state.expiresAt && <span className="muted">Link expires {dateTime(state.expiresAt)}</span>}</div><p className="preserve-lines">{report.description || "No description."}</p><h2>Reproduction</h2><p className="preserve-lines">{report.reproduction || "—"}</p><h2>Expected</h2><p className="preserve-lines">{report.expected || "—"}</p><h2>Actual</h2><p className="preserve-lines">{report.actual || "—"}</p></section></div>;
}
