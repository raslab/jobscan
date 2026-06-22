import * as cheerio from 'cheerio';
import { ParsedJob } from '../types';
import { fetchHtml, fetchJson } from '../fetch-utils';

/**
 * Crelate ATS parser.
 *
 * Portal URLs look like:
 *   https://jobs.crelate.com/portal/{orgName}
 *
 * The portal page is a Vue SPA that loads jobs via an internal API.
 * The HTML contains embedded JS variables (ORG_ID, ORG_NAME, ORG_DISPLAY_NAME)
 * which we extract to call the API.
 *
 * API endpoints (all GET, data passed via `requestEnvelope` query param):
 *   - GetAllJobs:  https://app.crelate.com/api/candidateportal/GetAllJobs
 *                  requestEnvelope = { OrganizationId: "<uuid>" }
 *                  → returns { Jobs: [...] } with all open positions (no pagination)
 *                  → descriptions are plain-text snippets (~500 chars)
 *
 *   - GetJob:      https://app.crelate.com/api/candidateportal/GetJob
 *                  requestEnvelope = { JobCode: "<code>" }
 *                  → returns { Job: {...} } with full HTML description
 */

const CRELATE_API_BASE = 'https://app.crelate.com/api';

// ── URL helpers ───────────────────────────────────────────────────────────────

/**
 * Extract the org name (slug) from a Crelate portal URL.
 * Handles: https://jobs.crelate.com/portal/{orgName}
 */
export function extractCrelateSlug(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname !== 'jobs.crelate.com') return null;
    const parts = u.pathname.split('/').filter(Boolean);
    // Expected: ['portal', '{orgName}'] or ['portal', 'v2', '{orgName}']
    if (parts[0] !== 'portal') return null;
    if (parts[1] === 'v2') return parts[2] || null;
    return parts[1] || null;
  } catch {
    return null;
  }
}

/**
 * Extract ORG_ID and ORG_DISPLAY_NAME from the Crelate portal HTML page.
 * The page embeds these as JS variables in a <script> tag.
 */
function extractOrgInfo(html: string): { orgId: string; displayName: string } | null {
  const orgIdMatch = html.match(/ORG_ID\s*=\s*"([^"]+)"/);
  const displayNameMatch = html.match(/ORG_DISPLAY_NAME\s*=\s*"([^"]+)"/);
  if (!orgIdMatch) return null;
  return {
    orgId: orgIdMatch[1],
    displayName: displayNameMatch ? displayNameMatch[1] : '',
  };
}

// ── API-based fetch (preferred — single call for all jobs) ────────────────────

/**
 * Fetch ALL jobs from a Crelate portal via the internal candidate portal API.
 *
 * Flow:
 *  1. Fetch the portal HTML page to extract ORG_ID
 *  2. Call GetAllJobs API with the OrganizationId
 *  3. Map each job to a ParsedJob (descriptions are short plain-text snippets;
 *     full HTML descriptions are fetched per-job in scrapeJobDetail)
 */
export async function crelateApiFetch(
  url: string,
): Promise<{ jobs: ParsedJob[]; error?: string }> {
  const slug = extractCrelateSlug(url);
  if (!slug) return { jobs: [], error: 'Could not extract org name from Crelate URL' };

  // Step 1: Fetch portal page to get ORG_ID
  const { html, error: htmlError } = await fetchHtml(url);
  if (htmlError) return { jobs: [], error: `Failed to fetch portal page: ${htmlError}` };

  const orgInfo = extractOrgInfo(html);
  if (!orgInfo) return { jobs: [], error: 'Could not extract ORG_ID from portal page' };

  // Step 2: Call GetAllJobs API
  const envelope = JSON.stringify({ OrganizationId: orgInfo.orgId });
  const apiUrl = `${CRELATE_API_BASE}/candidateportal/GetAllJobs?requestEnvelope=${encodeURIComponent(envelope)}`;

  const { data, error: apiError } = await fetchJson(apiUrl);
  if (apiError) return { jobs: [], error: `Crelate API error: ${apiError}` };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const payload = data as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawJobs: any[] = payload?.Jobs ?? [];

  if (rawJobs.length === 0) {
    return { jobs: [], error: undefined };
  }

  // Step 3: Map to ParsedJob[]
  const jobs: ParsedJob[] = [];
  for (const j of rawJobs) {
    const title: string = j.Title ?? '';
    const jobCode: string = j.JobCode ?? '';
    if (!title || !jobCode) continue;

    // Build the canonical job URL
    const jobUrl = `https://jobs.crelate.com/portal/${slug}/job/${jobCode}`;

    // Location: combine City, State, Country
    const locationParts: string[] = [];
    if (j.City) locationParts.push(j.City);
    if (j.State) locationParts.push(j.State);
    if (j.Country && j.Country !== 'United States') locationParts.push(j.Country);
    const location = locationParts.length > 0 ? locationParts.join(', ') : undefined;

    // Tags → department (use first tag name if available)
    let department: string | undefined;
    if (j.Tags && Array.isArray(j.Tags) && j.Tags.length > 0) {
      department = j.Tags.map((t: { Name?: string }) => t.Name).filter(Boolean).join(', ') || undefined;
    }

    // The GetAllJobs response contains a plain-text snippet (~500 chars).
    // We use it directly to avoid per-job GetJob API calls which trigger
    // 429 rate limits when syncing hundreds of jobs.
    const description: string | undefined = j.Description?.trim() || undefined;

    jobs.push({
      title,
      url: jobUrl,
      location,
      department,
      description,
    });
  }

  return { jobs };
}

