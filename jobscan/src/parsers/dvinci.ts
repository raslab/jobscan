import * as cheerio from 'cheerio';
import { ParsedJob } from '../types';
import { fetchHtml, sleep } from '../fetch-utils';
import { NodeHtmlMarkdown } from 'node-html-markdown';

/**
 * d.vinci ATS parser.
 *
 * ── Platform ─────────────────────────────────────────────────────────────────
 *
 * d.vinci is a German ATS by d.vinci HR-Systems GmbH (Hamburg).
 * Multi-tenant, subdomain-based: `{tenantId}.dvinci-hr.com`
 *
 * ── URL patterns ─────────────────────────────────────────────────────────────
 *
 *   https://{tenant}.dvinci-hr.com/en/jobs/iframe   — embeddable job list
 *   https://{tenant}.dvinci-hr.com/en/jobs           — same content as iframe
 *   https://{tenant}.dvinci-hr.com/en/jobs/{id}/{slug} — job detail page
 *
 * ── How it works ─────────────────────────────────────────────────────────────
 *
 * There is no public JSON API for listings. All jobs are server-rendered in a
 * simple HTML `<table>` on the listing page (no pagination — all jobs in one
 * page).
 *
 * Phase 1 — Listing: Fetch `/{lang}/jobs/iframe` and parse the HTML table to
 *   extract (title, relativeUrl) tuples from `<td class="link"> <a>` elements.
 *
 * Phase 2 — Detail enrichment: For each job, fetch the detail page and extract:
 *   - `var DvinciData = { jobPublication: {...} }` — inline JS object with
 *     location, department, categories, working times, contract period, etc.
 *   - JSON-LD `schema.org/JobPosting` — full HTML description.
 *
 * Field mapping from DvinciData.jobPublication.jobOpening:
 *   location    ← .location (comma-separated string)
 *   department  ← .department
 *   commitment  ← .workingTimes[0].name (e.g. "Full-time (40 hours)")
 *   team        ← .orgUnit.name (subsidiary/division)
 *
 * Description from JSON-LD → converted to Markdown.
 *
 * ── Detection signals ─────────────────────────────────────────────────────────
 *
 * URL:  *.dvinci-hr.com
 * Meta: <meta name="dvinciVersion"> or <meta name="tenantId"> on detail pages
 * DOM:  `ng-app="dvinci.apps.Dvinci"` on detail pages
 * CDN:  static.dvinci-easy.com references
 */

// ── Types for DvinciData extraction ───────────────────────────────────────────

interface DvinciJobOpening {
  location?: string;
  department?: string;
  workingTimes?: Array<{ name?: string; internalName?: string }>;
  contractPeriod?: { name?: string; internalName?: string };
  orgUnit?: { name?: string };
  company?: { name?: string };
  categories?: Array<{ name?: string; internalName?: string }>;
  targetGroups?: Array<{ name?: string }>;
  locations?: Array<{
    name?: string;
    country?: { name?: string; isoA2?: string };
    address?: { city?: string; zipCode?: string };
  }>;
}

interface DvinciJobPublication {
  id?: number;
  position?: string;
  jobPublicationURL?: string;
  jobOpening?: DvinciJobOpening;
}

// ── URL helpers ───────────────────────────────────────────────────────────────

/**
 * Extract the tenant ID from a dvinci-hr.com URL.
 *
 * `https://cenit.dvinci-hr.com/en/jobs/iframe` → `cenit`
 */
