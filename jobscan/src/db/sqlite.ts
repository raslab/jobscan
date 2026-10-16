/**
 * SQLite adapter (dev mode, no DATABASE_URL set).
 * Uses the built-in `node:sqlite` module (requires Node 22.5+).
 * All functions are wrapped in Promise.resolve() so callers can be uniformly async.
 */
import { DatabaseSync } from 'node:sqlite';
import fs from 'fs';
import path from 'path';
import {
  Job, JobFilters, PaginatedJobQuery, PaginatedResult, Source, SyncLog,
  CrmJob, CrmJobWithDetails, CrmEvent, CrmFilter, CrmFilterType,
  CrmBucket, CrmTier, CrmProcessingStatus, CrmBucketCounts, CrmSetting,
} from '../types';

const DATA_DIR = path.join(process.cwd(), 'data');
const DB_PATH = path.join(DATA_DIR, 'jobscan.db');

let db: DatabaseSync;

export function initDb(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  runMigrations();
}

function runMigrations(): void {
  const row = db.prepare('PRAGMA user_version').get() as unknown as { user_version: number };
  if (row.user_version < 1) {
    const migrationPath = path.join(__dirname, '..', 'migrations', '0001_init.sql');
    const sql = fs.readFileSync(migrationPath, 'utf8');
    db.exec(sql);
    db.exec('PRAGMA user_version = 1');
  }
  if (row.user_version < 2) {
    const migrationPath = path.join(__dirname, '..', 'migrations', '0002_add_department_team.sql');
    const sql = fs.readFileSync(migrationPath, 'utf8');
    db.exec(sql);
    db.exec('PRAGMA user_version = 2');
  }
  if (row.user_version < 3) {
    const migrationPath = path.join(__dirname, '..', 'migrations', '0003_crm_pipeline.sql');
    const sql = fs.readFileSync(migrationPath, 'utf8');
    db.exec(sql);
    db.exec('PRAGMA user_version = 3');
  }
  if (row.user_version < 4) {
    const migrationPath = path.join(__dirname, '..', 'migrations', '0004_gemini_settings.sql');
    const sql = fs.readFileSync(migrationPath, 'utf8');
    db.exec(sql);
    db.exec('PRAGMA user_version = 4');
  }
  if (row.user_version < 5) {
    const migrationPath = path.join(__dirname, '..', 'migrations', '0005_add_backfill_flag.sql');
    const sql = fs.readFileSync(migrationPath, 'utf8');
    db.exec(sql);
    db.exec('PRAGMA user_version = 5');
  }
}

// ─── Sources ─────────────────────────────────────────────────────────────────

export async function getSources(): Promise<Source[]> {
  return db.prepare('SELECT * FROM sources ORDER BY added_at DESC').all() as unknown as Source[];
}

export async function getJobCounts(): Promise<{ totalJobs: number; totalSources: number }> {
  const jobRow = db.prepare('SELECT COUNT(*) as cnt FROM jobs').get() as unknown as { cnt: number };
  const srcRow = db.prepare('SELECT COUNT(*) as cnt FROM sources').get() as unknown as { cnt: number };
  return {
    totalJobs: jobRow.cnt,
    totalSources: srcRow.cnt,
  };
}

/** Sources ordered by staleness: never-synced first, then oldest sync first */
export async function getSourcesForSync(): Promise<Source[]> {
  return db.prepare('SELECT * FROM sources ORDER BY last_synced IS NOT NULL, last_synced ASC').all() as unknown as Source[];
}

export async function getSourceById(id: number): Promise<Source | undefined> {
  return db.prepare('SELECT * FROM sources WHERE id = ?').get(id) as unknown as Source | undefined;
}

export async function insertSource(company: string, url: string, parser: string): Promise<number> {
  const result = db
    .prepare(`INSERT INTO sources (company, url, parser, added_at) VALUES (?, ?, ?, ?)`)
    .run(company, url, parser, new Date().toISOString());
  return Number(result.lastInsertRowid);
}

export async function deleteSource(id: number): Promise<void> {
  // Must delete in FK-dependency order (foreign_keys = ON via PRAGMA):
  // crm_events → crm_jobs → jobs → sources
  db.prepare(`
    DELETE FROM crm_events
     WHERE crm_job_id IN (
       SELECT cj.id FROM crm_jobs cj
       JOIN jobs j ON cj.job_id = j.id
       WHERE j.source_id = ?
     )
  `).run(id);
  db.prepare(`
    DELETE FROM crm_jobs WHERE job_id IN (SELECT id FROM jobs WHERE source_id = ?)
  `).run(id);
  db.prepare('DELETE FROM jobs WHERE source_id = ?').run(id);
  db.prepare('DELETE FROM sources WHERE id = ?').run(id);
}

export async function updateSourceSync(
  id: number, status: string, count: number, error?: string
): Promise<void> {
  db.prepare(
    `UPDATE sources SET last_synced=?, last_status=?, last_count=?, last_error=? WHERE id=?`
  ).run(new Date().toISOString(), status, count, error ?? null, id);
}

// ─── Jobs ─────────────────────────────────────────────────────────────────────

export async function insertJobIfNew(job: Omit<Job, 'id'>): Promise<boolean> {
  const result = db
    .prepare(
      `INSERT OR IGNORE INTO jobs
         (source_id, sync_id, company, title, location, workplace_type, commitment, department, team, description, url, first_seen)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      job.source_id, job.sync_id, job.company, job.title,
      job.location ?? null, job.workplace_type ?? null, job.commitment ?? null,
      job.department ?? null, job.team ?? null,
      job.description ?? null, job.url, job.first_seen
    );
  return result.changes === 1;
}

/**
 * Insert a job row from the listing stage and return its DB id along with
 * whether a new row was actually inserted (false = row already existed).
 *
 * Unlike insertJobIfNew, this always returns the id — even when the row was
 * already present — so the caller can immediately use it for updateJobDetails
 * without a second lookup.
 */
export async function insertJobListingRow(job: Omit<Job, 'id'>): Promise<{ id: number; inserted: boolean }> {
  const needsBackfill = job.description ? 0 : 1;
  const result = db
    .prepare(
      `INSERT OR IGNORE INTO jobs
         (source_id, sync_id, company, title, location, workplace_type, commitment, department, team, description, url, first_seen, needs_backfill)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      job.source_id, job.sync_id, job.company, job.title,
      job.location ?? null, job.workplace_type ?? null, job.commitment ?? null,
      job.department ?? null, job.team ?? null,
      job.description ?? null, job.url, job.first_seen, needsBackfill
    );
  if (result.changes === 1) {
    return { id: Number(result.lastInsertRowid), inserted: true };
  }
  // Row already existed — look up its id
  const existing = db.prepare('SELECT id FROM jobs WHERE url = ?').get(job.url) as { id: number };
  return { id: existing.id, inserted: false };
}

