-- Add needs_backfill flag to jobs table (Postgres)
-- Raised for rows with partial data (NULL/empty description) so the sync
-- backfill pass retries them; cleared on successful backfill or when the
-- job is definitively gone (4xx).
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS needs_backfill BOOLEAN NOT NULL DEFAULT FALSE;
UPDATE jobs SET needs_backfill = TRUE WHERE description IS NULL OR description = '';
