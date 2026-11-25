ALTER TABLE billing_attempts ADD COLUMN IF NOT EXISTS checkout_url TEXT;
ALTER TABLE billing_attempts ADD COLUMN IF NOT EXISTS resolved_at BIGINT;