/**
 * Update detail-page fields on an existing job row.
 * Only fields explicitly provided (non-undefined) are written — fields left
 * as undefined are left unchanged in the database.
 */
export async function updateJobDetails(
  jobId: number,
  fields: {
    description?:    string;
    workplace_type?: string;
    commitment?:     string;
    department?:     string;
    team?:           string;
    location?:       string;
  },
): Promise<void> {
  const sets: string[] = [];
  const values: unknown[] = [];
  if (fields.description    !== undefined) { sets.push('description = ?');    values.push(fields.description); }
  if (fields.workplace_type !== undefined) { sets.push('workplace_type = ?'); values.push(fields.workplace_type); }
  if (fields.commitment     !== undefined) { sets.push('commitment = ?');     values.push(fields.commitment); }
  if (fields.department     !== undefined) { sets.push('department = ?');     values.push(fields.department); }
  if (fields.team           !== undefined) { sets.push('team = ?');           values.push(fields.team); }
  if (fields.location       !== undefined) { sets.push('location = ?');       values.push(fields.location); }
  // A non-empty description written here resolves the partial-data condition,
  // so retire the row from the backfill backlog (owner comment 6195486910).
  if (fields.description !== undefined && fields.description !== '') {
    sets.push('needs_backfill = 0');
  }
  if (sets.length === 0) return;
  values.push(jobId);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db.prepare(`UPDATE jobs SET ${sets.join(', ')} WHERE id = ?`).run(...(values as any[]));
}

export async function getJobs(filters: JobFilters = {}): Promise<Job[]> {
  return db
    .prepare(
      `SELECT * FROM jobs
       WHERE (:company  IS NULL OR LOWER(company) LIKE '%' || LOWER(:company) || '%')
         AND (:title    IS NULL OR LOWER(title)    LIKE '%' || LOWER(:title)    || '%')
         AND (:location IS NULL OR LOWER(location) LIKE '%' || LOWER(:location) || '%')
         AND (:since    IS NULL OR first_seen >= :since)
         AND (:syncId   IS NULL OR sync_id = :syncId)
       ORDER BY first_seen DESC`
    )
    .all({
      company:  filters.company  ?? null,
      title:    filters.title    ?? null,
      location: filters.location ?? null,
      since:    filters.since    ?? null,
      syncId:   filters.syncId   ?? null,
    }) as unknown as Job[];
}

export async function getJobById(id: number): Promise<Job | undefined> {
  return db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as unknown as Job | undefined;
}

export async function getJobsBySyncId(syncId: number): Promise<Job[]> {
  return db
    .prepare('SELECT * FROM jobs WHERE sync_id = ? ORDER BY first_seen DESC')
    .all(syncId) as unknown as Job[];
}

export async function countJobsBySyncId(syncId: number): Promise<number> {
  const row = db
    .prepare('SELECT COUNT(*) AS count FROM jobs WHERE sync_id = ?')
    .get(syncId) as unknown as { count: number | string };
  return Number(row.count);
}

export async function getDistinctCompanies(): Promise<string[]> {
  const rows = db
    .prepare('SELECT DISTINCT company FROM jobs ORDER BY company')
    .all() as unknown as { company: string }[];
  return rows.map((r) => r.company);
}

export async function getExistingJobUrls(sourceId: number): Promise<Set<string>> {
  const rows = db
    .prepare('SELECT url FROM jobs WHERE source_id = ?')
    .all(sourceId) as unknown as { url: string }[];
  return new Set(rows.map((r) => r.url));
}

/** Return all jobs for a source that have a NULL or empty description. */
export async function getJobsWithEmptyDescription(sourceId: number): Promise<Pick<Job, 'id' | 'url' | 'title' | 'location' | 'department' | 'workplace_type' | 'commitment'>[]> {
  return db
    .prepare(
      `SELECT id, url, title, location, department, workplace_type, commitment
       FROM jobs
       WHERE source_id = ?
         AND needs_backfill = 1`
    )
    .all(sourceId) as unknown as Pick<Job, 'id' | 'url' | 'title' | 'location' | 'department' | 'workplace_type' | 'commitment'>[];
}

/** Update the description of an existing job row by its primary key. */
export async function updateJobDescription(jobId: number, description: string): Promise<void> {
  db.prepare('UPDATE jobs SET description = ? WHERE id = ?').run(description, jobId);
}

/** Raise/clear the needs_backfill flag on a job row. Cleared when a backfill
 *  succeeds (also implied by updateJobDetails) or the job is definitively gone
 *  (4xx); kept raised on transient failures so the row is retried next sync. */
export async function setJobNeedsBackfill(jobId: number, value: boolean): Promise<void> {
  db.prepare('UPDATE jobs SET needs_backfill = ? WHERE id = ?').run(value ? 1 : 0, jobId);
}

// ─── Paginated queries ────────────────────────────────────────────────────────

const SEARCH_FIELDS = ['title', 'company', 'location', 'workplace_type', 'commitment', 'department', 'team', 'description', 'url'];
const ALLOWED_SORT_COLUMNS = new Set(['first_seen', 'company', 'title', 'location', 'department', 'workplace_type', 'commitment']);