export function extractTenantId(url: string): string | null {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    const m = hostname.match(/^([a-z0-9-]+)\.dvinci-hr\.com$/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

/**
 * Build the listing URL for a dvinci tenant.
 * Prefers English if available; falls back to the base /en/jobs path.
 */
function buildListingUrl(baseOrigin: string): string {
  return `${baseOrigin}/en/jobs/iframe`;
}

// ── DvinciData extraction ─────────────────────────────────────────────────────

/**
 * Extract the DvinciData.jobPublication object from a job detail page HTML.
 *
 * The detail page contains:
 *   `var DvinciData = { jobPublication: { ... } }`
 * inside an inline `<script>` tag.
 */
export function extractDvinciData(html: string): DvinciJobPublication | null {
  // Match the DvinciData assignment — it contains a JSON object for jobPublication
  const marker = 'DvinciData = { jobPublication:';
  const idx = html.indexOf(marker);
  if (idx === -1) return null;

  const jsonStart = idx + 'DvinciData = { jobPublication:'.length;
  // Find the closing `}` of the outer object — look for `} }` or `}}`
  // The structure is: { jobPublication: { ... } }
  // We need to find the JSON for the jobPublication value.
  // Strategy: find the first `{` after the marker, then find its matching `}`
  const firstBrace = html.indexOf('{', jsonStart);
  if (firstBrace === -1) return null;

  let depth = 0;
  let endBrace = -1;
  for (let i = firstBrace; i < html.length && i < firstBrace + 50000; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') {
      depth--;
      if (depth === 0) {
        endBrace = i;
        break;
      }
    }
  }

  if (endBrace === -1) return null;

  const jsonStr = html.substring(firstBrace, endBrace + 1);
  try {
    return JSON.parse(jsonStr) as DvinciJobPublication;
  } catch {
    return null;
  }
}

/**
 * Extract the job description from JSON-LD (schema.org/JobPosting) on a detail page.
 * Returns the raw HTML description or null.
 */
export function extractJsonLdDescription(html: string): string | null {
  const $ = cheerio.load(html);
  let description: string | null = null;

  $('script[type="application/ld+json"]').each((_i, el) => {
    if (description) return;
    try {
      const ld = JSON.parse($(el).html() ?? '');
      if (ld['@type'] === 'JobPosting' && ld.description) {
        description = ld.description;
      }
    } catch { /* ignore parse errors */ }
  });

  return description;
}

// ── Normalisation helpers ─────────────────────────────────────────────────────

/**
 * Normalise commitment strings from d.vinci workingTimes.
 * "Full-time (40 hours)" → "Full-time"
 * "Part-time (20 hours)" → "Part-time"
 */
function normaliseCommitment(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  // Strip parenthetical hours info
  const cleaned = trimmed.replace(/\s*\([\d\s]+hours?\)/i, '').trim();
  return cleaned || undefined;
}

// ── HTML parser (listing page) ────────────────────────────────────────────────

/**
 * Parse job title + URL from a dvinci listing page HTML.
 *
 * The listing page (`/en/jobs/iframe`) contains a simple HTML table:
 *   <table class="table table-striped table-hover">
 *     <tbody>
 *       <tr>
 *         <td class="link">
 *           <a href="/en/jobs/{id}/{slug}" target="_blank">Job Title</a>
 *         </td>
 *       </tr>
 *     </tbody>
 *   </table>
 */
export function dvinciParser(html: string, baseUrl: string): ParsedJob[] {
  if (!html) return [];

  const $ = cheerio.load(html);
  const jobs: ParsedJob[] = [];

  let origin: string;
  try {
    origin = new URL(baseUrl).origin;
  } catch {
    origin = baseUrl.replace(/\/+$/, '');
  }

  $('td.link a[href]').each((_i, el) => {
    const $a = $(el);
    const title = $a.text().trim();
    const href = $a.attr('href') ?? '';
    if (!title || !href) return;

    let jobUrl: string;
    try {
      jobUrl = new URL(href, origin).toString();
    } catch {
      jobUrl = href.startsWith('http') ? href : origin + href;
    }

    jobs.push({ title, url: jobUrl });
  });

  return jobs;
}

// ── Detail page enrichment ────────────────────────────────────────────────────

/**
 * Fetch a single d.vinci job detail page and extract rich metadata from
 * DvinciData + JSON-LD.
 *
 * Returns updated ParsedJob fields (merges with listing data).
 */
export async function dvinciJobDetailFetch(
  jobUrl: string,
): Promise<{
  location?: string;
  department?: string;
  commitment?: string;
  team?: string;
  description?: string;
  error?: string;
}> {
  const { html, error } = await fetchHtml(jobUrl);
  if (error || !html) {
    return { error: error || 'Empty response from detail page' };
  }

  return dvinciParseDetailHtml(html);
}

/**
 * Parse rich metadata from a d.vinci job detail page HTML (without fetching).
 * Used for both live fetching and fixture-based testing.
 */
export function dvinciParseDetailHtml(html: string): {
  location?: string;
  department?: string;
  commitment?: string;
  team?: string;
  description?: string;
} {
  const result: {
    location?: string;
    department?: string;
    commitment?: string;
    team?: string;
    description?: string;
  } = {};

  // Extract DvinciData
  const dvData = extractDvinciData(html);
  if (dvData?.jobOpening) {
    const opening = dvData.jobOpening;

    if (opening.location) {
      result.location = opening.location;
    }

    if (opening.department) {
      result.department = opening.department;
    }

    if (opening.workingTimes && opening.workingTimes.length > 0) {
      result.commitment = normaliseCommitment(opening.workingTimes[0].name);
    }

    if (opening.orgUnit?.name) {
      result.team = opening.orgUnit.name;
    }
  }

  // Extract description from JSON-LD
  const descHtml = extractJsonLdDescription(html);
  if (descHtml) {
    try {
      result.description = NodeHtmlMarkdown.translate(descHtml);
    } catch {
      result.description = descHtml;
    }
  }

  return result;
}

// ── API fetch (primary entry point) ──────────────────────────────────────────

/**
 * Fetch all jobs from a d.vinci tenant, enriching each with detail page data.
 *
 * Strategy:
 *   1. Fetch the listing page to get all (title, url) pairs.
 *   2. For each job, fetch the detail page to extract location, department,
 *      commitment, team, and description from DvinciData + JSON-LD.
 *   3. Apply reasonable throttling (500–1000ms between detail fetches) to
 *      avoid rate-limiting by the d.vinci server (openresty/nginx).
 *
 * @param url - The source URL (e.g. https://cenit.dvinci-hr.com/en/jobs/iframe)
 */
export async function dvinciApiFetch(
  url: string,
): Promise<{ jobs: ParsedJob[]; error?: string }> {
  const tenantId = extractTenantId(url);
  if (!tenantId) {
    return { jobs: [], error: `Could not extract d.vinci tenant ID from URL: ${url}` };
  }

  const origin = new URL(url).origin;
  const listingUrl = buildListingUrl(origin);
  console.log(`[dvinci] Fetching listing from ${listingUrl}`);

  const { html: listingHtml, error: listingError } = await fetchHtml(listingUrl);
  if (listingError || !listingHtml) {
    return { jobs: [], error: listingError || 'Empty response from listing page' };
  }

  const listingJobs = dvinciParser(listingHtml, url);
  if (listingJobs.length === 0) {
    return { jobs: [], error: undefined }; // Zero jobs is valid
  }

  console.log(`[dvinci] Found ${listingJobs.length} jobs in listing, fetching details...`);

  // Enrich each job with detail page data
  const enrichedJobs: ParsedJob[] = [];
  for (let i = 0; i < listingJobs.length; i++) {
    const job = listingJobs[i];

    // Throttle between detail fetches (skip for first request)
    if (i > 0) {
      await sleep(500 + Math.random() * 500); // 500–1000ms
    }

    try {
      const detail = await dvinciJobDetailFetch(job.url);
      if (detail.error) {
        // If rate-limited, stop fetching details and return what we have
        if (/429|403/.test(detail.error)) {
          console.log(`[dvinci] Rate limited at job ${i + 1}/${listingJobs.length}, stopping detail fetch`);
          enrichedJobs.push(job); // Add remaining jobs without enrichment
          for (let j = i + 1; j < listingJobs.length; j++) {
            enrichedJobs.push(listingJobs[j]);
          }
          break;
        }
        // Non-fatal error — just add the job without enrichment
        enrichedJobs.push(job);
        continue;
      }

      enrichedJobs.push({
        ...job,
        location: detail.location || undefined,
        department: detail.department || undefined,
        commitment: detail.commitment || undefined,
        team: detail.team || undefined,
        description: detail.description || undefined,
      });
    } catch (err) {
      console.log(`[dvinci] Error fetching detail for ${job.url}: ${String(err)}`);
      enrichedJobs.push(job); // Add without enrichment
    }
  }

  console.log(`[dvinci] Enriched ${enrichedJobs.filter(j => j.location).length}/${enrichedJobs.length} jobs with details`);
  return { jobs: enrichedJobs };
}
