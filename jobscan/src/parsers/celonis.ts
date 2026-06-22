import { ParsedJob } from '../types';
import { fetchJson } from '../fetch-utils';
import { NodeHtmlMarkdown } from 'node-html-markdown';

/**
 * Celonis custom ATS parser.
 *
 * URL pattern: https://careers.celonis.com/join-us/teams
 *              (or any path under careers.celonis.com)
 *
 * ── How it works ──────────────────────────────────────────────────────────
 *
 * Celonis uses a custom Adobe AEM-based careers site with a backing REST API
 * at dxp-api.celonis.com.  A single GET request returns all open positions:
 *
 *   GET https://dxp-api.celonis.com/v1/jobs
 *
 * Response shape:
 *   {
 *     jobs: [
 *       {
 *         jobId:           6578211003,
 *         title:           "Senior Platform Engineer",
 *         team:            "Engineering",       // top-level department
 *         jobFunction:     "Backend",           // sub-team (optional)
 *         groupedLocation: "New York, United States",
 *         seniority:       "Experienced Professional",
 *         type:            "Professional Hire",  // or "Early Professional Hire" | ""
 *         updatedAt:       "2026-03-06T04:21:28-05:00",
 *       },
 *       ...
 *     ]
 *   }
 *
 * All jobs are returned in a single response (no pagination needed).
 *
 * Job URLs follow the canonical careers page pattern:
 *   https://careers.celonis.com/join-us/open-positions/job-detail?jobId={jobId}
 *
 * Descriptions are not included in the listing — they are fetched individually
 * via the detail API:
 *   GET https://dxp-api.celonis.com/v1/jobs/{jobId}
 * which returns the same fields plus `description` (HTML-encoded HTML string).
 *
 * Field mapping:
 *   title          ← title
 *   url            ← https://careers.celonis.com/join-us/open-positions/job-detail?jobId={jobId}
 *   location       ← groupedLocation
 *   workplace_type ← derived: "Remote" if groupedLocation starts with "Remote"
 *   department     ← team  (top-level, e.g. "Engineering")
 *   team           ← jobFunction (sub-team, e.g. "Backend") — optional field
 *   description    ← fetched separately via celonisJobDetailApiFetch
 */

const CELONIS_HOSTNAME = 'careers.celonis.com';
const DXP_API_BASE = 'https://dxp-api.celonis.com/v1/jobs';
const JOB_DETAIL_BASE = 'https://careers.celonis.com/join-us/open-positions/job-detail';

// ── URL helpers ───────────────────────────────────────────────────────────────

/**
 * Check whether the given URL belongs to the Celonis careers site.
 */
export function isCelonisUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.hostname.toLowerCase() === CELONIS_HOSTNAME;
  } catch {
    return false;
  }
}

/**
 * Build the canonical Celonis job detail page URL from a numeric job ID.
 */
function buildJobUrl(jobId: number | string): string {
  return `${JOB_DETAIL_BASE}?jobId=${jobId}`;
}

/**
 * Extract the jobId from a Celonis job detail URL.
 * e.g. https://careers.celonis.com/join-us/open-positions/job-detail?jobId=6578211003
 * → "6578211003"
 */
export function extractJobId(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname.toLowerCase() !== CELONIS_HOSTNAME) return null;
    return u.searchParams.get('jobId');
  } catch {
    return null;
  }
}

// ── Workplace type derivation ─────────────────────────────────────────────────

/**
 * Derive workplace type from the `groupedLocation` field.
 *
 * Observed patterns:
 *   "Remote, Virginia, United States"  → "Remote"
 *   "New York, United States"          → undefined (on-site, not labelled)
 *   "Munich, Germany"                  → undefined
 */
function deriveWorkplaceType(groupedLocation: string | null | undefined): string | undefined {
  if (!groupedLocation) return undefined;
  const lower = groupedLocation.trim().toLowerCase();
  if (lower.startsWith('remote')) return 'Remote';
  return undefined;
}

// ── Public API functions ──────────────────────────────────────────────────────

