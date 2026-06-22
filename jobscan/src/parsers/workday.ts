import { ParsedJob } from '../types';
import { fetchJson, sleep } from '../fetch-utils';
import { NodeHtmlMarkdown } from 'node-html-markdown';

/**
 * Extract tenant, siteId, and base origin from a Workday job board URL.
 *
 * URL pattern: https://{company}.wd{1-5}.myworkdayjobs.com/[{locale}/]{siteId}[/{rest}]
 *
 * Some boards include an optional locale prefix in the path (e.g. "en-US"):
 *   https://zendesk.wd1.myworkdayjobs.com/zendesk
 *   https://zalando.wd3.myworkdayjobs.com/ZalandoSiteWD
 *   https://sec.wd3.myworkdayjobs.com/en-US/Samsung_Careers       ← locale prefix
 *   https://motorolasolutions.wd5.myworkdayjobs.com/en-US/Careers  ← locale prefix
 */
interface WorkdayInfo {
  /** Subdomain portion — equals the Workday tenant name */
  tenant: string;
  /** Job board site ID (first non-locale path segment after the domain) */
  siteId: string;
  /** Full origin: https://{company}.wd{n}.myworkdayjobs.com */
  origin: string;
}

/** Matches BCP-47-style locale segments: "en", "en-US", "de-DE", "zh-CN", etc. */
const LOCALE_SEGMENT_RE = /^[a-z]{2,3}(-[a-zA-Z]{2,4})?$/i;

function extractWorkdayInfo(url: string): WorkdayInfo | null {
  try {
    const u = new URL(url);
    const match = u.hostname.match(/^([a-z0-9-]+)\.(wd\d+)\.myworkdayjobs\.com$/i);
    if (!match) return null;
    const tenant = match[1];
    const parts = u.pathname.split('/').filter(Boolean);
    // Skip optional locale prefix (e.g. "en-US") before the actual siteId
    const siteIdIndex = parts[0] && LOCALE_SEGMENT_RE.test(parts[0]) ? 1 : 0;
    const siteId = parts[siteIdIndex];
    if (!siteId) return null;
    return { tenant, siteId, origin: u.origin };
  } catch {
    return null;
  }
}

// ── Workplace-type normalisation ──────────────────────────────────────────────

/**
 * Normalise Workday's `remoteType` field to a standard string.
 *
 * Observed values:
 *   "In Office"        → "On-site"
 *   "Fully Flexible"   → "Remote"
 *   "Hybrid"           → "Hybrid"
 */
function formatRemoteType(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  const normalised = raw.trim();
  const lower = normalised.toLowerCase();
  if (lower === 'in office') return 'On-site';
  if (lower === 'fully flexible') return 'Remote';
  if (lower === 'hybrid') return 'Hybrid';
  // Return as-is for unrecognised values (future-proofing)
  return normalised || undefined;
}

/**
 * Normalise `timeType` (e.g. "Full time") to a canonical commitment string.
 */
function formatTimeType(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  const normalised = raw.trim();
  const lower = normalised.toLowerCase();
  if (lower === 'full time') return 'Full-time';
  if (lower === 'part time') return 'Part-time';
  return normalised || undefined;
}

// ── Listing API ───────────────────────────────────────────────────────────────

/**
 * Fetch ALL jobs from a Workday job board via its internal CXS JSON API.
 *
 * Endpoint: POST https://{company}.wd{n}.myworkdayjobs.com/wday/cxs/{tenant}/{siteId}/jobs
 * Body:     { "limit": 20, "offset": N, "searchText": "", "appliedFacets": {} }
 * Response: { "total": N (only on first page), "jobPostings": [...] }
 *
 * Pagination: max limit = 20 per page (limit=50 returns HTTP 400).
 * The `total` field is only populated on the first page (offset=0).
 *
 * Rate-limit / session notes:
 *   Some Workday instances (notably wd5) enforce a per-session burst limit at the
 *   Cloudflare edge. When the limit is hit the server returns HTTP 502.  The limit
 *   resets immediately after the response is received, so the correct strategy is:
 *     - On 502: clear the cookie jar (fresh session) and retry after a short back-off.
 *   We also maintain a cookie jar across pages because certain tenants require the
 *   CXS_SESSION / PLAY_SESSION cookies to be echoed back on paginated requests.
 */

