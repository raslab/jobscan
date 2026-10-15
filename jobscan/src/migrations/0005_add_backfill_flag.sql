-- Add needs_backfill flag to jobs table (SQLite)
-- Raised for rows with partial data (NULL/empty description) so the sync
-- backfill pass retries them; cleared on successful backfill or when the
-- job is definitively gone (4xx).
ALTER TABLE jobs ADD COLUMN needs_backfill INTEGER NOT NULL DEFAULT 0;
UPDATE jobs SET needs_backfill = 1 WHERE description IS NULL OR description = '';
