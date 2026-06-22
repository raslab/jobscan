/**
 * Typed HTTP client for the jobscan dev server REST API.
 * Used by integration tests to add sources, trigger syncs, and verify jobs.
 *
 * Requires the dev server running on localhost:3000 (`npm run dev`).
 */

const BASE_URL = process.env.JOBSCAN_TEST_URL || 'http://localhost:3000';

interface Source {
  id: number;
  company: string;
  url: string;
  parser: string;
  added_at: string;
  last_synced: string | null;
  last_status: string | null;
  last_error: string | null;
  last_count: number | null;
}

interface AddSourceResult {
  source: Source;
  firstScrape: {
    count: number;
    error?: string;
    warning?: string;
  };
}

interface SyncResult {
  syncId: number;
  sourceId: number;
  company: string;
  status: string;
  newJobs: number;
  totalJobs?: number;
  error?: string;
}

interface Job {
  id: number;
  source_id: number;
  company: string;
  title: string;
  url: string;
  location: string | null;
  workplace_type: string | null;
  commitment: string | null;
  department: string | null;
  team: string | null;
  description: string | null;
  first_seen: string;
}

interface PaginatedJobs {
  data: Job[];
  total: number;
  page: number;
  pageSize: number;
}

interface JobStatsSummary {
  totalJobs: number;
  totalSources: number;
}

interface JobStats extends JobStatsSummary {
  companies?: string[];
  locations?: string[];
  departments?: string[];
  workplaceTypes?: string[];
  commitmentTypes?: string[];
}

async function apiRequest<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; data: T }> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: T;
  try {
    data = JSON.parse(text);
  } catch {
    data = text as unknown as T;
  }
  return { status: res.status, data };
}

/** Add a new source and trigger initial scrape. */
export async function addSource(
  company: string,
  url: string,
  parser: string,
): Promise<{ status: number; data: AddSourceResult }> {
  return apiRequest<AddSourceResult>('POST', '/api/sources', { company, url, parser });
}

/** Delete a source by ID. */
export async function deleteSource(sourceId: number): Promise<{ status: number }> {
  const res = await fetch(`${BASE_URL}/api/sources/${sourceId}`, { method: 'DELETE' });
  return { status: res.status };
}

/** Trigger sync for a single source. */
export async function syncSource(
  sourceId: number,
): Promise<{ status: number; data: SyncResult }> {
  return apiRequest<SyncResult>('POST', `/api/sync/${sourceId}`);
}

/** Get paginated jobs, optionally filtered. */
export async function getJobs(params: {
  company?: string;
  page?: number;
  pageSize?: number;
  title?: string;
  search?: string;
  searchMode?: 'fuzzy' | 'exact' | 'regex';
} = {}): Promise<{ status: number; data: PaginatedJobs }> {
  const qs = new URLSearchParams();
  if (params.company) qs.set('company', params.company);
  if (params.page) qs.set('page', String(params.page));
  if (params.pageSize) qs.set('pageSize', String(params.pageSize));
  if (params.title) qs.set('title', params.title);
  if (params.search) qs.set('search', params.search);
  if (params.searchMode) qs.set('searchMode', params.searchMode);
  const path = `/api/jobs?${qs.toString()}`;
  return apiRequest<PaginatedJobs>('GET', path);
}

/** Get a single job by ID (includes description). */
export async function getJob(jobId: number): Promise<{ status: number; data: Job }> {
  return apiRequest<Job>('GET', `/api/jobs/${jobId}`);
}

/** Get lightweight stats, optionally including distinct filter values. */
export async function getStats(params: {
  includeFilters?: boolean;
  includeSources?: boolean;
} = {}): Promise<{ status: number; data: JobStats }> {
  const qs = new URLSearchParams();
  if (params.includeFilters) qs.set('includeFilters', 'true');
  if (params.includeSources) qs.set('includeSources', 'true');
  const path = qs.size > 0 ? `/api/jobs/stats?${qs.toString()}` : '/api/jobs/stats';
  return apiRequest<JobStats>('GET', path);
}

/** Get all sources, optionally filtered. */
export async function getSources(search?: string): Promise<{ status: number; data: Source[] }> {
  const qs = search ? `?search=${encodeURIComponent(search)}` : '';
  return apiRequest<Source[]>('GET', `/api/sources${qs}`);
}

/** Check if the dev server is reachable. */
export async function isServerRunning(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_URL}/api/sources/parsers`);
    return res.ok;
  } catch {
    return false;
  }
}

export { Source, Job, PaginatedJobs, AddSourceResult, SyncResult, JobStats, BASE_URL };
