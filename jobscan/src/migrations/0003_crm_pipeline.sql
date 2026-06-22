-- CRM Jobs: pipeline tracking layer on top of sourced jobs
CREATE TABLE IF NOT EXISTS crm_jobs (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id            INTEGER NOT NULL UNIQUE,    -- FK to jobs.id, one CRM entry per job
  bucket            TEXT NOT NULL DEFAULT 'sourced',
                    -- sourced | filtered | processed | applied | disqualified | auto_disqualified
  tier              TEXT,                       -- T1 | T2 | T3 | skip | null
  processing_status TEXT NOT NULL DEFAULT 'idle',
                    -- idle | pending | processing | done | error
  user_comment      TEXT,                       -- mutable user notes
  application_date  TEXT,                       -- ISO UTC, set when entering 'applied'
  disqualify_reason TEXT,                       -- required for disqualified/auto_disqualified
  added_at          TEXT NOT NULL,              -- ISO UTC
  last_moved_at     TEXT NOT NULL,              -- ISO UTC, used for sort order
  FOREIGN KEY (job_id) REFERENCES jobs(id)
);

CREATE INDEX IF NOT EXISTS idx_crm_jobs_bucket ON crm_jobs(bucket);
CREATE INDEX IF NOT EXISTS idx_crm_jobs_job_id ON crm_jobs(job_id);
CREATE INDEX IF NOT EXISTS idx_crm_jobs_processing ON crm_jobs(processing_status);

-- CRM Events: immutable history timeline
CREATE TABLE IF NOT EXISTS crm_events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  crm_job_id    INTEGER NOT NULL,
  event_type    TEXT NOT NULL,
                -- added | moved | keyword_disqualified | llm_filter_passed | llm_filter_failed
                -- | tier_assigned | processing_error | processing_started | manual_trigger
  actor         TEXT NOT NULL,                  -- 'user' or system process name
  from_bucket   TEXT,                           -- null for 'added' events
  to_bucket     TEXT,                           -- null for non-move events
  context_data  TEXT,                           -- JSON blob
  comment       TEXT,                           -- user-provided comment on move
  created_at    TEXT NOT NULL,                  -- ISO UTC
  FOREIGN KEY (crm_job_id) REFERENCES crm_jobs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_crm_events_job ON crm_events(crm_job_id);

-- CRM Filters: user-defined screening rules
CREATE TABLE IF NOT EXISTS crm_filters (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  filter_type   TEXT NOT NULL,                  -- keyword | llm_filter | llm_tier
  config        TEXT NOT NULL,                  -- JSON blob
  is_active     INTEGER NOT NULL DEFAULT 1,     -- 0 or 1
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL                   -- ISO UTC
);

-- CRM Settings: key-value configuration
CREATE TABLE IF NOT EXISTS crm_settings (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL
);

-- Default settings
INSERT OR IGNORE INTO crm_settings (key, value) VALUES ('llm_endpoint', 'http://localhost:11434');
INSERT OR IGNORE INTO crm_settings (key, value) VALUES ('llm_model', 'llama3.1:8b');
INSERT OR IGNORE INTO crm_settings (key, value) VALUES ('auto_process', 'true');
