import * as cheerio from 'cheerio';
import { ParsedJob } from '../types';
import { fetchHtml } from '../fetch-utils';
import { NodeHtmlMarkdown } from 'node-html-markdown';

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Extract the iCIMS base origin from a careers URL.
 *
 * Supported patterns:
 *   https://careers-here.icims.com
 *   https://careers-here.icims.com/jobs/
 *   https://careers-here.icims.com/jobs/12345/some-title/job
 *
 * Returns e.g. "https://careers-here.icims.com"
 */
function extractIcimsOrigin(url: string): string | null {
  try {
    const u = new URL(url);
    if (!u.hostname.endsWith('.icims.com')) return null;
    return u.origin;
  } catch {
    return null;
  }
}

/**
 * Parse a single iCIMS search listing page (the inner iframe HTML) into ParsedJob objects.
 *
 * iCIMS renders each job as a Bootstrap row inside `.container-fluid.iCIMS_JobsTable`:
 *
 *   <div class="col-xs-6 header left">
 *     <span class="sr-only field-label">Job Locations</span>
 *     <span>IN-MH-Mumbai</span>        ← location
 *   </div>
 *   <div class="col-xs-12 title">
 *     <a href="…/jobs/{id}/{slug}/job?in_iframe=1" class="iCIMS_Anchor" title="{id} - {title}">
 *       <h3>{title}</h3>
 *     </a>
 *   </div>
 *   <div class="col-xs-12 additionalFields">
 *     <dl>
 *       <dt class="iCIMS_JobHeaderField">Category</dt>
 *       <dd class="iCIMS_JobHeaderData"><span>Engineering</span></dd>
 *       <dt class="iCIMS_JobHeaderField">Remote</dt>
 *       <dd class="iCIMS_JobHeaderData"><span>Yes</span></dd>
 *     </dl>
 *   </div>
 */
function parseIcimsListingHtml(html: string, baseOrigin: string): ParsedJob[] {
  const $ = cheerio.load(html);
  const jobs: ParsedJob[] = [];

  // Each job card sits in a <div class="row"> inside iCIMS_JobsTable
  $('.container-fluid.iCIMS_JobsTable .row').each((_i, row) => {
    const $row = $(row);

    // ── Title + URL ────────────────────────────────────────────────────────
    const $anchor = $row.find('a.iCIMS_Anchor').first();
    if (!$anchor.length) return;

    // The title attribute is "{id} - {title}" — strip the req-id prefix
    const titleAttr = $anchor.attr('title') ?? '';
    const titleFromAttr = titleAttr.replace(/^\d+\s*-\s*/, '').trim();
    // Also try the <h3> text inside the anchor
    const titleFromH3 = $anchor.find('h3').text().trim();
    const title = titleFromH3 || titleFromAttr;
    if (!title) return;

    // Raw href contains "?in_iframe=1" — store the canonical job URL without it
    const rawHref = $anchor.attr('href') ?? '';
    const url = rawHref
      .replace(/[?&]in_iframe=1/, '')  // remove in_iframe param
      .replace(/[?&]$/, '')            // clean trailing ? or &
      .trim();
    if (!url) return;

    // ── Location ───────────────────────────────────────────────────────────
    // The header-left span (after the sr-only label span) holds the location text.
    const $headerLeft = $row.find('.header.left');
    // Skip the sr-only span, grab the visible text
    $headerLeft.find('.sr-only').remove();
    const locationRaw = $headerLeft.text().trim();
    const location: string | undefined = locationRaw || undefined;

    // ── Category / Department + Remote / Workplace type ────────────────────
    let department: string | undefined;
    let workplace_type: string | undefined;

    $row.find('div.iCIMS_JobHeaderTag').each((_j, tag) => {
      const $tag = $(tag);
      const fieldName = $tag.find('dt.iCIMS_JobHeaderField').text().trim().toLowerCase();
      const fieldValue = $tag.find('dd.iCIMS_JobHeaderData span').text().trim();
      if (!fieldValue) return;

      if (fieldName === 'category') {
        department = fieldValue;
      } else if (fieldName === 'remote') {
        // "Yes" → "Remote", "No" → "On-site", anything else kept as-is
        const lower = fieldValue.toLowerCase();
        if (lower === 'yes') {
          workplace_type = 'Remote';
        } else if (lower === 'no') {
          workplace_type = 'On-site';
        } else {
          workplace_type = fieldValue;
        }
      }
    });

    jobs.push({ title, url: `${baseOrigin}${new URL(url).pathname}`, location, department, workplace_type });
  });

  return jobs;
}

