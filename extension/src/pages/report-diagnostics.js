const select = (id) => document.getElementById(id);
const make = (tag, text) => Object.assign(document.createElement(tag), { textContent: text });
const labels = { interaction: "Interaction", exception: "Exception", console: "Console", network: "Network", performance: "Performance" };

function addPairs(list, pairs) {
  for (const [label, value] of pairs) {
    if (value == null || value === "") continue;
    list.append(make("dt", label), make("dd", String(value)));
  }
}

function boundsText(bounds) {
  if (!bounds) return "";
  const number = (value) => Number(value).toFixed(1).replace(/\.0$/, "");
  return `x ${number(bounds.x)} · y ${number(bounds.y)} · ${number(bounds.width)} × ${number(bounds.height)} px`;
}

function copyButton(label, value, notice) {
  const button = make("button", label);
  button.className = "secondary";
  button.onclick = async () => {
    try {
      await navigator.clipboard.writeText(value);
      notice.textContent = "Copied to clipboard.";
    } catch {
      notice.textContent = "Clipboard access is unavailable.";
    }
  };
  return button;
}

function treeView(ancestry, descendants) {
  const panel = make("details", "");
  panel.className = "element-tree";
  const label = make("label", "Search captured DOM tags");
  const search = make("input", "");
  search.type = "search";
  label.append(search);
  const feedback = make("p", "");
  feedback.className = "muted";
  feedback.setAttribute("role", "status");
  const list = make("ul", "");
  const selectedDepth = ancestry.length - 1;
  const nodes = ancestry.map((tag, depth) => ({ tag, depth, selected: depth === selectedDepth }));
  nodes.push(...descendants.map(({ tag, depth }) => ({ tag, depth: selectedDepth + depth })));
  function render() {
    const term = search.value.trim().toLowerCase();
    const matches = nodes.filter(({ tag }) => tag.toLowerCase().includes(term));
    list.replaceChildren(...matches.map(({ tag, depth, selected }) => {
      const row = make("li", "");
      row.style.setProperty("--node-depth", String(Math.min(depth, 7)));
      row.append(make("code", tag));
      if (selected) row.append(make("span", "Selected element"));
      return row;
    }));
    feedback.textContent = matches.length ? matches.length + (matches.length === 1 ? " tag" : " tags") : "No captured tags match your search.";
  }
  search.addEventListener("input", render);
  panel.append(make("summary", "Captured DOM tree"), label, feedback, list);
  render();
  return panel;
}

function viewElement(element) {
  const target = select("element");
  if (!element) {
    target.append(make("p", "No element was selected for this capture."));
    return;
  }
  const ancestry = [...(element.ancestry ?? [])].reverse().concat(element.tag);
  const style = element.styles ?? {};
  const locator = ancestry.join(" > ");
  const styleText = Object.entries(style).map(([property, value]) => property + ": " + value + ";").join("\n");
  const list = make("dl", "");
  addPairs(list, [["DOM ancestry", ancestry.join(" › ")], ["Bounds", boundsText(element.bounds)],
    ["Parent", [element.parent?.tag, boundsText(element.parent?.bounds), element.parent?.styles?.display].filter(Boolean).join(" · ")],
    ["Viewport", element.viewport && element.viewport.width + " × " + element.viewport.height + " px"],
    ["Position", style.position], ["Overflow", [style["overflow-x"], style["overflow-y"]].filter(Boolean).join(" / ")]]);
  const box = make("div", "Margin · " + (style.margin || "Unknown"));
  box.className = "box-model";
  const border = make("div", "Border · " + (style.border || "Unknown"));
  const padding = make("div", "Padding · " + (style.padding || "Unknown"));
  padding.append(make("div", "CSS size · " + [style.width, style.height].filter(Boolean).join(" × ")));
  border.append(padding);
  box.append(border);
  target.append(make("h3", element.tag), list, box);
  for (const anomaly of element.anomalies ?? []) target.append(make("p", anomaly));
  const controls = make("div", "");
  controls.className = "button-row";
  const feedback = make("p", "");
  feedback.className = "notice";
  feedback.setAttribute("role", "status");
  if (element.selector) {
    const selector = make("section", "");
    selector.className = "captured-selector";
    selector.append(make("h4", "Captured selector"), make("pre", element.selector),
      make("p", "Matched one element at capture. Page structure changes can change the match."));
    target.append(selector);
    controls.append(copyButton("Copy selector", element.selector, feedback));
  } else {
    controls.append(copyButton("Copy tag path", locator, feedback));
  }
  target.append(treeView(ancestry, element.descendants ?? []));
  if (styleText) controls.append(copyButton("Copy computed styles", styleText, feedback));
  const styles = make("details", "");
  styles.append(make("summary", "Computed styles"), make("pre", styleText));
  target.append(styles, controls, feedback);
}

