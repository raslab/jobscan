import { ParsedJob } from '../types';
import { fetchJson } from '../fetch-utils';
import { NodeHtmlMarkdown } from 'node-html-markdown';

/**
 * Extract the company identifier from a SmartRecruiters job board URL.
 * Handles:
 *   https://jobs.smartrecruiters.com/{CompanyIdentifier}
 *   https://jobs.smartrecruiters.com/{CompanyIdentifier}/{jobId}-{slug}
 *   https://careers.smartrecruiters.com/{CompanyIdentifier}  (alternate domain)
 */
function extractSmartRecruitersIdentifier(url: string): string | null {
  try {
    const u = new URL(url);
    if (!u.hostname.match(/^(?:jobs|careers)\.smartrecruiters\.com$/i)) return null;
    const parts = u.pathname.split('/').filter(Boolean);
    return parts[0] || null;
  } catch {
    return null;
  }
}

// ── Workplace-type mapping ────────────────────────────────────────────────────

function formatWorkplaceType(
  remote: boolean | undefined,
  hybrid: boolean | undefined,
): string | undefined {
  if (remote) return 'Remote';
  if (hybrid) return 'Hybrid';
  return undefined; // Don't assume On-site when neither flag is set
}

// ── Commitment / employment-type mapping ──────────────────────────────────────

function formatEmploymentType(
  typeId: string | undefined,
  typeLabel: string | undefined,
): string | undefined {
  if (!typeId && !typeLabel) return undefined;
  // Map SmartRecruiters typeOfEmployment.id values to normalised strings
  const map: Record<string, string> = {
    permanent: 'Full-time',
    contract: 'Contract',
    intern: 'Internship',
    'part-time': 'Part-time',
    temporary: 'Temporary',
    volunteer: 'Volunteer',
    freelance: 'Freelance',
  };
  if (typeId && map[typeId]) return map[typeId];
  // Fall back to the label as-is — it's usually already well-formatted
  return typeLabel || undefined;
}

// ── Public API functions ──────────────────────────────────────────────────────

/**
 * Fetch ALL jobs from a SmartRecruiters career board via its public JSON API.
 *
 * Endpoint: GET https://api.smartrecruiters.com/v1/companies/{identifier}/postings
 * Pagination: `limit` (max 100) + `offset` query parameters.
 * Response: { offset, limit, totalFound, content: [...] }
 *
 * Strategy:
 *  - Fetch first page → read `totalFound`
 *  - Keep fetching at offset 100, 200, … until all jobs are collected
 *  - Descriptions are NOT in the listing; they are fetched per-job by scrapeJobDetail
 */
