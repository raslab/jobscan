import { ParsedJob } from '../types';
import { fetchHtml, fetchJson, sleep } from '../fetch-utils';

/**
 * Eightfold AI ATS parser.
 *
 * URL pattern: https://{company}.eightfold.ai/careers
 *              (or custom domains that serve the same Eightfold platform)
 *
 * ── Platform variants ────────────────────────────────────────────────────
 *
 * Eightfold has two distinct platform modes:
 *
 * Standard mode (e.g. Bayer):
 *   HTML contains only: window._EF_GROUP_ID = "bayer.com";
 *   API: GET /api/apply/v2/jobs?domain={group_id}&num_jobs=10&start={offset}&query=
 *
 * PCS/PCSX mode (e.g. Qualcomm, Micron, NGC):
 *   HTML contains: window._EF_GROUP_ID = "qualcomm.com";
 *                  window._EF_PRODUCT = "PCS";
 *   The standard API returns HTTP 403 "Not authorized for PCSX" for these sites.
 *   API: GET /api/pcsx/search?domain={group_id}&num_jobs=10&start={offset}&query=
 *
 * ── How it works ──────────────────────────────────────────────────────────
 *
 * 1. Fetch the careers HTML page to extract `window._EF_GROUP_ID` and detect
 *    PCS mode via `window._EF_PRODUCT = "PCS"`.
 * 2. Paginate the appropriate API endpoint until all jobs are collected.
 *
 * Standard API response shape:
 *   {
 *     count: 603,
 *     positions: [
 *       {
 *         id:                   562949976272963,
 *         name:                 "Software Engineer",
 *         posting_name:         "Software Engineer",
 *         location:             "Berlin,BE,Germany",
 *         locations:            ["Berlin,BE,Germany"],
 *         department:           "Engineering",
 *         business_unit:        "Technology",
 *         work_location_option: "onsite" | "remote_local" | "remote_global" | "hybrid" | null,
 *         job_description:      "Plain text job description...",
 *         canonicalPositionUrl: "https://talent.bayer.com/careers/job/562949976272963",
 *         isPrivate:            false,
 *       }, ...
 *     ],
 *     branding: { navBar: { title: "Bayer" }, page_title: "Careers at Bayer" },
 *   }
 *
 * PCSX API response shape:
 *   {
 *     status: 200,
 *     data: {
 *       count: 1929,
 *       positions: [
 *         {
 *           id:               446717308937,
 *           name:             "Staff Engineer",
 *           locations:        ["Hyderabad, Telangana, India"],
 *           department:       "Hardware Systems Engineering",
 *           workLocationOption: "onsite" | "hybrid" | "remote" | null,
 *           positionUrl:      "/careers/job/446717308937",  // relative URL
 *         }, ...
 *       ],
 *     },
 *   }
 *   Note: PCSX positions have no `job_description` or `business_unit` fields.
 *
 * Pagination: Both APIs return ≤10 items per page; paginate via `start`.
 *
 * Job URLs: Constructed as {origin}/careers/job/{id} for both modes.
 */

// ── URL helpers ───────────────────────────────────────────────────────────────

interface EightfoldInfo {
  /** Base URL origin, e.g. https://bayer.eightfold.ai */
  origin: string;
  /** Subdomain / company slug, e.g. "bayer" */
  slug: string;
}

function extractEightfoldInfo(url: string): EightfoldInfo | null {
  try {
    const u = new URL(url);
    // Match *.eightfold.ai or any hostname (custom domains like talent.bayer.com)
    const slug = u.hostname.split('.')[0];
    if (!slug) return null;
    return { origin: u.origin, slug };
  } catch {
    return null;
  }
}

/**
 * Extract the Eightfold group_id/domain from the careers page HTML.
 * The HTML always contains: window._EF_GROUP_ID = "bayer.com";
 */
function extractGroupId(html: string): string | null {
  const legacyMatch = html.match(/window\._EF_GROUP_ID\s*=\s*["']([^"']+)["']/);
  if (legacyMatch) return legacyMatch[1];

  // Newer Eightfold boards inline bootstrap JSON instead of window._EF_* globals.
  // That payload still exposes the tenant domain used by the jobs API.
  const inlineJsonMatch = html.match(/"domain"\s*:\s*"([^"]+)"/);
  return inlineJsonMatch ? inlineJsonMatch[1] : null;
}

/**
 * Detect whether the page is running in PCS/PCSX mode.
 * PCS sites contain: window._EF_PRODUCT = "PCS";
 * They use /api/pcsx/search instead of /api/apply/v2/jobs.
 */
