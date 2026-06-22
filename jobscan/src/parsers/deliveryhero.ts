import * as cheerio from 'cheerio';
import { ParsedJob } from '../types';
import { fetchHtml, sleep } from '../fetch-utils';
import { NodeHtmlMarkdown } from 'node-html-markdown';

/**
 * Delivery Hero (Attrax ATS) parser.
 *
 * ── Platform ─────────────────────────────────────────────────────────────────
 *
 * Delivery Hero's careers site runs on the Attrax ATS platform (attraxcdnprod1
 * CDN).  There is no public JSON API — all job data is server-side rendered
 * directly into the HTML of paginated listing pages.
 *
 * ── How it works ─────────────────────────────────────────────────────────────
 *
 * 1. Fetch the source URL (e.g. https://careers.deliveryhero.com/deliveryhero)
 *    to extract:
 *      - `<input class="contextoptions" value="248">` — the brand/company filter ID
 *      - `property="og:site_name" content="Delivery Hero"` — company display name
 *
 * 2. Construct the paginated listing URL:
 *      GET {origin}/jobs?q=&options={contextId}&page={N}
 *
 *    Each page returns ~12 job tiles as HTML.
 *    The first page also carries pagination metadata:
 *      - `.attrax-pagination__total-results` → "64 result(s)"
 *      - `.attrax-pagination__last a[href]` → "javascript:pagination(6)"
 *
 * 3. Fetch all pages (batched with a short inter-page delay) and parse each
 *    job tile from the server-rendered HTML.
 *
 * ── Job tile HTML structure ───────────────────────────────────────────────────
 *
 *   <div class="attrax-vacancy-tile ... attrax-vacancy-tile--hybrid ..."
 *        data-jobid="8646">
 *     <a class="attrax-vacancy-tile__title ..."
 *        href="/job/title-slug-jid-8646">Job Title</a>
 *
 *     <div class="attrax-vacancy-tile__location-freetext ...">
 *       <p class="attrax-vacancy-tile__item-value">Berlin, Germany</p>
 *     </div>
 *
 *     <div class="attrax-vacancy-tile__option-job-category ...">
 *       <p class="attrax-vacancy-tile__item-value">Software Engineering</p>
 *     </div>
 *
 *     <div class="attrax-vacancy-tile__option-job-type ...">
 *       <p class="attrax-vacancy-tile__item-value">Full-time</p>
 *     </div>
 *
 *     <div class="attrax-vacancy-tile__option-remote-working ...">
 *       <p class="attrax-vacancy-tile__item-value">Hybrid</p>
 *     </div>
 *
 *     <div class="attrax-vacancy-tile__description ...">
 *       <p class="attrax-vacancy-tile__description-value">
 *         Short excerpt of the description…
 *       </p>
 *     </div>
 *   </div>
 *
 * ── Job detail page ───────────────────────────────────────────────────────────
 *
 *   URL: {origin}/job/{slug-jid-{ID}}
 *
 *   Full description is rendered inside a DescriptionWidget:
 *     <div data-type="DescriptionWidget" ...>
 *       <div aria-label="Job description">
 *         <p>Full HTML description...</p>
 *       </div>
 *     </div>
 *
 *   Fetched per-job only for new/unseen jobs (via scrapeJobDetail in scraper.ts).
 */

// ── URL / page helpers ────────────────────────────────────────────────────────

function extractOrigin(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * Extract the `contextoptions` brand filter ID from the Attrax careers page HTML.
 * The page always embeds: <input type="hidden" class="contextoptions" value="248">
 *
 * Multiple inputs may appear; we take the first single-number value.
 */
function extractContextId(html: string): string | null {
  const matches = html.match(/class="contextoptions"[^>]*value="([^"]+)"/g) ?? [];
  for (const m of matches) {
    const val = m.match(/value="([^"]+)"/)?.[1];
    if (!val) continue;
    // Accept single IDs ("248") or comma-separated ("248,248,248") — take first
    const first = val.split(',')[0]?.trim();
    if (first && /^\d+$/.test(first)) return first;
  }
  return null;
}

/**
 * Extract total page count from the Attrax pagination widget.
 *
 *   <span class="attrax-pagination__results-of attrax-pagination__results-of--2">
 *     6
 *   </span>
 *
 * Falls back to extracting the number from the "last page" link:
 *   <a href="javascript:pagination(6)" aria-label="Last pagination page">
 */