export async function smartrecruitersApiFetch(
  url: string,
): Promise<{ jobs: ParsedJob[]; error?: string }> {
  const identifier = extractSmartRecruitersIdentifier(url);
  if (!identifier) {
    return { jobs: [], error: 'Could not extract company identifier from SmartRecruiters URL' };
  }

  const LIMIT = 100;
  let offset = 0;
  let totalFound = 0;
  const allJobs: ParsedJob[] = [];

  do {
    const page = Math.floor(offset / LIMIT) + 1;
    const apiUrl =
      `https://api.smartrecruiters.com/v1/companies/${identifier}/postings` +
      `?limit=${LIMIT}&offset=${offset}`;

    console.log(`[smartrecruiters] ${identifier}: fetching page ${page}${totalFound ? ` (${offset}/${totalFound})` : ''} …`);
    const { data, error } = await fetchJson(apiUrl);

    if (error) {
      console.warn(`[smartrecruiters] ${identifier}: page ${page} failed — ${error}`);
      // If we failed on the very first page, surface the error
      if (offset === 0) return { jobs: [], error };
      // Otherwise return what we already collected
      break;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const payload = data as any;

    if (offset === 0) {
      totalFound = payload?.totalFound ?? 0;
      console.log(`[smartrecruiters] ${identifier}: ${totalFound} total jobs — will need ${Math.ceil(totalFound / LIMIT)} page(s)`);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rawJobs: any[] = payload?.content ?? [];
    if (rawJobs.length === 0) break;

    for (const j of rawJobs) {
      const title: string = (j.name ?? '').trim();
      const jobId: string = j.id ?? '';
      if (!title || !jobId) continue;

      // Public job URL — the slug suffix is cosmetic; ID-only URLs work fine
      const jobUrl = `https://jobs.smartrecruiters.com/${identifier}/${jobId}`;

      // Location — SmartRecruiters provides a pre-formatted fullLocation string
      const loc = j.location;
      const location: string | undefined =
        loc ? (loc.fullLocation ?? '').trim() || undefined : undefined;

      // Workplace type derived from the remote / hybrid boolean flags
      const workplace_type = formatWorkplaceType(loc?.remote, loc?.hybrid);

      // Department from department.label (may be an empty object for unset depts)
      const department: string | undefined = j.department?.label || undefined;

      // Commitment from typeOfEmployment (id + label both available)
      const commitment = formatEmploymentType(
        j.typeOfEmployment?.id,
        j.typeOfEmployment?.label,
      );

      allJobs.push({ title, url: jobUrl, location, workplace_type, department, commitment });
    }

    offset += rawJobs.length;
    console.log(`[smartrecruiters] ${identifier}: page ${page} done — ${rawJobs.length} jobs (${allJobs.length} collected so far)`);
  } while (offset < totalFound);

  console.log(`[smartrecruiters] ${identifier}: finished — ${allJobs.length} jobs total`);
  return { jobs: allJobs };
}

/**
 * Detect the human-readable company name from a SmartRecruiters board URL.
 *
 * Strategy:
 *  1. Fetch the first job posting → read company.name from the response
 *  2. Fallback: prettify the URL identifier (CamelCase → words)
 */
export async function smartrecruitersApiDetect(
  url: string,
): Promise<{ company: string; error?: string }> {
  const identifier = extractSmartRecruitersIdentifier(url);
  if (!identifier) {
    return { company: '', error: 'Could not extract company identifier from SmartRecruiters URL' };
  }

  const apiUrl = `https://api.smartrecruiters.com/v1/companies/${identifier}/postings?limit=1`;
  const { data, error } = await fetchJson(apiUrl);

  if (!error) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const payload = data as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const first: any = payload?.content?.[0];
    const name: string = first?.company?.name ?? '';
    if (name) return { company: name };
  }

  // Fallback: split CamelCase / PascalCase identifier into words
  const fallback = identifier
    .replace(/([a-z])([A-Z])/g, '$1 $2')   // split camelCase
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2') // split consecutive caps
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
  return { company: fallback };
}

/**
 * Fetch the full description for a single SmartRecruiters job via the detail API.
 * Called from scrapeJobDetail in scraper.ts — uses the API rather than HTML so we
 * avoid parsing a React SPA.
 *
 * Endpoint: GET https://api.smartrecruiters.com/v1/companies/{identifier}/postings/{jobId}
 *
 * The response contains a `jobAd.sections` object with HTML in:
 *   - companyDescription.text
 *   - jobDescription.text
 *   - qualifications.text
 *   - additionalInformation.text
 *
 * These are concatenated (with heading labels) and converted to Markdown.
 */
export async function smartrecruitersJobDetailApiFetch(
  jobUrl: string,
): Promise<{ description?: string; error?: string }> {
  // Parse identifier and jobId from URLs like:
  //   https://jobs.smartrecruiters.com/{identifier}/{jobId}
  //   https://jobs.smartrecruiters.com/{identifier}/{jobId}-{slug}
  let identifier: string | null = null;
  let jobId: string | null = null;

  try {
    const u = new URL(jobUrl);
    if (!u.hostname.match(/^(?:jobs|careers)\.smartrecruiters\.com$/i)) {
      return { error: 'Not a SmartRecruiters job URL' };
    }
    const parts = u.pathname.split('/').filter(Boolean);
    identifier = parts[0] ?? null;
    // The second segment starts with the numeric jobId, optionally followed by -slug
    const rawSegment = parts[1] ?? null;
    jobId = rawSegment ? rawSegment.split('-')[0] : null;
  } catch {
    return { error: 'Failed to parse SmartRecruiters job URL' };
  }

  if (!identifier || !jobId) {
    return { error: 'Could not extract identifier or jobId from SmartRecruiters job URL' };
  }

  const apiUrl = `https://api.smartrecruiters.com/v1/companies/${identifier}/postings/${jobId}`;
  // maxRetries=1: one retry on transient errors, but don't burn minutes on rate-limiting
  const { data, error } = await fetchJson(apiUrl, { maxRetries: 1 });
  if (error) return { error };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const payload = data as any;
  const sections = payload?.jobAd?.sections;
  if (!sections) return {};

  const nhm = new NodeHtmlMarkdown({ bulletMarker: '-' });
  const parts: string[] = [];

  // Sections in display order; skip empty ones (SmartRecruiters sends <p></p> for blanks)
  for (const key of [
    'companyDescription',
    'jobDescription',
    'qualifications',
    'additionalInformation',
  ] as const) {
    const section = sections[key];
    const title: string = section?.title ?? '';
    const text: string = section?.text ?? '';
    // Treat empty / whitespace-only / placeholder paragraphs as absent
    if (!text || /^(\s*<p>\s*<\/p>\s*)+$/.test(text)) continue;
    if (title) parts.push(`## ${title}\n`);
    parts.push(nhm.translate(text).trim());
  }

  if (parts.length === 0) return {};
  const description = parts.join('\n\n').trim().slice(0, 20_000) || undefined;
  return { description };
}

/**
 * SmartRecruiters HTML parser (fallback only).
 *
 * SmartRecruiters career pages are React SPAs that render job listings
 * client-side — server-rendered HTML contains minimal job data.
 * The API path (smartrecruitersApiFetch) is always preferred.
 *
 * This function returns an empty array; the API scraper in apiScrapers[]
 * will always be tried first and will succeed for valid company identifiers.
 */
export function smartrecruitersParser(
  _html: string,
  _baseUrl: string,
): ParsedJob[] {
  return [];
}
