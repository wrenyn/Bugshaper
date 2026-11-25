import { openWorkspace } from "../capture/account.js";
import { deleteReport, getReport, listReports, saveReport } from "../lib/storage.js";
import { submitReportToWorkspace } from "../capture/submit.js";
import { trimVideoBlob } from "../capture/trim.js";

const status = document.querySelector("#status");
const body = document.querySelector("#drafts");
const empty = document.querySelector("#empty");
const time = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

function label(report) {
  return report.title || (report.video ? "Untitled recording" : report.screenshot ? "Untitled screenshot" : "Untitled capture");
}

function uploadLabel(report) {
  if (report.uploadStatus === "uploaded") return "Uploaded";
  if (report.uploadStatus === "uploading") return "Uploading…";
  if (report.uploadStatus === "failed") return report.uploadError || "Failed";
  return "Not uploaded";
}

function trimControls(report, actions) {
  const wrap = document.createElement("div");
  wrap.className = "trim-controls";
  const start = Object.assign(document.createElement("input"), {
    type: "number", min: "0", step: "0.5", value: "0", title: "Start seconds", "aria-label": "Trim start seconds",
  });
  const end = Object.assign(document.createElement("input"), {
    type: "number", min: "0", step: "0.5", value: "", placeholder: "end", title: "End seconds (empty = full length)", "aria-label": "Trim end seconds",
  });
  const apply = document.createElement("button");
  apply.type = "button";
  apply.className = "secondary";
  apply.textContent = "Trim & save";
  apply.onclick = async () => {
    apply.disabled = true;
    status.textContent = "Trimming recording…";
    try {
      const full = await getReport(report.id);
      if (!full?.video) throw new Error("Recording draft missing.");
      const startMs = Math.max(0, Number(start.value) || 0) * 1000;
      const endMs = end.value === "" ? undefined : Math.max(0, Number(end.value) || 0) * 1000;
      if (endMs != null && endMs <= startMs) throw new Error("End must be after start.");
      const clipped = await trimVideoBlob(full.video, { startMs, endMs });
      await saveReport({ ...full, video: clipped });
      status.textContent = "Trimmed clip saved. You can upload it now.";
      await render();
    } catch (error) {
      status.textContent = error.message;
      apply.disabled = false;
    }
  };
  wrap.append(start, document.createTextNode("→"), end, apply);
  actions.append(wrap);
}

async function render() {
  status.textContent = "Loading drafts…";
  const reports = (await listReports()).sort((a, b) => b.createdAt - a.createdAt);
  body.replaceChildren();
  empty.hidden = reports.length > 0;
  status.textContent = "";
  for (const report of reports) {
    const row = document.createElement("tr");
    const title = document.createElement("td");
    const link = document.createElement("a");
    link.href = chrome.runtime.getURL("src/pages/reports.html") + "#" + encodeURIComponent(report.id);
    link.textContent = label(report);
    title.append(link);
    if (report.origin) {
      const origin = document.createElement("div");
      origin.className = "muted";
      origin.textContent = report.origin;
      title.append(origin);
    }
    const upload = document.createElement("td");
    upload.textContent = uploadLabel(report);
    if (report.uploadStatus === "failed") upload.className = "form-error";
    if (report.uploadStatus === "uploaded") upload.className = "muted";
    const created = document.createElement("td");
    created.className = "nowrap muted";
    created.textContent = time.format(report.createdAt);
    const actions = document.createElement("td");
    actions.className = "button-row drafts-actions";
    if (report.uploadStatus !== "uploaded") {
      if (report.video) trimControls(report, actions);
      const retry = document.createElement("button");
      retry.type = "button";
      retry.className = "secondary";
      retry.textContent = report.uploadStatus === "failed" ? "Retry upload" : "Upload";
      retry.onclick = async () => {
        retry.disabled = true;
        status.textContent = "Uploading “" + label(report) + "”…";
        try {
          const full = await getReport(report.id);
          if (!full) throw new Error("Draft was deleted.");
          const result = await submitReportToWorkspace(full, {
            open: false,
            onProgress: (message) => { status.textContent = message; },
          });
          status.textContent = "Uploaded. Opening workspace…";
          await openWorkspace("/reports/" + result.id);
          await render();
        } catch (error) {
          status.textContent = error.message;
          await render();
        }
      };
      actions.append(retry);
    } else {
      const open = document.createElement("button");
      open.type = "button";
      open.className = "secondary";
      open.textContent = "Open in workspace";
      open.onclick = () => openWorkspace("/reports/" + report.id);
      actions.append(open);
    }
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "secondary danger";
    remove.textContent = "Delete";
    remove.onclick = async () => {
      if (!confirm("Delete this local draft?")) return;
      await deleteReport(report.id);
      await render();
    };
    actions.append(remove);
    row.append(title, upload, created, actions);
    body.append(row);
  }
}

document.querySelector("#refresh").onclick = () => render();
document.querySelector("#open-workspace").onclick = () => openWorkspace("/dashboard");
render().catch((error) => { status.textContent = error.message; });