function extractTotalPages($: cheerio.CheerioAPI): number {
  // Primary: results-of--2 span holds the last page number
  const lastSpan = $('[class*="attrax-pagination__results-of--2"]').first().text().trim();
  const fromSpan = Number(lastSpan);
  if (Number.isInteger(fromSpan) && fromSpan > 0) return fromSpan;

  // Fallback: "Last pagination page" link href="javascript:pagination(N)"
  const lastLink = $('[aria-label="Last pagination page"]').attr('href') ?? '';
  const m = lastLink.match(/pagination\((\d+)\)/);
  if (m) return Number(m[1]);

  // Final fallback: if pagination widget is absent we're on the only page
  return 1;
}

/**
 * Parse all job tiles from a single Attrax listing page HTML.
 */
function parseJobTiles(html: string, origin: string): ParsedJob[] {
  const $ = cheerio.load(html);
  const jobs: ParsedJob[] = [];

  $('.attrax-vacancy-tile[data-jobid]').each((_i, el) => {
    const tile = $(el);

    // Title + URL
    const titleEl = tile.find('.attrax-vacancy-tile__title').first();
    const title = titleEl.text().trim();
    const relHref = titleEl.attr('href') ?? '';
    if (!title || !relHref) return;

    let jobUrl: string;
    try {
      jobUrl = new URL(relHref, origin).toString();
    } catch {
      jobUrl = relHref.startsWith('http') ? relHref : origin + relHref;
    }

    // Location (freetext field — most human-readable)
    const location =
      tile.find('.attrax-vacancy-tile__location-freetext .attrax-vacancy-tile__item-value')
        .first().text().trim() || undefined;

    // Department (Job Category option)
    const department =
      tile.find('.attrax-vacancy-tile__option-job-category .attrax-vacancy-tile__item-value')
        .first().text().trim() || undefined;

    // Commitment (Job Type option: Full-time / Part-time / Contract …)
    const commitment =
      tile.find('.attrax-vacancy-tile__option-job-type .attrax-vacancy-tile__item-value')
        .first().text().trim() || undefined;

    // Workplace type (Remote working option: Hybrid / Remote / On-site …)
    const rawWt =
      tile.find('.attrax-vacancy-tile__option-remote-working .attrax-vacancy-tile__item-value')
        .first().text().trim();
    const workplace_type = normaliseWorkplaceType(rawWt);

    // Short description excerpt already embedded in the listing tile
    const descExcerpt =
      tile.find('.attrax-vacancy-tile__description-value').first().text().trim() || undefined;

    jobs.push({ title, url: jobUrl, location, department, commitment, workplace_type, description: descExcerpt });
  });

  return jobs;
}

// ── Normalisation helpers ─────────────────────────────────────────────────────

function normaliseWorkplaceType(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const lower = raw.toLowerCase().trim();
  if (lower === 'hybrid') return 'Hybrid';
  if (lower.startsWith('remote')) return 'Remote';
  if (lower === 'on-site' || lower === 'onsite' || lower === 'office') return 'On-site';
  return raw.trim() || undefined;
}

// ── Public API functions ──────────────────────────────────────────────────────

/**
 * Fetch all Delivery Hero jobs from the Attrax ATS listing pages.
 *
 * Strategy:
 *   1. Fetch source URL to get the `contextoptions` brand-filter ID.
 *   2. Fetch page 1 of the listing → parse jobs + extract total-page-count.
 *   3. Fetch remaining pages with a short inter-page delay (300 ms).
 *   4. Return all deduplicated jobs (no per-job detail fetches here).
 *
 * Per-job full descriptions are fetched lazily by scrapeJobDetail in scraper.ts.
 */