/** Parse `Set-Cookie` response headers into a name→value map. */
function extractSetCookies(response: Response): Map<string, string> {
  const result = new Map<string, string>();
  // Node.js 18+ exposes getSetCookie() which returns each header separately;
  // fall back to the combined string (comma-joined) for older runtimes.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawList: string[] = (response.headers as any).getSetCookie?.()
    ?? (response.headers.get('set-cookie') ?? '').split(/,(?=\s*[A-Za-z0-9_-]+=)/).filter(Boolean);
  for (const sc of rawList) {
    const eq = sc.indexOf('=');
    if (eq < 0) continue;
    const name = sc.substring(0, eq).trim();
    const value = sc.substring(eq + 1).split(';')[0].trim();
    if (name) result.set(name, value);
  }
  return result;
}

/**
 * Perform a single Workday CXS jobs POST, updating the shared cookie jar.
 *
 * Returns { payload, status } — the caller decides what to do with non-200 statuses.
 * On HTTP 502 the caller should clear the cookie jar and retry with back-off.
 */
async function workdayCxsPost(
  apiBase: string,
  body: string,
  cookieJar: Map<string, string>,
): Promise<{ payload: unknown; status: number; error?: string }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  };
  if (cookieJar.size > 0) {
    headers['Cookie'] = [...cookieJar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  let response: Response;
  try {
    response = await fetch(apiBase, {
      method: 'POST',
      body,
      signal: AbortSignal.timeout(20_000),
      headers,
    });
  } catch (err) {
    return { payload: null, status: 0, error: `Network error: ${String(err)}` };
  }

  // Merge any new/updated cookies into the jar (even on error responses)
  for (const [name, value] of extractSetCookies(response)) {
    cookieJar.set(name, value);
  }

  if (!response.ok) {
    return { payload: null, status: response.status, error: `HTTP ${response.status}` };
  }

  try {
    const payload = await response.json();
    return { payload, status: response.status };
  } catch (err) {
    return { payload: null, status: response.status, error: `JSON parse error: ${String(err)}` };
  }
}

export async function workdayApiFetch(url: string): Promise<{ jobs: ParsedJob[]; error?: string }> {
  const info = extractWorkdayInfo(url);
  if (!info) {
    return { jobs: [], error: 'Could not extract Workday tenant/siteId from URL' };
  }

  const { tenant, siteId, origin } = info;
  const apiBase = `${origin}/wday/cxs/${tenant}/${siteId}/jobs`;
  const LIMIT = 20;
  // Max retries when the server returns HTTP 502 (Cloudflare burst rate limit).
  // We keep the existing cookie jar on retries — resetting to a fresh session every attempt
  // looks more like a bot to Cloudflare than simply waiting and retrying the same session.
  const MAX_502_RETRIES = 5;
  const BACKOFF_502_MS = 5_000; // 5 s base — the Cloudflare window needs ~5–10 s to refill

  let offset = 0;
  let totalFound = Infinity; // populated after first page
  const allJobs: ParsedJob[] = [];
  const cookieJar = new Map<string, string>(); // kept alive for the whole fetch

  do {
    const reqBody = JSON.stringify({ limit: LIMIT, offset, searchText: '', appliedFacets: {} });

    let result = await workdayCxsPost(apiBase, reqBody, cookieJar);

    // ── 502 retry loop ──
    for (let attempt = 1; result.status === 502 && attempt <= MAX_502_RETRIES; attempt++) {
      console.log(`[workday] 502 on offset ${offset} (attempt ${attempt}/${MAX_502_RETRIES}) — retrying in ${(BACKOFF_502_MS * attempt) / 1000}s`);
      await sleep(BACKOFF_502_MS * attempt); // linear back-off: 5s, 10s, 15s …
      // keep cookieJar — don't reset; reuse the existing session rather than starting fresh
      result = await workdayCxsPost(apiBase, reqBody, cookieJar);
    }

    if (result.error) {
      if (offset === 0) return { jobs: [], error: result.error };
      break; // Return what we have if pagination fails partway
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = result.payload as any;

    // `total` is only reliable on the first page
    if (offset === 0) {
      totalFound = typeof data?.total === 'number' ? data.total : 0;
      if (totalFound === 0) break;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rawJobs: any[] = data?.jobPostings ?? [];
    if (rawJobs.length === 0) break;

    for (const j of rawJobs) {
      const title: string = (j.title ?? '').trim();
      const externalPath: string = j.externalPath ?? '';
      if (!title || !externalPath) continue;

      // Public job URL: https://{origin}/{siteId}{externalPath}
      const jobUrl = `${origin}/${siteId}${externalPath}`;

      // Location — Workday provides a pre-formatted string (may be "N Locations")
      const location: string | undefined = (j.locationsText ?? '').trim() || undefined;

      // Workplace type (not always present — depends on company config)
      const workplace_type = formatRemoteType(j.remoteType);

      // Commitment from timeType (not always present)
      const commitment = formatTimeType(j.timeType);

      allJobs.push({ title, url: jobUrl, location, workplace_type, commitment });
    }

    offset += rawJobs.length;

    // If we got fewer than limit items, we're done
    if (rawJobs.length < LIMIT) break;

    // Pause between pages. 1 s is enough for most Workday instances;
    // the 502 retry loop above recovers the rare burst-limit hit without
    // needing a full 3 s gap between every page.
    await sleep(1_000);
  } while (offset < totalFound);

  return { jobs: allJobs };
}

// ── Detail API ────────────────────────────────────────────────────────────────

/**
 * Fetch the full job description for a single Workday posting via the CXS detail API.
 *
 * The public job URL is:
 *   https://{company}.wd{n}.myworkdayjobs.com/{siteId}/job/{slug}/{reqId}
 *
 * The detail API URL is:
 *   https://{company}.wd{n}.myworkdayjobs.com/wday/cxs/{tenant}/{siteId}/job/{slug}/{reqId}
 *
 * Response shape:
 *   {
 *     jobPostingInfo: {
 *       title, jobDescription (HTML), location, timeType, remoteType, jobReqId, …
 *     },
 *     hiringOrganization: { name, url }
 *   }
 *
 * Returns the Markdown-formatted description, or undefined on failure.
 */
export async function workdayJobDetailApiFetch(
  jobUrl: string,
): Promise<{ description?: string; error?: string }> {
  const info = extractWorkdayInfo(jobUrl);
  if (!info) return { error: 'Not a Workday URL' };

  const { tenant, siteId, origin } = info;

  // Strip the siteId prefix from the path to get the /job/... portion
  let u: URL;
  try {
    u = new URL(jobUrl);
  } catch {
    return { error: 'Invalid URL' };
  }

  // Pathname: /{siteId}/job/{slug}/{reqId}  →  keep from /job/ onward
  const jobPathMatch = u.pathname.match(new RegExp(`^/${siteId}(/job/.+)$`, 'i'));
  if (!jobPathMatch) return { error: 'Could not parse Workday job path' };
  const jobPath = jobPathMatch[1]; // e.g. /job/San-Francisco.../Senior-EA_R123

  const apiUrl = `${origin}/wday/cxs/${tenant}/${siteId}${jobPath}`;

  // maxRetries:1 — fail fast on 429/403 so the caller can detect rate-limiting
  // and stop the batch rather than waiting through exponential backoff.
  const { data, error } = await fetchJson(apiUrl, { maxRetries: 1 });
  if (error) return { error };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const payload = data as any;
  const descHtml: string = payload?.jobPostingInfo?.jobDescription ?? '';
  if (!descHtml) return {};

  const nhm = new NodeHtmlMarkdown({ bulletMarker: '-' });
  const description = nhm.translate(descHtml).trim().slice(0, 20_000) || undefined;
  return { description };
}

// ── Company detect ────────────────────────────────────────────────────────────

/**
 * Detect the human-readable company name for a Workday board.
 *
 * Strategy:
 *   1. Fetch listing with limit=1 to verify the board exists
 *   2. GET the first job's detail → hiringOrganization.name
 *   3. Fallback: prettify the tenant slug
 */
export async function workdayApiDetect(
  url: string,
): Promise<{ company: string; error?: string }> {
  const info = extractWorkdayInfo(url);
  if (!info) {
    return { company: '', error: 'Could not extract Workday tenant/siteId from URL' };
  }

  const { tenant, siteId, origin } = info;

  // Step 1: fetch listing (limit=1) to get the first job's externalPath
  const { data, error } = await fetchJson(`${origin}/wday/cxs/${tenant}/${siteId}/jobs`, {
    method: 'POST',
    body: JSON.stringify({ limit: 1, offset: 0, searchText: '', appliedFacets: {} }),
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
  });

  if (error) {
    return { company: prettifySlug(tenant), error };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const payload = data as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const firstJob: any = payload?.jobPostings?.[0];

  if (firstJob?.externalPath) {
    const jobUrl = `${origin}/${siteId}${firstJob.externalPath}`;
    const jobPathMatch = firstJob.externalPath.match(/^(\/job\/.+)$/i);
    if (jobPathMatch) {
      const detailApiUrl = `${origin}/wday/cxs/${tenant}/${siteId}${jobPathMatch[1]}`;
      const { data: detail, error: detailError } = await fetchJson(detailApiUrl);
      if (!detailError) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const orgName: string = (detail as any)?.hiringOrganization?.name ?? '';
        if (orgName) return { company: orgName };
      }
      // detail failed — suppress, fall through to slug prettify
    }
    // Silence unused variable warning
    void jobUrl;
  }

  // Fallback: prettify the tenant slug
  return { company: prettifySlug(tenant) };
}

// ── HTML parser (fallback, rarely needed) ────────────────────────────────────

/**
 * Workday ATS HTML parser — fallback only.
 *
 * Workday boards are React SPAs; the HTML contains no job listings.
 * This function is a no-op placeholder that always returns an empty array.
 * All actual parsing is done by workdayApiFetch via the CXS JSON API.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function workdayParser(_html: string, _baseUrl: string): ParsedJob[] {
  return [];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function prettifySlug(slug: string): string {
  return slug
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// ── SiteId discovery ─────────────────────────────────────────────────────────

/**
 * Discover the Workday job board siteId from a Workday origin URL by fetching
 * its robots.txt.
 *
 * Workday instances serve a robots.txt that lists available job boards:
 *
 *   Sitemap: https://{tenant}.wd{n}.myworkdayjobs.com/{siteId}/siteMap.xml
 *   User-agent: *
 *   Allow: /{siteId}/
 *
 * This is a reliable, generalizable approach that works across all Workday
 * tenants without needing to guess siteId names.
 *
 * @param origin - Workday origin URL (e.g. "https://mercedesbenztechinnovation.wd3.myworkdayjobs.com")
 * @returns The first siteId found, or null if not discoverable
 */
export async function discoverWorkdaySiteId(origin: string): Promise<string | null> {
  const cleanOrigin = origin.replace(/\/+$/, '');
  const robotsUrl = `${cleanOrigin}/robots.txt`;

  try {
    const resp = await fetch(robotsUrl, {
      method: 'GET',
      signal: AbortSignal.timeout(8_000),
      headers: {
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/plain',
      },
    });
    if (!resp.ok) return null;

    const text = await resp.text();

    // Parse "Allow: /{siteId}/" directives — most reliable signal
    for (const line of text.split('\n')) {
      const allowMatch = line.match(/^Allow:\s*\/([A-Za-z0-9_-]+)\//i);
      if (allowMatch) return allowMatch[1];
    }

    // Fallback: parse "Sitemap: .../{siteId}/siteMap.xml"
    for (const line of text.split('\n')) {
      const sitemapMatch = line.match(/^Sitemap:\s*https?:\/\/[^/]+\/([A-Za-z0-9_-]+)\/siteMap\.xml/i);
      if (sitemapMatch) return sitemapMatch[1];
    }

    return null;
  } catch {
    return null;
  }
}
