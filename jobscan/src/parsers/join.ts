import * as cheerio from 'cheerio';
import { ParsedJob } from '../types';
import { fetchHtml } from '../fetch-utils';

/**
 * Extract the company slug from a JOIN URL.
 * Handles:
 *   https://join.com/companies/{slug}
 *   https://join.com/companies/{slug}/{idParam}
 */
function extractJoinSlug(url: string): string | null {
  try {
    const u = new URL(url);
    if (!u.hostname.match(/^(www\.)?join\.com$/i)) return null;
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts[0] !== 'companies' || !parts[1]) return null;
    return parts[1];
  } catch {
    return null;
  }
}

// ── Workplace-type mapping ────────────────────────────────────────────────────

function formatWorkplaceType(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  const map: Record<string, string> = {
    ONSITE: 'On-site',
    REMOTE: 'Remote',
    HYBRID: 'Hybrid',
  };
  return map[raw] ?? raw;
}

// ── __NEXT_DATA__ extraction helpers ──────────────────────────────────────────

/**
 * Parse the `__NEXT_DATA__` JSON embedded in a join.com HTML page.
 * Returns the parsed object or null if not found.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractNextData(html: string): any | null {
  const match = html.match(/<script id="__NEXT_DATA__"[^>]*>(.*?)<\/script>/);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

/**
 * Build a location string from a job item's city field.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildLocation(city: any): string | undefined {
  if (!city) return undefined;
  const parts = [city.cityName, city.countryName].filter(Boolean);
  return parts.join(', ') || undefined;
}

// ── Public functions ──────────────────────────────────────────────────────────

/**
 * Fetch all jobs from a join.com company page by parsing `__NEXT_DATA__`.
 *
 * Join.com is a Next.js app that embeds the full page state in a
 * `<script id="__NEXT_DATA__">` tag. The company listing page at
 * `/companies/{slug}` includes:
 *   - Company info in `initialState.company`
 *   - Job items in `initialState.jobs.items[]`
 *   - Pagination in `initialState.jobs.pagination`
 *
 * The listing returns max 5 jobs per page (perPage is server-fixed at 5),
 * so we paginate through all pages via `?page=N`.
 *
 * Descriptions are NOT included in the listing — they are only available on
 * individual job detail pages. The scraper's `scrapeJobDetail` function
 * handles enriching new jobs with descriptions from detail pages.
 */