/**
 * Fetch all Celonis job listings via the dxp-api in a single request.
 *
 * No pagination is needed — the API returns all open positions at once.
 * Descriptions are NOT included in the listing; they are enriched later
 * via `celonisJobDetailApiFetch` (called by the scraper's `scrapeJobDetail`).
 */
export async function celonisApiFetch(_url: string): Promise<{ jobs: ParsedJob[]; error?: string }> {
  const { data, error } = await fetchJson(DXP_API_BASE, {
    headers: { 'Accept': 'application/json' },
  });

  if (error) return { jobs: [], error };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const payload = data as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawJobs: any[] = payload?.jobs ?? [];

  const jobs: ParsedJob[] = [];
  for (const j of rawJobs) {
    const title: string = (j.title ?? '').trim();
    const jobId: number | undefined = j.jobId;
    if (!title || !jobId) continue;

    const groupedLocation: string | undefined = (j.groupedLocation ?? '').trim() || undefined;
    const workplaceType = deriveWorkplaceType(groupedLocation);
    const department: string | undefined = (j.team ?? '').trim() || undefined;
    const team: string | undefined = (j.jobFunction ?? '').trim() || undefined;

    jobs.push({
      title,
      url: buildJobUrl(jobId),
      location: groupedLocation,
      workplace_type: workplaceType,
      department,
      team,
    });
  }

  return { jobs };
}

/**
 * Fetch the job description for a single Celonis job via the detail API.
 *
 * The `description` field in the API response is HTML-entity-encoded HTML
 * (i.e. `&lt;p&gt;...&lt;/p&gt;`). We:
 *   1. Decode the HTML entities to recover the raw HTML string.
 *   2. Convert HTML → Markdown using NodeHtmlMarkdown.
 *
 * Returns `{ description }` or `{ description: undefined }` on failure.
 */
export async function celonisJobDetailApiFetch(jobUrl: string): Promise<{ description?: string; error?: string }> {
  const jobId = extractJobId(jobUrl);
  if (!jobId) return {};

  const apiUrl = `${DXP_API_BASE}/${jobId}`;
  const { data, error } = await fetchJson(apiUrl, {
    headers: { 'Accept': 'application/json' },
    maxRetries: 1, // fail fast — don't waste time on rate limits
  });

  if (error) return { error };
  if (!data) return {};

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const payload = data as any;
  const rawDescription: string | undefined = payload?.description;
  if (!rawDescription) return {};

  // The description is HTML-entity-encoded: &lt;p&gt; → <p>
  // Use a simple regex-based entity decoder (covers the main HTML5 entities)
  const decodedHtml = decodeHtmlEntities(rawDescription);

  const nhm = new NodeHtmlMarkdown({ bulletMarker: '-' });
  const markdown = nhm.translate(decodedHtml).trim().slice(0, 20_000);

  return { description: markdown || undefined };
}

/**
 * Detect company name for Celonis — always returns "Celonis".
 * The company name is fixed; no API call is needed.
 */
export async function celonisDetect(_url: string): Promise<{ company: string; error?: string }> {
  return { company: 'Celonis' };
}

// ── HTML fallback parser ──────────────────────────────────────────────────────

/**
 * HTML fallback parser for Celonis.
 * Celonis is fully covered by the API — this is a no-op stub so the registry
 * type constraints are satisfied.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function celonisParser(_html: string, _baseUrl: string): ParsedJob[] {
  return [];
}

// ── Utilities ─────────────────────────────────────────────────────────────────

/**
 * Minimal HTML entity decoder covering the most common entities produced by
 * Celonis's API (`&lt;`, `&gt;`, `&amp;`, `&quot;`, `&#39;`, `&nbsp;`).
 * This avoids pulling in a full DOM parser just for entity decoding.
 */
function decodeHtmlEntities(encoded: string): string {
  return encoded
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/')
    .replace(/&nbsp;/g, ' ')
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&hellip;/g, '…')
    .replace(/&#(\d+);/g, (_m, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex) => String.fromCharCode(parseInt(hex, 16)));
}
