export const MAX_EVENTS = 200;

export function publicAddress(value) {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    return url.origin;
  } catch {
    return null;
  }
}

const labels = {
  console: new Set(["debug", "log", "info", "warn", "error", "trace"]),
  exception: new Set(["Error", "TypeError", "RangeError", "SyntaxError", "ReferenceError", "URIError", "EvalError", "Unhandled rejection", "Script error"]),
  interaction: new Set(["Click", "Submit"]),
  network: new Set(["Resource timing"]),
  performance: new Set(["Long task", "Largest contentful paint", "Layout shift"]),
};

const resourceTypes = new Set(["audio", "beacon", "css", "early-hints", "embed", "fetch", "frame",
  "iframe", "icon", "image", "img", "input", "link", "navigation", "object", "other", "ping",
  "script", "track", "video", "xmlhttprequest"]);

export function normalizeEvidence(events) {
  if (!Array.isArray(events)) return [];
  return events.slice(-MAX_EVENTS).flatMap((event) => {
    if (!event || !Object.hasOwn(labels, event.kind) || !Number.isFinite(event.at) || Math.abs(event.at) > 8.64e15) return [];
    const clean = { kind: event.kind, at: event.at };
    if (event.kind === "console") return labels.console.has(event.label) ? [{ ...clean, label: event.label }] : [];
    clean.label = labels[event.kind].has(event.label) ? event.label : {
      exception: "Script error", interaction: "Click", network: "Resource timing", performance: "Performance signal",
    }[event.kind];
    const origin = publicAddress(event.origin);
    if (origin) clean.origin = origin;
    if (event.kind === "network") {
      if (resourceTypes.has(event.resourceType)) clean.resourceType = event.resourceType;
      if (Number.isSafeInteger(event.transferBytes) && event.transferBytes > 0) clean.transferBytes = event.transferBytes;
    }
    for (const key of ["duration", "status", "line", "column", "value"]) {
      if (Number.isFinite(event[key]) && event[key] >= 0) clean[key] = event[key];
    }
    return [clean];
  }).sort((left, right) => left.at - right.at);
}
