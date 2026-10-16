/**
 * PostgreSQL adapter (production / Docker mode, DATABASE_URL set).
 * Uses the `pg` package (node-postgres).
 */
import { Pool } from 'pg';
import fs from 'fs';
import path from 'path';
import {
  Job, JobFilters, PaginatedJobQuery, PaginatedResult, Source, SyncLog,
  CrmJob, CrmJobWithDetails, CrmEvent, CrmFilter, CrmFilterType,
  CrmBucket, CrmTier, CrmProcessingStatus, CrmBucketCounts, CrmSetting,
} from '../types';

export interface CrmJobFilter {
  company?: string;
  location?: string;
  title?: string;
  department?: string;
  workplace_type?: string;
  commitment?: string;
  search?: string;
  searchMode?: 'fuzzy' | 'exact' | 'regex';
  /** Filter by the CRM auto-filter that caused disqualification */
  autoFilter?: string;
}

let pool: Pool;

export async function initDb(): Promise<void> {
  pool = new Pool({ connectionString: process.env['DATABASE_URL'] });
  await runMigrations();
}

async function runMigrations(): Promise<void> {
  const client = await pool.connect();
  try {
    // Create migrations tracking table if it doesn't exist yet
    await client.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY)`
    );
    const { rows } = await client.query(`SELECT version FROM schema_migrations WHERE version = 1`);
    if (rows.length === 0) {
      const migrationPath = path.join(__dirname, '..', 'migrations', '0001_init_pg.sql');
      const sql = fs.readFileSync(migrationPath, 'utf8');
      await client.query(sql);
      await client.query(`INSERT INTO schema_migrations (version) VALUES (1)`);
      console.log('[pg] Migration 0001 applied');
    }
    const { rows: rows2 } = await client.query(`SELECT version FROM schema_migrations WHERE version = 2`);
    if (rows2.length === 0) {
      const migrationPath = path.join(__dirname, '..', 'migrations', '0002_add_department_team_pg.sql');
      const sql = fs.readFileSync(migrationPath, 'utf8');
      await client.query(sql);
      await client.query(`INSERT INTO schema_migrations (version) VALUES (2)`);
      console.log('[pg] Migration 0002 applied');
    }
    const { rows: rows3 } = await client.query(`SELECT version FROM schema_migrations WHERE version = 3`);
    if (rows3.length === 0) {
      const migrationPath = path.join(__dirname, '..', 'migrations', '0003_crm_pipeline_pg.sql');
      const sql = fs.readFileSync(migrationPath, 'utf8');
      await client.query(sql);
      await client.query(`INSERT INTO schema_migrations (version) VALUES (3)`);
      console.log('[pg] Migration 0003 applied');
    }
    const { rows: rows4 } = await client.query(`SELECT version FROM schema_migrations WHERE version = 4`);
    if (rows4.length === 0) {
      const migrationPath = path.join(__dirname, '..', 'migrations', '0004_gemini_settings_pg.sql');
      const sql = fs.readFileSync(migrationPath, 'utf8');
      await client.query(sql);
      await client.query(`INSERT INTO schema_migrations (version) VALUES (4)`);
      console.log('[pg] Migration 0004 applied');
    }
    const { rows: rows5 } = await client.query(`SELECT version FROM schema_migrations WHERE version = 5`);
    if (rows5.length === 0) {
      const migrationPath = path.join(__dirname, '..', 'migrations', '0005_performance_indexes_pg.sql');
      const sql = fs.readFileSync(migrationPath, 'utf8');
      await client.query(sql);
      await client.query(`INSERT INTO schema_migrations (version) VALUES (5)`);
      console.log('[pg] Migration 0005 applied (performance indexes)');
    }
    const { rows: rows6 } = await client.query(`SELECT version FROM schema_migrations WHERE version = 6`);
    if (rows6.length === 0) {
      const migrationPath = path.join(__dirname, '..', 'migrations', '0006_crm_composite_indexes_pg.sql');
      const sql = fs.readFileSync(migrationPath, 'utf8');
      await client.query(sql);
      await client.query(`INSERT INTO schema_migrations (version) VALUES (6)`);
      console.log('[pg] Migration 0006 applied (CRM composite indexes)');
    }
    const { rows: rows7 } = await client.query(`SELECT version FROM schema_migrations WHERE version = 7`);
    if (rows7.length === 0) {
      const migrationPath = path.join(__dirname, '..', 'migrations', '0007_add_backfill_flag_pg.sql');
      const sql = fs.readFileSync(migrationPath, 'utf8');
      await client.query(sql);
      await client.query(`INSERT INTO schema_migrations (version) VALUES (7)`);
      console.log('[pg] Migration 0007 applied (needs_backfill flag)');
    }
  } finally {
    client.release();
  }
}

// ─── Sources ─────────────────────────────────────────────────────────────────

export async function getSources(): Promise<Source[]> {
  const { rows } = await pool.query('SELECT * FROM sources ORDER BY added_at DESC');
  return rows as Source[];
}

export async function getJobCounts(): Promise<{ totalJobs: number; totalSources: number }> {
  const [jobRes, srcRes] = await Promise.all([
    pool.query('SELECT COUNT(*) as cnt FROM jobs'),
    pool.query('SELECT COUNT(*) as cnt FROM sources'),
  ]);
  return {
    totalJobs: parseInt(jobRes.rows[0].cnt, 10),
    totalSources: parseInt(srcRes.rows[0].cnt, 10),
  };
}

/** Sources ordered by staleness: never-synced first, then oldest sync first */
export async function getSourcesForSync(): Promise<Source[]> {
  const { rows } = await pool.query('SELECT * FROM sources ORDER BY last_synced IS NOT NULL, last_synced ASC');
  return rows as Source[];
}

export async function getSourceById(id: number): Promise<Source | undefined> {
  const { rows } = await pool.query('SELECT * FROM sources WHERE id = $1', [id]);
  return rows[0] as Source | undefined;
}

export async function insertSource(company: string, url: string, parser: string): Promise<number> {
  const { rows } = await pool.query(
    `INSERT INTO sources (company, url, parser, added_at) VALUES ($1, $2, $3, $4) RETURNING id`,
    [company, url, parser, new Date().toISOString()]
  );
  return rows[0].id as number;
}

export async function deleteSource(id: number): Promise<void> {
  // Must delete in FK-dependency order:
  // crm_events → crm_jobs (both reference jobs.id chain) → jobs → sources
  await pool.query(`
    DELETE FROM crm_events
     WHERE crm_job_id IN (
       SELECT cj.id FROM crm_jobs cj
       JOIN jobs j ON cj.job_id = j.id
       WHERE j.source_id = $1
     )
  `, [id]);
  await pool.query(`
    DELETE FROM crm_jobs
     WHERE job_id IN (SELECT id FROM jobs WHERE source_id = $1)
  `, [id]);
  await pool.query('DELETE FROM jobs WHERE source_id = $1', [id]);
  await pool.query('DELETE FROM sources WHERE id = $1', [id]);
}

export async function updateSourceSync(
  id: number, status: string, count: number, error?: string
): Promise<void> {
  await pool.query(
    `UPDATE sources SET last_synced=$1, last_status=$2, last_count=$3, last_error=$4 WHERE id=$5`,
    [new Date().toISOString(), status, count, error ?? null, id]
  );
}

// ─── Jobs ─────────────────────────────────────────────────────────────────────

export async function insertJobIfNew(job: Omit<Job, 'id'>): Promise<boolean> {
  const { rowCount } = await pool.query(
    `INSERT INTO jobs
       (source_id, sync_id, company, title, location, workplace_type, commitment, department, team, description, url, first_seen)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     ON CONFLICT (url) DO NOTHING`,
    [
      job.source_id, job.sync_id, job.company, job.title,
      job.location ?? null, job.workplace_type ?? null, job.commitment ?? null,
      job.department ?? null, job.team ?? null,
      job.description ?? null, job.url, job.first_seen,
    ]
  );
  return (rowCount ?? 0) === 1;
}

/**
 * Insert a job row from the listing stage and return its DB id along with
 * whether a new row was actually inserted (false = row already existed).
 */
export async function insertJobListingRow(job: Omit<Job, 'id'>): Promise<{ id: number; inserted: boolean }> {
  const needsBackfill = !job.description;
  const { rows } = await pool.query(
    `INSERT INTO jobs
       (source_id, sync_id, company, title, location, workplace_type, commitment, department, team, description, url, first_seen, needs_backfill)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT (url) DO NOTHING
     RETURNING id`,
    [
      job.source_id, job.sync_id, job.company, job.title,
      job.location ?? null, job.workplace_type ?? null, job.commitment ?? null,
      job.department ?? null, job.team ?? null,
      job.description ?? null, job.url, job.first_seen, needsBackfill,
    ]
  );
  if (rows.length > 0) return { id: rows[0].id as number, inserted: true };
  // Row already existed — fetch its id
  const { rows: existing } = await pool.query('SELECT id FROM jobs WHERE url = $1', [job.url]);
  return { id: existing[0].id as number, inserted: false };
}

/**
 * Update detail-page fields on an existing job row.
 * Only fields explicitly provided (non-undefined) are written.
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
  let i = 1;
  if (fields.description    !== undefined) { sets.push(`description = $${i++}`);    values.push(fields.description); }
  if (fields.workplace_type !== undefined) { sets.push(`workplace_type = $${i++}`); values.push(fields.workplace_type); }
  if (fields.commitment     !== undefined) { sets.push(`commitment = $${i++}`);     values.push(fields.commitment); }
  if (fields.department     !== undefined) { sets.push(`department = $${i++}`);     values.push(fields.department); }
  if (fields.team           !== undefined) { sets.push(`team = $${i++}`);           values.push(fields.team); }
  if (fields.location       !== undefined) { sets.push(`location = $${i++}`);       values.push(fields.location); }
  // A non-empty description written here resolves the partial-data condition,
  // so retire the row from the backfill backlog (owner comment 6195486910).
  if (fields.description !== undefined && fields.description !== '') {
    sets.push('needs_backfill = FALSE');
  }
  if (sets.length === 0) return;
  values.push(jobId);
  await pool.query(`UPDATE jobs SET ${sets.join(', ')} WHERE id = $${i}`, values);
}

export async function getJobs(filters: JobFilters = {}): Promise<Job[]> {
  const conditions: string[] = ['TRUE'];
  const params: unknown[] = [];
  let i = 1;

  if (filters.company)  { conditions.push(`company = $${i++}`);                            params.push(filters.company); }
  if (filters.title)    { conditions.push(`LOWER(title) LIKE $${i++}`);                    params.push(`%${filters.title.toLowerCase()}%`); }
  if (filters.location) { conditions.push(`LOWER(COALESCE(location,'')) LIKE $${i++}`);    params.push(`%${filters.location.toLowerCase()}%`); }
  if (filters.since)    { conditions.push(`first_seen >= $${i++}`);                         params.push(filters.since); }
  if (filters.syncId)   { conditions.push(`sync_id = $${i++}`);                             params.push(filters.syncId); }

  const { rows } = await pool.query(
    `SELECT * FROM jobs WHERE ${conditions.join(' AND ')} ORDER BY first_seen DESC`,
    params
  );
  return rows as Job[];
}

export async function getJobById(id: number): Promise<Job | undefined> {
  const { rows } = await pool.query('SELECT * FROM jobs WHERE id = $1', [id]);
  return rows[0] as Job | undefined;
}

export async function getJobsBySyncId(syncId: number): Promise<Job[]> {
  const { rows } = await pool.query(
    'SELECT * FROM jobs WHERE sync_id = $1 ORDER BY first_seen DESC', [syncId]
  );
  return rows as Job[];
}

export async function countJobsBySyncId(syncId: number): Promise<number> {
  const { rows } = await pool.query(
    'SELECT COUNT(*)::int AS count FROM jobs WHERE sync_id = $1', [syncId]
  );
  return Number(rows[0].count);
}

export async function getDistinctCompanies(): Promise<string[]> {
  const { rows } = await pool.query('SELECT DISTINCT company FROM jobs ORDER BY company');
  return rows.map((r: { company: string }) => r.company);
}

export async function getExistingJobUrls(sourceId: number): Promise<Set<string>> {
  const { rows } = await pool.query('SELECT url FROM jobs WHERE source_id = $1', [sourceId]);
  return new Set(rows.map((r: { url: string }) => r.url));
}

/** Return all jobs for a source that have a NULL or empty description. */
export async function getJobsWithEmptyDescription(sourceId: number): Promise<Pick<Job, 'id' | 'url' | 'title' | 'location' | 'department' | 'workplace_type' | 'commitment'>[]> {
  const { rows } = await pool.query(
    `SELECT id, url, title, location, department, workplace_type, commitment
     FROM jobs
     WHERE source_id = $1
       AND needs_backfill = TRUE`,
    [sourceId]
  );
  return rows as Pick<Job, 'id' | 'url' | 'title' | 'location' | 'department' | 'workplace_type' | 'commitment'>[];
}

/** Update the description of an existing job row by its primary key. */
export async function updateJobDescription(jobId: number, description: string): Promise<void> {
  await pool.query('UPDATE jobs SET description = $1 WHERE id = $2', [description, jobId]);
}

/** Raise/clear the needs_backfill flag on a job row. Cleared when a backfill
 *  succeeds (also implied by updateJobDetails) or the job is definitively gone
 *  (4xx); kept raised on transient failures so the row is retried next sync. */
export async function setJobNeedsBackfill(jobId: number, value: boolean): Promise<void> {
  await pool.query('UPDATE jobs SET needs_backfill = $1 WHERE id = $2', [value, jobId]);
}

// ─── Paginated queries ────────────────────────────────────────────────────────

const SEARCH_FIELDS = ['title', 'company', 'location', 'workplace_type', 'commitment', 'department', 'team', 'url'];
const ALLOWED_SORT_COLUMNS = new Set(['first_seen', 'company', 'title', 'location', 'department', 'workplace_type', 'commitment']);

/** Build WHERE clause + params for job filters (shared between count and paginated) */
function buildJobWhere(filters: PaginatedJobQuery): { clause: string; params: unknown[]; nextIdx: number } {
  const conditions: string[] = ['TRUE'];
  const params: unknown[] = [];
  let i = 1;

  if (filters.company) {
    conditions.push(`company = $${i++}`);
    params.push(filters.company);
  }
  if (filters.since) {
    conditions.push(`first_seen >= $${i++}`);
    params.push(filters.since);
  }
  if (filters.syncId) {
    conditions.push(`sync_id = $${i++}`);
    params.push(filters.syncId);
  }
  if (filters.location) {
    conditions.push(`LOWER(COALESCE(location,'')) LIKE $${i++}`);
    params.push(`%${filters.location.toLowerCase()}%`);
  }
  if (filters.title) {
    conditions.push(`LOWER(title) LIKE $${i++}`);
    params.push(`%${filters.title.toLowerCase()}%`);
  }
  if (filters.department) {
    conditions.push(`LOWER(COALESCE(department,'')) LIKE $${i++}`);
    params.push(`%${filters.department.toLowerCase()}%`);
  }
  if (filters.workplace_type) {
    conditions.push(`LOWER(COALESCE(workplace_type,'')) LIKE $${i++}`);
    params.push(`%${filters.workplace_type.toLowerCase()}%`);
  }
  if (filters.commitment) {
    conditions.push(`LOWER(COALESCE(commitment,'')) LIKE $${i++}`);
    params.push(`%${filters.commitment.toLowerCase()}%`);
  }
  if (filters.inCrm === 'yes') {
    conditions.push('EXISTS (SELECT 1 FROM crm_jobs WHERE crm_jobs.job_id = jobs.id)');
  } else if (filters.inCrm === 'no') {
    conditions.push('NOT EXISTS (SELECT 1 FROM crm_jobs WHERE crm_jobs.job_id = jobs.id)');
  }

  // Full-text search using the pre-computed search_text generated column
  // (GIN trigram index on search_text handles LIKE '%term%' efficiently)
  if (filters.search && filters.search.trim()) {
    const q = filters.search.trim();
    const mode = filters.searchMode || 'fuzzy';

    if (mode === 'regex') {
      // PostgreSQL regex on the pre-concatenated search_text column
      conditions.push(`search_text ~* $${i}`);
      params.push(q);
      i++;
    } else if (mode === 'fuzzy') {
      // Every whitespace-separated word must appear in search_text
      const words = q.toLowerCase().split(/\s+/).filter(Boolean);
      for (const word of words) {
        conditions.push(`search_text LIKE $${i}`);
        params.push(`%${word}%`);
        i++;
      }
    } else {
      // exact: the whole query as a substring in search_text
      conditions.push(`search_text LIKE $${i}`);
      params.push(`%${q.toLowerCase()}%`);
      i++;
    }
  }

  return { clause: conditions.join(' AND '), params, nextIdx: i };
}

export async function getJobsCount(filters: PaginatedJobQuery = {}): Promise<number> {
  const { clause, params } = buildJobWhere(filters);
  const { rows } = await pool.query(`SELECT COUNT(*) as cnt FROM jobs WHERE ${clause}`, params);
  return parseInt(rows[0].cnt, 10);
}

export async function getJobsPaginated(filters: PaginatedJobQuery = {}): Promise<PaginatedResult<Omit<Job, 'description'> & { description_short: string | null }>> {
  const page = Math.max(1, filters.page || 1);
  const pageSize = Math.min(100, Math.max(1, filters.pageSize || 25));
  const offset = (page - 1) * pageSize;

  const { clause, params, nextIdx } = buildJobWhere(filters);
  let i = nextIdx;

  // Count
  const countRes = await pool.query(`SELECT COUNT(*) as cnt FROM jobs WHERE ${clause}`, params);
  const total = parseInt(countRes.rows[0].cnt, 10);

  // Sort
  let sortCol = 'first_seen';
  if (filters.sortBy && ALLOWED_SORT_COLUMNS.has(filters.sortBy)) {
    sortCol = filters.sortBy;
  }
  const sortDir = filters.sortDir === 'asc' ? 'ASC' : 'DESC';

  // Query with truncated description (use SUBSTR to avoid encoding issues with LEFT)
  const queryParams = [...params, pageSize, offset];
  const { rows } = await pool.query(
    `SELECT id, source_id, sync_id, company, title, location, workplace_type, commitment,
            department, team, description, url, first_seen
     FROM jobs WHERE ${clause}
     ORDER BY ${sortCol} ${sortDir}
     LIMIT $${i++} OFFSET $${i++}`,
    queryParams
  );

  // Truncate description in JS to avoid PG encoding errors on corrupt data
  type Row = Omit<Job, 'description'> & { description: string | null; description_short: string | null };
  const data = (rows as Row[]).map(r => {
    const desc = r.description ?? '';
    const short = desc.length > 500 ? desc.slice(0, 500) + '...' : desc;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { description: _full, ...rest } = r;
    return { ...rest, description_short: short || null };
  });

  return { data, total, page, pageSize };
}

export async function getSourcesCount(): Promise<number> {
  const { rows } = await pool.query('SELECT COUNT(*) as cnt FROM sources');
  return parseInt(rows[0].cnt, 10);
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
  const bindParams: string[] = [];

  if (search) {
    const like = `%${search}%`;
    const i = bindParams.length;
    conditions.push(`(company ILIKE $${i + 1} OR url ILIKE $${i + 2} OR parser ILIKE $${i + 3})`);
    bindParams.push(like, like, like);
  }
  if (status) {
    conditions.push(`last_status = $${bindParams.length + 1}`);
    bindParams.push(status);
  }

  const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

  const countRes = await pool.query(`SELECT COUNT(*) as cnt FROM sources ${where}`, bindParams);
  const total = parseInt(countRes.rows[0].cnt, 10);

  const { rows } = await pool.query(
    `SELECT * FROM sources ${where} ORDER BY added_at DESC LIMIT $${bindParams.length + 1} OFFSET $${bindParams.length + 2}`,
    [...bindParams, pageSize, offset],
  );

  return { data: rows as Source[], total, page, pageSize };
}

export async function getJobStats(): Promise<{ totalJobs: number; totalSources: number; companies: string[]; locations: string[]; departments: string[]; workplaceTypes: string[]; commitmentTypes: string[] }> {
  const [{ totalJobs, totalSources }, compRes, locRes, deptRes, wpRes, commitRes] = await Promise.all([
    getJobCounts(),
    pool.query('SELECT DISTINCT company FROM jobs ORDER BY company'),
    pool.query("SELECT DISTINCT location FROM jobs WHERE location IS NOT NULL AND location != '' ORDER BY location"),
    pool.query("SELECT DISTINCT department FROM jobs WHERE department IS NOT NULL AND department != '' ORDER BY department"),
    pool.query("SELECT DISTINCT workplace_type FROM jobs WHERE workplace_type IS NOT NULL AND workplace_type != '' ORDER BY workplace_type"),
    pool.query("SELECT DISTINCT commitment FROM jobs WHERE commitment IS NOT NULL AND commitment != '' ORDER BY commitment"),
  ]);
  return {
    totalJobs,
    totalSources,
    companies: compRes.rows.map((r: { company: string }) => r.company),
    locations: locRes.rows.map((r: { location: string }) => r.location),
    departments: deptRes.rows.map((r: { department: string }) => r.department),
    workplaceTypes: wpRes.rows.map((r: { workplace_type: string }) => r.workplace_type),
    commitmentTypes: commitRes.rows.map((r: { commitment: string }) => r.commitment),
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

  const queries = fieldDefs.map(fd => {
    const modified = { ...filters, [fd.filterKey]: undefined };
    const { clause, params } = buildJobWhere(modified);
    const nullCheck = fd.nullable ? ` AND ${fd.col} IS NOT NULL AND ${fd.col} != ''` : '';
    return pool.query(
      `SELECT DISTINCT ${fd.col} FROM jobs WHERE ${clause}${nullCheck} ORDER BY ${fd.col}`,
      params
    );
  });

  const results = await Promise.all(queries);

  return {
    companies:       results[0].rows.map((r: Record<string, string>) => r[fieldDefs[0].col]),
    locations:       results[1].rows.map((r: Record<string, string>) => r[fieldDefs[1].col]),
    departments:     results[2].rows.map((r: Record<string, string>) => r[fieldDefs[2].col]),
    workplaceTypes:  results[3].rows.map((r: Record<string, string>) => r[fieldDefs[3].col]),
    commitmentTypes: results[4].rows.map((r: Record<string, string>) => r[fieldDefs[4].col]),
  };
}

// ─── Sync log ────────────────────────────────────────────────────────────────

export async function startSyncLog(): Promise<number> {
  const { rows } = await pool.query(
    `INSERT INTO sync_log (started_at, sources_count, new_jobs) VALUES ($1, 0, 0) RETURNING id`,
    [new Date().toISOString()]
  );
  return rows[0].id as number;
}

export async function completeSyncLog(id: number, sourcesCount: number, newJobs: number): Promise<void> {
  await pool.query(
    `UPDATE sync_log SET completed_at=$1, sources_count=$2, new_jobs=$3 WHERE id=$4`,
    [new Date().toISOString(), sourcesCount, newJobs, id]
  );
}

export async function getLatestSyncLog(): Promise<SyncLog | undefined> {
  const { rows } = await pool.query(
    'SELECT * FROM sync_log WHERE completed_at IS NOT NULL ORDER BY id DESC LIMIT 1'
  );
  return rows[0] as SyncLog | undefined;
}

// ─── HTML backups ─────────────────────────────────────────────────────────────

export async function insertHtmlBackup(sourceId: number, syncId: number, html: string): Promise<void> {
  await pool.query(
    `INSERT INTO html_backups (source_id, sync_id, html, captured_at) VALUES ($1, $2, $3, $4)`,
    [sourceId, syncId, html, new Date().toISOString()]
  );
}

// ─── CRM Jobs ─────────────────────────────────────────────────────────────────

export async function getCrmJobByJobId(jobId: number): Promise<CrmJob | undefined> {
  const { rows } = await pool.query('SELECT * FROM crm_jobs WHERE job_id = $1', [jobId]);
  return rows[0] as CrmJob | undefined;
}

export async function insertCrmJob(
  jobId: number, bucket: CrmBucket, comment?: string, reason?: string
): Promise<number> {
  const now = new Date().toISOString();
  const { rows, rowCount } = await pool.query(
    `INSERT INTO crm_jobs (job_id, bucket, user_comment, disqualify_reason, added_at, last_moved_at, processing_status)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (job_id) DO NOTHING
     RETURNING id`,
    [jobId, bucket, comment ?? null, reason ?? null, now, now, 'idle']
  );
  return (rowCount ?? 0) > 0 ? (rows[0].id as number) : 0;
}

export async function getCrmJobsByBucket(
  bucket: CrmBucket, page: number, pageSize: number
): Promise<PaginatedResult<CrmJobWithDetails>> {
  page = Math.max(1, page);
  pageSize = Math.min(100, Math.max(1, pageSize));
  const offset = (page - 1) * pageSize;

  const countRes = await pool.query(
    'SELECT COUNT(*) as cnt FROM crm_jobs WHERE bucket = $1', [bucket]
  );
  const total = parseInt(countRes.rows[0].cnt, 10);

  const { rows } = await pool.query(
    `SELECT cj.*, j.title, j.company, j.location, j.workplace_type, j.department, j.team, j.commitment, j.description, j.url
     FROM crm_jobs cj
     JOIN jobs j ON cj.job_id = j.id
     WHERE cj.bucket = $1
     ORDER BY cj.last_moved_at DESC
     LIMIT $2 OFFSET $3`,
    [bucket, pageSize, offset]
  );

  return { data: rows as CrmJobWithDetails[], total, page, pageSize };
}

export async function getCrmJobWithDetails(crmJobId: number): Promise<CrmJobWithDetails | undefined> {
  const { rows } = await pool.query(
    `SELECT cj.*, j.title, j.company, j.location, j.workplace_type, j.department, j.team, j.commitment, j.description, j.url
     FROM crm_jobs cj
     JOIN jobs j ON cj.job_id = j.id
     WHERE cj.id = $1`,
    [crmJobId]
  );
  return rows[0] as CrmJobWithDetails | undefined;
}

export async function updateCrmJobBucket(
  crmJobId: number, bucket: CrmBucket,
  opts?: { tier?: CrmTier | null; applicationDate?: string; reason?: string; processingStatus?: CrmProcessingStatus }
): Promise<void> {
  const sets: string[] = ['bucket = $1', 'last_moved_at = $2'];
  const params: unknown[] = [bucket, new Date().toISOString()];
  let i = 3;

  if (opts?.tier !== undefined) {
    sets.push(`tier = $${i++}`);
    params.push(opts.tier);
  }
  if (opts?.applicationDate !== undefined) {
    sets.push(`application_date = $${i++}`);
    params.push(opts.applicationDate);
  }
  if (opts?.reason !== undefined) {
    sets.push(`disqualify_reason = $${i++}`);
    params.push(opts.reason);
  }
  if (opts?.processingStatus !== undefined) {
    sets.push(`processing_status = $${i++}`);
    params.push(opts.processingStatus);
  }

  params.push(crmJobId);
  await pool.query(`UPDATE crm_jobs SET ${sets.join(', ')} WHERE id = $${i}`, params);
}

export async function updateCrmJobComment(crmJobId: number, comment: string | null): Promise<void> {
  await pool.query('UPDATE crm_jobs SET user_comment = $1 WHERE id = $2', [comment, crmJobId]);
}

export async function updateCrmJobProcessingStatus(crmJobId: number, status: CrmProcessingStatus): Promise<void> {
  await pool.query('UPDATE crm_jobs SET processing_status = $1 WHERE id = $2', [status, crmJobId]);
}

export async function updateCrmJobTier(crmJobId: number, tier: CrmTier | null): Promise<void> {
  await pool.query('UPDATE crm_jobs SET tier = $1 WHERE id = $2', [tier, crmJobId]);
}

export async function deleteCrmJob(crmJobId: number): Promise<void> {
  await pool.query('DELETE FROM crm_jobs WHERE id = $1', [crmJobId]);
}

export async function getCrmBucketCounts(): Promise<CrmBucketCounts> {
  const { rows } = await pool.query(
    'SELECT bucket, COUNT(*) as cnt FROM crm_jobs GROUP BY bucket'
  );
  const counts: CrmBucketCounts = {
    sourced: 0, filtered: 0, processed: 0, applied: 0,
    disqualified: 0, auto_disqualified: 0,
  };
  for (const row of rows) {
    if (row.bucket in counts) {
      counts[row.bucket as CrmBucket] = parseInt(row.cnt, 10);
    }
  }
  return counts;
}

const CRM_SEARCH_FIELDS = ['j.title', 'j.company', 'j.location', 'j.workplace_type', 'j.commitment', 'j.department', 'j.team', 'j.description', 'j.url'];

/** Build WHERE conditions + params for CRM job filters (shared helper, PG $N positional params).
 *  Pass excludeField to skip one filter — used for cascading dropdown options. */
function buildCrmJobConditions(
  filters: CrmJobFilter & { bucket?: string },
  exclude: keyof (CrmJobFilter & { bucket?: string }) | null = null,
  startIdx = 1
): { conditions: string[]; params: (string | number)[]; nextIdx: number } {
  const conditions: string[] = [];
  const params: (string | number)[] = [];
  let i = startIdx;

  if (exclude !== 'bucket'        && filters.bucket)        { conditions.push(`cj.bucket = $${i}`);                                          params.push(filters.bucket); i++; }
  if (exclude !== 'company'       && filters.company)       { conditions.push(`j.company = $${i}`);                                          params.push(filters.company); i++; }
  if (exclude !== 'location'      && filters.location)      { conditions.push(`LOWER(COALESCE(j.location,'')) LIKE $${i}`);                  params.push(`%${filters.location.toLowerCase()}%`); i++; }
  if (exclude !== 'title'         && filters.title)         { conditions.push(`LOWER(j.title) LIKE $${i}`);                                  params.push(`%${filters.title.toLowerCase()}%`); i++; }
  if (exclude !== 'department'    && filters.department)    { conditions.push(`LOWER(COALESCE(j.department,'')) LIKE $${i}`);                params.push(`%${filters.department.toLowerCase()}%`); i++; }
  if (exclude !== 'workplace_type'&& filters.workplace_type){ conditions.push(`LOWER(COALESCE(j.workplace_type,'')) LIKE $${i}`);           params.push(`%${filters.workplace_type.toLowerCase()}%`); i++; }
  if (exclude !== 'commitment'    && filters.commitment)    { conditions.push(`LOWER(COALESCE(j.commitment,'')) LIKE $${i}`);                params.push(`%${filters.commitment.toLowerCase()}%`); i++; }
  if (exclude !== 'autoFilter'    && filters.autoFilter)    {
    conditions.push(`cj.id IN (SELECT crm_job_id FROM crm_events WHERE event_type IN ('keyword_disqualified','llm_filter_failed') AND context_data::jsonb->>'filter_name' = $${i})`);
    params.push(filters.autoFilter); i++;
  }
  if (exclude !== 'search' && filters.search && filters.search.trim()) {
    const q = filters.search.trim();
    const mode = filters.searchMode || 'fuzzy';
    if (mode === 'regex') {
      // Use search_text (indexed) + description (not in search_text due to encoding issues)
      conditions.push(`(j.search_text ~* $${i} OR COALESCE(j.description,'') ~* $${i})`);
      params.push(q); i++;
    } else if (mode === 'fuzzy') {
      // Every word must appear in search_text OR description
      const words = q.toLowerCase().split(/\s+/).filter(Boolean);
      for (const word of words) {
        conditions.push(`(j.search_text LIKE $${i} OR LOWER(COALESCE(j.description,'')) LIKE $${i})`);
        params.push(`%${word}%`); i++;
      }
    } else {
      // exact: whole query as substring in search_text OR description
      conditions.push(`(j.search_text LIKE $${i} OR LOWER(COALESCE(j.description,'')) LIKE $${i})`);
      params.push(`%${q.toLowerCase()}%`); i++;
    }
  }

  return { conditions, params, nextIdx: i };
}

export async function getCrmBucketCountsFiltered(filters: CrmJobFilter = {}): Promise<CrmBucketCounts> {
  const { conditions, params } = buildCrmJobConditions(filters);
  const whereClause = conditions.length > 0 ? conditions.join(' AND ') : '1=1';

  const { rows } = await pool.query(
    `SELECT cj.bucket, COUNT(*) as cnt FROM crm_jobs cj JOIN jobs j ON cj.job_id = j.id WHERE ${whereClause} GROUP BY cj.bucket`, params
  );
  const counts: CrmBucketCounts = {
    sourced: 0, filtered: 0, processed: 0, applied: 0,
    disqualified: 0, auto_disqualified: 0,
  };
  for (const row of rows) {
    if (row.bucket in counts) {
      counts[row.bucket as CrmBucket] = parseInt(row.cnt, 10);
    }
  }
  return counts;
}

export async function getNextPendingCrmJob(): Promise<CrmJobWithDetails | undefined> {
  const { rows } = await pool.query(
    `SELECT cj.*, j.title, j.company, j.location, j.workplace_type, j.department, j.description, j.url
     FROM crm_jobs cj
     JOIN jobs j ON cj.job_id = j.id
     WHERE cj.processing_status = 'pending'
     ORDER BY cj.last_moved_at ASC
     LIMIT 1`
  );
  return rows[0] as CrmJobWithDetails | undefined;
}

export async function resetProcessingJobs(): Promise<number> {
  const { rowCount } = await pool.query(
    `UPDATE crm_jobs SET processing_status = 'pending' WHERE processing_status = 'processing'`
  );
  return rowCount ?? 0;
}

export async function resetErroredJobs(): Promise<number> {
  const { rowCount } = await pool.query(
    `UPDATE crm_jobs SET processing_status = 'pending' WHERE processing_status = 'error'`
  );
  return rowCount ?? 0;
}

export async function getCrmJobsForSourceJob(jobId: number): Promise<CrmJob | undefined> {
  const { rows } = await pool.query('SELECT * FROM crm_jobs WHERE job_id = $1', [jobId]);
  return rows[0] as CrmJob | undefined;
}

export async function getErroredCrmJobs(): Promise<CrmJobWithDetails[]> {
  const { rows } = await pool.query(
    `SELECT cj.*, j.title, j.company, j.location, j.workplace_type, j.department, j.description, j.url
     FROM crm_jobs cj
     JOIN jobs j ON cj.job_id = j.id
     WHERE cj.processing_status = 'error'
     ORDER BY cj.last_moved_at DESC`
  );
  return rows as CrmJobWithDetails[];
}

export async function getCrmStatusMap(jobIds: number[]): Promise<Record<number, { bucket: CrmBucket; tier: CrmTier | null }>> {
  if (jobIds.length === 0) return {};
  const placeholders = jobIds.map((_, i) => `$${i + 1}`).join(',');
  const { rows } = await pool.query(
    `SELECT job_id, bucket, tier FROM crm_jobs WHERE job_id IN (${placeholders})`,
    jobIds
  );
  const map: Record<number, { bucket: CrmBucket; tier: CrmTier | null }> = {};
  for (const r of rows) {
    map[r.job_id as number] = { bucket: r.bucket as CrmBucket, tier: r.tier as CrmTier | null };
  }
  return map;
}

// ─── CRM Events ───────────────────────────────────────────────────────────────

export async function insertCrmEvent(event: Omit<CrmEvent, 'id'>): Promise<number> {
  const { rows } = await pool.query(
    `INSERT INTO crm_events (crm_job_id, event_type, actor, from_bucket, to_bucket, context_data, comment, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [
      event.crm_job_id, event.event_type, event.actor,
      event.from_bucket ?? null, event.to_bucket ?? null,
      event.context_data ?? null, event.comment ?? null, event.created_at,
    ]
  );
  return rows[0].id as number;
}

