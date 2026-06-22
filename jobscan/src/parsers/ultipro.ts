import * as cheerio from 'cheerio';
import { ParsedJob } from '../types';
import { fetchHtml } from '../fetch-utils';

// ── User-Agent for API requests ───────────────────────────────────────────────
const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Check whether a URL points to recruiting.ultipro.com */
export function isUltiproUrl(url: string): boolean {
  try {
    return new URL(url).hostname === 'recruiting.ultipro.com';
  } catch {
    return false;
  }
}

/**
 * Extract the tenant alias from a UltiPro recruiting URL.
 * URL pattern: https://recruiting.ultipro.com/{TENANT_ALIAS}
 */
function extractTenantAlias(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname !== 'recruiting.ultipro.com') return null;
    const parts = u.pathname.split('/').filter(Boolean);
    return parts[0] || null;
  } catch {
    return null;
  }
}

/**
 * Fetch the main career page HTML and extract the JobBoard GUID.
 * The page contains references like:
 *   /TENANT/JobBoard/{GUID}/JobBoardView/LoadSearchResults
 */
async function fetchJobBoardGuid(
  tenantAlias: string
): Promise<{ guid: string; html: string; error?: string }> {
  const pageUrl = `https://recruiting.ultipro.com/${tenantAlias}`;
  const { html, error } = await fetchHtml(pageUrl);
  if (error) return { guid: '', html: '', error };

  const guidMatch = html.match(
    new RegExp(`/${tenantAlias}/JobBoard/([0-9a-f-]{36})`, 'i')
  );
  if (!guidMatch) {
    return { guid: '', html, error: 'Could not extract JobBoard GUID from page' };
  }

  return { guid: guidMatch[1], html };
}

// ── UltiPro Search API types ─────────────────────────────────────────────────

interface UltiproLocation {
  LocalizedName?: string;
  Address?: {
    City?: string;
    State?: { Code?: string; Name?: string };
    Country?: { Code?: string; Name?: string };
  };
}

interface UltiproOpportunity {
  Id: string;
  Title: string;
  BriefDescription?: string;
  Locations?: UltiproLocation[];
  PostedDate?: string;
  FullTime?: boolean;
  JobCategoryName?: string;
  JobLocationType?: number | null;
}

interface UltiproSearchResponse {
  opportunities: UltiproOpportunity[];
  totalCount: number;
}

// ── API-based scraper (preferred) ─────────────────────────────────────────────

const PAGE_SIZE = 100;

/**
 * Fetch all jobs from the UltiPro LoadSearchResults POST API.
 * Steps:
 *  1. GET the career page HTML to extract the JobBoard GUID
 *  2. POST to LoadSearchResults with pagination until all jobs are fetched
 */
export async function ultiproApiFetch(
  url: string
): Promise<{ jobs: ParsedJob[]; error?: string }> {
  const tenantAlias = extractTenantAlias(url);
  if (!tenantAlias) {
    return { jobs: [], error: 'Could not extract tenant alias from UltiPro URL' };
  }

  const { guid, error: guidError } = await fetchJobBoardGuid(tenantAlias);
  if (guidError || !guid) {
    return { jobs: [], error: guidError || 'No JobBoard GUID found' };
  }

  const apiUrl = `https://recruiting.ultipro.com/${tenantAlias}/JobBoard/${guid}/JobBoardView/LoadSearchResults`;
  const baseDetailUrl = `https://recruiting.ultipro.com/${tenantAlias}/JobBoard/${guid}/OpportunityDetail?opportunityId=`;

  const allJobs: ParsedJob[] = [];
  let skip = 0;
  let totalCount = Infinity;

  while (skip < totalCount) {
    const body = {
      opportunitySearch: {
        Top: PAGE_SIZE,
        Skip: skip,
        QueryString: '',
        OrderBy: [
          {
            Value: 'postedDateDesc',
            PropertyName: 'PostedDate',
            Ascending: false,
          },
        ],
        Filters: [],
      },
    };

    let data: UltiproSearchResponse;
    try {
      const resp = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'User-Agent': UA,
          Accept: 'application/json, */*;q=0.5',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });

      if (!resp.ok) {
        return {
          jobs: allJobs,
          error: `UltiPro API returned HTTP ${resp.status} ${resp.statusText}`,
        };
      }

      data = (await resp.json()) as UltiproSearchResponse;
    } catch (err) {
      return {
        jobs: allJobs,
        error: `UltiPro API request failed: ${String(err)}`,
      };
    }

    totalCount = data.totalCount ?? 0;

    for (const opp of data.opportunities ?? []) {
      const title = opp.Title ?? '';
      if (!title) continue;

      const jobUrl = `${baseDetailUrl}${opp.Id}`;

      // Build location string from the first location
      const loc = opp.Locations?.[0];
      let location: string | undefined;
      if (loc) {
        const parts: string[] = [];
        if (loc.Address?.City) parts.push(loc.Address.City);
        if (loc.Address?.State?.Code) parts.push(loc.Address.State.Code);
        if (loc.Address?.Country?.Code && loc.Address.Country.Code !== 'USA') {
          parts.push(loc.Address.Country.Code);
        }
        if (parts.length > 0) {
          location = parts.join(', ');
        } else if (loc.LocalizedName) {
          location = loc.LocalizedName;
        }
      }

      // Workplace type from JobLocationType
      // 0 = On-site, 1 = Remote, 2 = Hybrid (based on UKG convention)
      let workplace_type: string | undefined;
      if (opp.JobLocationType === 1) workplace_type = 'Remote';
      else if (opp.JobLocationType === 2) workplace_type = 'Hybrid';
      else if (opp.JobLocationType === 0) workplace_type = 'On-site';

      // Commitment from FullTime
      const commitment: string | undefined =
        opp.FullTime === true
          ? 'Full-time'
          : opp.FullTime === false
            ? 'Part-time'
            : undefined;

      // Department from JobCategoryName
      const department: string | undefined = opp.JobCategoryName || undefined;

      // Brief description (already plain text from the API)
      const description: string | undefined =
        opp.BriefDescription?.trim().slice(0, 20_000) || undefined;

      allJobs.push({
        title,
        url: jobUrl,
        location,
        workplace_type,
        commitment,
        department,
        description,
      });
    }

    skip += PAGE_SIZE;
  }

  return { jobs: allJobs };
}