/** Build WHERE clause + params for job filters (shared between count and paginated) */
function buildJobWhere(filters: PaginatedJobQuery): { clause: string; params: Record<string, string | number | null> } {
  const conditions: string[] = ['1=1'];
  const params: Record<string, string | number | null> = {};

  if (filters.company) {
    conditions.push("LOWER(company) LIKE '%' || LOWER(:fCompany) || '%'");
    params.fCompany = filters.company;
  }
  if (filters.since) {
    conditions.push('first_seen >= :fSince');
    params.fSince = filters.since;
  }
  if (filters.syncId) {
    conditions.push('sync_id = :fSyncId');
    params.fSyncId = filters.syncId;
  }
  if (filters.location) {
    conditions.push("LOWER(COALESCE(location,'')) LIKE :fLoc");
    params.fLoc = `%${filters.location.toLowerCase()}%`;
  }
  if (filters.title) {
    conditions.push('LOWER(title) LIKE :fTitle');
    params.fTitle = `%${filters.title.toLowerCase()}%`;
  }
  if (filters.department) {
    conditions.push("LOWER(COALESCE(department,'')) LIKE :fDept");
    params.fDept = `%${filters.department.toLowerCase()}%`;
  }
  if (filters.workplace_type) {
    conditions.push("LOWER(COALESCE(workplace_type,'')) LIKE :fWp");
    params.fWp = `%${filters.workplace_type.toLowerCase()}%`;
  }
  if (filters.commitment) {
    conditions.push("LOWER(COALESCE(commitment,'')) LIKE :fCommit");
    params.fCommit = `%${filters.commitment.toLowerCase()}%`;
  }
  if (filters.inCrm === 'yes') {
    conditions.push('EXISTS (SELECT 1 FROM crm_jobs WHERE crm_jobs.job_id = jobs.id)');
  } else if (filters.inCrm === 'no') {
    conditions.push('NOT EXISTS (SELECT 1 FROM crm_jobs WHERE crm_jobs.job_id = jobs.id)');
  }

  // Full-text-ish search across all text fields
  if (filters.search && filters.search.trim()) {
    const q = filters.search.trim();
    const mode = filters.searchMode || 'fuzzy';

    if (mode === 'fuzzy') {
      // Every whitespace-separated word must appear in at least one field
      const words = q.toLowerCase().split(/\s+/).filter(Boolean);
      words.forEach((word, wi) => {
        const fieldConds = SEARCH_FIELDS.map(f => `LOWER(COALESCE(${f},'')) LIKE :sw${wi}`);
        conditions.push(`(${fieldConds.join(' OR ')})`);
        params[`sw${wi}`] = `%${word}%`;
      });
    } else {
      // exact or regex (SQLite has no native regex, fall back to LIKE for both)
      const fieldConds = SEARCH_FIELDS.map(f => `LOWER(COALESCE(${f},'')) LIKE :sExact`);
      conditions.push(`(${fieldConds.join(' OR ')})`);
      params.sExact = `%${q.toLowerCase()}%`;
    }
  }

  return { clause: conditions.join(' AND '), params };
}

export async function getJobsCount(filters: PaginatedJobQuery = {}): Promise<number> {
  const { clause, params } = buildJobWhere(filters);
  const row = db.prepare(`SELECT COUNT(*) as cnt FROM jobs WHERE ${clause}`).get(params) as unknown as { cnt: number };
  return row.cnt;
}

export async function getJobsPaginated(filters: PaginatedJobQuery = {}): Promise<PaginatedResult<Omit<Job, 'description'> & { description_short: string | null }>> {
  const page = Math.max(1, filters.page || 1);
  const pageSize = Math.min(100, Math.max(1, filters.pageSize || 25));
  const offset = (page - 1) * pageSize;

  const { clause, params } = buildJobWhere(filters);

  // Count
  const countRow = db.prepare(`SELECT COUNT(*) as cnt FROM jobs WHERE ${clause}`).get(params) as unknown as { cnt: number };
  const total = countRow.cnt;

  // Sort
  let sortCol = 'first_seen';
  if (filters.sortBy && ALLOWED_SORT_COLUMNS.has(filters.sortBy)) {
    sortCol = filters.sortBy;
  }
  const sortDir = filters.sortDir === 'asc' ? 'ASC' : 'DESC';

  // Query with truncated description
  const rows = db.prepare(
    `SELECT id, source_id, sync_id, company, title, location, workplace_type, commitment,
            department, team, SUBSTR(description, 1, 500) as description_short, url, first_seen
     FROM jobs WHERE ${clause}
     ORDER BY ${sortCol} ${sortDir}
     LIMIT :_limit OFFSET :_offset`
  ).all({ ...params, _limit: pageSize, _offset: offset }) as unknown as (Omit<Job, 'description'> & { description_short: string | null })[];

  return { data: rows, total, page, pageSize };
}

export async function getSourcesCount(): Promise<number> {
  const row = db.prepare('SELECT COUNT(*) as cnt FROM sources').get() as unknown as { cnt: number };
  return row.cnt;
}

export async function getSourcesPaginated(
  page = 1,
  pageSize = 25,
  search = '',
  status = '',
): Promise<PaginatedResult<Source>> {
  page = Math.max(1, page);
  pageSize = Math.min(100, Math.max(1, pageSize));
  const offset = (page - 1) * pageSize;

  const conditions: string[] = [];
  const params: string[] = [];

  if (search) {
    const like = `%${search}%`;
    conditions.push("(company LIKE ? OR url LIKE ? OR parser LIKE ?)");
    params.push(like, like, like);
  }
  if (status) {
    conditions.push("last_status = ?");
    params.push(status);
  }

  const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

  const countRow = db.prepare(`SELECT COUNT(*) as cnt FROM sources ${where}`).get(...params) as unknown as { cnt: number };
  const total = countRow.cnt;

  const rows = db.prepare(
    `SELECT * FROM sources ${where} ORDER BY added_at DESC LIMIT ? OFFSET ?`
  ).all(...params, pageSize, offset) as unknown as Source[];

  return { data: rows, total, page, pageSize };
}

