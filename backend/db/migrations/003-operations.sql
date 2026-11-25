CREATE TABLE IF NOT EXISTS mail_jobs (
 id TEXT PRIMARY KEY,
 invitation_id TEXT NOT NULL UNIQUE REFERENCES invitations(id) ON DELETE CASCADE,
 payload TEXT,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','sent','failed','cancelled')),
 attempts INTEGER NOT NULL DEFAULT 0,
 available_at BIGINT NOT NULL, leased_until BIGINT,
 last_error TEXT, created_at BIGINT NOT NULL, completed_at BIGINT
);
CREATE INDEX IF NOT EXISTS mail_jobs_due ON mail_jobs(status,available_at);
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS checked_at BIGINT NOT NULL DEFAULT 0;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS sync_error TEXT;
ALTER TABLE billing_attempts ADD COLUMN IF NOT EXISTS checked_at BIGINT NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS service_state (name TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at BIGINT NOT NULL);