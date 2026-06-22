import * as cheerio from 'cheerio';
import { ParsedJob } from '../types';
import { fetchJson, fetchHtml } from '../fetch-utils';

/**
 * Schwarz IT / Schwarz Group "Trinity" CMS parser.
 *
 * ── Platform ─────────────────────────────────────────────────────────────────
 *
 * Schwarz Group (parent of Lidl, Kaufland, STACKIT, PreZero) runs a custom
 * Vite-based CMS ("Trinity" theme) with server-rendered data-island web
 * components. Job listings are rendered client-side by the `DigitsSearch`
 * component, fed by a REST API. Multiple Schwarz subsidiaries use the same
 * platform with different domains.
 *
 * ── Known domains ────────────────────────────────────────────────────────────
 *
 *   schwarz-digits.de     — Schwarz Digits (IT / Cloud / Cyber)
 *   jobs.schwarz          — Schwarz Group corporate
 *
 * ── URL patterns ─────────────────────────────────────────────────────────────
 *
 *   https://schwarz-digits.de/en/jobsearch                   — listing page
 *   https://schwarz-digits.de/en/jobsearch?itemsPerPage=100  — with pagination
 *   https://schwarz-digits.de/en/jobsearch/hr/{slug}-GT{id}  — job detail (HR system)
 *   https://schwarz-digits.de/en/jobsearch/{slug}-{id}       — job detail (external)
 *   https://jobs.schwarz/en/jobsearch                        — group-level listing
 *
 * ── API ──────────────────────────────────────────────────────────────────────
 *
 *   POST /{lang}/api/v1/job/search
 *   Body: {"perPage": 100, "page": 1, "term": "", "filters": {}}
 *   Returns: { jobs: [{id, title, entryLevel, location, url, brand}], pagination, filters }
 *
 * ── Detection signals ────────────────────────────────────────────────────────
 *
 *   URL:    schwarz-digits.de/...jobsearch  |  jobs.schwarz/...jobsearch
 *   DOM:    DigitsSearch component in data-props, searchApiUrl = "/en/api/v1/job/search"
 *   Script: /assets-digits/ script paths
 */

// ── Types ────────────────────────────────────────────────────────────────────

interface SchwarzApiJob {
  id: string;
  title: string;
  entryLevel: string | null;
  location: string | null;
  url: string;
  brand: string | null;
}

interface SchwarzApiResponse {
  jobs: SchwarzApiJob[];
  pagination: {
    count: number;
    totalCount: number;
    page: number;
    resultsPerPage: number;
  };
  filters: unknown;
}

// ── Known Schwarz Group domains ─────────────────────────────────────────────

const KNOWN_DOMAINS = [
  'schwarz-digits.de',
  'jobs.schwarz',
];

// ── URL helpers ─────────────────────────────────────────────────────────────

/**
 * Check if a URL belongs to a known Schwarz Group career site.
 */
export function isSchwarzItUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '');
    return KNOWN_DOMAINS.some(d => host === d);
  } catch {
    return false;
  }
}

/**
 * Extract the language prefix from a Schwarz career site URL.
 * Defaults to 'en' if not found.
 */
export function extractLangPrefix(url: string): string {
  try {
    const u = new URL(url);
    // Path: /en/jobsearch or /de/jobsearch or /jobsearch
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts.length >= 1 && /^[a-z]{2}$/.test(parts[0])) {
      return parts[0];
    }
  } catch { /* ignore */ }
  return 'en';
}

/**
 * Build the API URL for a given Schwarz career site URL.
 */
export function buildApiUrl(url: string): string | null {
  try {
    const u = new URL(url);
    const lang = extractLangPrefix(url);
    return `${u.origin}/${lang}/api/v1/job/search`;
  } catch {
    return null;
  }
}

// ── API fetch ───────────────────────────────────────────────────────────────

/**
 * Fetch all jobs from a Schwarz IT / Schwarz Group career site via the REST API.
 *
 * POST /{lang}/api/v1/job/search
 * Paginates automatically if totalCount > perPage.
 */
