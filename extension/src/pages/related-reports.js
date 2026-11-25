import { getReport, listReports, relatedReportLimit, setReportLink } from "../lib/storage.js";

const byId = (id) => document.getElementById(id);
const titleFor = (report) => report.title || "Untitled capture";

export function mountRelatedReports(report) {
  const { id } = report;
  const list = byId("related-list");
  const empty = byId("related-empty");
  const feedback = byId("related-feedback");
  const picker = byId("related-picker");
  const form = byId("related-form");
  const query = form.elements.namedItem("query");
  const target = form.elements.namedItem("target");
  const submit = form.querySelector("button");
  const discoverable = byId("related-results");
  const date = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });
  let reports = [];
  let linked = new Set();
  let busy = true;

  function renderPicker() {
    const term = query.value.trim().toLowerCase();
    const matches = reports.filter((candidate) => !linked.has(candidate.id) &&
      [titleFor(candidate), candidate.project, candidate.origin, candidate.id].some((value) => value?.toLowerCase().includes(term)));
    const previous = target.value;
    const options = matches.slice(0, 30).map((candidate) =>
      new Option(titleFor(candidate) + " · " + date.format(candidate.createdAt) + " · " + candidate.id.slice(0, 8), candidate.id));
    target.replaceChildren(new Option("Choose a report", ""), ...options);
    target.value = options.some((option) => option.value === previous) ? previous : "";
    target.disabled = busy || !options.length;
    submit.disabled = busy || !target.value;
    discoverable.textContent = matches.length > options.length ? "Showing the 30 most recent matches." :
      options.length ? "" : "No available reports match.";
  }

  function renderLinks() {
    const relatedReports = reports.filter((candidate) => linked.has(candidate.id));
    list.replaceChildren(...relatedReports.map((candidate) => {
      const item = document.createElement("li");
      const link = document.createElement("a");
      link.textContent = titleFor(candidate);
      link.href = "#" + encodeURIComponent(candidate.id);
      const unlink = document.createElement("button");
      unlink.type = "button";
      unlink.className = "secondary";
      unlink.textContent = "Unlink";
      unlink.setAttribute("aria-label", "Unlink " + titleFor(candidate));
      unlink.onclick = () => change(candidate.id, false);
      item.append(link, unlink);
      return item;
    }));
    empty.hidden = relatedReports.length > 0;
    empty.textContent = reports.length ? "No related reports linked." : "Capture or import another report to link it here.";
    list.hidden = !relatedReports.length;
    picker.hidden = linked.size >= relatedReportLimit || !reports.some((candidate) => !linked.has(candidate.id));
  }

  async function refresh() {
    const [current, available] = await Promise.all([getReport(id), listReports()]);
    if (!current) throw new Error("This report was deleted.");
    reports = available.filter((candidate) => candidate.id !== id).sort((a, b) => b.createdAt - a.createdAt);
    linked = new Set(current.relatedReports ?? []);
    renderLinks();
  }

  async function change(relatedId, add) {
    if (busy || !relatedId) return;
    busy = true;
    feedback.textContent = "";
    for (const button of list.querySelectorAll("button")) button.disabled = true;
    renderPicker();
    try {
      const result = await setReportLink(id, relatedId, add);
      await refresh();
      if (result === "limit") throw new Error("One of these reports has reached the 30-link limit.");
      if (result !== "saved") throw new Error("This report is no longer available.");
      feedback.textContent = add ? "Reports linked." : "Reports unlinked.";
      if (add) {
        picker.open = false;
        form.reset();
      }
      byId("related-heading").focus();
    } catch (error) {
      feedback.textContent = error.message;
    } finally {
      busy = false;
      for (const button of list.querySelectorAll("button")) button.disabled = false;
      renderPicker();
    }
  }

  query.oninput = renderPicker;
  target.onchange = () => { submit.disabled = busy || !target.value; };
  form.onsubmit = (event) => {
    event.preventDefault();
    change(target.value, true);
  };
  refresh().catch(() => {
    empty.textContent = "Related reports could not be loaded.";
    picker.hidden = true;
  }).finally(() => {
    busy = false;
    renderPicker();
  });
}

