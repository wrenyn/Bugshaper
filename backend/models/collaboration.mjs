import { randomUUID } from "node:crypto";
import { validateReport } from "./report.mjs";
import { textLimits } from "../helpers/bundle.js";
import { transaction } from "../helpers/http.mjs";

export function createDiscussion(db, now) {
  const fields = new Set([...Object.keys(textLimits), "status"]);

  async function add(id, actor, kind, body) {
    const entry = { id: randomUUID(), at: now(), actor, kind, body };
    await db.prepare("INSERT INTO discussion (id, report_id, at, actor, kind, body) VALUES (?, ?, ?, ?, ?, ?)")
      .run(entry.id, id, entry.at, actor, kind, JSON.stringify(body));
    return entry;
  }

  return {
    async list(id) {
      const rows = await db.prepare("SELECT id, at, actor, kind, body FROM discussion WHERE report_id = ? ORDER BY sequence DESC LIMIT 100").all(id);
      return rows.reverse().map((entry) => ({ ...entry, body: JSON.parse(entry.body) }));
    },
    async comment(id, actor, input) {
      const text = input?.text;
      const at = input?.at;
      if (typeof text !== "string" || !text.trim() || text.length > 2000 ||
          (at !== undefined && (!Number.isSafeInteger(at) || at < 0 || at > now()))) {
        throw new Error("Provide a comment up to 2,000 characters and an optional valid event timestamp.");
      }
      return await add(id, actor, "comment", { text: text.trim(), ...(at === undefined ? {} : { at }) });
    },
    async patch(id, actor, original, input) {
      if (!input || typeof input !== "object" || Array.isArray(input) || !Object.keys(input).length ||
          Object.keys(input).some((key) => !fields.has(key))) throw new Error("Provide editable report fields.");
      const before = JSON.parse(original);
      const report = validateReport({ ...before, ...input });
      const changedFields = Object.keys(input).filter((key) => before[key] !== report[key]);
      const document = JSON.stringify(report);
      return transaction(db, async () => {
        const changed = (await db.prepare("UPDATE reports SET document = ? WHERE id = ? AND document = ?").run(document, id, original)).changes;
        if (!changed) return null;
        if (changedFields.length) await add(id, actor, "edit", { fields: changedFields,
          ...(changedFields.includes("status") ? { from: before.status, to: report.status } : {}) });
        return report;
      });
    },
  };
}