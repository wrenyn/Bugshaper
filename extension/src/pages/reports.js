import { mountPreferences } from "./preferences.js";
import { mountReplay } from "./replay.js";
import { mountVerification } from "./verification.js";
import { lifecycle } from "../lib/bundle.js";
import { mountExport, mountImport } from "./report-files.js";
import { mountEditor } from "./editor.js";
import { mountDiagnostics } from "./report-diagnostics.js";
import { mountRelatedReports } from "./related-reports.js";
import { mountReportDivider } from "./report-divider.js";
import { deleteReport, getReport, listReports, updateNotes, updateReportStatuses } from "../lib/storage.js";

const select = (id) => document.getElementById(id);
const status = select("status");
const time = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
const id = location.hash.slice(1);
// Local mini-workspace pages are retired; drafts + detail remain.
if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) {
  location.replace(chrome.runtime.getURL("src/pages/drafts.html"));
  throw new Error("Redirecting to local drafts.");
}
const pages = ["overview", "projects", "integrations", "settings"];
const page = pages.includes(id) ? id : "reports";
document.querySelector(`[data-page="${page}"]`)?.setAttribute("aria-current", "page");
const make = (tag, text) => Object.assign(document.createElement(tag), { textContent: text });

function captureType(report) {
  return report.element ? "Element" : report.video ? "Recording" : report.screenshot ? "Screenshot" : "Metadata";
}

