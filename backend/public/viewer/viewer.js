const access = document.querySelector("#access");
const comment = document.querySelector("#comment");
const status = document.querySelector("#status");
const report = document.querySelector("#report");
const discussion = document.querySelector("#discussion");
const investigation = document.querySelector("#investigation");
const analysisOutput = document.querySelector("#investigation-result");
const share = document.querySelector("#share");
const sharing = document.querySelector("#sharing");
const tokenField = document.querySelector("#share-token");
const tokenRow = document.querySelector("#share-token-row");
const shareResult = document.querySelector("#share-result");
const outputEvidence = document.querySelector("#investigation-evidence");
let evidenceRows = new Map();
let session;
const requestedId = new URLSearchParams(location.search).get("id") ?? "";
if (/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(requestedId)) access.elements.id.value = requestedId.toLowerCase();

async function request(path, token, body, method = body ? "POST" : "GET") {
  const response = await fetch(path, {
    method,
    headers: { authorization: "Bearer " + token, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined, redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed.");
  return data;
}

function items(selector, values) {
  const parent = document.querySelector(selector);
  parent.replaceChildren(...values.map((value) => {
    const item = document.createElement("li");
    item.textContent = value;
    return item;
  }));
}

function draw(data) {
  document.querySelector("#title").textContent = data.title || "Untitled report";
  const fields = { status: "Status", severity: "Severity", project: "Project", category: "Category", assignee: "Assignee", origin: "Origin", description: "Description",
    expected: "Expected", actual: "Actual", reproduction: "Steps to reproduce" };
  const details = document.querySelector("#details");
  details.replaceChildren();
  for (const [key, label] of Object.entries(fields)) {
    if (!data[key]) continue;
    const term = document.createElement("dt");
    term.textContent = label;
    const value = document.createElement("dd");
    value.textContent = data[key];
    details.append(term, value);
  }
  const timeline = document.querySelector("#timeline");
  timeline.replaceChildren();
  evidenceRows = new Map();
  for (const event of data.events) {
    const row = document.createElement("li");
    row.tabIndex = -1;
    row.textContent = [new Date(event.at).toISOString(), event.label, event.origin, event.status ? "HTTP " + event.status : null].filter(Boolean).join(" | ");
    const rows = evidenceRows.get(event.at) ?? [];
    rows.push(row);
    evidenceRows.set(event.at, rows);
    timeline.append(row);
  }
  if (!timeline.children.length) items("#timeline", ["No diagnostics were included."]);
}

async function refresh({ path, token }) {
  const { entries } = await request(path + "/discussion", token);
  items("#entries", entries.map(({ at, actor, kind, body }) => {
    const detail = kind === "comment" ? body.text + (body.at === undefined ? "" : " | Event at " + new Date(body.at).toISOString()) :
      "Edited " + body.fields.join(", ") + (body.to ? " | " + body.from + " to " + body.to : "");
    return new Date(at).toLocaleString() + " | " + actor + " | " + detail;
  }));
}

access.onsubmit = async (event) => {
  event.preventDefault();
  const button = access.querySelector("button");
  button.disabled = true;
  session = undefined;
  report.hidden = true;
  discussion.hidden = true;
  investigation.hidden = true;
  investigation.reset();
  outputEvidence.hidden = true;
  sharing.hidden = true;
  tokenRow.hidden = true;
  tokenField.value = "";
  shareResult.textContent = "";
  analysisOutput.textContent = "";
  status.textContent = "";
  try {
    const token = access.elements.namedItem("token").value.trim();
    const id = access.elements.namedItem("id").value.trim().toLowerCase();
    if (id && !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(id)) throw new Error("Enter a valid report ID.");
    const path = id ? "/v1/reports/" + id : "/v1/shared";
    const data = await request(path, token);
    draw(data.report);
    if (id) {
      await refresh({ path, token });
      session = { path, token };
      discussion.hidden = false;
      comment.hidden = !data.canComment;
      investigation.hidden = !data.canInvestigate;
      sharing.hidden = !data.canShare;
    }
    report.hidden = false;
    access.elements.namedItem("token").value = "";
  } catch (error) {
    status.textContent = error.message;
  } finally {
    button.disabled = false;
  }
};

comment.onsubmit = async (event) => {
  event.preventDefault();
  if (!session) return;
  const current = session;
  const button = comment.querySelector("button");
  button.disabled = true;
  status.textContent = "";
  try {
    await request(current.path + "/discussion", current.token, { text: comment.elements.namedItem("text").value });
    comment.reset();
    if (session === current) await refresh(current);
  } catch (error) {
    status.textContent = error.message;
  } finally {
    button.disabled = false;
  }
};


investigation.onsubmit = async (event) => {
  event.preventDefault();
  if (!session || !investigation.elements.namedItem("consent").checked) return;
  const current = session;
  const button = investigation.querySelector("button");
  button.disabled = true;
  outputEvidence.hidden = true;
  analysisOutput.textContent = "Investigating…";
  try {
    const { result } = await request(current.path + "/investigation", current.token, { consent: true });
    if (session !== current) return;
    document.querySelector("#ai-summary").textContent = result.summary;
    document.querySelector("#ai-check").textContent = result.nextCheck;
    const references = document.querySelector("#ai-references");
    references.replaceChildren();
    for (const at of new Set(result.evidenceAt)) {
      const rows = evidenceRows.get(at);
      if (!rows?.length) continue;
      const item = document.createElement("li");
      const link = document.createElement("button");
      link.type = "button";
      link.className = "secondary";
      link.textContent = "View event · " + new Date(at).toISOString();
      link.onclick = () => {
        document.querySelector("#timeline-panel").open = true;
        rows[0].focus();
      };
      item.append(link);
      references.append(item);
    }
    outputEvidence.hidden = false;
    analysisOutput.textContent = "Investigation ready.";
  } catch (error) {
    if (session === current) analysisOutput.textContent = error.message;
  } finally {
    button.disabled = false;
  }
};

async function changeShare(method, scope = "shares") {
  if (!session || sharing.hidden) return;
  const current = session;
  const buttons = [...share.querySelectorAll("button")];
  for (const button of buttons) button.disabled = true;
  tokenField.value = "";
  tokenRow.hidden = true;
  shareResult.textContent = method === "POST" ? "Creating token…" : "Revoking tokens…";
  try {
    const body = method === "POST" ? { ttlSeconds: Number(share.elements.namedItem("ttl").value) } : undefined;
    const response = await request(current.path + "/" + scope, current.token, body, method);
    if (current !== session) return;
    if (method === "POST") {
      document.querySelector("#share-token-label").textContent = scope === "shares"
        ? "Generated read-only token" : "Generated contributor token";
      tokenField.value = response.key;
      tokenRow.hidden = false;
      shareResult.textContent = "Token expires " + new Date(response.expiresAt).toLocaleString() + ".";
      tokenField.focus();
      tokenField.select();
    } else {
      shareResult.textContent = (scope === "shares" ? "Read-only" : "Contributor") + " tokens for this report were revoked.";
    }
  } catch (error) {
    if (current === session) shareResult.textContent = error.message;
  } finally {
    for (const button of buttons) button.disabled = false;
  }
}

share.onsubmit = (event) => {
  event.preventDefault();
  changeShare("POST");
};
document.querySelector("#revoke-share").onclick = () => {
  if (confirm("Revoke all read-only tokens for this report?")) changeShare("DELETE");
};
document.querySelector("#create-contributor").onclick = () => changeShare("POST", "contributors");
document.querySelector("#revoke-contributor").onclick = () => {
  if (confirm("Revoke all contributor tokens for this report?")) changeShare("DELETE", "contributors");
};
