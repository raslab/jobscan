-- CRM composite indexes for bucket-scoped queries (PostgreSQL 12+)
-- Fixes two problems identified via EXPLAIN ANALYZE on 1,737 CRM rows / 129k jobs:
--
--   1. getCrmJobsByBucket / getCrmJobsByBucketFiltered:
--      The simple (last_moved_at DESC) index works well today, but as the CRM
--      grows the planner can't skip non-matching bucket rows cheaply.
--      A composite (bucket, last_moved_at DESC) lets it index-scan *only* the
--      target bucket already sorted by recency — zero extra sort step.
--
--   2. getCrmFunnelAnalytics autoFilter sub-query:
--      Pattern: WHERE crm_job_id = ANY($1) AND event_type IN (...)
--      The existing single-column indexes (idx_crm_events_job, idx_crm_events_type)
--      each cover one half; the composite (crm_job_id, event_type) eliminates the
--      extra filter step and can be index-only for COUNT queries.

-- ==========================================================================
-- 1. Composite index: bucket + last_moved_at DESC
--    Powers: ORDER BY last_moved_at DESC WHERE bucket = $1
--    Used by: getCrmJobsByBucket, getCrmJobsByBucketFiltered (via MATERIALIZED CTE)
-- ==========================================================================
CREATE INDEX IF NOT EXISTS idx_crm_jobs_bucket_order
  ON crm_jobs (bucket, last_moved_at DESC);

-- ==========================================================================
-- 2. Composite index: crm_job_id + event_type
--    Powers: WHERE crm_job_id = ANY($1) AND event_type IN (...)
--    Used by: getCrmFunnelAnalytics, autoFilter sub-query in buildCrmJobConditions
-- ==========================================================================
CREATE INDEX IF NOT EXISTS idx_crm_events_job_type
  ON crm_events (crm_job_id, event_type);