export async function getCrmEventsByJob(crmJobId: number): Promise<CrmEvent[]> {
  const { rows } = await pool.query(
    'SELECT * FROM crm_events WHERE crm_job_id = $1 ORDER BY created_at DESC',
    [crmJobId]
  );
  return rows as CrmEvent[];
}

// ─── CRM Filters ──────────────────────────────────────────────────────────────

export async function getCrmFilters(): Promise<CrmFilter[]> {
  const { rows } = await pool.query('SELECT * FROM crm_filters ORDER BY sort_order ASC, id ASC');
  return rows as CrmFilter[];
}

export async function getCrmFilterById(id: number): Promise<CrmFilter | undefined> {
  const { rows } = await pool.query('SELECT * FROM crm_filters WHERE id = $1', [id]);
  return rows[0] as CrmFilter | undefined;
}

export async function insertCrmFilter(filter: Omit<CrmFilter, 'id'>): Promise<number> {
  const { rows } = await pool.query(
    `INSERT INTO crm_filters (name, filter_type, config, is_active, sort_order, created_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [filter.name, filter.filter_type, filter.config, filter.is_active, filter.sort_order, filter.created_at]
  );
  return rows[0].id as number;
}

export async function updateCrmFilter(id: number, updates: Partial<CrmFilter>): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [];
  let i = 1;

  if (updates.name !== undefined) { sets.push(`name = $${i++}`); params.push(updates.name); }
  if (updates.filter_type !== undefined) { sets.push(`filter_type = $${i++}`); params.push(updates.filter_type); }
  if (updates.config !== undefined) { sets.push(`config = $${i++}`); params.push(updates.config); }
  if (updates.is_active !== undefined) { sets.push(`is_active = $${i++}`); params.push(updates.is_active); }
  if (updates.sort_order !== undefined) { sets.push(`sort_order = $${i++}`); params.push(updates.sort_order); }

  if (sets.length === 0) return;
  params.push(id);
  await pool.query(`UPDATE crm_filters SET ${sets.join(', ')} WHERE id = $${i}`, params);
}

export async function deleteCrmFilter(id: number): Promise<void> {
  await pool.query('DELETE FROM crm_filters WHERE id = $1', [id]);
}

export async function reorderCrmFilters(ids: number[]): Promise<void> {
  for (let i = 0; i < ids.length; i++) {
    await pool.query('UPDATE crm_filters SET sort_order = $1 WHERE id = $2', [i, ids[i]]);
  }
}

export async function getActiveCrmFilters(): Promise<CrmFilter[]> {
  const { rows } = await pool.query(
    'SELECT * FROM crm_filters WHERE is_active = 1 ORDER BY sort_order ASC, id ASC'
  );
  return rows as CrmFilter[];
}

export async function deactivateCrmFiltersByType(filterType: CrmFilterType): Promise<void> {
  await pool.query('UPDATE crm_filters SET is_active = 0 WHERE filter_type = $1', [filterType]);
}

// ─── CRM Settings ─────────────────────────────────────────────────────────────

export async function getCrmSettings(): Promise<Record<string, string>> {
  const { rows } = await pool.query('SELECT key, value FROM crm_settings');
  const settings: Record<string, string> = {};
  for (const r of rows) {
    settings[r.key as string] = r.value as string;
  }
  return settings;
}

export async function getCrmSetting(key: string): Promise<string | undefined> {
  const { rows } = await pool.query('SELECT value FROM crm_settings WHERE key = $1', [key]);
  return rows[0]?.value as string | undefined;
}

export async function setCrmSetting(key: string, value: string): Promise<void> {
  await pool.query(
    'INSERT INTO crm_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
    [key, value]
  );
}

// ─── CRM Analytics (PG stubs — mirrors SQLite interface) ──────────────────────

export async function getCrmJobsByBucketFiltered(
  bucket: CrmBucket, page: number, pageSize: number, filters: CrmJobFilter = {}
): Promise<PaginatedResult<CrmJobWithDetails>> {
  page = Math.max(1, page);
  pageSize = Math.min(100, Math.max(1, pageSize));
  const offset = (page - 1) * pageSize;

  // Build filter conditions starting at $2 (bucket is always $1 for the CTE).
  // We do NOT add 'cj.bucket = $1' here — the CTE already limits to the target bucket.
  const { conditions: filterConds, params: filterParams, nextIdx } = buildCrmJobConditions(filters, null, 2);
  const params: (string | number)[] = [bucket, ...filterParams];
  const paramIdx = nextIdx;

  // MATERIALIZED CTE guarantees bucket-first execution:
  //   1. PG materialises all crm_jobs rows for this bucket (temp table, N rows)
  //   2. Nested-loop joins each row to jobs via PK
  //   3. Applies remaining filters on those N rows only
  //
  // Without this, PG misestimates trgm LIKE cardinality (~13 rows estimated vs
  // 24k–39k actual for common English words), picks a jobs-first plan that scans
  // 24k-39k rows before bucket-filtering — 15–25× more work than needed.
  //
  // The composite idx_crm_jobs_bucket_order (bucket, last_moved_at DESC) lets PG
  // scan the CTE source in recency order, so no extra Sort is needed.
  const filterWhereClause = filterConds.length > 0 ? filterConds.join(' AND ') : '1=1';
  const dataParams = [...params, pageSize, offset];
  const { rows } = await pool.query(
    `WITH bucket_cte AS MATERIALIZED (
       SELECT * FROM crm_jobs WHERE bucket = $1
     )
     SELECT cj.*, j.title, j.company, j.location, j.workplace_type, j.department, j.team, j.commitment, j.description, j.url,
            COUNT(*) OVER() AS _total
     FROM bucket_cte cj JOIN jobs j ON cj.job_id = j.id
     WHERE ${filterWhereClause}
     ORDER BY cj.last_moved_at DESC
     LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`, dataParams
  );

  const total = rows.length > 0 ? parseInt(rows[0]._total, 10) : 0;
  // Strip the _total column from returned data
  const data = rows.map(({ _total, ...rest }: any) => rest) as CrmJobWithDetails[];

  return { data, total, page, pageSize };
}

export async function getCrmFilterOptions(filters: CrmJobFilter & { bucket?: string } = {}): Promise<{
  companies: string[]; locations: string[]; departments: string[]; workplaceTypes: string[]; commitmentTypes: string[]; autoFilterNames: string[];
}> {
  // Strip search from filter-option queries: search (especially regex) is very expensive
  // and shouldn't cascade into dropdown options — e.g. available companies don't need
  // to be restricted by a regex match on description text.
  const filtersNoSearch: CrmJobFilter & { bucket?: string } = { ...filters, search: undefined, searchMode: undefined };

  async function queryDistinct(col: string, nullCheck: boolean, exclude: keyof (CrmJobFilter & { bucket?: string }) | null): Promise<string[]> {
    const { conditions, params } = buildCrmJobConditions(filtersNoSearch, exclude);
    const where = conditions.length > 0 ? conditions.join(' AND ') : '1=1';
    const nullFrag = nullCheck ? ` AND ${col} IS NOT NULL AND ${col} != ''` : '';
    const colAlias = col.split('.')[1];
    const { rows } = await pool.query(
      `SELECT DISTINCT ${col} AS ${colAlias} FROM crm_jobs cj JOIN jobs j ON cj.job_id = j.id WHERE ${where}${nullFrag} ORDER BY ${col}`,
      params
    );
    return rows.map((r: any) => r[colAlias]).filter(Boolean);
  }

  const [companies, locations, departments, workplaceTypes, commitmentTypes] = await Promise.all([
    queryDistinct('j.company',        false, 'company'),
    queryDistinct('j.location',       true,  'location'),
    queryDistinct('j.department',     true,  'department'),
    queryDistinct('j.workplace_type', true,  'workplace_type'),
    queryDistinct('j.commitment',     true,  'commitment'),
  ]);

  // Auto-filter names: scoped by all filters except autoFilter itself (also no search)
  const { conditions: afConds, params: afParams } = buildCrmJobConditions(filtersNoSearch, 'autoFilter');
  const afWhere = afConds.length > 0 ? afConds.join(' AND ') : '1=1';
  const { rows: autoFilterRows } = await pool.query(
    `SELECT DISTINCT context_data::jsonb->>'filter_name' AS filter_name
     FROM crm_events ce
     JOIN crm_jobs cj ON ce.crm_job_id = cj.id
     JOIN jobs j ON cj.job_id = j.id
     WHERE ce.event_type IN ('keyword_disqualified','llm_filter_failed')
       AND ce.context_data IS NOT NULL
       AND context_data::jsonb->>'filter_name' IS NOT NULL
       AND ${afWhere}
     ORDER BY filter_name`,
    afParams
  );

  return {
    companies,
    locations,
    departments,
    workplaceTypes,
    commitmentTypes,
    autoFilterNames: autoFilterRows.map((r: any) => r.filter_name).filter(Boolean),
  };
}

export async function getCrmFunnelAnalytics(filters: CrmJobFilter = {}): Promise<{
  flows: { from: string; to: string; count: number }[];
  filterStats: { filterName: string; filterType: string; count: number }[];
  bucketCounts: Record<string, number>;
  totalJobs: number;
}> {
  // Use shared condition builder for full filter support
  const { conditions: builtConds, params } = buildCrmJobConditions(filters);
  const conditions = builtConds.length > 0 ? builtConds : ['1=1'];
  const whereClause = conditions.join(' AND ');

  const { rows: jobRows } = await pool.query(`SELECT cj.id FROM crm_jobs cj JOIN jobs j ON cj.job_id = j.id WHERE ${whereClause}`, params);
  const crmJobIds = jobRows.map((r: any) => r.id);
  if (crmJobIds.length === 0) return { flows: [], filterStats: [], bucketCounts: {}, totalJobs: 0 };

  const { rows: bucketRows } = await pool.query(`SELECT cj.bucket, COUNT(*) as cnt FROM crm_jobs cj JOIN jobs j ON cj.job_id = j.id WHERE ${whereClause} GROUP BY cj.bucket`, params);
  const bucketCounts: Record<string, number> = {};
  for (const r of bucketRows) bucketCounts[r.bucket] = parseInt(r.cnt);

  const { rows: transEvents } = await pool.query(
    `SELECT crm_job_id, event_type, from_bucket, to_bucket, context_data FROM crm_events WHERE crm_job_id = ANY($1) AND from_bucket IS NOT NULL AND to_bucket IS NOT NULL ORDER BY crm_job_id, created_at ASC`,
    [crmJobIds]
  );

  const flowMap = new Map<string, number>();
  for (const evt of transEvents) {
    if (evt.from_bucket !== evt.to_bucket) {
      const key = `${evt.from_bucket}|${evt.to_bucket}`;
      flowMap.set(key, (flowMap.get(key) || 0) + 1);
    }
  }
  const flows = Array.from(flowMap.entries()).map(([key, count]) => {
    const [from, to] = key.split('|');
    return { from, to, count };
  });

  const { rows: addedEvents } = await pool.query(
    `SELECT to_bucket FROM crm_events WHERE crm_job_id = ANY($1) AND event_type = 'added'`, [crmJobIds]
  );
  const addedMap = new Map<string, number>();
  for (const evt of addedEvents) {
    if (evt.to_bucket) {
      const key = `_entry|${evt.to_bucket}`;
      addedMap.set(key, (addedMap.get(key) || 0) + 1);
    }
  }
  for (const [key, count] of addedMap) {
    const [from, to] = key.split('|');
    flows.push({ from, to, count });
  }

  const { rows: disqualEvents } = await pool.query(
    `SELECT context_data, event_type FROM crm_events WHERE crm_job_id = ANY($1) AND event_type IN ('keyword_disqualified', 'llm_filter_failed')`, [crmJobIds]
  );
  const filterStatsMap = new Map<string, { filterType: string; count: number }>();
  for (const evt of disqualEvents) {
    let filterName = evt.event_type === 'keyword_disqualified' ? 'Keyword Filter' : 'LLM Filter';
    let filterType = evt.event_type === 'keyword_disqualified' ? 'keyword' : 'llm_filter';
    if (evt.context_data) {
      try { const ctx = JSON.parse(evt.context_data); if (ctx.filter_name) filterName = ctx.filter_name; if (ctx.filter_type) filterType = ctx.filter_type; } catch {}
    }
    const existing = filterStatsMap.get(filterName);
    if (existing) existing.count++; else filterStatsMap.set(filterName, { filterType, count: 1 });
  }
  const filterStats = Array.from(filterStatsMap.entries()).map(([name, data]) => ({ filterName: name, filterType: data.filterType, count: data.count })).sort((a, b) => b.count - a.count);

  return { flows, filterStats, bucketCounts, totalJobs: crmJobIds.length };
}
