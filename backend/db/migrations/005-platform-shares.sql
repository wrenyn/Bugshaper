CREATE TABLE IF NOT EXISTS platform_shares (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  report_id TEXT NOT NULL,
  digest TEXT UNIQUE NOT NULL,
  created_by TEXT REFERENCES users(id),
  expires_at BIGINT NOT NULL,
  revoked_at BIGINT,
  created_at BIGINT NOT NULL,
  FOREIGN KEY(workspace_id, report_id) REFERENCES workspace_reports(workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS platform_shares_report ON platform_shares(workspace_id, report_id);
CREATE INDEX IF NOT EXISTS platform_shares_digest ON platform_shares(digest);
CREATE INDEX IF NOT EXISTS platform_shares_active ON platform_shares(workspace_id, expires_at) WHERE revoked_at IS NULL;