export async function joinApiFetch(url: string): Promise<{ jobs: ParsedJob[]; error?: string }> {
  const slug = extractJoinSlug(url);
  if (!slug) return { jobs: [], error: 'Could not extract company slug from JOIN URL' };

  const baseUrl = `https://join.com/companies/${slug}`;
  const allJobs: ParsedJob[] = [];
  let page = 1;
  let totalPages = 1;

  while (page <= totalPages) {
    const pageUrl = page === 1 ? baseUrl : `${baseUrl}?page=${page}`;
    const { html, error } = await fetchHtml(pageUrl);
    if (error) {
      if (page === 1) return { jobs: [], error };
      // If a subsequent page fails, return what we have so far
      break;
    }

    const nextData = extractNextData(html);
    if (!nextData) {
      if (page === 1) return { jobs: [], error: 'Could not parse __NEXT_DATA__ from JOIN page' };
      break;
    }

    const pageProps = nextData?.props?.pageProps;
    if (pageProps?.statusCode) {
      return { jobs: [], error: `JOIN returned status ${pageProps.statusCode}: ${pageProps.error?.msg ?? 'Unknown error'}` };
    }

    const state = pageProps?.initialState;
    if (!state) {
      if (page === 1) return { jobs: [], error: 'No initialState found in JOIN page data' };
      break;
    }

    const jobsData = state.jobs ?? {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const items: any[] = jobsData.items ?? [];
    const pagination = jobsData.pagination ?? {};

    if (page === 1) {
      totalPages = pagination.pageCount || 1;
    }

    for (const j of items) {
      const title: string = j.title?.trim() ?? '';
      const idParam: string = j.idParam ?? '';
      if (!title || !idParam) continue;

      const jobUrl = `https://join.com/companies/${slug}/${idParam}`;
      const location = buildLocation(j.city);
      const workplace_type = formatWorkplaceType(j.workplaceType);
      const department: string | undefined = j.category?.name || undefined;
      const commitment: string | undefined = j.employmentType?.name || undefined;

      allJobs.push({
        title,
        url: jobUrl,
        location,
        workplace_type,
        department,
        commitment,
        // description is NOT available in the listing — will be fetched per-job
      });
    }

    page++;
  }

  return { jobs: allJobs };
}

/**
 * Detect company name from a join.com URL.
 * Fetches the company page and extracts the company name from __NEXT_DATA__.
 */
export async function joinDetect(url: string): Promise<{ company: string; error?: string }> {
  const slug = extractJoinSlug(url);
  if (!slug) return { company: '', error: 'Could not extract company slug from JOIN URL' };

  const pageUrl = `https://join.com/companies/${slug}`;
  const { html, error } = await fetchHtml(pageUrl);
  if (error) {
    // Fallback: prettify the slug
    const fallback = slug.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    return { company: fallback };
  }

  const nextData = extractNextData(html);
  if (!nextData) {
    const fallback = slug.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    return { company: fallback };
  }

  const state = nextData?.props?.pageProps?.initialState;
  const name: string = state?.company?.name ?? '';
  if (name) return { company: name };

  const fallback = slug.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  return { company: fallback };
}

/**
 * Extract a job's description from its detail page's `__NEXT_DATA__`.
 *
 * The detail page at `/companies/{slug}/{idParam}` embeds the full job
 * object in `initialState.job`, which includes:
 *   - `description` (Markdown format)
 *   - `schemaDescription` (HTML format)
 *   - `workplaceType`, `employmentType`, `category`, `city`, etc.
 *
 * We prefer `description` (Markdown) since it's already clean text.
 */
export function extractJoinJobFromHtml(html: string): Partial<ParsedJob> | null {
  const nextData = extractNextData(html);
  if (!nextData) return null;

  const job = nextData?.props?.pageProps?.initialState?.job;
  if (!job) return null;

  const result: Partial<ParsedJob> = {};

  // Description: prefer Markdown version, fall back to HTML conversion
  if (job.description) {
    result.description = String(job.description).trim().slice(0, 20_000) || undefined;
  }

  // Additional fields that might not be in the listing
  if (job.workplaceType) {
    result.workplace_type = formatWorkplaceType(job.workplaceType);
  }
  if (job.employmentType?.name || job.employmentType?.googleType) {
    result.commitment = job.employmentType.name || job.employmentType.googleType;
  }
  if (job.category?.name) {
    result.department = job.category.name;
  }
  if (job.city) {
    result.location = buildLocation(job.city);
  }

  return result;
}

/**
 * JOIN HTML fallback parser.
 *
 * If the API-style __NEXT_DATA__ extraction fails, this parser
 * scrapes job listings from the HTML DOM of a join.com company page.
 *
 * Job links follow the pattern: https://join.com/companies/{slug}/{idParam}
 * Each job card contains the title, location, and optional metadata.
 */
export function joinParser(html: string, baseUrl: string): ParsedJob[] {
  // First try __NEXT_DATA__ (most reliable)
  const nextData = extractNextData(html);
  if (nextData) {
    const state = nextData?.props?.pageProps?.initialState;
    if (state?.jobs?.items?.length > 0) {
      const slug = extractJoinSlug(baseUrl);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return state.jobs.items.map((j: any) => ({
        title: j.title?.trim() ?? '',
        url: slug
          ? `https://join.com/companies/${slug}/${j.idParam}`
          : `https://join.com/companies/${j.idParam}`,
        location: buildLocation(j.city),
        workplace_type: formatWorkplaceType(j.workplaceType),
        department: j.category?.name || undefined,
        commitment: j.employmentType?.name || undefined,
      })).filter((j: ParsedJob) => j.title && j.url);
    }
  }

  // Fallback: DOM-based extraction
  const $ = cheerio.load(html);
  const slug = extractJoinSlug(baseUrl);
  const jobs: ParsedJob[] = [];
  const seen = new Set<string>();

  // Job links are full URLs like https://join.com/companies/{slug}/{idParam}
  const linkPattern = slug
    ? new RegExp(`^https?://join\\.com/companies/${slug}/[\\w-]+$`)
    : /^https?:\/\/join\.com\/companies\/[\w-]+\/[\w-]+$/;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  $('a[href]').each((_i: number, el: any) => {
    const href = $(el).attr('href') ?? '';
    if (!linkPattern.test(href)) return;
    if (seen.has(href)) return;
    seen.add(href);

    // The link text or the closest heading is usually the job title
    const title = $(el).text().trim();
    if (!title || title.length < 3) return;

    jobs.push({
      title,
      url: href,
    });
  });

  return jobs;
}