function isPcsMode(html: string): boolean {
  return (
    /window\._EF_PRODUCT\s*=\s*["']PCS["']/i.test(html) ||
    /"product"\s*:\s*"PCS"/i.test(html) ||
    /"configPath"\s*:\s*"PCS(?:>pcsx>)?"/i.test(html)
  );
}

function extractCompanyNameFromHtml(html: string): string | null {
  const companyNameMatch = html.match(/"company_name"\s*:\s*"([^"]+)"/);
  if (companyNameMatch?.[1]?.trim()) return companyNameMatch[1].trim();

  const ogTitleMatch = html.match(
    /<meta\s+(?:property|name)=["']og:title["'][^>]*content=["']([^"']+)["']/i,
  );
  if (ogTitleMatch?.[1]?.trim()) {
    const title = ogTitleMatch[1]
      .replace(/^careers\s+at\s+/i, '')
      .replace(/\s+careers?\s*$/i, '')
      .trim();
    if (title) return title;
  }

  return null;
}

// ── Workplace type normalisation ──────────────────────────────────────────────

/**
 * Normalise Eightfold's `work_location_option` field to a standard string.
 *
 * Observed values:
 *   "onsite"        → "On-site"
 *   "hybrid"        → "Hybrid"
 *   "remote_local"  → "Remote"
 *   "remote_global" → "Remote"
 *   null / ""       → undefined
 */
function formatWorkplaceType(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  const lower = raw.trim().toLowerCase();
  if (lower === 'onsite') return 'On-site';
  if (lower === 'hybrid') return 'Hybrid';
  if (lower.startsWith('remote')) return 'Remote';
  // Return capitalised as-is for unknown values (future-proofing)
  return raw.trim() || undefined;
}

// ── Location formatting ───────────────────────────────────────────────────────

/**
 * Format an Eightfold location string.
 * The API returns "City,State/Region,Country" (comma-separated, no spaces).
 * We convert to "City, Country" for readability.
 *
 * Examples:
 *   "Berlin,BE,Germany"             → "Berlin, Germany"
 *   "Residence Based,Residence Based,United States" → "Residence Based, United States"
 *   "Remote"                        → "Remote"
 */
function formatLocation(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  const parts = raw.split(',').map(p => p.trim()).filter(Boolean);
  if (parts.length === 0) return undefined;
  if (parts.length === 1) return parts[0];
  // city, [state/region,] country → keep city + country
  const city = parts[0];
  const country = parts[parts.length - 1];
  if (city.toLowerCase() === country.toLowerCase()) return city;
  return `${city}, ${country}`;
}

// ── Public API functions ──────────────────────────────────────────────────────

/**
 * Fetch all jobs from an Eightfold AI career page via the internal JSON API.
 *
 * Strategy:
 *   1. Fetch the careers HTML page to extract `window._EF_GROUP_ID`.
 *   2. Paginate GET /api/apply/v2/jobs?domain={group_id}&num_jobs=10&start={offset}&query=
 *      until all jobs are collected.
 *
 * Descriptions are included in each API response as plain text (`job_description`).
 * No per-job detail fetches required.
 */
export async function eightfoldApiFetch(url: string): Promise<{ jobs: ParsedJob[]; error?: string }> {
  const info = extractEightfoldInfo(url);
  if (!info) return { jobs: [], error: 'Could not parse Eightfold URL' };

  // Step 1: fetch HTML to extract the group_id and detect PCS mode
  const { html, error: htmlError } = await fetchHtml(url, { maxRetries: 1 });
  if (htmlError || !html) {
    return { jobs: [], error: htmlError || 'Failed to fetch Eightfold careers page' };
  }

  const groupId = extractGroupId(html);
  if (!groupId) {
    return { jobs: [], error: 'Could not extract _EF_GROUP_ID from Eightfold careers page' };
  }

  // PCS/PCSX sites require a different API endpoint.
  // The standard /api/apply/v2/jobs returns HTTP 403 "Not authorized for PCSX" for them.
  const pcsMode = isPcsMode(html);
  const apiBase = pcsMode
    ? `${info.origin}/api/pcsx/search`
    : `${info.origin}/api/apply/v2/jobs`;

  // Step 2: paginate the jobs API
  const PAGE_SIZE = 10; // API always returns ≤10 regardless of num_jobs
  let offset = 0;
  let total = Infinity;
  const allJobs: ParsedJob[] = [];

  do {
    const apiUrl = `${apiBase}?domain=${encodeURIComponent(groupId)}&num_jobs=${PAGE_SIZE}&start=${offset}&query=`;
    const { data, error: apiError } = await fetchJson(apiUrl, {
      maxRetries: 1, // fail fast on rate-limiting — no endless backoff for 61+ pages
      headers: {
        'Accept': 'application/json',
        'Referer': url,
      },
    });

    if (apiError) {
      if (offset === 0) return { jobs: [], error: apiError };
      break; // partial result — return what we have
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const any_data = data as any;
    // PCSX response: { status: 200, data: { count, positions } }
    // Standard response: { count, positions }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const payload: any = pcsMode ? any_data?.data : any_data;

    // Populate total from first page only
    if (offset === 0) {
      total = typeof payload?.count === 'number' ? payload.count : 0;
      if (total === 0) break;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rawJobs: any[] = payload?.positions ?? [];
    if (rawJobs.length === 0) break;

    for (const j of rawJobs) {
      // Skip private / unlisted postings (standard API only; PCSX jobs lack this field)
      if (j.isPrivate === true) continue;

      const title: string = (j.name ?? j.posting_name ?? '').trim();
      if (!title) continue;

      const jobId: string | number = j.id ?? '';

      // Build job URL:
      //   PCSX: positionUrl is a relative path like "/careers/job/446717308937"
      //   Standard: prefer eightfold.ai URL constructed from id (keeps .eightfold.ai guard intact)
      let jobUrl: string;
      if (pcsMode) {
        jobUrl = j.positionUrl
          ? `${info.origin}${j.positionUrl}`
          : (jobId ? `${info.origin}/careers/job/${jobId}` : '');
      } else {
        jobUrl =
          (jobId ? `${info.origin}/careers/job/${jobId}` : '') ||
          j.canonicalPositionUrl ||
          '';
      }
      if (!jobUrl) continue;

      // Field names differ between standard and PCSX API:
      //   Standard: location (string), work_location_option (snake_case), job_description, business_unit
      //   PCSX:     locations (array, pre-formatted), workLocationOption (camelCase), no job_description
      const rawLocation = pcsMode
        ? (j.locations?.[0] ?? null)
        : (j.location ?? (j.locations?.[0] ?? null));
      const rawWorkplace = pcsMode ? j.workLocationOption : j.work_location_option;

      const location = formatLocation(rawLocation);
      const workplace_type = formatWorkplaceType(rawWorkplace);

      // department → department field; business_unit → team field
      const department: string | undefined = j.department?.trim() || undefined;
      const team: string | undefined = j.business_unit?.trim() || undefined;

      // Description is plain text in standard mode; PCSX doesn't provide it
      const description: string | undefined =
        j.job_description?.trim().slice(0, 20_000) || undefined;

      allJobs.push({ title, url: jobUrl, location, workplace_type, department, team, description });
    }

    offset += rawJobs.length;

    if (rawJobs.length < PAGE_SIZE) break; // last page

    // Brief inter-page delay to avoid triggering Eightfold's rate limiting.
    // 61+ pages back-to-back without any pause triggers 403s on subsequent syncs.
    await sleep(300);
  } while (offset < total);

  return { jobs: allJobs };
}

/**
 * Detect company name from an Eightfold AI career page.
 *
 * Fetches the careers HTML to extract `_EF_GROUP_ID`, then calls the API
 * to read `branding.navBar.title` (the cleanest source of the company name).
 * Falls back to `branding.page_title` (e.g., "Careers at Bayer"),
 * then to prettifying the URL subdomain.
 */
export async function eightfoldDetect(url: string): Promise<{ company: string; error?: string }> {
  const info = extractEightfoldInfo(url);
  if (!info) return { company: '', error: 'Could not parse Eightfold URL' };

  // Fetch HTML to get group_id and detect platform mode
  const { html, error: htmlError } = await fetchHtml(url, { maxRetries: 1 });
  if (htmlError || !html) {
    // Fall back to prettified slug
    const fallback = info.slug.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    return { company: fallback };
  }

  const htmlCompany = extractCompanyNameFromHtml(html);

  const groupId = extractGroupId(html);
  if (!groupId) {
    const fallback = htmlCompany || info.slug.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    return { company: fallback };
  }

  // PCS/PCSX sites return 403 on the standard API (which would trigger slow retries).
  // The PCSX API also doesn't include branding data, so skip the API call entirely.
  if (isPcsMode(html)) {
    const fallback = htmlCompany || info.slug.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    return { company: fallback };
  }

  // Call the jobs API for the first page — it includes branding data
  const apiUrl = `${info.origin}/api/apply/v2/jobs?domain=${encodeURIComponent(groupId)}&num_jobs=1&start=0&query=`;
  const { data, error: apiError } = await fetchJson(apiUrl, {
    maxRetries: 1, // Fail fast — branding is optional; don't spend minutes on retries
    headers: { 'Accept': 'application/json', 'Referer': url },
  });

  if (!apiError && data) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const payload = data as any;

    // Best source: branding.navBar.title
    const navTitle: string = payload?.branding?.navBar?.title?.trim();
    if (navTitle) return { company: navTitle };

    // Second: strip "Careers at " prefix from page_title
    const pageTitle: string = payload?.branding?.page_title?.trim();
    if (pageTitle) {
      const stripped = pageTitle
        .replace(/^careers\s+at\s+/i, '')
        .replace(/\s+careers?\s*$/i, '')
        .trim();
      if (stripped) return { company: stripped };
    }
  }

  // Fallback: prettify the subdomain slug
  const fallback = htmlCompany || info.slug.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  return { company: fallback };
}

/**
 * Fetch the full job description for a single Eightfold PCSX job.
 *
 * PCSX listing API (/api/pcsx/search) omits `job_description` from position
 * objects. The per-job endpoint /api/apply/v2/jobs/{id}?domain={groupId}
 * returns the full HTML description even for PCSX sites.
 *
 * Used by scraper.scrapeJobDetail for Eightfold jobs that have no description
 * after the initial listing fetch (i.e. all PCSX jobs).
 *
 * @param jobUrl  Full job URL, e.g. https://ngc.eightfold.ai/careers/job/1340070503599
 * @param groupId The _EF_GROUP_ID value (e.g. "ngc.com").  If omitted it will
 *                be re-fetched from the careers page (adds one extra HTTP call).
 */
export async function eightfoldJobDetailApiFetch(
  jobUrl: string,
  groupId?: string,
): Promise<{ description?: string; error?: string }> {
  const info = extractEightfoldInfo(jobUrl);
  if (!info) return { error: 'Could not parse Eightfold job URL' };

  // Extract job id from the URL path: /careers/job/{id}
  const idMatch = jobUrl.match(/\/careers\/job\/(\d+)/);
  if (!idMatch) return { error: 'Could not extract job id from URL' };
  const jobId = idMatch[1];

  // Resolve groupId if not provided (costs one extra HTML fetch — callers should pass it)
  let domain = groupId;
  if (!domain) {
    const { html } = await fetchHtml(`${info.origin}/careers`, { maxRetries: 1 });
    domain = html ? extractGroupId(html) ?? undefined : undefined;
  }
  if (!domain) return { error: 'Could not resolve Eightfold group id' };

  const apiUrl = `${info.origin}/api/apply/v2/jobs/${jobId}?domain=${encodeURIComponent(domain)}`;
  const { data, error: apiError } = await fetchJson(apiUrl, {
    maxRetries: 1,
    headers: { Accept: 'application/json', Referer: jobUrl },
  });
  if (apiError) return { error: apiError };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawDesc: string = (data as any)?.job_description ?? '';
  if (!rawDesc) return {};

  // The description is HTML — convert to Markdown for storage
  const { NodeHtmlMarkdown } = await import('node-html-markdown');
  const nhm = new NodeHtmlMarkdown();
  const description = nhm.translate(rawDesc).trim().slice(0, 20_000) || undefined;
  return { description };
}

/**
 * HTML parser fallback (used by parserRegistry when API fetch is unavailable).
 *
 * Eightfold pages are JavaScript-rendered SPAs; the server-side-rendered HTML
 * contains a serialised JSON blob for the first page of results inside a
 * `<code id="customCSSBlock">` element (HTML-entity-encoded).
 *
 * This is a best-effort fallback — the API path is strongly preferred.
 */
export function eightfoldParser(html: string, baseUrl: string): ParsedJob[] {
  // The page HTML embeds data as HTML-entity-encoded JSON in a <code> block.
  // Look for the "positions" array which is always present.
  const m = html.match(/&#34;positions&#34;\s*:\s*(\[.*?\])(?=\s*,\s*&#34;(?:debug|count|location_user)&#34;)/s);
  if (!m) return [];

  try {
    // Decode HTML entities and parse
    const decoded = m[1]
      .replace(/&#34;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>');

    const rawJobs: unknown[] = JSON.parse(decoded);
    if (!Array.isArray(rawJobs)) return [];

    const info = extractEightfoldInfo(baseUrl);
    const jobs: ParsedJob[] = [];

    for (const j of rawJobs) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pos = j as any;
      if (pos.isPrivate === true) continue;

      const title: string = (pos.name ?? pos.posting_name ?? '').trim();
      if (!title) continue;

      const jobUrl: string =
        pos.canonicalPositionUrl ||
        (pos.id && info ? `${info.origin}/careers/job/${pos.id}` : '');
      if (!jobUrl) continue;

      jobs.push({
        title,
        url: jobUrl,
        location: formatLocation(pos.location ?? (pos.locations?.[0] ?? null)),
        workplace_type: formatWorkplaceType(pos.work_location_option),
        department: pos.department?.trim() || undefined,
        team: pos.business_unit?.trim() || undefined,
        description: pos.job_description?.trim().slice(0, 20_000) || undefined,
      });
    }

    return jobs;
  } catch {
    return [];
  }
}
