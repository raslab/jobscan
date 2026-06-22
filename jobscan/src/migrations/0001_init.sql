PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS sources (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  company     TEXT NOT NULL,
  url         TEXT NOT NULL UNIQUE,
  parser      TEXT NOT NULL DEFAULT 'default',
  added_at    TEXT NOT NULL,
  last_synced TEXT,
  last_status TEXT,
  last_error  TEXT,
  last_count  INTEGER
);

CREATE TABLE IF NOT EXISTS sync_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at    TEXT NOT NULL,
  completed_at  TEXT,
  sources_count INTEGER NOT NULL DEFAULT 0,
  new_jobs      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS jobs (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id      INTEGER,
  sync_id        INTEGER NOT NULL,
  company        TEXT NOT NULL,
  title          TEXT NOT NULL,
  location       TEXT,
  workplace_type TEXT,
  commitment     TEXT,
  description    TEXT,
  url            TEXT NOT NULL UNIQUE,
  first_seen     TEXT NOT NULL,
  FOREIGN KEY (sync_id) REFERENCES sync_log(id)
);

CREATE INDEX IF NOT EXISTS idx_jobs_source ON jobs(source_id);
CREATE INDEX IF NOT EXISTS idx_jobs_sync   ON jobs(sync_id);
CREATE INDEX IF NOT EXISTS idx_jobs_title  ON jobs(title);
CREATE INDEX IF NOT EXISTS idx_jobs_company ON jobs(company);

CREATE TABLE IF NOT EXISTS html_backups (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id   INTEGER NOT NULL,
  sync_id     INTEGER NOT NULL,
  html        TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  FOREIGN KEY (sync_id) REFERENCES sync_log(id)
);
