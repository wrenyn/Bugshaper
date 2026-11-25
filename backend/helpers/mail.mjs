import { randomUUID } from "node:crypto";
import { seal, unseal } from "./encryption.mjs";
import { transaction } from "./http.mjs";

export function mailService(repo, config, now, fetcher) {
  async function enqueue(invitationId, message) {
    if (!config.resendKey || !config.emailFrom) return "link";
    const id = randomUUID();
    const payload = seal(JSON.stringify({ from: config.emailFrom, ...message }), config.dataKey, "mail-job:" + id);
    await repo.run("INSERT INTO mail_jobs(id,invitation_id,payload,available_at,created_at) VALUES (?,?,?,?,?)", id, invitationId, payload, now(), now());
    return "queued";
  }
  async function cancelInvalid() {
    await repo.run(`UPDATE mail_jobs SET status='cancelled',payload=NULL,leased_until=NULL,completed_at=?
      WHERE status IN ('pending','sending','failed') AND invitation_id IN
      (SELECT id FROM invitations WHERE revoked_at IS NOT NULL OR accepted_at IS NOT NULL OR expires_at<=?)`, now(), now());
  }
  async function deliver(limit = 5) {
    if (!config.resendKey || !config.emailFrom) return;
    await cancelInvalid();
    for (let i = 0; i < limit; i++) {
      const job = await transaction(repo.db, async () => {
        const pending = await repo.one("SELECT * FROM mail_jobs WHERE (status='pending' AND available_at<=?) OR (status='sending' AND leased_until<?) ORDER BY available_at LIMIT 1", now(), now());
        if (!pending) return null;
        await repo.run("UPDATE mail_jobs SET status='sending',attempts=attempts+1,leased_until=? WHERE id=?", now() + 60000, pending.id);
        return { ...pending, attempts: pending.attempts + 1 };
      });
      if (!job) break;
      try {
        const payload = unseal(job.payload, config.dataKey, "mail-job:" + job.id).toString("utf8");
        const invitation = await repo.one("SELECT 1 FROM invitations WHERE id=? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at>?", job.invitation_id, now());
        if (!invitation) { await cancelInvalid(); continue; }
        const response = await fetcher("https://api.resend.com/emails", { method: "POST", signal: AbortSignal.timeout(10000), headers: { authorization: "Bearer " + config.resendKey, "content-type": "application/json", "idempotency-key": "bugshaper-" + job.id }, body: payload });
        if (!response.ok) throw new Error("delivery_failed");
        await repo.run("UPDATE mail_jobs SET status='sent',payload=NULL,last_error=NULL,leased_until=NULL,completed_at=? WHERE id=?", now(), job.id);
      } catch {
        const exhausted = job.attempts >= 8;
        await repo.run("UPDATE mail_jobs SET status=?,available_at=?,leased_until=NULL,last_error='Delivery could not be completed.',payload=CASE WHEN ? THEN NULL ELSE payload END,completed_at=CASE WHEN ? THEN ? ELSE NULL END WHERE id=?", exhausted ? "failed" : "pending", now() + Math.min(3600000, 30000 * 2 ** (job.attempts - 1)), exhausted ? 1 : 0, exhausted ? 1 : 0, now(), job.id);
      }
    }
  }
  return { enqueue, deliver, cancelInvalid };
}