/**
 * Extract total page count from the iCIMS listing HTML.
 *
 * The pagination renders each page button as:
 *   <span class="sr-only">Page</span>
 *   3
 *   <span class="sr-only">of 3</span>
 *
 * We simply find all occurrences of "of N" and take the maximum integer found.
 * On the last page, the next-page anchor becomes `class="invisible"` and there is
 * no `rel="next"` link.
 */
function extractTotalPages(html: string): number {
  const matches = [...html.matchAll(/of\s+(\d+)/g)];
  if (matches.length === 0) return 1;
  return Math.max(...matches.map((m) => parseInt(m[1], 10)));
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Fetch ALL jobs from an iCIMS career site.
 *
 * iCIMS uses an AngularJS SPA that embeds a server-side rendered iframe at
 * `/jobs/search?in_iframe=1`.  The iframe returns real HTML (no JS execution
 * needed) and supports 0-indexed page pagination via the `pr=N` query parameter
 * (20 jobs per page, consistent across installations).
 *
 * Strategy:
 *   1. Fetch page 0 (`pr=0`) to get the total page count ("of N" in pagination).
 *   2. Fetch all remaining pages (`pr=1 … pr=N-1`) concurrently (2 at a time).
 *   3. Parse each page with parseIcimsListingHtml.
 *
 * No per-job fetching is done here — descriptions are obtained in scrapeJobDetail.
 */
export async function icimsApiFetch(url: string): Promise<{ jobs: ParsedJob[]; error?: string }> {
  const origin = extractIcimsOrigin(url);
  if (!origin) return { jobs: [], error: 'Could not extract iCIMS origin from URL' };

  const searchBase = `${origin}/jobs/search?in_iframe=1`;

  // ── Page 0 ────────────────────────────────────────────────────────────────
  const { html: html0, error: err0 } = await fetchHtml(`${searchBase}&pr=0`);
  if (err0 || !html0) return { jobs: [], error: err0 ?? 'Empty response from iCIMS listing page' };

  const page0Jobs = parseIcimsListingHtml(html0, origin);
  if (page0Jobs.length === 0) return { jobs: [] }; // genuinely empty board

  const totalPages = extractTotalPages(html0);

  if (totalPages <= 1) {
    return { jobs: page0Jobs };
  }

  // ── Pages 1 … totalPages-1 ────────────────────────────────────────────────
  const allJobs: ParsedJob[] = [...page0Jobs];
  const pageNumbers = Array.from({ length: totalPages - 1 }, (_, i) => i + 1);

  // Fetch 2 pages concurrently to avoid hammering the server
  const CONCURRENCY = 2;
  for (let i = 0; i < pageNumbers.length; i += CONCURRENCY) {
    const batch = pageNumbers.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map((pr) => fetchHtml(`${searchBase}&pr=${pr}`))
    );
    for (const { html, error } of results) {
      if (error || !html) continue; // skip failed pages, keep partial result
      const pageJobs = parseIcimsListingHtml(html, origin);
      if (pageJobs.length === 0) break; // past the last page
      allJobs.push(...pageJobs);
    }
  }

  return { jobs: allJobs };
}

/**
 * Detect the company name from an iCIMS career site.
 *
 * Two sources tried in order:
 *   1. The main (non-iframe) page embeds `window.angularAppConfig` JSON which
 *      contains `client.displayName` — the canonical company name.
 *   2. The iframe listing page title: "Job Listings at {Company Name}"
 *   3. Fallback: prettify the subdomain (e.g. "careers-here" → "Here").
 */