export async function deliveryheroApiFetch(url: string): Promise<{ jobs: ParsedJob[]; error?: string }> {
  const origin = extractOrigin(url);
  if (!origin) return { jobs: [], error: 'Could not parse Delivery Hero URL' };

  // Step 1: fetch the source page to extract contextoptions brand ID
  const { html: sourceHtml, error: sourceError } = await fetchHtml(url);
  if (sourceError || !sourceHtml) {
    return { jobs: [], error: sourceError ?? 'Failed to fetch Delivery Hero careers page' };
  }

  const contextId = extractContextId(sourceHtml);
  if (!contextId) {
    return { jobs: [], error: 'Could not extract contextoptions from Delivery Hero careers page' };
  }

  // Step 2: fetch first listing page
  const listingBase = `${origin}/jobs?q=&options=${contextId}&page=`;
  const { html: page1Html, error: page1Error } = await fetchHtml(`${listingBase}1`);
  if (page1Error || !page1Html) {
    return { jobs: [], error: page1Error ?? 'Failed to fetch Delivery Hero jobs listing' };
  }

  const $ = cheerio.load(page1Html);
  const totalPages = extractTotalPages($);

  // Collect jobs from page 1
  const allJobs: ParsedJob[] = parseJobTiles(page1Html, origin);

  // Step 3: fetch remaining pages
  for (let page = 2; page <= totalPages; page++) {
    await sleep(300); // brief delay to avoid hammering the server
    const { html: pageHtml, error: pageError } = await fetchHtml(`${listingBase}${page}`);
    if (pageError || !pageHtml) {
      // Partial result — return what we have so far
      console.warn(`[deliveryhero] Page ${page}/${totalPages} failed: ${pageError} — returning partial results`);
      break;
    }
    const pageJobs = parseJobTiles(pageHtml, origin);
    allJobs.push(...pageJobs);
  }

  // Deduplicate by URL (paranoia guard)
  const seen = new Set<string>();
  const deduped = allJobs.filter((j) => {
    if (seen.has(j.url)) return false;
    seen.add(j.url);
    return true;
  });

  return { jobs: deduped };
}

/**
 * Detect the company name from a Delivery Hero careers page.
 *
 * Reads `og:site_name` (most reliable) from the page HTML.
 * Falls back to stripping " | Delivery Hero" from the <title>, or
 * to returning "Delivery Hero" directly.
 */
export async function deliveryheroDetect(url: string): Promise<{ company: string; error?: string }> {
  const { html, error } = await fetchHtml(url);
  if (error || !html) {
    return { company: 'Delivery Hero' }; // safe hard-coded fallback
  }

  // og:site_name is the cleanest source
  const ogSite = html.match(/property='og:site_name'[^>]*content='([^']+)'/)?.[1]?.trim()
    ?? html.match(/property="og:site_name"[^>]*content="([^"]+)"/)?.[1]?.trim();
  if (ogSite) return { company: ogSite };

  // <title> — strip page-specific part, keep "| Company" suffix
  const titleMatch = html.match(/<title>\s*(.*?)\s*<\/title>/i);
  if (titleMatch) {
    const titleText = titleMatch[1].replace(/&amp;/g, '&').replace(/&#39;/g, "'").trim();
    // Pattern: "Page title | Company Name"
    const parts = titleText.split('|');
    if (parts.length >= 2) {
      const company = parts[parts.length - 1].trim();
      if (company) return { company };
    }
  }

  return { company: 'Delivery Hero' };
}

/**
 * Fetch the full job description from a Delivery Hero job detail page.
 *
 * The description lives inside:
 *   <div data-type="DescriptionWidget" ...>
 *     <div aria-label="Job description">
 *       <html description content/>
 *     </div>
 *   </div>
 *
 * Returns the description as Markdown, or an empty string if not found.
 */
export async function deliveryheroJobDetailFetch(url: string): Promise<{ description?: string }> {
  const { html, error } = await fetchHtml(url);
  if (error || !html) return {};

  const $ = cheerio.load(html);

  // Find the DescriptionWidget and extract its aria-labeled description div
  const descWidget = $('[data-type="DescriptionWidget"]').first();
  const descDiv = descWidget.find('[aria-label="Job description"]').first();

  const innerHtml = descDiv.html()?.trim();
  if (!innerHtml) return {};

  const nhm = new NodeHtmlMarkdown({ bulletMarker: '-' });
  const markdown = nhm.translate(innerHtml).trim().slice(0, 20_000);
  return { description: markdown || undefined };
}

/**
 * HTML fallback parser (used by parserRegistry for legacy HTML scrape path).
 *
 * Parses job tiles from a server-side-rendered Attrax listing page HTML.
 * Works for both the homepage excerpt and the full /jobs?... paginated listing.
 */
export function deliveryheroParser(html: string, baseUrl: string): ParsedJob[] {
  let origin: string;
  try {
    origin = new URL(baseUrl).origin;
  } catch {
    origin = 'https://careers.deliveryhero.com';
  }
  return parseJobTiles(html, origin);
}
