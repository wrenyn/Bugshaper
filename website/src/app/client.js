let csrf = "";
export function setCsrf(value) { csrf = value || ""; }
export async function api(path, method = "GET", data) {
  const response = await fetch(path, { method, credentials: "same-origin", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(45000),
    headers: { ...(data !== undefined ? { "content-type": "application/json" } : {}), ...(!["GET", "HEAD"].includes(method) ? { "x-csrf-token": csrf } : {}) },
    body: data === undefined ? undefined : JSON.stringify(data) });
  const result = await response.json();
  if (!response.ok) { const error = new Error(result.error || "Request failed."); error.status = response.status; throw error; }
  return result;
}
export const date = value => new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(value));
export const dateTime = value => new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
export function download(name, contents, type = "text/csv") {
  const url = URL.createObjectURL(new Blob([contents], { type })); const a = document.createElement("a"); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function csv(rows) { return rows.map(row => row.map(value => { const s = String(value ?? ""); return '"' + (/^[=+\-@\t\r]/.test(s) ? "'" : "") + s.replaceAll('"', '""') + '"'; }).join(",")).join("\r\n"); }
