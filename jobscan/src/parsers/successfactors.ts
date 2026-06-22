/**
 * SuccessFactors ATS parser
 *
 * Uses the DWR (Direct Web Remoting) internal API that backs the career-site SPA.
 *
 * 3-step pagination flow (required to get ALL jobs, not just the first 10):
 *  1. GET the career page  →  JSESSIONID cookie  +  `ajaxSecKey` JS variable
 *  2. POST `getInitialJobSearchData({})` → first page (≤10 jobs) + totalCount
 *  3. POST `search(pagination)` → primes server-side session state
 *  4. POST `getInitialJobSearchData(pagination)` → ALL jobs in one response
 *
 * Steps 3–4 are only needed when totalCount > first-page job count.
 * All three DWR calls MUST share the same JSESSIONID + scriptSessionId
 * so the server associates them with the same search context.
 *
 * Per-job detail page  →  location / description / company name (schema.org)
 *
 * Supported URL patterns
 *   https://career5.successfactors.eu/career?company=bmwag
 *   https://career5.successfactors.eu/careers?company=SAP
 *   https://career012.successfactors.eu/career?company=eberspaecher
 *   https://career1.successfactors.com/career?company=acme
 */

import * as cheerio from 'cheerio';
import { NodeHtmlMarkdown } from 'node-html-markdown';
import { fetchHtml } from '../fetch-utils';
import { ParsedJob } from '../types';

// ── Constants ──────────────────────────────────────────────────────────────────

/** Hard-coded DWR scriptSessionId root found in the generated engine.js */
const SF_ORIG_SSID      = '80A8BD291A8E635A37D57F13E5D1F423';
const SF_VIEW_ID        = '/ui/rcmcareer/pages/careersite/career.jsp.xhtml';
/** Primary: works on all SF cluster variants (career2 … career012). */
const SF_DWR_INITIAL    = '/xi/ajax/remoting/call/plaincall/careerJobSearchControllerProxy.getInitialJobSearchData.dwr';
/** Fallback: used only if the primary returns 0 jobs (older/unusual instances). */
const SF_DWR_SEARCH     = '/xi/ajax/remoting/call/plaincall/careerJobSearchControllerProxy.search.dwr';
const SF_UA             = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// ── Internal helpers ───────────────────────────────────────────────────────────

/** Extract hostname and companyId from any SuccessFactors career URL. */
function extractSFInfo(url: string): { host: string; companyId: string } | null {
  try {
    const u = new URL(url);
    // Accepts career1…career99 on .eu / .com / .cn / .sa etc.
    if (!/^career\d+\.successfactors\.[a-z]{2,3}$/i.test(u.hostname)) return null;
    const companyId = u.searchParams.get('company');
    if (!companyId) return null;
    return { host: u.hostname, companyId };
  } catch {
    return null;
  }
}

/**
 * Extract SuccessFactors host + companyId from a Career Site Builder (CSB) custom-domain page.
 *
 * CSB pages (e.g. https://careers.nemetschek.com/Bluebeam/search/) are hosted on the customer's
 * own domain and embed a `j2w.init({...})` JS block that contains:
 *   "ssoCompanyId" : 'nemetschek'
 *   "ssoUrl"       : 'https://career55.sapsf.eu'
 *
 * We extract these two values so the rest of the DWR scraping flow can target
 * the canonical `career*.sapsf.eu` backend instead of the custom domain.
 *
 * Returns null when the page is not a recognised CSB page.
 */
async function sfExtractCSBInfo(url: string): Promise<{ host: string; companyId: string } | null> {
  try {
    const { html, error } = await fetchHtml(url);
    if (error || !html) return null;

    // "ssoCompanyId"   : 'nemetschek'
    const companyMatch = html.match(/"ssoCompanyId"\s*:\s*['"]([^'"]+)['"]/);
    // "ssoUrl"         : 'https://career55.sapsf.eu'
    const ssoUrlMatch  = html.match(/"ssoUrl"\s*:\s*['"]([^'"]+)['"]/);

    if (!companyMatch || !ssoUrlMatch) return null;

    const companyId = companyMatch[1].trim();
    const ssoHost   = new URL(ssoUrlMatch[1].trim()).hostname;

    if (!companyId || !ssoHost) return null;
    return { host: ssoHost, companyId };
  } catch {
    return null;
  }
}

