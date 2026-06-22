import * as cheerio from 'cheerio';
import { ParsedJob } from '../types';
import { fetchHtml, sleep } from '../fetch-utils';

/**
 * Rohde & Schwarz careers parser.
 *
 * ── Platform ─────────────────────────────────────────────────────────────────
 *
 * Custom job board built on FirstSpirit CMS (e-Spirit / Crownpeak) with a
 * Backbone.js frontend.  The careers page is hosted directly on
 * rohde-schwarz.com.
 *
 * ── URL patterns ─────────────────────────────────────────────────────────────
 *
 *   German:  https://www.rohde-schwarz.com/de/karriere/stellenangebote/karriere-stellenangebote_251573.html
 *   English: (not used — English page returns 0 jobs; German page has all)
 *
 * ── How it works ─────────────────────────────────────────────────────────────
 *
 * There is no public JSON API.  Jobs are server-rendered in paginated HTML
 * pages.  The frontend uses infinite scroll via XHR GET requests with an
 * `offset` query parameter (30 jobs per page).
 *
 * Phase 1 — Fetch and parse each page:
 *   GET karriere-stellenangebote_251573.html?offset=0   → jobs 1-30
 *   GET karriere-stellenangebote_251573.html?offset=30  → jobs 31-60
 *   ... until a page returns 0 jobs.
 *
 * Each job entry is an `.module-accordion` div with this structure:
 *
 *   .accordion-table-list-item.column-2 → title + URL
 *     a.accordion-table-list-item-title-link[href] → job detail URL (relative)
 *
 *   .accordion-table-list-item.column-3 → department (Functional area)
 *   .accordion-table-list-item.column-4 → commitment (Entry level / seniority)
 *   .accordion-table-list-item.column-5 → location (country)
 *   .accordion-table-list-item.column-6 → city/region
 *
 * ── Field mapping ─────────────────────────────────────────────────────────────
 *
 *   title       ← column-2 title link text
 *   url         ← column-2 <a href> (resolved to absolute)
 *   department  ← column-3 info text (Functional area)
 *   commitment  ← column-4 info text (Entry level)
 *   location    ← column-5 + column-6 combined (Country, City)
 *
 * Detection signals:
 *   - URL pattern: rohde-schwarz.com with karriere/stellenangebote path
 *   - DOM: data-view="jobboard-table" and data-view="jobboard-filter"
 *   - Content: firstspirit CMS markers (DYO.smartObject, espirit)
 */

const BASE_URL = 'https://www.rohde-schwarz.com';
const CAREERS_PATH = '/de/karriere/stellenangebote/karriere-stellenangebote_251573.html';
const ITEMS_PER_PAGE = 30;

// ── URL helpers ───────────────────────────────────────────────────────────────

/**
 * Return true if the URL belongs to the Rohde & Schwarz careers page.
 */
export function isRohdeSchwarzUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    if (host === 'www.rohde-schwarz.com' || host === 'rohde-schwarz.com') {
      return /karriere\/stellenangebote|career\/job-offers/i.test(u.pathname);
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Build the listing URL for a given offset.
 */
function buildListingUrl(offset: number): string {
  return `${BASE_URL}${CAREERS_PATH}?offset=${offset}`;
}

// ── HTML parsing ──────────────────────────────────────────────────────────────

/**
 * Parse jobs from a single page of R&S career page HTML.
 *
 * Each job is an `.module-accordion` div containing columns with metadata.
 * This function can be used standalone for unit testing with cached HTML.
 */
export function rohdeschwarzParser(html: string, baseUrl: string): ParsedJob[] {
  const $ = cheerio.load(html);
  const jobs: ParsedJob[] = [];

  $('.module-accordion').each((_i, accordion) => {
    const $acc = $(accordion);

    // Column 2: title + URL
    const $titleLink = $acc.find('.accordion-table-list-item.column-2 a.accordion-table-list-item-title-link');
    const title = $titleLink.text().trim();
    const relUrl = $titleLink.attr('href');

    if (!title || !relUrl) return; // skip entries without title/URL

    // Resolve relative URL to absolute
    let url: string;
    try {
      url = new URL(relUrl, baseUrl).toString();
    } catch {
      url = relUrl.startsWith('/') ? `${BASE_URL}${relUrl}` : relUrl;
    }

    // Column 3: department (Functional area)
    const department = $acc.find('.accordion-table-list-item.column-3 .accordion-table-list-item-info')
      .text().trim() || undefined;

    // Column 4: commitment (Entry level / seniority)
    const commitment = $acc.find('.accordion-table-list-item.column-4 .accordion-table-list-item-info')
      .text().trim() || undefined;

    // Column 5: location (country)
    const country = $acc.find('.accordion-table-list-item.column-5 .accordion-table-list-item-info')
      .text().trim();

    // Column 6: city/region
    const city = $acc.find('.accordion-table-list-item.column-6 .accordion-table-list-item-info')
      .text().trim();

    // Combine country + city into a single location string
    const location = [city, country].filter(Boolean).join(', ') || undefined;

    jobs.push({ title, url, department, commitment, location });
  });

  return jobs;
}

/**
 * Extract the total job count from the counter element in the page.
 * Returns 0 if not found.
 */
export function extractTotalCount(html: string): number {
  const $ = cheerio.load(html);
  const counterText = $('.module-counter-big .counter').text().trim();
  const count = parseInt(counterText, 10);
  return isNaN(count) ? 0 : count;
}

// ── API-style fetch (paginated HTML scraping) ─────────────────────────────────

/**
 * Fetch all Rohde & Schwarz job listings by paginating through HTML pages.
 *
 * Since there's no JSON API, this fetches the career page with increasing
 * `offset` values (30 jobs per page) until an empty page is returned.
 *
 * Throttling: 500-1000ms delay between page fetches to be polite.
 *
 * @param url - The R&S careers page URL (used for validation)
 */
export async function rohdeschwarzApiFetch(url: string): Promise<{ jobs: ParsedJob[]; error?: string }> {
  const allJobs: ParsedJob[] = [];
  let offset = 0;
  let totalExpected = 0;
  const maxPages = 30; // Safety limit: 30 pages × 30 jobs = 900 max

  for (let page = 0; page < maxPages; page++) {
    const pageUrl = buildListingUrl(offset);

    const { html, error } = await fetchHtml(pageUrl);
    if (error) {
      // If we already have some jobs, return what we have with a warning
      if (allJobs.length > 0) {
        console.warn(`[rohdeschwarz] Stopping at offset ${offset} due to error: ${error}`);
        break;
      }
      return { jobs: [], error: `Failed to fetch R&S page at offset ${offset}: ${error}` };
    }

    // On first page, extract total count
    if (page === 0) {
      totalExpected = extractTotalCount(html);
      if (totalExpected === 0) {
        return { jobs: [], error: 'R&S career page returned 0 total jobs' };
      }
    }

    const pageJobs = rohdeschwarzParser(html, pageUrl);
    if (pageJobs.length === 0) {
      break; // No more jobs — we've reached the end
    }

    allJobs.push(...pageJobs);

    // If we've fetched all expected jobs, stop
    if (allJobs.length >= totalExpected) {
      break;
    }

    // Less than a full page means this was the last page
    if (pageJobs.length < ITEMS_PER_PAGE) {
      break;
    }

    offset += ITEMS_PER_PAGE;

    // Throttle between page fetches (500-1000ms)
    await sleep(500 + Math.random() * 500);
  }

  return { jobs: allJobs };
}