export async function getJobStats(): Promise<{ totalJobs: number; totalSources: number; companies: string[]; locations: string[]; departments: string[]; workplaceTypes: string[]; commitmentTypes: string[] }> {
  const { totalJobs, totalSources } = await getJobCounts();
  const companyRows = db.prepare('SELECT DISTINCT company FROM jobs ORDER BY company').all() as unknown as { company: string }[];
  const locationRows = db.prepare("SELECT DISTINCT location FROM jobs WHERE location IS NOT NULL AND location != '' ORDER BY location").all() as unknown as { location: string }[];
  const departmentRows = db.prepare("SELECT DISTINCT department FROM jobs WHERE department IS NOT NULL AND department != '' ORDER BY department").all() as unknown as { department: string }[];
  const workplaceRows = db.prepare("SELECT DISTINCT workplace_type FROM jobs WHERE workplace_type IS NOT NULL AND workplace_type != '' ORDER BY workplace_type").all() as unknown as { workplace_type: string }[];
  const commitmentRows = db.prepare("SELECT DISTINCT commitment FROM jobs WHERE commitment IS NOT NULL AND commitment != '' ORDER BY commitment").all() as unknown as { commitment: string }[];
  return {
    totalJobs,
    totalSources,
    companies: companyRows.map(r => r.company),
    locations: locationRows.map(r => r.location),
    departments: departmentRows.map(r => r.department),
    workplaceTypes: workplaceRows.map(r => r.workplace_type),
    commitmentTypes: commitmentRows.map(r => r.commitment),
  };
}

/**
 * Cascading filter options: for each dropdown field return DISTINCT values
 * constrained by ALL other active filters (excluding that field's own filter).
 */
export async function getJobFilterOptions(filters: PaginatedJobQuery = {}): Promise<{
  companies: string[]; locations: string[]; departments: string[]; workplaceTypes: string[]; commitmentTypes: string[];
}> {
  const fieldDefs: { resultKey: string; col: string; filterKey: keyof PaginatedJobQuery; nullable: boolean }[] = [
    { resultKey: 'companies',       col: 'company',        filterKey: 'company',        nullable: false },
    { resultKey: 'locations',       col: 'location',       filterKey: 'location',       nullable: true },
    { resultKey: 'departments',     col: 'department',     filterKey: 'department',      nullable: true },
    { resultKey: 'workplaceTypes',  col: 'workplace_type', filterKey: 'workplace_type', nullable: true },
    { resultKey: 'commitmentTypes', col: 'commitment',     filterKey: 'commitment',     nullable: true },
  ];

  const result: Record<string, string[]> = {};

  for (const fd of fieldDefs) {
    // Build filters without this field's own value
    const modified = { ...filters, [fd.filterKey]: undefined };
    const { clause, params } = buildJobWhere(modified);
    const nullCheck = fd.nullable ? ` AND ${fd.col} IS NOT NULL AND ${fd.col} != ''` : '';
    const rows = db.prepare(
      `SELECT DISTINCT ${fd.col} FROM jobs WHERE ${clause}${nullCheck} ORDER BY ${fd.col}`
    ).all(params) as unknown as Record<string, string>[];
    result[fd.resultKey] = rows.map(r => r[fd.col]);
  }

  return result as { companies: string[]; locations: string[]; departments: string[]; workplaceTypes: string[]; commitmentTypes: string[] };
}

// ─── Sync log ────────────────────────────────────────────────────────────────

export async function startSyncLog(): Promise<number> {
  const result = db
    .prepare(`INSERT INTO sync_log (started_at, sources_count, new_jobs) VALUES (?, 0, 0)`)
    .run(new Date().toISOString());
  return Number(result.lastInsertRowid);
}

export async function completeSyncLog(id: number, sourcesCount: number, newJobs: number): Promise<void> {
  db.prepare(
    `UPDATE sync_log SET completed_at=?, sources_count=?, new_jobs=? WHERE id=?`
  ).run(new Date().toISOString(), sourcesCount, newJobs, id);
}

export async function getLatestSyncLog(): Promise<SyncLog | undefined> {
  return db
    .prepare('SELECT * FROM sync_log WHERE completed_at IS NOT NULL ORDER BY id DESC LIMIT 1')
    .get() as unknown as SyncLog | undefined;
}

// ─── HTML backups ─────────────────────────────────────────────────────────────

export async function insertHtmlBackup(sourceId: number, syncId: number, html: string): Promise<void> {
  db.prepare(
    `INSERT INTO html_backups (source_id, sync_id, html, captured_at) VALUES (?, ?, ?, ?)`
  ).run(sourceId, syncId, html, new Date().toISOString());
}

// ─── CRM Jobs ─────────────────────────────────────────────────────────────────

export async function getCrmJobByJobId(jobId: number): Promise<CrmJob | undefined> {
  return db.prepare('SELECT * FROM crm_jobs WHERE job_id = ?').get(jobId) as unknown as CrmJob | undefined;
}