/**
 * Step 1 – Load the career page to capture the session cookie and CSRF token.
 * The native `fetch()` is required here so we can read `Set-Cookie` headers,
 * which `fetchHtml()` (our wrapper) does not expose.
 */
async function sfFetchSession(
  host: string,
  companyId: string,
): Promise<{ cookieStr: string; ajaxSecKey: string; error?: string }> {
  const pageUrl = `https://${host}/career?company=${encodeURIComponent(companyId)}&lang=en_US`;
  try {
    const resp = await fetch(pageUrl, {
      headers: {
        'User-Agent':      SF_UA,
        'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control':   'no-cache',
      },
      signal: AbortSignal.timeout(30_000),
    });

    if (!resp.ok) {
      return { cookieStr: '', ajaxSecKey: '', error: `Career page HTTP ${resp.status}` };
    }

    // ── Collect Set-Cookie headers ──────────────────────────────────────────
    const cookies: Record<string, string> = {};

    // Node 20+: Headers.getSetCookie() returns an array (undici)
    const rawCookies: string[] =
      typeof (resp.headers as { getSetCookie?: () => string[] }).getSetCookie === 'function'
        ? (resp.headers as { getSetCookie: () => string[] }).getSetCookie()
        : [];

    // Older runtimes: iterate all headers (may coalesce Set-Cookie into one)
    if (rawCookies.length === 0) {
      resp.headers.forEach((value, name) => {
        if (name.toLowerCase() === 'set-cookie') {
          // Each header value may itself be comma-joined in some implementations
          for (const part of value.split(/,(?=[^ ])/)) {
            const pair = part.split(';')[0];
            const eqIdx = pair.indexOf('=');
            if (eqIdx > 0) {
              cookies[pair.slice(0, eqIdx).trim()] = pair.slice(eqIdx + 1).trim();
            }
          }
        }
      });
    } else {
      for (const h of rawCookies) {
        const pair = h.split(';')[0];
        const eqIdx = pair.indexOf('=');
        if (eqIdx > 0) cookies[pair.slice(0, eqIdx).trim()] = pair.slice(eqIdx + 1).trim();
      }
    }

    const cookieStr = Object.entries(cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');

    // ── Extract ajaxSecKey from page HTML ────────────────────────────────────
    const html = await resp.text();

    // Primary: variable assignment  ajaxSecKey = "abc123"  or  ajaxSecKey:"abc123"
    const m1 = html.match(/[Aa]jax[Ss]ec[Kk]ey\s*[=:]\s*["']([^"']+)['"]/);
    // Fallback: form action ?_s.crb=abc123  (URL-encoded CSRF token)
    const m2 = html.match(/_s\.crb=([A-Za-z0-9%+/=._-]+)/);
    const ajaxSecKey = m1?.[1] ?? m2?.[1] ?? '';

    if (!ajaxSecKey) {
      return { cookieStr, ajaxSecKey: '', error: 'ajaxSecKey not found in page HTML' };
    }

    return { cookieStr, ajaxSecKey };
  } catch (err) {
    return { cookieStr: '', ajaxSecKey: '', error: `Session fetch error: ${String(err)}` };
  }
}

/**
 * Shared helper: POST a DWR body to a given path and return the response text.
 */
async function sfDWRPost(
  host: string,
  companyId: string,
  cookieStr: string,
  ajaxSecKey: string,
  dwrPath: string,
  dwrBody: string,
): Promise<{ text: string; error?: string }> {
  const dwrUrl = `https://${host}${dwrPath}`;
  try {
    const resp = await fetch(dwrUrl, {
      method: 'POST',
      headers: {
        'Content-Type':     'text/plain',
        'X-CSRF-Token':     ajaxSecKey,
        'viewId':           SF_VIEW_ID,
        'X-Requested-With': 'XMLHttpRequest',
        'Referer':          `https://${host}/career?company=${companyId}`,
        'Cookie':           cookieStr,
        'User-Agent':       SF_UA,
        'Accept':           '*/*',
      },
      body: dwrBody,
      signal: AbortSignal.timeout(60_000),
    });
    if (!resp.ok) return { text: '', error: `DWR POST HTTP ${resp.status}` };
    const text = await resp.text();
    if (text.includes('You are not authorized')) {
      return { text: '', error: 'DWR: not authorized (bad session or CSRF token)' };
    }
    return { text };
  } catch (err) {
    return { text: '', error: `DWR fetch error: ${String(err)}` };
  }
}

/**
 * Step 2a – Primary DWR call: `getInitialJobSearchData`.
 *
 * This is what the SF SPA calls on every page load and works across ALL SF
 * cluster variants (career2, career5, career012 …).  Sending an empty filter
 * `{}` returns the first page of results (typically 10 jobs) plus the total
 * posting count.  To get ALL jobs we need a 3-step flow – see
 * `sfDWRAllJobsFetch()` below.
 */
async function sfDWRInitialFetch(
  host: string,
  companyId: string,
  cookieStr: string,
  ajaxSecKey: string,
  scriptSessionId: string,
  batchId: number = 1,
): Promise<{ text: string; error?: string }> {
  const body = [
    'callCount=1',
    'page=/career',
    'httpSessionId=',
    `scriptSessionId=${scriptSessionId}`,
    'c0-scriptName=careerJobSearchControllerProxy',
    'c0-methodName=getInitialJobSearchData',
    'c0-id=0',
    'c0-param0=Object_Object:{}',
    `batchId=${batchId}`,
    '',
  ].join('\n');
  return sfDWRPost(host, companyId, cookieStr, ajaxSecKey, SF_DWR_INITIAL, body);
}

/**
 * Step 2b-prime – Call `search` to prime the server-side session state.
 *
 * The SF DWR backend maintains per-session search context.  Calling `search`
 * (even though it usually returns 0 jobs headlessly) initialises this context
 * so that a subsequent `getInitialJobSearchData` with pagination params can
 * return ALL jobs beyond the first page.  This is the same `search` method
 * the SPA invokes when a user applies filters.
 */
async function sfDWRSearchPrime(
  host: string,
  companyId: string,
  cookieStr: string,
  ajaxSecKey: string,
  scriptSessionId: string,
  batchId: number = 2,
): Promise<{ text: string; error?: string }> {
  const body = [
    'callCount=1',
    'page=/career',
    'httpSessionId=',
    `scriptSessionId=${scriptSessionId}`,
    'c0-scriptName=careerJobSearchControllerProxy',
    'c0-methodName=search',
    'c0-id=0',
    'c0-e1=number:9999',
    'c0-e2=number:1',
    'c0-e3=number:1',
    'c0-e4=number:9999',
    'c0-e5=boolean:false',
    'c0-e6=Object_Object:{pageSize:reference:c0-e1,currentPage:reference:c0-e2,startRow:reference:c0-e3,endRow:reference:c0-e4,increaseCandSummaryPagination:reference:c0-e5}',
    'c0-e7=string:JOB_POSTING_DATE',
    'c0-e8=string:DESC',
    'c0-param0=Object_Object:{pagination:reference:c0-e6,sortByColumn:reference:c0-e7,sortOrder:reference:c0-e8}',
    `batchId=${batchId}`,
    '',
  ].join('\n');
  return sfDWRPost(host, companyId, cookieStr, ajaxSecKey, SF_DWR_SEARCH, body);
}

/**
 * Step 2c – `getInitialJobSearchData` with pagination to retrieve ALL jobs.
 *
 * After the session has been primed by `sfDWRSearchPrime`, calling
 * `getInitialJobSearchData` again with a pagination object
 * `{pageSize:N, currentPage:2, startRow:1, endRow:N, totalCount:N}`
 * makes the server return the complete result set in a single response.
 *
 * The `currentPage:2` value is intentional — the server interprets page 2+
 * as a continuation and honours the requested pageSize rather than the
 * default (10).
 */
async function sfDWRPaginatedFetch(
  host: string,
  companyId: string,
  cookieStr: string,
  ajaxSecKey: string,
  scriptSessionId: string,
  totalCount: number,
  batchId: number = 3,
): Promise<{ text: string; error?: string }> {
  const body = [
    'callCount=1',
    'page=/career',
    'httpSessionId=',
    `scriptSessionId=${scriptSessionId}`,
    'c0-scriptName=careerJobSearchControllerProxy',
    'c0-methodName=getInitialJobSearchData',
    'c0-id=0',
    `c0-e1=number:${totalCount}`,
    'c0-e2=number:2',
    'c0-e3=number:1',
    `c0-e4=number:${totalCount}`,
    `c0-e5=number:${totalCount}`,
    'c0-param0=Object_Object:{pageSize:reference:c0-e1,currentPage:reference:c0-e2,startRow:reference:c0-e3,endRow:reference:c0-e4,totalCount:reference:c0-e5}',
    `batchId=${batchId}`,
    '',
  ].join('\n');
  return sfDWRPost(host, companyId, cookieStr, ajaxSecKey, SF_DWR_INITIAL, body);
}

/**
 * Step 3 – Parse the DWR JavaScript-notation response.
 *
 * Response structure (simplified):
 *   var s0={}; var s1={}; ...
 *   s1.detailURLPrefix="\/career?career%5fns=...&career_job_req_id=";
 *   s1.postingCount=287;
 *   s12.id=164528;
 *   s12.title="Quality Management Intern";
 *   s12.postingDate="03\/07\/2026";
 *   dwr.engine._remoteHandleCallback('1','0',{filters:s0,results:s1});
 */
function parseDWRListings(dwr: string): {
  jobs: Array<{ id: string; title: string }>;
  detailURLPrefix: string;
  totalCount: number;
} {
  // ── detailURLPrefix ────────────────────────────────────────────────────────
  const prefixMatch = dwr.match(/\.detailURLPrefix="((?:[^"\\]|\\.)*)"/);
  const rawPrefix = prefixMatch
    ? prefixMatch[1]
        .replace(/\\\//g, '/')   // \/ → /
        .replace(/\\"/g, '"')    // \" → "
    : '';

  // URL-decode %5f → _ etc. so the final job URL looks human-readable
  let detailURLPrefix = rawPrefix;
  try {
    detailURLPrefix = decodeURIComponent(rawPrefix.replace(/\+/g, ' '));
  } catch { /* leave as-is */ }

  // ── Job stubs ──────────────────────────────────────────────────────────────
  // Each posting is represented by a unique JS variable (e.g. s12, s13…).
  // We look for variables that have BOTH .id=NUMBER and .title="…".
  const jobs: Array<{ id: string; title: string }> = [];
  const idPattern = /(\w+)\.id=(\d+);/g;
  let m: RegExpExecArray | null;

  while ((m = idPattern.exec(dwr)) !== null) {
    const [, varName, id] = m;

    // Must have a matching title on the same variable
    const titleRe  = new RegExp(`${varName}\\.title="((?:[^"\\\\]|\\\\.)*)";`);
    const titleMatch = dwr.match(titleRe);
    if (!titleMatch) continue;

    const title = titleMatch[1]
      .replace(/\\"/g,  '"')
      .replace(/\\\//g, '/')
      .replace(/\\n/g,  '\n')
      .replace(/\\t/g,  '\t')
      .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));

    jobs.push({ id, title });
  }

  // ── Total count ────────────────────────────────────────────────────────────
  // The DWR response often contains multiple `totalCount=N` assignments: some
  // belong to filter-facet objects (e.g. s14.totalCount=0) and the real one
  // is on the pagination object (e.g. s35.totalCount=48).  Taking the first
  // match can therefore return 0 and suppress pagination.  We use the maximum
  // value across all matches instead.
  const allCountMatches = [...dwr.matchAll(/totalCount=(\d+)/g)];
  const totalCount = allCountMatches.length > 0
    ? Math.max(...allCountMatches.map((m) => parseInt(m[1], 10)))
    : jobs.length;

  return { jobs, detailURLPrefix, totalCount };
}

// ── Public exports ─────────────────────────────────────────────────────────────

/**
 * Fetch all SuccessFactors job listings via the DWR search API.
 * Returns ParsedJob stubs (title + url); descriptions/locations are filled
 * later by `successfactorsJobDetailFetch()` in scraper.ts.
 */
export async function successfactorsApiFetch(
  url: string,
): Promise<{ jobs: ParsedJob[]; error?: string }> {
  // Try the standard career*.successfactors.* URL pattern first, then fall
  // back to CSB custom-domain detection (fetches the page to read j2w.init config).
  const info = extractSFInfo(url) ?? (await sfExtractCSBInfo(url));
  if (!info) return { jobs: [], error: 'Not a recognised SuccessFactors URL' };
  const { host, companyId } = info;

  // 1. Session + CSRF
  const { cookieStr, ajaxSecKey, error: sessionErr } = await sfFetchSession(host, companyId);
  if (sessionErr || !ajaxSecKey) {
    return { jobs: [], error: sessionErr ?? 'Could not obtain CSRF token' };
  }

  // Use a single scriptSessionId for the whole 3-step flow so the server
  // associates all calls with the same DWR page-session.
  const scriptSessionId = `${SF_ORIG_SSID}${Math.floor(Math.random() * 1000)}`;

  // 2. Primary: getInitialJobSearchData — gets first page + total count
  let { text: dwr, error: dwrErr } = await sfDWRInitialFetch(
    host, companyId, cookieStr, ajaxSecKey, scriptSessionId, 1,
  );
  if (dwrErr || !dwr) {
    return { jobs: [], error: dwrErr ?? 'Empty DWR response' };
  }

  let parsed = parseDWRListings(dwr);

  // 2b. If the first page has fewer jobs than totalCount, fetch ALL via
  //     the 3-step pagination flow:
  //       init({}) → search(prime) → getInitialJobSearchData(pagination)
  if (parsed.jobs.length > 0 && parsed.totalCount > parsed.jobs.length) {
    console.log(
      `[successfactors] ${host}/${companyId}: page 1 has ${parsed.jobs.length} of ${parsed.totalCount}, fetching all…`,
    );

    // Step 2b-i: prime the session with a search call
    await sfDWRSearchPrime(host, companyId, cookieStr, ajaxSecKey, scriptSessionId, 2);

    // Step 2b-ii: re-fetch with pagination requesting ALL results
    const { text: allDwr, error: allErr } = await sfDWRPaginatedFetch(
      host, companyId, cookieStr, ajaxSecKey, scriptSessionId, parsed.totalCount, 3,
    );

    if (!allErr && allDwr) {
      const allParsed = parseDWRListings(allDwr);
      if (allParsed.jobs.length > parsed.jobs.length) {
        console.log(
          `[successfactors] ${host}/${companyId}: pagination returned ${allParsed.jobs.length} jobs (total: ${allParsed.totalCount})`,
        );
        parsed = allParsed;
      }
    }
  }

  // 2c. If still 0 jobs, return empty (scraper.ts will fall through to HTML)
  if (parsed.jobs.length === 0) {
    return { jobs: [] };
  }

  // 3. Build ParsedJob list
  const { jobs: stubs, detailURLPrefix } = parsed;
  const jobs: ParsedJob[] = stubs.map(({ id, title }) => ({
    title: title || '(untitled)',
    url:   `https://${host}${detailURLPrefix}${id}`,
  }));

  console.log(`[successfactors] ${host}/${companyId}: ${jobs.length} jobs`);
  return { jobs };
}

/**
 * Fetch a single SuccessFactors job detail page and extract:
 *   - location  (schema.org or breadcrumb line with bold elements)
 *   - description (schema.org or .joqReqDescription / .externalPosting)
 *   - company   (schema.org or page title)
 *
 * Some SF instances (e.g. ESA) render schema.org metadata server-side.
 * Others (e.g. eberspaecher) are full SPAs but still include the job
 * description HTML and a location breadcrumb in the initial page load.
 *
 * Called by scraper.ts for each job after the listing is fetched.
 * No session cookies required for detail pages.
 */
export async function successfactorsJobDetailFetch(
  jobUrl: string,
): Promise<{ description?: string; location?: string; company?: string; error?: string }> {
  const { html, error } = await fetchHtml(jobUrl);
  if (error || !html) return { error: error ?? 'Empty response' };

  const $ = cheerio.load(html);

  // ── Location ────────────────────────────────────────────────────────────────
  // Strategy 1: schema.org meta tags (some instances have these)
  const locality = $('meta[itemprop="addressLocality"]').attr('content')?.trim()  ?? '';
  const region   = $('meta[itemprop="addressRegion"]').attr('content')?.trim()    ?? '';
  const country  = $('meta[itemprop="addressCountry"]').attr('content')?.trim()   ?? '';
  let location = [locality, region, country].filter(Boolean).join(', ') || undefined;

  // Strategy 2: Requisition breadcrumb line —
  //   <div tabindex="0">Requisition ID&nbsp;<b>35205</b>&nbsp;-&nbsp;…&nbsp;-&nbsp;
  //   <b>Germany</b>&nbsp;-&nbsp;<b>Baden-Württemberg</b>&nbsp;-&nbsp;<b>Esslingen</b>…</div>
  if (!location) {
    // The breadcrumb text contains "Requisition ID" followed by location bold segments.
    // Extract the raw text, split on " - ", skip the req-ID and date, keep location parts.
    const reqDiv = $('div[tabindex="0"]').filter(function () {
      return $(this).text().includes('Requisition ID');
    }).first();
    if (reqDiv.length) {
      // Grab all <b> text nodes after the first one (which is the req ID number)
      const bolds: string[] = [];
      reqDiv.find('b').each(function () {
        const txt = $(this).text().trim();
        if (txt) bolds.push(txt);
      });
      // bolds[0] = Req ID (number), rest = location segments + possibly category.
      // Skip the req ID and the posted date (if present).
      // Location parts are typically Country, Region, City.
      const locParts = bolds.slice(1).filter(
        (b) => !/^\d/.test(b) && !/posted/i.test(b),
      );
      if (locParts.length > 0) {
        location = locParts.join(', ');
      }
    }
  }

  // ── Company ─────────────────────────────────────────────────────────────────
  const company =
    $('meta[itemprop="hiringOrganization"]').attr('content')?.trim()  ||
    $('[itemprop="hiringOrganization"]').first().text().trim()         ||
    undefined;

  // ── Description ─────────────────────────────────────────────────────────────
  let description: string | undefined;
  const nhm = new NodeHtmlMarkdown({ bulletMarker: '-' });

  // Strategy 1: schema.org itemprop="description"
  const descEl = $('[itemprop="description"]').first();
  if (descEl.length) {
    const inner = descEl.find('.jobdescription').first();
    const descHtml = (inner.length ? inner : descEl).html() ?? '';
    if (descHtml) {
      description = nhm.translate(descHtml).trim().slice(0, 20_000) || undefined;
    }
  }

  // Strategy 2: .joqReqDescription (SPA-rendered pages like eberspaecher)
  // The job description is inside <div class="joqReqDescription"> and often
  // wrapped in <div class="externalPosting">.
  if (!description) {
    const joqEl = $('div.joqReqDescription').first();
    if (joqEl.length) {
      const extPosting = joqEl.find('.externalPosting').first();
      const descHtml = (extPosting.length ? extPosting : joqEl).html() ?? '';
      if (descHtml) {
        description = nhm.translate(descHtml).trim().slice(0, 20_000) || undefined;
      }
    }
  }

  return { description, location, company };
}

/**
 * Detect the company name for a SuccessFactors source URL.
 * Strategy: fetch just the first page of results (≤10 jobs, no pagination)
 * to get a detail URL, then read the detail page for the company name.
 * Falls back to the raw companyId slug when no jobs are found or detail fails.
 */
export async function successfactorsApiDetect(
  url: string,
): Promise<{ company: string; error?: string }> {
  // Same CSB fallback as successfactorsApiFetch
  const info = extractSFInfo(url) ?? (await sfExtractCSBInfo(url));
  if (!info) return { company: '', error: 'Not a recognised SuccessFactors URL' };
  const { host, companyId } = info;

  // Lightweight: just init + first page (no pagination) — enough to get one job URL
  const { cookieStr, ajaxSecKey, error: sessionErr } = await sfFetchSession(host, companyId);
  if (sessionErr || !ajaxSecKey) {
    return { company: companyId, error: sessionErr ?? 'Could not obtain CSRF token' };
  }

  const scriptSessionId = `${SF_ORIG_SSID}${Math.floor(Math.random() * 1000)}`;
  const { text: dwr, error: dwrErr } = await sfDWRInitialFetch(
    host, companyId, cookieStr, ajaxSecKey, scriptSessionId, 1,
  );
  if (dwrErr || !dwr) {
    return { company: companyId, error: dwrErr ?? 'Empty DWR response' };
  }

  const parsed = parseDWRListings(dwr);
  if (parsed.jobs.length === 0) {
    return { company: companyId, error: 'No jobs found' };
  }

  // Build the first job URL and fetch its detail page for the company name
  const firstJobUrl = `https://${host}${parsed.detailURLPrefix}${parsed.jobs[0].id}`;
  const { company } = await successfactorsJobDetailFetch(firstJobUrl);
  return { company: company ?? companyId };
}

/**
 * HTML fallback parser — no-op.
 * scraper.ts always calls `successfactorsApiFetch` first; this is only here
 * to satisfy the `ParserFn` contract required by the registry.
 */
export function successfactorsParser(_html: string, _baseUrl: string): ParsedJob[] {
  return [];
}
