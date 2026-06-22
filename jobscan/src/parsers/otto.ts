import { ParsedJob } from '../types';
import { randomDelay } from '../fetch-utils';

/**
 * OTTO careers parser.
 *
 * URL patterns:
 *   https://www.otto.de/jobs/en/          (English careers home)
 *   https://www.otto.de/jobs/en/jobsearch/ (English job search)
 *   https://www.otto.de/jobs/de/          (German careers home)
 *   https://www.otto.de/jobs/de/jobsuche/ (German job search)
 *
 * ── How it works ──────────────────────────────────────────────────────────────
 *
 * OTTO hosts a custom careers portal built with Weblication® CMS, backed by a
 * SAP OData API.  Job listings are loaded dynamically via two sequential API
 * calls (session create → entity set fetch).
 *
 * Step 1 — Create a session context (required before fetching jobs):
 *
 *   GET https://www.otto.de/or/sap/opu/odata/OTTO/OR2JB_SCONTEXT_SRV/create
 *     ?ConsumerId='9814723'
 *     &hash=''
 *     &langu='DE'        (or 'EN')
 *     &mediumId='2740'
 *     &sttag='20160223'
 *
 *   Headers:
 *     Accept: application/json
 *     X-Requested-With: X
 *     dataserviceversion: 2.0
 *     Accept-Language: DE  (or EN)
 *
 *   Response: { d: { create: { Message: "...", URL_HASH: "" } } }
 *   The server sets session cookies required for the next request.
 *
 * Step 2 — Fetch all job listings:
 *
 *   GET https://www.otto.de/or/sap/opu/odata/OTTO/OR2JB_SCONTEXT_SRV/AusschreibungSet
 *     ?$filter=ConsumerId eq '9814723'
 *
 *   Same headers + session cookies from step 1.
 *
 *   Response shape:
 *     { d: { results: [ { Posit, Offid, Locations, Utext, TargetGroupText,
 *         EmploymentTypeText, RemoteWorkOptionText, ... }, ... ] } }
 *
 * The German language session returns all positions (~50+), while the English
 * session returns only the few positions published in English (~1-5).  We
 * always use the **German session** to get the full job listing, but prefer
 * the English language page when available.
 *
 * ── Field mapping ─────────────────────────────────────────────────────────────
 *
 *   title          ← Posit  (position title)
 *   url            ← https://www.otto.de/jobs/de/jobs/{Offid}/{slugified-title}/
 *   location       ← Locations (e.g. "Hamburg")
 *   department     ← TargetGroupText (e.g. "Software Development", "Marketing")
 *   commitment     ← EmploymentTypeText (e.g. "Vollzeit unbefristet", "Teilzeit befristet")
 *   workplace_type ← RemoteWorkOptionText → normalised
 *   team           ← Utext (company entity, e.g. "Otto GmbH & Co. KGaA")
 *
 * ── Notes ─────────────────────────────────────────────────────────────────────
 *
 *   - The SAP OData session is cookie-based; the create call must use the same
 *     cookie jar as the listing fetch.
 *   - consumerId (9814723) and mediumId (2740) are constants embedded in the
 *     page's inline JavaScript.
 *   - Descriptions are not available in the listing API.
 *   - A small delay is added between session creation and listing fetch.
 */

// ── Constants ─────────────────────────────────────────────────────────────────

const BASE_ORIGIN = 'https://www.otto.de';
const ODATA_BASE = `${BASE_ORIGIN}/or/sap/opu/odata/OTTO/OR2JB_SCONTEXT_SRV`;
const CONSUMER_ID = '9814723';
const MEDIUM_ID = '2740';

const SAP_HEADERS: Record<string, string> = {
  'Accept': 'application/json',
  'X-Requested-With': 'X',
  'dataserviceversion': '2.0',
};

// ── URL helpers ───────────────────────────────────────────────────────────────

/**
 * Return true if the URL belongs to the OTTO careers site.
 */
