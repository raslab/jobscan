import * as cheerio from 'cheerio';
import { ParsedJob } from '../types';
import { fetchHtml, sleep } from '../fetch-utils';
import { NodeHtmlMarkdown } from 'node-html-markdown';

/**
 * DYMATRIX careers parser.
 *
 * ── Platform ─────────────────────────────────────────────────────────────────
 *
 * DYMATRIX GmbH runs a custom TYPO3 CMS with the UdgJobs extension
 * (`tx_udgjobs_jobslist`). Job listings are server-rendered HTML with
 * pagination and filters.
 *
 * ── URL patterns ─────────────────────────────────────────────────────────────
 *
 *   https://www.dymatrix.de/de/unternehmen/stellenangebote                     — listing page 1
 *   https://www.dymatrix.de/de/unternehmen/stellenangebote?tx_udgjobs_...=N    — paginated
 *   https://www.dymatrix.de/de/unternehmen/stellenangebote/details/{slug}      — job detail page
 *
 * ── How it works ─────────────────────────────────────────────────────────────
 *
 * Phase 1 — Listing: Fetch each paginated listing page and parse job cards.
 *   Job cards are `<a>` elements with `data-econda-downloadtyp="job"` and
 *   class `list__item`. Each card contains:
 *     - Title: `<h5 class="list__title">`
 *     - Company/team: first `<span class="category-badge">`
 *     - Department: second `<span class="category-badge">`
 *     - Schedule: `<span aria-label="Schedule">`
 *     - Location(s): `<b aria-label="Location">` (multiple)
 *
 * Phase 2 — Detail enrichment: For each job, fetch the detail page to extract
 *   the full job description from `<div class="details">` sections.
 *
 * ── Detection signals ─────────────────────────────────────────────────────────
 *
 * URL:  www.dymatrix.de/.../stellenangebote
 * DOM:  tx_udgjobs_jobslist in form actions, hidden inputs
 */

// ── Listing page parser ─────────────────────────────────────────────────────

/**
 * Parse job cards from a DYMATRIX listing page HTML.
 *
 * Each job card is an `<a>` element with `data-econda-downloadtyp="job"`.
 */
export function dymatrixParser(html: string, baseUrl: string): ParsedJob[] {
  if (!html) return [];

  const $ = cheerio.load(html);
  const jobs: ParsedJob[] = [];

  let origin: string;
  try {
    origin = new URL(baseUrl).origin;
  } catch {
    origin = baseUrl.replace(/\/+$/, '');
  }

  $('a[data-econda-downloadtyp="job"]').each((_i, el) => {
    const $a = $(el);

    // Title from <h5 class="list__title"> or data-econda-downloadname attribute
    const title = $a.find('h5.list__title').text().trim()
      || $a.attr('data-econda-downloadname')?.trim()
      || '';

    const href = $a.attr('href') ?? '';
    if (!title || !href) return;

    // Build absolute URL
    let jobUrl: string;
    try {
      jobUrl = new URL(href, origin).toString();
    } catch {
      jobUrl = href.startsWith('http') ? href : origin + href;
    }

    // Category badges: first = company/team, second = department
    const badges = $a.find('span.category-badge').map((_j, badge) => $(badge).text().trim()).get();
    const team = badges[0] || undefined;
    const department = badges[1] || undefined;

    // Schedule / commitment
    const commitment = $a.find('span[aria-label="Schedule"]').text().trim() || undefined;

    // Locations — multiple <b aria-label="Location"> elements
    const locations = $a.find('b[aria-label="Location"]').map((_j, loc) => $(loc).text().trim()).get().filter(Boolean);
    const location = locations.length > 0 ? locations.join(', ') : undefined;

    jobs.push({
      title,
      url: jobUrl,
      location,
      commitment,
      department,
      team,
    });
  });

  return jobs;
}

// ── Pagination helper ─────────────────────────────────────────────────────────

/**
 * Extract pagination page numbers from the listing HTML.
 * Returns sorted array of unique page numbers found in pagination links.
 */
export function extractPaginationPages(html: string): number[] {
  if (!html) return [];
  const $ = cheerio.load(html);
  const pages = new Set<number>();

  $('ul.pagination a.page-link').each((_i, el) => {
    const href = $(el).attr('href') ?? '';
    const match = href.match(/currentPageNumber%5D=(\d+)/i)
      || href.match(/currentPageNumber\]=(\d+)/i);
    if (match) {
      pages.add(parseInt(match[1], 10));
    }
  });

  return Array.from(pages).sort((a, b) => a - b);
}

// ── Detail page parser ────────────────────────────────────────────────────────

/**
 * Parse job description from a DYMATRIX detail page HTML.
 *
 * The detail page has:
 *   - `<h1 class="headline">` — job title
 *   - `<span aria-label="Schedule">` — commitment
 *   - `<b aria-label="Location">` — locations
 *   - `<div class="details">` — description sections with `<h2 class="detail--headline">`
 *
 * Returns description as Markdown.
 */