function networkTable(requests, notice) {
  const wrap = make("div", "");
  wrap.className = "table-scroll network-table";
  const table = make("table", "");
  const head = table.createTHead().insertRow();
  const fields = ["Request origin", "Status", "Resource type", "Duration", "Transferred"];
  for (const label of fields) {
    const cell = make("th", label);
    cell.scope = "col";
    head.append(cell);
  }
  const body = table.createTBody();
  for (const event of requests) {
    const row = body.insertRow();
    const details = make("details", "");
    const summary = make("summary", event.origin || "Unknown origin");
    const size = event.transferBytes == null ? "" : event.transferBytes.toLocaleString() + " B";
    const duration = event.duration == null ? "" : event.duration + " ms";
    const time = new Date(event.at).toISOString();
    const metadata = make("dl", "");
    addPairs(metadata, [["Started", time], ["Initiator type", event.resourceType]]);
    details.append(summary, metadata, copyButton("Copy request details",
      [event.origin, event.status && "HTTP " + event.status, event.resourceType, duration, size, time].filter(Boolean).join("\n"), notice));
    const values = [details, event.status, event.resourceType, duration, size];
    for (const [index, value] of values.entries()) {
      const cell = row.insertCell();
      cell.dataset.label = fields[index];
      cell.append(value || "Unavailable");
      if (index === 1 && event.status >= 400) cell.className = "failed";
    }
  }
  wrap.append(table);
  const note = make("p", "Capture stores request origins and available browser timing metadata.");
  note.className = "muted";
  wrap.append(note);
  return wrap;
}

function mountTimeline(all, render) {
  const panel = select("timeline-window");
  const zoom = select("timeline-zoom");
  const previous = select("timeline-previous");
  const next = select("timeline-next");
  const density = select("timeline-density");
  const interval = select("timeline-interval");
  const start = all[0]?.at;
  const end = all.at(-1)?.at;
  const duration = end - start;
  for (const option of zoom.options) option.disabled = Number(option.value) > duration + 1;
  const bars = Array.from({ length: 24 }, () => make("span", ""));
  density.replaceChildren(...bars);
  let index = 0;

  zoom.onchange = () => { index = 0; render(); };
  previous.onclick = () => { index--; render(); };
  next.onclick = () => { index++; render(); };

  return (view, matching) => {
    panel.hidden = view !== "timeline" || !(duration > 0);
    if (panel.hidden) return matching;
    const windows = Number(zoom.value);
    const from = start + duration * index / windows;
    const to = start + duration * (index + 1) / windows;
    const finalWindow = index + 1 === windows;
    const visible = matching.filter(({ at }) => at >= from && (at < to || finalWindow && at <= end));
    const counts = bars.map(() => 0);
    for (const { at } of visible) {
      const bin = Math.min(bars.length - 1, Math.floor((at - from) * bars.length / (to - from)));
      counts[bin]++;
    }
    const maximum = Math.max(1, ...counts);
    bars.forEach((bar, bin) => {
      bar.style.setProperty("--density", String(counts[bin] / maximum));
      bar.classList.toggle("has-events", counts[bin] > 0);
    });
    const seconds = (at) => ((at - start) / 1000).toFixed(3) + "s";
    interval.textContent = seconds(from) + " – " + seconds(to) + " · " + visible.length + (visible.length === 1 ? " event" : " events");
    previous.disabled = index === 0;
    next.disabled = index + 1 === windows;
    return visible;
  };
}

export function recordingPosition(segments, at) {
  let played = 0;
  for (const { from, to } of segments ?? []) {
    if (at >= from && at < to) return (played + at - from) / 1000;
    played += to - from;
  }
  return null;
}