export function isOttoUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    if (host === 'www.otto.de' || host === 'otto.de') {
      return /^\/jobs\b/i.test(u.pathname);
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Detect the language from URL path: /jobs/en/... → 'EN', /jobs/de/... → 'DE'.
 * Defaults to 'DE' (more complete listings).
 */
function detectLanguage(url: string): 'EN' | 'DE' {
  try {
    const u = new URL(url);
    if (/^\/jobs\/en\b/i.test(u.pathname)) return 'EN';
  } catch { /* ignore */ }
  return 'DE';
}

// ── Slugify helper (mirrors the site's replaceSpecialChars) ───────────────────

/**
 * Slugify a job title to match the URL format used by otto.de.
 *
 * The site converts the title to a URL-safe slug by:
 *   1. Replacing German umlauts/special chars with ASCII equivalents
 *   2. Replacing non-alphanumeric chars with hyphens
 *   3. Collapsing consecutive hyphens
 *   4. Lowercasing
 *   5. Trimming leading/trailing hyphens
 */
function slugify(title: string): string {
  return title
    .replace(/ä/g, 'ae').replace(/Ä/g, 'Ae')
    .replace(/ö/g, 'oe').replace(/Ö/g, 'Oe')
    .replace(/ü/g, 'ue').replace(/Ü/g, 'Ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
}

/**
 * Build the OTTO job detail URL from the Offid and title.
 * Format: https://www.otto.de/jobs/de/jobs/{Offid}/{slug}/
 * Always uses /de/ path since most jobs are German-language.
 */
function buildJobUrl(offid: string, title: string): string {
  const slug = slugify(title);
  return `${BASE_ORIGIN}/jobs/de/jobs/${offid}/${slug}/`;
}

// ── Workplace type normalisation ──────────────────────────────────────────────

/**
 * Normalise the RemoteWorkOptionText into a standard workplace_type.
 *
 * Known values from the API:
 *   "Hybrides Arbeiten möglich" / "Remote work possible" → "Hybrid"
 *   "Vor Ort" / "On-site"                               → "On-site"
 *   "" (empty)                                           → undefined
 */
function normaliseWorkplaceType(remoteOption: string | undefined): string | undefined {
  if (!remoteOption) return undefined;
  const lower = remoteOption.toLowerCase();
  if (/hybrid|remote.*possible|remote.*möglich/i.test(lower)) return 'Hybrid';
  if (/vor.ort|on.?site/i.test(lower)) return 'On-site';
  if (/remote/i.test(lower)) return 'Remote';
  return remoteOption.trim() || undefined;
}

// ── SAP OData API response shape ──────────────────────────────────────────────

interface OttoApiJob {
  Offid: string;
  Posit: string;
  Locations: string;
  Utext: string;
  TargetGroupText: string;
  EmploymentTypeText: string;
  RemoteWorkOptionText: string;
  Fulltime: boolean;
  TemporaryJob: boolean;
  OnlyIntern: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

// ── Public API functions ──────────────────────────────────────────────────────

/**
 * Fetch all OTTO job listings via the SAP OData API.
 *
 * The two-step process (session create → listing fetch) is handled internally.
 * Cookies from the session creation response are forwarded to the listing call,
 * since Node.js fetch does not maintain a cookie jar automatically.
 *
 * Always fetches German listings (DE language) since that returns all positions.
 *
 * @param url - The OTTO careers page URL (used for validation/language hint)
 */
export async function ottoApiFetch(url: string): Promise<{ jobs: ParsedJob[]; error?: string }> {
  // Always use DE language for the complete listing
  const lang = 'DE';

  const headers: Record<string, string> = {
    ...SAP_HEADERS,
    'Accept-Language': lang,
    'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
  };

  // Step 1 — Create session context
  const createUrl = `${ODATA_BASE}/create?ConsumerId=%27${CONSUMER_ID}%27&hash=%27%27&langu=%27${lang}%27&mediumId=%27${MEDIUM_ID}%27&sttag=%2720160223%27`;

  let sessionCookies = '';
  try {
    const createResp = await fetch(createUrl, {
      headers,
      signal: AbortSignal.timeout(15_000),
    });

    if (!createResp.ok) {
      return { jobs: [], error: `OTTO session create failed: HTTP ${createResp.status}` };
    }

    // Extract Set-Cookie headers for the next request
    const setCookieHeaders = createResp.headers.getSetCookie?.() ?? [];
    sessionCookies = setCookieHeaders
      .map((c) => c.split(';')[0])
      .filter(Boolean)
      .join('; ');
  } catch (err) {
    return { jobs: [], error: `OTTO session create failed: ${String(err)}` };
  }

  // Small delay between session creation and listing fetch to be polite
  await randomDelay(500, 1000);

  // Step 2 — Fetch job listings (with session cookies)
  const listUrl = `${ODATA_BASE}/AusschreibungSet?$filter=ConsumerId%20eq%20%27${CONSUMER_ID}%27`;

  try {
    const listResp = await fetch(listUrl, {
      headers: {
        ...headers,
        ...(sessionCookies ? { 'Cookie': sessionCookies } : {}),
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (!listResp.ok) {
      return { jobs: [], error: `OTTO job list fetch failed: HTTP ${listResp.status}` };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const payload: any = await listResp.json();
    const results: OttoApiJob[] = payload?.d?.results ?? [];

    if (results.length === 0) {
      return { jobs: [], error: 'OTTO API returned 0 jobs (empty results array)' };
    }

    return { jobs: parseOttoResults(results) };
  } catch (err) {
    return { jobs: [], error: `OTTO job list fetch failed: ${String(err)}` };
  }
}

/**
 * Parse raw SAP OData job results into ParsedJob array.
 * Deduplicates by Offid (API occasionally returns duplicates).
 */
function parseOttoResults(results: OttoApiJob[]): ParsedJob[] {
  const seen = new Set<string>();
  const jobs: ParsedJob[] = [];

  for (const r of results) {
    const title = (r.Posit ?? '').trim();
    const offid = (r.Offid ?? '').trim();
    if (!title || !offid) continue;
    if (seen.has(offid)) continue;
    seen.add(offid);

    const jobUrl = buildJobUrl(offid, title);
    const location = (r.Locations ?? '').trim() || undefined;
    const department = (r.TargetGroupText ?? '').trim() || undefined;
    const commitment = (r.EmploymentTypeText ?? '').trim() || undefined;
    const workplaceType = normaliseWorkplaceType(r.RemoteWorkOptionText);
    const team = (r.Utext ?? '').trim() || undefined;

    jobs.push({
      title,
      url: jobUrl,
      location,
      department,
      commitment,
      workplace_type: workplaceType,
      team,
    });
  }

  return jobs;
}

/**
 * HTML parser stub — OTTO's job listing page loads data dynamically via JS;
 * the server-rendered HTML contains no job listing data.  This function always
 * returns an empty array and exists only to satisfy the ParserFn interface.
 *
 * The API-based `ottoApiFetch` is the primary (and only) fetch path.
 */
export function ottoParser(_html: string, _baseUrl: string): ParsedJob[] {
  return [];
}