export function dymatrixParseDetailHtml(html: string): {
  description?: string;
  location?: string;
  commitment?: string;
} {
  if (!html) return {};

  const $ = cheerio.load(html);
  const result: {
    description?: string;
    location?: string;
    commitment?: string;
  } = {};

  // Location from detail page
  const locations = $('b[aria-label="Location"]').map((_i, el) => $(el).text().trim()).get().filter(Boolean);
  if (locations.length > 0) {
    result.location = locations.join(', ');
  }

  // Commitment from detail page
  const commitment = $('span[aria-label="Schedule"]').first().text().trim();
  if (commitment) {
    result.commitment = commitment;
  }

  // Description from <div class="details"> sections
  const $details = $('div.details');
  if ($details.length > 0) {
    const descriptionHtml = $details.html();
    if (descriptionHtml) {
      try {
        result.description = NodeHtmlMarkdown.translate(descriptionHtml).trim();
      } catch {
        // Fallback to raw text
        result.description = $details.text().trim();
      }
    }
  }

  return result;
}

// ── Detail page fetcher ───────────────────────────────────────────────────────

/**
 * Fetch a single DYMATRIX job detail page and extract description.
 */
export async function dymatrixJobDetailFetch(
  jobUrl: string,
): Promise<{
  description?: string;
  location?: string;
  commitment?: string;
  error?: string;
}> {
  const { html, error } = await fetchHtml(jobUrl);
  if (error || !html) {
    return { error: error || 'Empty response from detail page' };
  }

  return dymatrixParseDetailHtml(html);
}

// ── API fetch (primary entry point) ──────────────────────────────────────────

/**
 * Build a pagination URL for the DYMATRIX careers listing.
 */
function buildPaginationUrl(baseUrl: string, page: number): string {
  const u = new URL(baseUrl);
  u.searchParams.set('tx_udgjobs_jobslist[controller]', 'Jobs');
  u.searchParams.set('tx_udgjobs_jobslist[currentPageNumber]', String(page));
  return u.toString();
}

/**
 * Fetch all jobs from DYMATRIX careers, handling pagination and detail enrichment.
 *
 * Strategy:
 *   1. Fetch page 1 to get job cards + discover total pages from pagination.
 *   2. Fetch remaining pages sequentially with 300-600ms throttling.
 *   3. For each job, fetch the detail page to extract description.
 *   4. Apply 400-800ms throttling between detail fetches.
 *
 * @param url - The source URL (e.g. https://www.dymatrix.de/de/unternehmen/stellenangebote)
 */
export async function dymatrixApiFetch(
  url: string,
): Promise<{ jobs: ParsedJob[]; error?: string }> {
  // Normalise the URL to remove any existing pagination params
  const baseUrl = url.split('?')[0];

  console.log(`[dymatrix] Fetching listing page 1 from ${baseUrl}`);

  // Phase 1: Fetch page 1
  const { html: page1Html, error: page1Error } = await fetchHtml(baseUrl);
  if (page1Error || !page1Html) {
    return { jobs: [], error: page1Error || 'Empty response from listing page 1' };
  }

  let allJobs = dymatrixParser(page1Html, baseUrl);
  const pages = extractPaginationPages(page1Html);

  console.log(`[dymatrix] Page 1: ${allJobs.length} jobs, pages found: [${pages.join(', ')}]`);

  // Phase 2: Fetch remaining pages
  const remainingPages = pages.filter(p => p > 1);
  for (const page of remainingPages) {
    await sleep(300 + Math.random() * 300); // 300-600ms throttle

    const pageUrl = buildPaginationUrl(baseUrl, page);
    console.log(`[dymatrix] Fetching page ${page}`);

    const { html: pageHtml, error: pageError } = await fetchHtml(pageUrl);
    if (pageError || !pageHtml) {
      console.log(`[dymatrix] Error fetching page ${page}: ${pageError}`);
      continue; // Skip failed pages, we still have what we have
    }

    const pageJobs = dymatrixParser(pageHtml, baseUrl);
    console.log(`[dymatrix] Page ${page}: ${pageJobs.length} jobs`);
    allJobs = allJobs.concat(pageJobs);
  }

  if (allJobs.length === 0) {
    return { jobs: [], error: undefined }; // Zero jobs is valid
  }

  console.log(`[dymatrix] Total ${allJobs.length} jobs from listing, fetching details...`);

  // Phase 3: Enrich each job with detail page data (description)
  const enrichedJobs: ParsedJob[] = [];
  for (let i = 0; i < allJobs.length; i++) {
    const job = allJobs[i];

    // Throttle between detail fetches (skip for first request)
    if (i > 0) {
      await sleep(400 + Math.random() * 400); // 400-800ms
    }

    try {
      const detail = await dymatrixJobDetailFetch(job.url);
      if (detail.error) {
        // If rate-limited, stop fetching details and return what we have
        if (/429|403/.test(detail.error)) {
          console.log(`[dymatrix] Rate limited at job ${i + 1}/${allJobs.length}, stopping detail fetch`);
          enrichedJobs.push(job);
          for (let j = i + 1; j < allJobs.length; j++) {
            enrichedJobs.push(allJobs[j]);
          }
          break;
        }
        // Non-fatal error — add without enrichment
        enrichedJobs.push(job);
        continue;
      }

      enrichedJobs.push({
        ...job,
        // Prefer listing data for location/commitment, fall back to detail page
        location: job.location || detail.location || undefined,
        commitment: job.commitment || detail.commitment || undefined,
        description: detail.description || undefined,
      });
    } catch (err) {
      console.log(`[dymatrix] Error fetching detail for ${job.url}: ${String(err)}`);
      enrichedJobs.push(job); // Add without enrichment
    }
  }

  console.log(`[dymatrix] Enriched ${enrichedJobs.filter(j => j.description).length}/${enrichedJobs.length} jobs with descriptions`);
  return { jobs: enrichedJobs };
}