export function mountDiagnostics(report, seekReplay, notice, video) {
  const tabs = [...document.querySelectorAll("[data-view]")];
  const events = select("events");
  const input = select("event-search");
  const filter = select("event-filter");
  const networkFilter = select("network-filter");
  const consoleFilter = select("console-filter");
  const all = [...(report.events ?? [])].sort((left, right) => left.at - right.at);
  let view = "timeline";
  const showWindow = mountTimeline(all, render);
  viewElement(report.element);
  addPairs(select("environment"), [["Page origin", report.origin], ["Captured", new Date(report.createdAt).toLocaleString()],
    ["Viewport", report.element?.viewport && report.element.viewport.width + " × " + report.element.viewport.height + " px"],
    ["Device pixel ratio", report.element?.viewport?.pixelRatio]]);
  function render() {
    const showEvents = !["element", "environment"].includes(view);
    events.hidden = select("event-controls").hidden = !showEvents;
    select("element").hidden = view !== "element";
    select("environment").hidden = view !== "environment";
    filter.closest("label").hidden = view !== "timeline";
    select("network-filter-label").hidden = view !== "network";
    select("console-filter-label").hidden = view !== "console";
    if (view !== "timeline") showWindow(view, []);
    if (!showEvents) return;
    events.replaceChildren();
    const term = input.value.trim().toLowerCase();
    const kind = view === "timeline" ? filter.value : view;
    if (view === "network") {
      const requests = all.filter((event) => {
        if (event.kind !== "network") return false;
        if (networkFilter.value === "failed" && !(event.status >= 400)) return false;
        if (networkFilter.value === "unavailable" && event.status) return false;
        return [event.origin, event.status, event.resourceType, event.duration, event.transferBytes]
          .filter((value) => value != null).join(" ").toLowerCase().includes(term);
      });
      events.append(requests.length ? networkTable(requests, notice) : make("p", "No requests match this view."));
      return;
    }
    const matching = all.filter((event) => {
      if (view !== "console") return !kind || kind === event.kind;
      if (event.kind === "exception") return !consoleFilter.value || consoleFilter.value === "exception";
      return event.kind === "console" && (!consoleFilter.value || event.label === consoleFilter.value);
    }).map((event) => {
      const time = new Date(event.at).toISOString().slice(11, 23);
      const parts = [event.origin, event.status ? "HTTP " + event.status : null, event.duration !== undefined ? event.duration + " ms" : null,
        event.line ? "Line " + event.line + ":" + (event.column ?? 0) : null, event.value !== undefined ? "Score " + event.value : null].filter(Boolean);
      const title = [time, labels[event.kind], event.label].filter(Boolean).join(" · ");
      const detail = parts.join(" · ");
      return { event, title, detail, at: event.at };
    }).filter(({ title, detail }) => (title + " " + detail).toLowerCase().includes(term));
    for (const { event, title, detail } of showWindow(view, matching)) {
      const row = make("details", "");
      row.className = "event-row";
      const summary = make("summary", title + (event.status ? " · " : ""));
      if (event.status) {
        const indicator = make("span", String(event.status));
        if (event.status >= 400) indicator.className = "failed";
        summary.append(indicator);
      }
      const actions = make("div", "");
      actions.className = "button-row";
      actions.append(copyButton("Copy event", [title, detail].filter(Boolean).join(" · "), notice));
      if (seekReplay && event.at >= report.replay[0].at && event.at <= report.replay.at(-1).at) {
        const seek = make("button", "Seek layout replay");
        seek.className = "secondary";
        seek.onclick = () => seekReplay(event.at);
        actions.append(seek);
      }
      const position = video && recordingPosition(report.recordingSegments, event.at);
      if (position != null) {
        const seek = make("button", "Seek recording");
        seek.className = "secondary";
        seek.onclick = () => {
          video.currentTime = Number.isFinite(video.duration) ? Math.min(position, video.duration) : position;
          video.focus();
        };
        actions.append(seek);
      }
      const description = event.kind === "console" ? "Captured call level. Message contents stay on the page." : "No additional diagnostics were captured for this event.";
      row.append(summary, make("p", detail || description), actions);
      events.append(row);
    }
    if (!events.children.length) events.append(make("p", all.length ? "No events match this view." : "No diagnostics were captured."));
  }
  for (const tab of tabs) {
    tab.onclick = () => {
      view = tab.dataset.view;
      for (const peer of tabs) peer.setAttribute("aria-pressed", String(peer === tab));
      render();
    };
  }
  input.oninput = filter.onchange = networkFilter.onchange = consoleFilter.onchange = render;
  render();
}
