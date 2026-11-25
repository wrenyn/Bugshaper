(() => {
  if (globalThis.bugshaperProbe) return;
  const events = [];
  const controller = new AbortController();
  const { signal } = controller;
  const errors = new Set(["Error", "TypeError", "RangeError", "SyntaxError", "ReferenceError", "URIError", "EvalError", "Script error", "Unhandled rejection"]);
  let consoleCount = 0;

  function record(event, at = Date.now()) {
    events.push({ ...event, at });
    if (events.length > 200) events.shift();
  }

  function origin(address) {
    try {
      const url = new URL(address);
      return ["https:", "http:"].includes(url.protocol) ? url.origin : null;
    } catch {
      return null;
    }
  }

  document.addEventListener("bugshaper:exception", (event) => {
    if (typeof event.detail !== "string" || event.detail.length > 512) return;
    let detail;
    try { detail = JSON.parse(event.detail); } catch { return; }
    if (!detail || !errors.has(detail.label)) return;
    const position = (value) => Number.isSafeInteger(value) && value > 0 ? value : undefined;
    record({ kind: "exception", label: detail.label, origin: origin(detail.origin),
      line: position(detail.line), column: position(detail.column) });
  }, { signal });

  for (const level of ["debug", "log", "info", "warn", "error", "trace"]) {
    document.addEventListener("bugshaper:console:" + level, () => {
      if (consoleCount >= 60) return;
      consoleCount++;
      record({ kind: "console", label: level });
    }, { signal });
  }

  for (const [name, label] of [["click", "Click"], ["submit", "Submit"]]) {
    addEventListener(name, (event) => {
      if (event.isTrusted) record({ kind: "interaction", label });
    }, { capture: true, signal });
  }

  let observer;
  if (PerformanceObserver.supportedEntryTypes.includes("resource")) {
    observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const event = { kind: "network", label: "Resource timing",
          origin: origin(entry.name), duration: Math.round(entry.duration),
          resourceType: entry.initiatorType };
        if (entry.responseStatus > 0) event.status = entry.responseStatus;
        if (entry.transferSize > 0) event.transferBytes = entry.transferSize;
        record(event, Math.round(performance.timeOrigin + entry.startTime));
      }
    });
    observer.observe({ type: "resource" });
  }

  const performanceObservers = [];
  const metrics = { longtask: "Long task", "largest-contentful-paint": "Largest contentful paint", "layout-shift": "Layout shift" };
  for (const [type, label] of Object.entries(metrics)) {
    if (!PerformanceObserver.supportedEntryTypes.includes(type)) continue;
    const metric = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (type === "layout-shift" && (entry.hadRecentInput || entry.value < 0.01)) continue;
        const event = { kind: "performance", label };
        if (type === "longtask") event.duration = Math.round(entry.duration);
        if (type === "largest-contentful-paint") event.duration = Math.round(entry.startTime);
        if (type === "layout-shift") event.value = Math.round(entry.value * 1000) / 1000;
        record(event, Math.round(performance.timeOrigin + entry.startTime));
      }
    });
    metric.observe({ type });
    performanceObservers.push(metric);
  }

  function stop() {
    for (const metric of performanceObservers) metric.disconnect();
    controller.abort();
    document.dispatchEvent(new Event("bugshaper:stop-console"));
    observer?.disconnect();
    clearTimeout(timer);
    const result = events.slice();
    delete globalThis.bugshaperProbe;
    return result;
  }

  const timer = setTimeout(stop, 10 * 60 * 1000);
  globalThis.bugshaperProbe = { stop, snapshot: () => events.slice() };
})();
