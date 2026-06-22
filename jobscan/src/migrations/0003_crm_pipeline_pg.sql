-- CRM Jobs
CREATE TABLE IF NOT EXISTS crm_jobs (
  id                SERIAL PRIMARY KEY,
  job_id            INTEGER NOT NULL UNIQUE REFERENCES jobs(id),
  bucket            TEXT NOT NULL DEFAULT 'sourced',
  tier              TEXT,
  processing_status TEXT NOT NULL DEFAULT 'idle',
  user_comment      TEXT,
  application_date  TEXT,
  disqualify_reason TEXT,
  added_at          TEXT NOT NULL,
  last_moved_at     TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_crm_jobs_bucket ON crm_jobs(bucket);
CREATE INDEX IF NOT EXISTS idx_crm_jobs_job_id ON crm_jobs(job_id);
CREATE INDEX IF NOT EXISTS idx_crm_jobs_processing ON crm_jobs(processing_status);

-- CRM Events
CREATE TABLE IF NOT EXISTS crm_events (
  id            SERIAL PRIMARY KEY,
  crm_job_id    INTEGER NOT NULL REFERENCES crm_jobs(id) ON DELETE CASCADE,
  event_type    TEXT NOT NULL,
  actor         TEXT NOT NULL,
  from_bucket   TEXT,
  to_bucket     TEXT,
  context_data  TEXT,
  comment       TEXT,
  created_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_crm_events_job ON crm_events(crm_job_id);

-- CRM Filters
CREATE TABLE IF NOT EXISTS crm_filters (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  filter_type   TEXT NOT NULL,
  config        TEXT NOT NULL,
  is_active     INTEGER NOT NULL DEFAULT 1,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL
);

-- CRM Settings
CREATE TABLE IF NOT EXISTS crm_settings (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL
);

INSERT INTO crm_settings (key, value) VALUES ('llm_endpoint', 'http://host.docker.internal:11434') ON CONFLICT (key) DO NOTHING;
INSERT INTO crm_settings (key, value) VALUES ('llm_model', 'llama3.1:8b') ON CONFLICT (key) DO NOTHING;
INSERT INTO crm_settings (key, value) VALUES ('auto_process', 'true') ON CONFLICT (key) DO NOTHING;