export async function schwarzitApiFetch(
  url: string,
): Promise<{ jobs: ParsedJob[]; error?: string }> {
  if (!isSchwarzItUrl(url)) {
    return { jobs: [], error: 'Not a recognised Schwarz Group career site URL' };
  }

  const apiUrl = buildApiUrl(url);
  if (!apiUrl) {
    return { jobs: [], error: 'Could not build API URL from source URL' };
  }

  const perPage = 100;
  let page = 1;
  const allJobs: ParsedJob[] = [];
  let totalCount = Infinity;

  while (allJobs.length < totalCount) {
    const body = JSON.stringify({ perPage, page, term: '', filters: {} });

    const { data, error } = await fetchJson(apiUrl, {
      method: 'POST',
      body,
      headers: { 'Content-Type': 'application/json' },
    });

    if (error) {
      // If we already have some jobs from previous pages, return them
      if (allJobs.length > 0) {
        console.log(`[schwarzit] Partial fetch: got ${allJobs.length} jobs before error on page ${page}: ${error}`);
        break;
      }
      return { jobs: [], error };
    }

    const resp = data as SchwarzApiResponse;
    if (!resp?.jobs || !Array.isArray(resp.jobs)) {
      if (allJobs.length > 0) break;
      return { jobs: [], error: 'Unexpected API response format' };
    }

    totalCount = resp.pagination?.totalCount ?? resp.jobs.length;

    for (const j of resp.jobs) {
      const title = j.title?.trim();
      const jobUrl = j.url?.trim();
      if (!title || !jobUrl) continue;

      const location = j.location?.trim() || undefined;
      const commitment = j.entryLevel?.trim() || undefined;

      allJobs.push({
        title,
        url: jobUrl,
        location,
        commitment,
      });
    }

    // Stop if we got all jobs or this page returned fewer than expected
    if (resp.jobs.length < perPage || allJobs.length >= totalCount) break;
    page++;
  }

  return { jobs: allJobs };
}

// ── HTML parser (fallback if API fails) ─────────────────────────────────────

/**
 * Parse job listings from server-rendered or data-island HTML.
 *
 * The Trinity CMS renders job data inside `data-props` attributes on
 * `data-island` web component divs. The `DigitsSearch` component contains
 * the search API URL but not the actual job data (loaded client-side).
 *
 * However, the page also contains `<a>` links to job detail pages in the
 * HTML when JS renders the listing. For the HTML fallback, we extract jobs
 * from the serialized data or from link patterns.
 */
export function schwarzitParser(html: string, baseUrl: string): ParsedJob[] {
  if (!html) return [];

  const $ = cheerio.load(html);
  const jobs: ParsedJob[] = [];

  let origin: string;
  try {
    origin = new URL(baseUrl).origin;
  } catch {
    origin = baseUrl.replace(/\/+$/, '');
  }

  // Strategy: Parse links matching the job detail URL pattern
  // /en/jobsearch/{slug}-{id}  or  /en/jobsearch/hr/{slug}-GT{id}
  const seenUrls = new Set<string>();

  $('a[href]').each((_i, el) => {
    const href = $(el).attr('href') ?? '';

    // Match job detail URL patterns
    if (!/\/jobsearch\/(?:hr\/)?[a-z0-9].*-(?:GT)?\d+$/i.test(href)) return;

    let jobUrl: string;
    try {
      jobUrl = new URL(href, origin).toString();
    } catch {
      return;
    }

    if (seenUrls.has(jobUrl)) return;
    seenUrls.add(jobUrl);

    // Extract title from link text or surrounding context
    const linkText = $(el).text().trim();
    // The link text usually includes title + "Bookmark job" + entry level + location
    // Extract just the job title (first meaningful line)
    const title = linkText.split(/\n/)[0]?.trim()
      || linkText.replace(/Bookmark job.*$/i, '').trim();

    if (!title) return;

    jobs.push({ title, url: jobUrl });
  });

  return jobs;
}
