import { portableReport, reportId, lifecycle } from "../helpers/bundle.js";

export const statuses = lifecycle;
export const idPattern = reportId;

export function validateReport(input) {
  if (input?.schemaVersion !== 1) throw new Error("Expected a version 1 report.");
  const report = portableReport(input);
  if (report.createdAt > Date.now() + 60000) throw new Error("Invalid creation time.");
  return report;
}

export function classify(events) {
  const categories = new Map();
  for (const event of events) {
    const category = event.kind === "exception" ? "JavaScript" :
      event.kind === "network" && event.status >= 400 ? "Network" : null;
    if (!category) continue;
    if (!categories.has(category)) categories.set(category, []);
    categories.get(category).push(event.at);
  }
  return [...categories].map(([category, evidenceAt]) => ({ category, evidenceAt, basis: "Observed diagnostic signal" }));
}