/**
 * Detect company name from a Crelate portal without fetching the jobs list.
 * Fetches the portal page to extract ORG_DISPLAY_NAME.
 */
export async function crelateApiDetect(url: string): Promise<{ company: string; error?: string }> {
  const slug = extractCrelateSlug(url);
  if (!slug) return { company: '', error: 'Could not extract org name from Crelate URL' };

  const { html, error } = await fetchHtml(url);
  if (error) {
    // Fallback: prettify the slug
    const fallback = slug.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    return { company: fallback };
  }

  const orgInfo = extractOrgInfo(html);
  if (orgInfo?.displayName) return { company: orgInfo.displayName };

  // Fallback to prettified slug
  const fallback = slug.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  return { company: fallback };
}

/**
 * Fetch a single Crelate job's full HTML description via the GetJob API.
 * Called from scrapeJobDetail for enrichment of new jobs.
 */
export async function fetchCrelateJobDetail(jobCode: string): Promise<ParsedJob | null> {
  const envelope = JSON.stringify({ JobCode: jobCode });
  const apiUrl = `${CRELATE_API_BASE}/candidateportal/GetJob?requestEnvelope=${encodeURIComponent(envelope)}`;

  const { data, error } = await fetchJson(apiUrl);
  if (error) return null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const payload = data as any;
  const job = payload?.Job;
  if (!job) return null;

  // Description from GetJob is full HTML
  let description: string | undefined;
  if (job.Description) {
    const { NodeHtmlMarkdown } = await import('node-html-markdown');
    const nhm = new NodeHtmlMarkdown({ bulletMarker: '-' });
    description = nhm.translate(job.Description).trim().slice(0, 20_000) || undefined;
  }

  // Location
  const locationParts: string[] = [];
  if (job.City) locationParts.push(job.City);
  if (job.State) locationParts.push(job.State);
  if (job.Country && job.Country !== 'United States') locationParts.push(job.Country);
  const location = locationParts.length > 0 ? locationParts.join(', ') : undefined;

  // Department from tags
  let department: string | undefined;
  if (job.Tags && Array.isArray(job.Tags) && job.Tags.length > 0) {
    department = job.Tags.map((t: { Name?: string }) => t.Name).filter(Boolean).join(', ') || undefined;
  }

  return {
    title: job.Title ?? '',
    url: '',
    location,
    department,
    description,
  };
}

/**
 * Extract the JobCode from a Crelate job URL.
 * URL format: https://jobs.crelate.com/portal/{orgName}/job/{jobCode}
 */
export function extractCrelateJobCode(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname !== 'jobs.crelate.com') return null;
    const parts = u.pathname.split('/').filter(Boolean);
    // ['portal', '{orgName}', 'job', '{jobCode}'] or
    // ['portal', 'v2', '{orgName}', 'job', '{jobCode}']
    const jobIdx = parts.indexOf('job');
    if (jobIdx < 0 || jobIdx >= parts.length - 1) return null;
    return parts[jobIdx + 1] || null;
  } catch {
    return null;
  }
}

// ── HTML parser (fallback) ────────────────────────────────────────────────────

/**
 * Crelate HTML parser — fallback for when the API approach fails.
 *
 * The portal page is a Vue SPA, so at load time the HTML body is mostly empty
 * (just placeholder divs). Server-rendered content is minimal.
 * This parser won't find much, but is included for completeness.
 */
export function crelateParser(html: string, baseUrl: string): ParsedJob[] {
  // The Crelate portal is fully client-side rendered, so HTML parsing
  // won't find job listings. Return empty — the API fetch handles everything.
  return [];
}
