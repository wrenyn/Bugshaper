import { normalizeEvidence, publicAddress } from "./evidence.js";

export const lifecycle = ["Open", "Triaged", "In progress", "Fix proposed", "Ready for verification", "Resolved", "Reopened"];
export const textLimits = { title: 160, description: 4000, expected: 4000, actual: 4000,
  reproduction: 4000, environment: 200, version: 100, assignee: 120, category: 80, severity: 40, priority: 40, project: 120 };
export const reportId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function portableReport(input) {
  if (!input || typeof input !== "object" || Array.isArray(input) || typeof input.id !== "string" ||
      !reportId.test(input.id) || !Number.isSafeInteger(input.createdAt) || input.createdAt < 0) {
    throw new Error("Invalid report metadata.");
  }
  // Keep the version 1 event shape stable for checksum verification by older clients.
  const events = normalizeEvidence(input.events).filter(({ kind }) => kind !== "console")
    .map(({ resourceType, transferBytes, ...event }) => event);
  const report = { schemaVersion: 1, id: input.id.toLowerCase(), createdAt: input.createdAt,
    origin: publicAddress(input.origin), events, status: input.status ?? "Open" };
  if (!lifecycle.includes(report.status)) throw new Error("Invalid report status.");
  for (const [name, limit] of Object.entries(textLimits)) {
    const value = input[name];
    if (value === undefined) continue;
    if (typeof value !== "string" || value.length > limit) throw new Error("Invalid " + name + ".");
    report[name] = value.trim();
  }
  return report;
}

async function checksum(report) {
  const signed = new TextEncoder().encode(JSON.stringify(report));
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", signed));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function makeBundle(input) {
  const report = portableReport(input);
  return { format: "bugshaper-report", version: 1, report, sha256: await checksum(report) };
}

export async function extractBundle(bundle) {
  if (!bundle || bundle.format !== "bugshaper-report" || bundle.version !== 1 ||
      bundle.report?.schemaVersion !== 1 || typeof bundle.sha256 !== "string") throw new Error("Unsupported Bugshaper bundle.");
  const report = portableReport(bundle.report);
  if (await checksum(report) !== bundle.sha256) throw new Error("The bundle integrity check failed.");
  return report;
}