async function renderList() {
  status.textContent = "Loading reports…";
  const reports = await listReports();
  status.textContent = "";
  const search = select("report-search");
  const sort = select("sort-date");
  const filters = { status: select("filter-status"), project: select("filter-project"), capture: select("filter-type"),
    severity: select("filter-severity"), assignee: select("filter-assignee"), category: select("filter-category") };
  let data = reports.map((report) => ({ ...report, capture: captureType(report), project: report.project || report.origin }));
  for (const [key, field] of Object.entries(filters)) {
    if (key === "capture") continue;
    const values = key === "status" ? lifecycle : [...new Set(data.map((report) => report[key]).filter(Boolean))].sort();
    for (const value of values) field.add(new Option(value, value));
  }
  const list = select("reports");
  const previous = select("previous");
  const next = select("next");
  const bulk = select("bulk-status");
  const pageSelection = select("select-page");
  const batchStatus = select("batch-status");
  const apply = bulk.querySelector("button");
  const feedback = select("bulk-feedback");
  const count = select("selection-count");
  const selected = new Set();
  let visibleChecks = [];
  let busy = false;
  for (const value of lifecycle) batchStatus.add(new Option(value, value));
  const size = 15;
  let index = 0;

  function renderSelection() {
    let pageCount = 0;
    for (const checkbox of visibleChecks) {
      checkbox.checked = selected.has(checkbox.value);
      checkbox.disabled = busy;
      if (checkbox.checked) pageCount++;
    }
    pageSelection.disabled = busy || !visibleChecks.length;
    pageSelection.checked = pageCount > 0 && pageCount === visibleChecks.length;
    pageSelection.indeterminate = pageCount > 0 && pageCount < visibleChecks.length;
    count.textContent = selected.size + " selected";
    batchStatus.disabled = busy || !selected.size;
    apply.disabled = batchStatus.disabled || !batchStatus.value;
  }

  function render() {
    const term = search.value.trim().toLowerCase();
    const matches = data.filter((report) => {
      const values = [report.title, report.origin, report.status, report.project, report.assignee, report.category, report.severity];
      return (!term || values.some((value) => value?.toLowerCase().includes(term))) &&
        Object.entries(filters).every(([key, field]) => !field.value || report[key] === field.value);
    }).sort((left, right) => sort.value === "asc" ? left.createdAt - right.createdAt : right.createdAt - left.createdAt);
    const pages = Math.max(1, Math.ceil(matches.length / size));
    index = Math.min(index, pages - 1);
    list.replaceChildren();
    visibleChecks = [];
    for (const report of matches.slice(index * size, (index + 1) * size)) {
      const row = make("tr", "");
      const link = make("a", report.title || "Untitled capture");
      link.href = "#" + encodeURIComponent(report.id);
      const checkbox = make("input", "");
      checkbox.type = "checkbox";
      checkbox.value = report.id;
      checkbox.setAttribute("aria-label", "Select " + link.textContent);
      checkbox.onchange = () => {
        if (checkbox.checked) selected.add(report.id);
        else selected.delete(report.id);
        renderSelection();
      };
      visibleChecks.push(checkbox);
      const values = [checkbox, link, report.status, report.severity, report.project, report.category, report.assignee, report.capture, time.format(report.createdAt)];
      for (const [column, value] of values.entries()) {
        const cell = make("td", "");
        cell.dataset.label = ["Select", "Report", "Status", "Severity", "Project", "Category", "Assignee", "Capture", "Created"][column];
        cell.append(value || "—");
        row.append(cell);
      }
      list.append(row);
    }
    select("list-empty").textContent = matches.length ? "" : data.length
      ? "No reports match these filters." : "Capture a screenshot from the Bugshaper popup to create your first report.";
    select("page-count").textContent = "Page " + (index + 1) + " of " + pages;
    previous.disabled = index === 0;
    next.disabled = index + 1 >= pages;
    bulk.hidden = !matches.length;
    renderSelection();
  }
  const reset = () => {
    selected.clear();
    batchStatus.value = "";
    feedback.textContent = "";
    index = 0;
    render();
  };
  search.oninput = reset;
  sort.onchange = () => { index = 0; render(); };
  for (const field of Object.values(filters)) field.onchange = reset;
  previous.onclick = () => { index--; render(); };
  next.onclick = () => { index++; render(); };
  pageSelection.onchange = () => {
    for (const checkbox of visibleChecks) {
      if (pageSelection.checked) selected.add(checkbox.value);
      else selected.delete(checkbox.value);
    }
    renderSelection();
  };
  batchStatus.onchange = renderSelection;
  bulk.onsubmit = async (event) => {
    event.preventDefault();
    if (busy || !selected.size || !batchStatus.value) return;
    busy = true;
    const ids = [...selected];
    const nextStatus = batchStatus.value;
    renderSelection();
    try {
      const { updated, unchanged, missing } = await updateReportStatuses(ids, nextStatus);
      const selectedIds = new Set(ids);
      const missingIds = new Set(missing);
      data = data.filter((report) => !missingIds.has(report.id));
      for (const report of data) if (selectedIds.has(report.id)) report.status = nextStatus;
      selected.clear();
      batchStatus.value = "";
      feedback.textContent = [updated.length + " updated.", unchanged && (unchanged + " already had this status."),
        missing.length && (missing.length + " no longer available.")].filter(Boolean).join(" ");
      feedback.focus();
    } catch (error) {
      feedback.textContent = error.message;
    } finally {
      busy = false;
      render();
    }
  };
  select("list-controls").hidden = select("report-list").hidden = false;
  mountImport(status);
  render();
}

async function renderWorkspace() {
  const target = select("workspace-page");
  select("heading").textContent = page[0].toUpperCase() + page.slice(1);
  target.hidden = false;
  if (page === "overview" || page === "projects") {
    target.textContent = "Loading reports…";
    const reports = await listReports();
    target.replaceChildren();
    if (page === "overview") {
      target.append(make("h2", reports.length + " local reports"),
        make("p", reports.filter((report) => report.status === "Open").length + " open"));
    } else {
      const groups = new Map();
      for (const report of reports) {
        const key = report.project || report.origin || "Unassigned";
        groups.set(key, (groups.get(key) ?? 0) + 1);
      }
      target.append(make("h2", "Report groups"));
      const list = make("ul", "");
      for (const [name, count] of groups) list.append(make("li", name + " · " + count + " reports"));
      target.append(groups.size ? list : make("p", "Projects appear here after you add a project name to a report or capture a page."));
    }
    const link = make("a", "Browse reports");
    link.href = "src/pages/reports.html";
    target.append(link);
  }
  if (page === "integrations") {
    target.append(make("h2", "CLI and MCP"), make("p", "Export report metadata from the report page, import it with the Bugshaper CLI, and configure an MCP client with a read-only credential."),
      make("pre", "node cli/cli.mjs import report.json\nnode cli/mcp.mjs"));
  }
  if (page === "settings") {
    target.append(make("h2", "Replay preferences"));
    mountPreferences(target);
    target.append(make("h2", "Capture and privacy"),
      make("p", "Diagnostics start only when you turn them on in the popup. Reports stay in this Chrome profile. Screenshots and recordings may contain text and fields visible on the page."),
      make("h2", "Storage"), make("p", "Use each report’s actions to export metadata or delete its local capture."),
      make("h2", "Recording"), make("p", "Tab recordings contain video and stop after 60 seconds."));
  }
}