export async function insertCrmJob(
  jobId: number, bucket: CrmBucket, comment?: string, reason?: string
): Promise<number> {
  const now = new Date().toISOString();
  const processingStatus = bucket === 'sourced' ? 'idle' : 'idle';
  const result = db.prepare(
    `INSERT OR IGNORE INTO crm_jobs (job_id, bucket, user_comment, disqualify_reason, added_at, last_moved_at, processing_status)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(jobId, bucket, comment ?? null, reason ?? null, now, now, processingStatus);
  return Number(result.lastInsertRowid) || 0;
}

export async function getCrmJobsByBucket(
  bucket: CrmBucket, page: number, pageSize: number
): Promise<PaginatedResult<CrmJobWithDetails>> {
  page = Math.max(1, page);
  pageSize = Math.min(100, Math.max(1, pageSize));
  const offset = (page - 1) * pageSize;

  const countRow = db.prepare(
    'SELECT COUNT(*) as cnt FROM crm_jobs WHERE bucket = ?'
  ).get(bucket) as unknown as { cnt: number };
  const total = countRow.cnt;

  const rows = db.prepare(
    `SELECT cj.*, j.title, j.company, j.location, j.workplace_type, j.department, j.team, j.commitment, j.description, j.url
     FROM crm_jobs cj
     JOIN jobs j ON cj.job_id = j.id
     WHERE cj.bucket = ?
     ORDER BY cj.last_moved_at DESC
     LIMIT ? OFFSET ?`
  ).all(bucket, pageSize, offset) as unknown as CrmJobWithDetails[];

  return { data: rows, total, page, pageSize };
}

export async function getCrmJobWithDetails(crmJobId: number): Promise<CrmJobWithDetails | undefined> {
  return db.prepare(
    `SELECT cj.*, j.title, j.company, j.location, j.workplace_type, j.department, j.team, j.commitment, j.description, j.url
     FROM crm_jobs cj
     JOIN jobs j ON cj.job_id = j.id
     WHERE cj.id = ?`
  ).get(crmJobId) as unknown as CrmJobWithDetails | undefined;
}

export async function updateCrmJobBucket(
  crmJobId: number, bucket: CrmBucket,
  opts?: { tier?: CrmTier | null; applicationDate?: string; reason?: string; processingStatus?: CrmProcessingStatus }
): Promise<void> {
  const sets: string[] = ['bucket = ?', 'last_moved_at = ?'];
  const params: (string | number | null)[] = [bucket, new Date().toISOString()];

  if (opts?.tier !== undefined) {
    sets.push('tier = ?');
    params.push(opts.tier);
  }
  if (opts?.applicationDate !== undefined) {
    sets.push('application_date = ?');
    params.push(opts.applicationDate);
  }
  if (opts?.reason !== undefined) {
    sets.push('disqualify_reason = ?');
    params.push(opts.reason);
  }
  if (opts?.processingStatus !== undefined) {
    sets.push('processing_status = ?');
    params.push(opts.processingStatus);
  }

  params.push(crmJobId);
  db.prepare(`UPDATE crm_jobs SET ${sets.join(', ')} WHERE id = ?`).run(...(params as [string | number | null, ...Array<string | number | null>]));
}

export async function updateCrmJobComment(crmJobId: number, comment: string | null): Promise<void> {
  db.prepare('UPDATE crm_jobs SET user_comment = ? WHERE id = ?').run(comment, crmJobId);
}

export async function updateCrmJobProcessingStatus(crmJobId: number, status: CrmProcessingStatus): Promise<void> {
  db.prepare('UPDATE crm_jobs SET processing_status = ? WHERE id = ?').run(status, crmJobId);
}

export async function updateCrmJobTier(crmJobId: number, tier: CrmTier | null): Promise<void> {
  db.prepare('UPDATE crm_jobs SET tier = ? WHERE id = ?').run(tier, crmJobId);
}

export async function deleteCrmJob(crmJobId: number): Promise<void> {
  db.prepare('DELETE FROM crm_jobs WHERE id = ?').run(crmJobId);
}

export async function getCrmBucketCounts(): Promise<CrmBucketCounts> {
  const rows = db.prepare(
    `SELECT bucket, COUNT(*) as cnt FROM crm_jobs GROUP BY bucket`
  ).all() as unknown as { bucket: CrmBucket; cnt: number }[];

  const counts: CrmBucketCounts = {
    sourced: 0, filtered: 0, processed: 0, applied: 0,
    disqualified: 0, auto_disqualified: 0,
  };
  for (const row of rows) {
    if (row.bucket in counts) {
      counts[row.bucket] = row.cnt;
    }
  }
  return counts;
}

/** Get CRM bucket counts filtered by job-property filters (for cascading badge updates) */
export async function getCrmBucketCountsFiltered(filters: CrmJobFilter = {}): Promise<CrmBucketCounts> {
  const { conditions, params } = buildCrmJobWhere(filters);
  const whereClause = conditions.length > 0 ? conditions.join(' AND ') : '1=1';
  const rows = db.prepare(
    `SELECT cj.bucket, COUNT(*) as cnt
     FROM crm_jobs cj
     JOIN jobs j ON cj.job_id = j.id
     WHERE ${whereClause}
     GROUP BY cj.bucket`
  ).all(params) as unknown as { bucket: CrmBucket; cnt: number }[];

  const counts: CrmBucketCounts = {
    sourced: 0, filtered: 0, processed: 0, applied: 0,
    disqualified: 0, auto_disqualified: 0,
  };
  for (const row of rows) {
    if (row.bucket in counts) {
      counts[row.bucket] = row.cnt;
    }
  }
  return counts;
}

export async function getNextPendingCrmJob(): Promise<CrmJobWithDetails | undefined> {
  return db.prepare(
    `SELECT cj.*, j.title, j.company, j.location, j.workplace_type, j.department, j.description, j.url
     FROM crm_jobs cj
     JOIN jobs j ON cj.job_id = j.id
     WHERE cj.processing_status = 'pending'
     ORDER BY cj.last_moved_at ASC
     LIMIT 1`
  ).get() as unknown as CrmJobWithDetails | undefined;
}

export async function resetProcessingJobs(): Promise<number> {
  const result = db.prepare(
    `UPDATE crm_jobs SET processing_status = 'pending' WHERE processing_status = 'processing'`
  ).run();
  return Number(result.changes);
}

export async function resetErroredJobs(): Promise<number> {
  const result = db.prepare(
    `UPDATE crm_jobs SET processing_status = 'pending' WHERE processing_status = 'error'`
  ).run();
  return Number(result.changes);
}

export async function getCrmJobsForSourceJob(jobId: number): Promise<CrmJob | undefined> {
  return db.prepare('SELECT * FROM crm_jobs WHERE job_id = ?').get(jobId) as unknown as CrmJob | undefined;
}

export async function getErroredCrmJobs(): Promise<CrmJobWithDetails[]> {
  return db.prepare(
    `SELECT cj.*, j.title, j.company, j.location, j.workplace_type, j.department, j.description, j.url
     FROM crm_jobs cj
     JOIN jobs j ON cj.job_id = j.id
     WHERE cj.processing_status = 'error'
     ORDER BY cj.last_moved_at DESC`
  ).all() as unknown as CrmJobWithDetails[];
}

export async function getCrmStatusMap(jobIds: number[]): Promise<Record<number, { bucket: CrmBucket; tier: CrmTier | null }>> {
  if (jobIds.length === 0) return {};
  const placeholders = jobIds.map(() => '?').join(',');
  const rows = db.prepare(
    `SELECT job_id, bucket, tier FROM crm_jobs WHERE job_id IN (${placeholders})`
  ).all(...jobIds) as unknown as { job_id: number; bucket: CrmBucket; tier: CrmTier | null }[];
  const map: Record<number, { bucket: CrmBucket; tier: CrmTier | null }> = {};
  for (const r of rows) {
    map[r.job_id] = { bucket: r.bucket, tier: r.tier };
  }
  return map;
}

// ─── CRM Events ───────────────────────────────────────────────────────────────

export async function insertCrmEvent(event: Omit<CrmEvent, 'id'>): Promise<number> {
  const result = db.prepare(
    `INSERT INTO crm_events (crm_job_id, event_type, actor, from_bucket, to_bucket, context_data, comment, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    event.crm_job_id, event.event_type, event.actor,
    event.from_bucket ?? null, event.to_bucket ?? null,
    event.context_data ?? null, event.comment ?? null, event.created_at
  );
  return Number(result.lastInsertRowid);
}

export async function getCrmEventsByJob(crmJobId: number): Promise<CrmEvent[]> {
  return db.prepare(
    'SELECT * FROM crm_events WHERE crm_job_id = ? ORDER BY created_at DESC'
  ).all(crmJobId) as unknown as CrmEvent[];
}

// ─── CRM Filters ──────────────────────────────────────────────────────────────

export async function getCrmFilters(): Promise<CrmFilter[]> {
  return db.prepare('SELECT * FROM crm_filters ORDER BY sort_order ASC, id ASC').all() as unknown as CrmFilter[];
}

export async function getCrmFilterById(id: number): Promise<CrmFilter | undefined> {
  return db.prepare('SELECT * FROM crm_filters WHERE id = ?').get(id) as unknown as CrmFilter | undefined;
}

export async function insertCrmFilter(filter: Omit<CrmFilter, 'id'>): Promise<number> {
  const result = db.prepare(
    `INSERT INTO crm_filters (name, filter_type, config, is_active, sort_order, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(filter.name, filter.filter_type, filter.config, filter.is_active, filter.sort_order, filter.created_at);
  return Number(result.lastInsertRowid);
}

export async function updateCrmFilter(id: number, updates: Partial<CrmFilter>): Promise<void> {
  const sets: string[] = [];
  const params: (string | number | null)[] = [];

  if (updates.name !== undefined) { sets.push('name = ?'); params.push(updates.name); }
  if (updates.filter_type !== undefined) { sets.push('filter_type = ?'); params.push(updates.filter_type); }
  if (updates.config !== undefined) { sets.push('config = ?'); params.push(updates.config); }
  if (updates.is_active !== undefined) { sets.push('is_active = ?'); params.push(updates.is_active); }
  if (updates.sort_order !== undefined) { sets.push('sort_order = ?'); params.push(updates.sort_order); }

  if (sets.length === 0) return;
  params.push(id);
  db.prepare(`UPDATE crm_filters SET ${sets.join(', ')} WHERE id = ?`).run(...(params as [string | number | null, ...Array<string | number | null>]));
}

export async function deleteCrmFilter(id: number): Promise<void> {
  db.prepare('DELETE FROM crm_filters WHERE id = ?').run(id);
}

export async function reorderCrmFilters(ids: number[]): Promise<void> {
  const stmt = db.prepare('UPDATE crm_filters SET sort_order = ? WHERE id = ?');
  for (let i = 0; i < ids.length; i++) {
    stmt.run(i, ids[i]);
  }
}

export async function getActiveCrmFilters(): Promise<CrmFilter[]> {
  return db.prepare(
    'SELECT * FROM crm_filters WHERE is_active = 1 ORDER BY sort_order ASC, id ASC'
  ).all() as unknown as CrmFilter[];
}

export async function deactivateCrmFiltersByType(filterType: CrmFilterType): Promise<void> {
  db.prepare('UPDATE crm_filters SET is_active = 0 WHERE filter_type = ?').run(filterType);
}

// ─── CRM Settings ─────────────────────────────────────────────────────────────

export async function getCrmSettings(): Promise<Record<string, string>> {
  const rows = db.prepare('SELECT key, value FROM crm_settings').all() as unknown as CrmSetting[];
  const settings: Record<string, string> = {};
  for (const r of rows) {
    settings[r.key] = r.value;
  }
  return settings;
}

export async function getCrmSetting(key: string): Promise<string | undefined> {
  const row = db.prepare('SELECT value FROM crm_settings WHERE key = ?').get(key) as unknown as { value: string } | undefined;
  return row?.value;
}

export async function setCrmSetting(key: string, value: string): Promise<void> {
  db.prepare(
    'INSERT INTO crm_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, value);
}

// ─── CRM Analytics ────────────────────────────────────────────────────────────

export interface CrmJobFilter {
  company?: string;
  location?: string;
  title?: string;
  department?: string;
  workplace_type?: string;
  commitment?: string;
  search?: string;
  searchMode?: 'fuzzy' | 'exact' | 'regex';
  /** Filter by the CRM auto-filter (pipeline filter) that caused disqualification */
  autoFilter?: string;
}

/** Build WHERE conditions for CRM jobs filtered by underlying job properties */
function buildCrmJobWhere(filters: CrmJobFilter): { conditions: string[]; params: Record<string, string | number | null> } {
  const conditions: string[] = [];
  const params: Record<string, string | number | null> = {};

  if (filters.company) {
    conditions.push('j.company = :fCompany');
    params.fCompany = filters.company;
  }
  if (filters.location) {
    conditions.push("LOWER(COALESCE(j.location,'')) LIKE :fLoc");
    params.fLoc = `%${filters.location.toLowerCase()}%`;
  }
  if (filters.title) {
    conditions.push('LOWER(j.title) LIKE :fTitle');
    params.fTitle = `%${filters.title.toLowerCase()}%`;
  }
  if (filters.department) {
    conditions.push("LOWER(COALESCE(j.department,'')) LIKE :fDept");
    params.fDept = `%${filters.department.toLowerCase()}%`;
  }
  if (filters.workplace_type) {
    conditions.push("LOWER(COALESCE(j.workplace_type,'')) LIKE :fWp");
    params.fWp = `%${filters.workplace_type.toLowerCase()}%`;
  }
  if (filters.commitment) {
    conditions.push("LOWER(COALESCE(j.commitment,'')) LIKE :fCommit");
    params.fCommit = `%${filters.commitment.toLowerCase()}%`;
  }
  if (filters.search && filters.search.trim()) {
    const q = filters.search.trim();
    const mode = filters.searchMode || 'fuzzy';
    const searchFields = ['j.title', 'j.company', 'j.location', 'j.workplace_type', 'j.commitment', 'j.department', 'j.team', 'j.description'];
    if (mode === 'fuzzy') {
      const words = q.toLowerCase().split(/\s+/).filter(Boolean);
      words.forEach((word, wi) => {
        const fieldConds = searchFields.map(f => `LOWER(COALESCE(${f},'')) LIKE :csw${wi}`);
        conditions.push(`(${fieldConds.join(' OR ')})`);
        params[`csw${wi}`] = `%${word}%`;
      });
    } else {
      const fieldConds = searchFields.map(f => `LOWER(COALESCE(${f},'')) LIKE :csExact`);
      conditions.push(`(${fieldConds.join(' OR ')})`);
      params.csExact = `%${q.toLowerCase()}%`;
    }
  }
  if (filters.autoFilter) {
    // Match jobs that were auto-disqualified by this specific filter name (stored in crm_events context_data)
    conditions.push(
      `cj.id IN (
        SELECT crm_job_id FROM crm_events
        WHERE event_type IN ('keyword_disqualified', 'llm_filter_failed')
        AND json_extract(context_data, '$.filter_name') = :fAutoFilter
      )`
    );
    params.fAutoFilter = filters.autoFilter;
  }

  return { conditions, params };
}

/** Get CRM jobs by bucket with optional job-property filters */
export async function getCrmJobsByBucketFiltered(
  bucket: CrmBucket, page: number, pageSize: number, filters: CrmJobFilter = {}
): Promise<PaginatedResult<CrmJobWithDetails>> {
  page = Math.max(1, page);
  pageSize = Math.min(100, Math.max(1, pageSize));
  const offset = (page - 1) * pageSize;

  const { conditions, params } = buildCrmJobWhere(filters);
  const allConditions = ['cj.bucket = :bucket', ...conditions];
  const allParams = { ...params, bucket };
  const whereClause = allConditions.join(' AND ');

  // Single query: use COUNT(*) OVER() window function to get total alongside data,
  // avoiding a separate COUNT query (important for expensive regex/search filters).
  const rows = db.prepare(
    `SELECT cj.*, j.title, j.company, j.location, j.workplace_type, j.department, j.team, j.commitment, j.description, j.url,
            COUNT(*) OVER() AS _total
     FROM crm_jobs cj
     JOIN jobs j ON cj.job_id = j.id
     WHERE ${whereClause}
     ORDER BY cj.last_moved_at DESC
     LIMIT :_limit OFFSET :_offset`
  ).all({ ...allParams, _limit: pageSize, _offset: offset }) as unknown as (CrmJobWithDetails & { _total: number })[];

  const total = rows.length > 0 ? rows[0]._total : 0;
  // Strip _total from returned data
  const data = rows.map(({ _total, ...rest }) => rest) as CrmJobWithDetails[];

  return { data, total, page, pageSize };
}

/** Get CRM filter options (distinct values for job fields, scoped to CRM jobs and optional filters) */
export async function getCrmFilterOptions(filters: CrmJobFilter & { bucket?: string } = {}): Promise<{
  companies: string[]; locations: string[]; departments: string[]; workplaceTypes: string[]; commitmentTypes: string[]; autoFilterNames: string[];
}> {
  const fieldDefs: { resultKey: string; col: string; filterKey: keyof CrmJobFilter; nullable: boolean }[] = [
    { resultKey: 'companies',       col: 'j.company',        filterKey: 'company',        nullable: false },
    { resultKey: 'locations',       col: 'j.location',       filterKey: 'location',       nullable: true },
    { resultKey: 'departments',     col: 'j.department',     filterKey: 'department',      nullable: true },
    { resultKey: 'workplaceTypes',  col: 'j.workplace_type', filterKey: 'workplace_type', nullable: true },
    { resultKey: 'commitmentTypes', col: 'j.commitment',     filterKey: 'commitment',     nullable: true },
  ];

  const result: Record<string, string[]> = {};

  // Strip search from filter-option queries: search (especially regex) is very expensive
  // and shouldn't cascade into dropdown options — e.g. available companies don't need
  // to be restricted by a regex match on description text.
  const filtersNoSearch = { ...filters, search: undefined, searchMode: undefined };

  for (const fd of fieldDefs) {
    const modified = { ...filtersNoSearch, [fd.filterKey]: undefined };
    const { conditions, params } = buildCrmJobWhere(modified);
    const allConditions = [...conditions];
    if (filters.bucket) {
      allConditions.push('cj.bucket = :fBucket');
      (params as any).fBucket = filters.bucket;
    }
    const whereClause = allConditions.length > 0 ? allConditions.join(' AND ') : '1=1';
    const nullCheck = fd.nullable ? ` AND ${fd.col} IS NOT NULL AND ${fd.col} != ''` : '';
    const colAlias = fd.col.split('.')[1];
    const rows = db.prepare(
      `SELECT DISTINCT ${fd.col} as ${colAlias} FROM crm_jobs cj JOIN jobs j ON cj.job_id = j.id WHERE ${whereClause}${nullCheck} ORDER BY ${fd.col}`
    ).all(params) as unknown as Record<string, string>[];
    result[fd.resultKey] = rows.map(r => r[colAlias]);
  }

  // Distinct auto-filter names from disqualification events for currently matching CRM jobs
  // (scoped by all active filters except autoFilter itself, so the dropdown stays populated)
  {
    const modified = { ...filtersNoSearch, autoFilter: undefined };
    const { conditions, params } = buildCrmJobWhere(modified);
    const whereClause = conditions.length > 0 ? conditions.join(' AND ') : '1=1';
    const autoFilterRows = db.prepare(
      `SELECT DISTINCT json_extract(ce.context_data, '$.filter_name') AS filter_name
       FROM crm_events ce
       JOIN crm_jobs cj ON ce.crm_job_id = cj.id
       JOIN jobs j ON cj.job_id = j.id
       WHERE ce.event_type IN ('keyword_disqualified', 'llm_filter_failed')
         AND ce.context_data IS NOT NULL
         AND json_extract(ce.context_data, '$.filter_name') IS NOT NULL
         AND ${whereClause}
       ORDER BY filter_name`
    ).all(params) as unknown as { filter_name: string }[];
    result['autoFilterNames'] = autoFilterRows.map(r => r.filter_name);
  }

  return result as { companies: string[]; locations: string[]; departments: string[]; workplaceTypes: string[]; commitmentTypes: string[]; autoFilterNames: string[] };
}

/** Get funnel analytics: stage transitions and filter disqualification stats */
export async function getCrmFunnelAnalytics(filters: CrmJobFilter = {}): Promise<{
  flows: { from: string; to: string; count: number }[];
  filterStats: { filterName: string; filterType: string; count: number }[];
  bucketCounts: Record<string, number>;
  totalJobs: number;
}> {
  const { conditions, params } = buildCrmJobWhere(filters);
  const extraWhere = conditions.length > 0 ? 'AND ' + conditions.join(' AND ') : '';

  // Get all CRM job IDs that match the filter
  const matchingJobs = db.prepare(
    `SELECT cj.id FROM crm_jobs cj JOIN jobs j ON cj.job_id = j.id WHERE 1=1 ${extraWhere}`
  ).all(params) as unknown as { id: number }[];
  const crmJobIds = matchingJobs.map(r => r.id);

  if (crmJobIds.length === 0) {
    return { flows: [], filterStats: [], bucketCounts: {}, totalJobs: 0 };
  }

  // Bucket counts for matched jobs
  const bucketRows = db.prepare(
    `SELECT cj.bucket, COUNT(*) as cnt FROM crm_jobs cj JOIN jobs j ON cj.job_id = j.id WHERE 1=1 ${extraWhere} GROUP BY cj.bucket`
  ).all(params) as unknown as { bucket: string; cnt: number }[];
  const bucketCounts: Record<string, number> = {};
  for (const r of bucketRows) bucketCounts[r.bucket] = r.cnt;

  // Get all transition events for matched jobs
  // Use batched IN clause for large sets
  const placeholders = crmJobIds.map(() => '?').join(',');
  const transitionEvents = db.prepare(
    `SELECT crm_job_id, event_type, from_bucket, to_bucket, context_data
     FROM crm_events
     WHERE crm_job_id IN (${placeholders})
       AND (from_bucket IS NOT NULL AND to_bucket IS NOT NULL)
     ORDER BY crm_job_id, created_at ASC`
  ).all(...crmJobIds) as unknown as { crm_job_id: number; event_type: string; from_bucket: string; to_bucket: string; context_data: string | null }[];

  // Count stage transitions
  const flowMap = new Map<string, number>();
  for (const evt of transitionEvents) {
    if (evt.from_bucket && evt.to_bucket && evt.from_bucket !== evt.to_bucket) {
      const key = `${evt.from_bucket}|${evt.to_bucket}`;
      flowMap.set(key, (flowMap.get(key) || 0) + 1);
    }
  }

  const flows = Array.from(flowMap.entries()).map(([key, count]) => {
    const [from, to] = key.split('|');
    return { from, to, count };
  }).sort((a, b) => b.count - a.count);

  // Filter disqualification stats (from context_data)
  const disqualEvents = db.prepare(
    `SELECT context_data, event_type
     FROM crm_events
     WHERE crm_job_id IN (${placeholders})
       AND event_type IN ('keyword_disqualified', 'llm_filter_failed')
     ORDER BY created_at ASC`
  ).all(...crmJobIds) as unknown as { context_data: string | null; event_type: string }[];

  const filterStatsMap = new Map<string, { filterType: string; count: number }>();
  for (const evt of disqualEvents) {
    let filterName = evt.event_type === 'keyword_disqualified' ? 'Keyword Filter' : 'LLM Filter';
    let filterType = evt.event_type === 'keyword_disqualified' ? 'keyword' : 'llm_filter';
    if (evt.context_data) {
      try {
        const ctx = JSON.parse(evt.context_data);
        if (ctx.filter_name) filterName = ctx.filter_name;
        if (ctx.filter_type) filterType = ctx.filter_type;
      } catch { /* ignore */ }
    }
    const existing = filterStatsMap.get(filterName);
    if (existing) {
      existing.count++;
    } else {
      filterStatsMap.set(filterName, { filterType, count: 1 });
    }
  }

  const filterStats = Array.from(filterStatsMap.entries()).map(([name, data]) => ({
    filterName: name,
    filterType: data.filterType,
    count: data.count,
  })).sort((a, b) => b.count - a.count);

  // Also count jobs that are currently in each bucket but have NO transition events
  // (jobs added directly to a bucket without moves)
  const addedEvents = db.prepare(
    `SELECT crm_job_id, to_bucket
     FROM crm_events
     WHERE crm_job_id IN (${placeholders})
       AND event_type = 'added'
     ORDER BY created_at ASC`
  ).all(...crmJobIds) as unknown as { crm_job_id: number; to_bucket: string }[];

  // Count "added" entries as initial flow
  const addedMap = new Map<string, number>();
  for (const evt of addedEvents) {
    if (evt.to_bucket) {
      const key = `_entry|${evt.to_bucket}`;
      addedMap.set(key, (addedMap.get(key) || 0) + 1);
    }
  }

  // Add entry flows
  for (const [key, count] of addedMap) {
    const [from, to] = key.split('|');
    flows.push({ from, to, count });
  }

  return { flows, filterStats, bucketCounts, totalJobs: crmJobIds.length };
}