// ── Company name detection ────────────────────────────────────────────────────

/**
 * Detect company name from the UltiPro career page.
 * Looks for the logo alt text (e.g. alt="ARA Brand") or the page title.
 */
export async function ultiproDetect(
  url: string
): Promise<{ company: string; error?: string }> {
  const tenantAlias = extractTenantAlias(url);
  if (!tenantAlias) {
    return { company: '', error: 'Could not extract tenant alias from UltiPro URL' };
  }

  const { html, error } = await fetchJobBoardGuid(tenantAlias);
  if (error && !html) {
    // Fallback: prettify the tenant alias
    const fallback = tenantAlias
      .replace(/[0-9]+[A-Z]*$/i, '')        // strip trailing code e.g. APP1010ARAI -> APP
      .replace(/([a-z])([A-Z])/g, '$1 $2')  // camelCase -> words
      .replace(/[-_]+/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase())
      .trim();
    return { company: fallback || tenantAlias };
  }

  const $ = cheerio.load(html);

  // Try logo alt text: alt="CompanyName Brand" or alt="CompanyName"
  const logoAlt =
    $('img.logo[alt]').first().attr('alt') ||
    $('img[alt][data-automation*="logo"]').first().attr('alt') ||
    $('a.navbar-brand img[alt]').first().attr('alt') ||
    '';
  if (logoAlt) {
    const cleaned = logoAlt.replace(/\s+Brand$/i, '').trim();
    if (cleaned) return { company: cleaned };
  }

  // Fallback: page title
  const title = $('title').text().trim();
  if (title) {
    const cleaned = title
      .replace(/\s*[\|–\-]\s*(careers?|jobs?|opportunities).*$/i, '')
      .trim();
    if (cleaned) return { company: cleaned };
  }

  // Final fallback: prettify tenant alias
  const fallback = tenantAlias
    .replace(/[0-9]+[A-Z]*$/i, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
  return { company: fallback || tenantAlias };
}

// ── HTML parser (fallback when API fails) ─────────────────────────────────────

/**
 * Parse UltiPro job listings from HTML.
 * The page is a Knockout.js SPA so visible job data is minimal in HTML,
 * but the server-rendered config may contain some useful data.
 * This is a best-effort fallback — the API-based approach is strongly preferred.
 */
export function ultiproParser(html: string, baseUrl: string): ParsedJob[] {
  const $ = cheerio.load(html);
  const jobs: ParsedJob[] = [];

  // Try to find any opportunity data rendered in the page
  // UltiPro SPA renders jobs client-side, so HTML parsing is very limited.
  // We look for .opportunity elements that may be server-rendered.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  $('[data-automation="opportunity"]').each((_i: number, el: any) => {
    const $el = $(el);
    const title =
      $el.find('[data-automation="opportunityTitle"]').text().trim() ||
      $el.find('a').first().text().trim();
    const href = $el.find('a').first().attr('href') || '';
    const location = $el.find('[data-automation="annotationLocation"]').text().trim() || undefined;

    if (title && href) {
      let url: string;
      try {
        url = new URL(href, baseUrl).toString();
      } catch {
        url = href;
      }
      jobs.push({ title, url, location });
    }
  });

  return jobs;
}