async function renderReport() {
  status.textContent = "Loading capture…";
  const report = await getReport(id);
  status.textContent = "";
  if (!report) {
    status.textContent = "This report could not be found.";
    return;
  }
  select("detail").hidden = false;
  mountReportDivider(select("report-divider"));
  select("report-navigation").hidden = false;
  select("open-export").onclick = () => select("report-actions-heading").focus();
  const heading = select("heading");
  const metadata = select("report-meta");
  function updateHeader(details) {
    heading.textContent = details.title || "Untitled capture";
    metadata.textContent = [details.status || "Open", details.severity && details.severity + " severity",
      details.project || report.origin, captureType(report)].filter(Boolean).join(" · ");
    metadata.hidden = false;
  }
  updateHeader(report);
  select("report-id").textContent = "Report " + report.id;
  let refreshScreenshot;
  for (const [blob, section, media, download] of [
    [report.screenshot, "shot-section", "shot", "download"],
    [report.video, "video-section", "video", "video-download"],
  ]) {
    if (!blob) continue;
    select(section).hidden = false;
    let url;
    const show = (data) => {
      if (url) URL.revokeObjectURL(url);
      url = URL.createObjectURL(data);
      select(media).src = url;
      select(download).href = url;
    };
    show(blob);
    if (media === "shot") refreshScreenshot = show;
    addEventListener("pagehide", (event) => {
      if (!event.persisted) URL.revokeObjectURL(url);
    });
  }
  mountEditor(report, select("editor-status"), refreshScreenshot);
  mountVerification(report, status);
  mountRelatedReports(report);
  mountDiagnostics(report, mountReplay(report), status, report.video ? select("video") : null);

  const form = select("notes");
  const fields = ["title", "description", "expected", "actual", "reproduction", "status", "project", "severity", "assignee", "category"];
  const state = form.elements.namedItem("status");
  for (const label of lifecycle) state.add(new Option(label, label));
  mountExport(report, getReport, status);
  for (const field of fields) form.elements.namedItem(field).value = report[field] ?? (field === "status" ? "Open" : "");
  const submit = form.querySelector("button");
  const remove = select("delete");
  function setBusy(busy) {
    submit.disabled = busy;
    remove.disabled = busy;
  }
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    setBusy(true);
    try {
      const notes = Object.fromEntries(fields.map((field) => [field, form.elements.namedItem(field).value.trim()]));
      if (!(await updateNotes(id, notes))) throw new Error("This report was deleted.");
      updateHeader(notes);
      status.textContent = "Report details saved.";
    } catch (error) {
      status.textContent = error.message;
    } finally {
      setBusy(false);
    }
  });
  remove.addEventListener("click", async () => {
    if (!confirm("Delete this local report and its media?")) return;
    setBusy(true);
    try {
      await deleteReport(id);
      location.replace("src/pages/reports.html");
    } catch (error) {
      status.textContent = error.message;
      setBusy(false);
    }
  });
}

document.querySelector(".skip-link").onclick = (event) => {
  event.preventDefault();
  select("workspace").focus();
};
addEventListener("hashchange", () => location.reload());
(page !== "reports" ? renderWorkspace() : id && id !== "workspace" ? renderReport() : renderList()).catch((error) => {
  status.textContent = error.message;
});

