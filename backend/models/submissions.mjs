import { createHash } from "node:crypto";
import { extractLocalBundle } from "../helpers/portable-media.js";
import { validateReport } from "./report.mjs";
import { transaction } from "../helpers/http.mjs";

const kinds = ["screenshot", "video"];

export async function parseSubmission(bundle) {
  const imported = await extractLocalBundle(bundle);
  const report = validateReport(imported);
  const artifacts = await Promise.all(kinds.filter(kind => imported[kind]).map(async kind => {
    const { type } = imported[kind];
    return { kind, type, data: Buffer.from(await imported[kind].arrayBuffer()) };
  }));
  const document = JSON.stringify(report);
  const fingerprint = createHash("sha256").update(JSON.stringify([document,
    artifacts.map(({ kind }) => [kind, bundle.media[kind].sha256])])).digest("hex");
  return { report, document, artifacts, fingerprint };
}

export function createSubmissionStore(db) {
  return {
    async save({ report, document, artifacts, fingerprint }, recordAudit) {
      return transaction(db, async () => {
        const previous = await db.prepare("SELECT digest FROM submission_receipts WHERE report_id = ?").get(report.id);
        const existing = await db.prepare("SELECT document FROM reports WHERE id = ?").get(report.id);
        let status = 409;
        if (previous?.digest === fingerprint) status = 200;
        else if (!previous && (!existing || existing.document === document)) {
          if (!existing) await db.prepare("INSERT INTO reports VALUES (?, ?, ?)").run(report.id, report.createdAt, document);
          for (const { kind, type, data } of artifacts) await db.prepare("INSERT INTO report_artifacts VALUES (?, ?, ?, ?)").run(report.id, kind, type, data);
          await db.prepare("INSERT INTO submission_receipts VALUES (?, ?)").run(report.id, fingerprint);
          await recordAudit();
          status = existing ? 200 : 201;
        }
        return status;
      });
    },
    get: async (id, kind) => db.prepare("SELECT type, data FROM report_artifacts WHERE report_id = ? AND kind = ?").get(id, kind),
    kinds: async (id) => (await db.prepare("SELECT kind FROM report_artifacts WHERE report_id = ? ORDER BY kind").all(id)).map(({ kind }) => kind),
  };
}