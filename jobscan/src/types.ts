export interface Source {
  id: number;
  company: string;
  url: string;
  parser: string;
  added_at: string;
  last_synced: string | null;
  last_status: 'ok' | 'error' | 'zero-jobs' | 'timed-out' | null;
  last_error: string | null;
  last_count: number | null;
}

export interface Job {
  id: number;
  source_id: number | null;
  sync_id: number;
  company: string;
  title: string;
  location: string | null;
  workplace_type: string | null;
  commitment: string | null;
  department: string | null;
  team: string | null;
  description: string | null;
  url: string;
  first_seen: string;
}

export interface SyncLog {
  id: number;
  started_at: string;
  completed_at: string | null;
  sources_count: number;
  new_jobs: number;
}

export interface ParsedJob {
  title: string;
  url: string;
  location?: string;
  workplace_type?: string;
  commitment?: string;
  department?: string;
  team?: string;
  description?: string;
}

export type ParserFn = (html: string, baseUrl: string) => ParsedJob[];

export interface SyncSourceResult {
  sourceId: number;
  company: string;
  status: 'ok' | 'error' | 'zero-jobs' | 'timed-out';
  newJobs: number;
  totalJobs?: number;
  error?: string;
}

export interface SyncSummary {
  syncId: number;
  sourcesChecked: number;
  newJobsTotal: number;
  results: SyncSourceResult[];
}

export interface JobFilters {
  company?: string;
  title?: string;
  location?: string;
  department?: string;
  workplace_type?: string;
  commitment?: string;
  since?: string;
  syncId?: number;
  inCrm?: 'yes' | 'no';
}

/** Extended filters for the paginated jobs endpoint */
export interface PaginatedJobQuery extends JobFilters {
  search?: string;
  searchMode?: 'fuzzy' | 'exact' | 'regex';
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
}

/** Pagination params for sources */
export interface PaginatedSourceQuery {
  page?: number;
  pageSize?: number;
}

/** Generic paginated API response */
export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}

/** Lightweight stats for tab badges */
export interface JobStatsSummary {
  totalJobs: number;
  totalSources: number;
}

/** Aggregate stats plus distinct filter values */
export interface JobStats extends JobStatsSummary {
  companies: string[];
  locations: string[];
  departments: string[];
  workplaceTypes: string[];
  commitmentTypes: string[];
}

/** Stats response; heavy lists are opt-in because they are expensive on large installs */
export interface JobStatsResponse extends JobStatsSummary {
  companies?: string[];
  locations?: string[];
  departments?: string[];
  workplaceTypes?: string[];
  commitmentTypes?: string[];
  sources?: Source[];
}

// ─── CRM Types ────────────────────────────────────────────────────────────────

export type CrmBucket =
  | 'sourced'
  | 'filtered'
  | 'processed'
  | 'applied'
  | 'disqualified'
  | 'auto_disqualified';

export type CrmTier = 'T1' | 'T2' | 'T3' | 'skip';

export type CrmProcessingStatus = 'idle' | 'pending' | 'processing' | 'done' | 'error';

export interface CrmJob {
  id: number;
  job_id: number;
  bucket: CrmBucket;
  tier: CrmTier | null;
  processing_status: CrmProcessingStatus;
  user_comment: string | null;
  application_date: string | null;
  disqualify_reason: string | null;
  added_at: string;
  last_moved_at: string;
}

/** CRM job joined with source job data for display */
export interface CrmJobWithDetails extends CrmJob {
  title: string;
  company: string;
  location: string | null;
  workplace_type: string | null;
  department: string | null;
  team: string | null;
  commitment: string | null;
  description: string | null;
  url: string;
}

export type CrmEventType =
  | 'added'
  | 'moved'
  | 'comment'
  | 'keyword_disqualified'
  | 'llm_filter_passed'
  | 'llm_filter_failed'
  | 'tier_assigned'
  | 'processing_error'
  | 'processing_started'
  | 'manual_trigger';

export interface CrmEvent {
  id: number;
  crm_job_id: number;
  event_type: CrmEventType;
  actor: string;
  from_bucket: CrmBucket | null;
  to_bucket: CrmBucket | null;
  context_data: string | null;
  comment: string | null;
  created_at: string;
}

export type CrmFilterType = 'keyword' | 'llm_filter' | 'llm_tier';

export interface CrmFilter {
  id: number;
  name: string;
  filter_type: CrmFilterType;
  config: string;
  is_active: number;
  sort_order: number;
  created_at: string;
}

export interface KeywordFilterConfig {
  keywords: string[];
  fields: ('title' | 'description' | 'company' | 'location' | 'department')[];
  match_mode: 'any' | 'all';
}

export interface LlmFilterConfig {
  prompt: string;
}

export interface LlmTierConfig {
  prompt: string;
}

export interface CrmSetting {
  key: string;
  value: string;
}

/** Result of running a single filter against a job */
export interface FilterResult {
  passed: boolean;
  reason: string;
  filter_name: string;
  filter_type: CrmFilterType;
  details?: Record<string, unknown>;
}

/** Result of LLM tier assignment */
export interface TierResult {
  tier: CrmTier;
  reasoning: string;
  strengths: string[];
  gaps: string[];
  raw_response: string;
  prompt_sent: string;
}

/** Processing queue status (in-memory) */
export interface ProcessingStatus {
  state: 'idle' | 'processing' | 'error';
  current_job: { id: number; company: string; title: string } | null;
  error_count: number;
}

/** Bucket counts for the CRM tab */
export interface CrmBucketCounts {
  sourced: number;
  filtered: number;
  processed: number;
  applied: number;
  disqualified: number;
  auto_disqualified: number;
}

/** LLM call result */
export interface LlmCallResult {
  success: boolean;
  content: string;
  error?: string;
  prompt_sent: string;
  /** Number of tokens in the prompt (input) */
  tokens_in?: number;
  /** Number of tokens in the response (output) */
  tokens_out?: number;
  /** Wall-clock time for the LLM call in milliseconds */
  elapsed_ms?: number;
}
