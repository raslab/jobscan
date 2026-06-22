// Shared TypeScript interfaces mirroring JobScan API response shapes.
// All data lives in the JobScan REST API — the MCP server is stateless.

export interface Source {
  id: number;
  company: string;
  url: string;
  parser: string;
  added_at: string; // ISO 8601
  last_synced: string | null;
  last_status: 'ok' | 'error' | null;
  last_error: string | null;
  last_count: number | null;
}

export interface Job {
  id: number;
  source_id: number;
  sync_id: number | null;
  company: string;
  title: string;
  location: string | null;
  workplace_type: string | null; // "remote" | "hybrid" | "onsite" | null
  commitment: string | null; // "full-time" | "part-time" | "contract" | null
  department: string | null;
  team: string | null;
  url: string;
  first_seen: string; // ISO 8601
  description?: string; // Present in jobscan_get_job only
}

export interface SyncSourceResult {
  sourceId: number;
  company: string;
  status: 'ok' | 'error';
  newJobs: number;
  totalJobs?: number;
  error?: string;
}

export interface SyncAllResult {
  syncId: number;
  sourcesChecked: number;
  newJobsTotal: number;
  results: SyncSourceResult[];
}

export interface SyncLog {
  id: number;
  started_at: string; // ISO 8601
  completed_at: string | null;
  sources_count: number;
  new_jobs: number;
}

export interface JobStats {
  totalJobs: number;
  totalSources: number;
  companies: string[];
  locations: string[];
  departments: string[];
  workplaceTypes: string[];
  commitmentTypes: string[];
}

export type CrmBucket =
  | 'sourced'
  | 'filtered'
  | 'processed'
  | 'applied'
  | 'disqualified'
  | 'auto_disqualified';

export type CrmTier = 'T1' | 'T2' | 'T3' | 'skip';

export interface CrmJob {
  id: number;
  job_id: number;
  bucket: CrmBucket;
  tier: CrmTier | null;
  processing_status: 'pending' | 'processing' | 'done' | 'error' | null;
  user_comment: string | null;
  application_date: string | null; // ISO 8601
  disqualify_reason: string | null;
  added_at: string; // ISO 8601
  last_moved_at: string | null;
  // Joined job fields
  company: string;
  title: string;
  location: string | null;
  workplace_type: string | null;
  commitment: string | null;
  department: string | null;
  url: string;
  // Detail only
  events?: CrmEvent[];
}

export interface CrmEvent {
  id: number;
  crm_job_id: number;
  event_type: 'added' | 'moved' | 'commented' | 'processed' | 'auto_processed';
  actor: 'user' | 'system';
  from_bucket: CrmBucket | null;
  to_bucket: CrmBucket | null;
  context_data: string | null; // JSON string or null
  comment: string | null;
  created_at: string; // ISO 8601
}

export interface CrmBucketCounts {
  sourced: number;
  filtered: number;
  processed: number;
  applied: number;
  disqualified: number;
  auto_disqualified: number;
}

export type CrmStatusMap = Record<number, CrmBucket>;

export interface Paginated<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}
