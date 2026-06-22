-- Performance indexes for full-text search and filtering (PostgreSQL 12+)
-- Addresses slow sequential scans on 155k+ jobs table

-- ==========================================================================
-- 1. Enable pg_trgm extension for trigram-based GIN indexes (fuzzy search)
-- ==========================================================================
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ==========================================================================
-- 2. B-tree indexes on filter/sort columns that were missing
--    (company and title already have btree from migration 0001)
-- ==========================================================================
CREATE INDEX IF NOT EXISTS idx_jobs_location        ON jobs(location);
CREATE INDEX IF NOT EXISTS idx_jobs_department       ON jobs(department);
CREATE INDEX IF NOT EXISTS idx_jobs_workplace_type   ON jobs(workplace_type);
CREATE INDEX IF NOT EXISTS idx_jobs_commitment       ON jobs(commitment);
CREATE INDEX IF NOT EXISTS idx_jobs_first_seen       ON jobs(first_seen DESC);

-- ==========================================================================
-- 3. GIN trigram indexes on filter columns for LIKE '%term%' queries
--    Expression matches exactly what buildJobWhere / buildCrmJobConditions use
-- ==========================================================================
CREATE INDEX IF NOT EXISTS idx_jobs_title_trgm
  ON jobs USING gin (LOWER(title) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_jobs_company_trgm
  ON jobs USING gin (LOWER(company) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_jobs_location_trgm
  ON jobs USING gin (LOWER(COALESCE(location, '')) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_jobs_department_trgm
  ON jobs USING gin (LOWER(COALESCE(department, '')) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_jobs_workplace_type_trgm
  ON jobs USING gin (LOWER(COALESCE(workplace_type, '')) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_jobs_commitment_trgm
  ON jobs USING gin (LOWER(COALESCE(commitment, '')) gin_trgm_ops);

-- ==========================================================================
-- 4. Generated stored column combining all searchable text fields
--    This replaces per-word OR-across-8-fields with a single column LIKE
--    NOTE: description is excluded because production data contains corrupted
--    UTF-8 byte sequences from web scraping; LOWER() on those crashes PG.
--    CRM description search falls back to a separate condition in the query.
-- ==========================================================================
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS search_text TEXT GENERATED ALWAYS AS (
  LOWER(
    COALESCE(title, '') || ' ' ||
    COALESCE(company, '') || ' ' ||
    COALESCE(location, '') || ' ' ||
    COALESCE(workplace_type, '') || ' ' ||
    COALESCE(commitment, '') || ' ' ||
    COALESCE(department, '') || ' ' ||
    COALESCE(team, '') || ' ' ||
    COALESCE(url, '')
  )
) STORED;

-- GIN trigram index on search_text — powers fuzzy LIKE '%word%' and exact LIKE
CREATE INDEX IF NOT EXISTS idx_jobs_search_text_trgm
  ON jobs USING gin (search_text gin_trgm_ops);

-- ==========================================================================
-- 5. GIN tsvector expression index for potential word-level full-text search
--    Uses 'simple' config (no stemming) so it matches all languages/tokens
-- ==========================================================================
CREATE INDEX IF NOT EXISTS idx_jobs_search_tsv ON jobs USING gin (
  to_tsvector('simple',
    COALESCE(title, '') || ' ' ||
    COALESCE(company, '') || ' ' ||
    COALESCE(location, '') || ' ' ||
    COALESCE(workplace_type, '') || ' ' ||
    COALESCE(commitment, '') || ' ' ||
    COALESCE(department, '') || ' ' ||
    COALESCE(team, '') || ' ' ||
    COALESCE(url, '')
  )
);

-- ==========================================================================
-- 6. CRM table indexes for common query patterns
-- ==========================================================================
CREATE INDEX IF NOT EXISTS idx_crm_jobs_last_moved
  ON crm_jobs(last_moved_at DESC);

CREATE INDEX IF NOT EXISTS idx_crm_events_type
  ON crm_events(event_type);