export async function icimsApiDetect(url: string): Promise<{ company: string; error?: string }> {
  const origin = extractIcimsOrigin(url);
  if (!origin) return { company: '', error: 'Not an iCIMS URL' };

  // Try the main page first — it has the richest config
  const { html: mainHtml } = await fetchHtml(`${origin}/jobs/search`);
  if (mainHtml) {
    const displayNameMatch = mainHtml.match(/"displayName":"([^"]+)"/);
    if (displayNameMatch) {
      return { company: displayNameMatch[1].trim() };
    }
  }

  // Fallback: fetch the iframe page and look for "Job Listings at {Company}"
  const { html: iframeHtml } = await fetchHtml(`${origin}/jobs/search?in_iframe=1`);
  if (iframeHtml) {
    const listingsMatch = iframeHtml.match(/Job Listings at ([^<]+)</);
    if (listingsMatch) {
      return { company: listingsMatch[1].trim() };
    }
  }

  // Last resort: prettify the subdomain
  try {
    const subdomain = new URL(origin).hostname.replace(/\.icims\.com$/, '');
    // Remove leading prefix like "careers-", "jobs-", "app-"
    const slug = subdomain.replace(/^(careers|jobs|app|careers2|talent)-/i, '');
    const company = slug.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    return { company };
  } catch {
    return { company: '', error: 'Could not detect company name' };
  }
}

/**
 * Fallback HTML parser for iCIMS listing pages.
 *
 * Used when the API fetch fails or returns 0 jobs.  Accepts the raw HTML of
 * `/jobs/search` (the outer Angular app page, which may embed job data as a
 * noscript iframe fallback) or the iframe HTML itself.
 */
export function icimsParser(html: string, baseUrl: string): ParsedJob[] {
  let origin: string;
  try {
    origin = new URL(baseUrl).origin;
  } catch {
    origin = '';
  }
  return parseIcimsListingHtml(html, origin);
}

/**
 * Fetch the full job description from a single iCIMS job detail page.
 *
 * The canonical job URL is:  https://{site}.icims.com/jobs/{id}/{slug}/job
 * The iframe version is:     https://{site}.icims.com/jobs/{id}/{slug}/job?in_iframe=1
 *
 * We fetch the iframe variant (no JS execution needed) and extract:
 *   - Full description from `.iCIMS_Expandable_Text` (Markdown-converted)
 *   - Category / department from `dt.iCIMS_JobHeaderField:contains('Category')`
 *   - Remote field for workplace_type
 *
 * Returns only the fields it could extract; callers should merge with the
 * existing ParsedJob rather than replacing it wholesale.
 */
export async function icimsJobDetailFetch(
  jobUrl: string,
): Promise<{ description?: string; department?: string; workplace_type?: string; error?: string }> {
  // Append ?in_iframe=1 so we get static HTML instead of the AngularJS SPA
  const iframeUrl = `${jobUrl}?in_iframe=1`;

  const { html, error } = await fetchHtml(iframeUrl);
  if (error || !html) return { error: error ?? 'Empty response from iCIMS job detail page' };

  const $ = cheerio.load(html);

  // ── Full description ───────────────────────────────────────────────────────
  // The expandable text div holds the full formatted description HTML.
  const $descEl = $('.iCIMS_Expandable_Text').first();
  let description: string | undefined;
  if ($descEl.length) {
    const descHtml = $descEl.html() ?? '';
    const nhm = new NodeHtmlMarkdown({ bulletMarker: '-' });
    description = nhm.translate(descHtml).trim().slice(0, 20_000) || undefined;
  }

  // ── Department / Category ──────────────────────────────────────────────────
  let department: string | undefined;
  let workplace_type: string | undefined;

  $('div.iCIMS_JobHeaderTag').each((_i, tag) => {
    const $tag = $(tag);
    const fieldName = $tag.find('dt.iCIMS_JobHeaderField').text().trim().toLowerCase();
    const fieldValue = $tag.find('dd.iCIMS_JobHeaderData span').text().trim();
    if (!fieldValue) return;

    if (fieldName === 'category') {
      department = fieldValue;
    } else if (fieldName === 'remote') {
      const lower = fieldValue.toLowerCase();
      if (lower === 'yes') {
        workplace_type = 'Remote';
      } else if (lower === 'no') {
        workplace_type = 'On-site';
      } else {
        workplace_type = fieldValue;
      }
    }
  });

  return { description, department, workplace_type };
}
