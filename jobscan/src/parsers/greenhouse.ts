import * as cheerio from 'cheerio';
import { ParsedJob } from '../types';
import { fetchJson } from '../fetch-utils';

function resolveUrl(href: string, baseUrl: string): string {
  if (!href) return '';
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return href;
  }
}

/**
 * Extract the company slug from a Greenhouse board URL.
 * Handles:
 *   https://boards.greenhouse.io/{company}
 *   https://job-boards.greenhouse.io/{company}
 *   https://job-boards.eu.greenhouse.io/{company}
 *   https://boards.eu.greenhouse.io/{company}
 */
function extractGreenhouseSlug(url: string): string | null {
  try {
    const u = new URL(url);
    const match = u.hostname.match(/^(?:job-)?boards(?:\.eu)?\.greenhouse\.io$/i);
    if (!match) return null;
    const parts = u.pathname.split('/').filter(Boolean);
    return parts[0] || null;
  } catch {
    return null;
  }
}

/**
 * Fetch jobs via the Greenhouse public JSON API.
 * Endpoint: https://boards-api.greenhouse.io/v1/boards/{company}/jobs
 * This avoids Cloudflare-protected HTML pages entirely.
 */
export async function greenhouseApiFetch(url: string): Promise<{ jobs: ParsedJob[]; error?: string }> {
  const slug = extractGreenhouseSlug(url);
  if (!slug) return { jobs: [], error: 'Could not extract company slug from Greenhouse URL' };

  const apiUrl = `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true`;
  const { data, error } = await fetchJson(apiUrl);
  if (error) return { jobs: [], error };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const payload = data as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawJobs: any[] = payload?.jobs ?? [];
  const jobs: ParsedJob[] = [];

  for (const j of rawJobs) {
    const title: string = j.title ?? '';
    const jobUrl: string = j.absolute_url ?? '';
    if (!title || !jobUrl) continue;

    const rawLocName = (j.location?.name ?? '').trim();
    // Filter placeholder strings that some companies (e.g. Stripe) use
    const GH_PLACEHOLDER_LOCS = new Set(['n/a', 'na', 'location', 'tbd', 'tba', 'remote']);
    const location: string | undefined =
      rawLocName && !GH_PLACEHOLDER_LOCS.has(rawLocName.toLowerCase()) ? rawLocName : undefined;
    const department: string | undefined =
      j.departments?.[0]?.name || undefined;

    // content=true gives us the description HTML
    let description: string | undefined;
    if (j.content) {
      // Convert HTML → plain text (lightweight: strip tags)
      const { NodeHtmlMarkdown } = await import('node-html-markdown');
      const nhm = new NodeHtmlMarkdown({ bulletMarker: '-' });
      description = nhm.translate(j.content).trim().slice(0, 20_000) || undefined;
    }

    jobs.push({ title, url: jobUrl, location, department, description });
  }

  return { jobs };
}

/**
 * Detect company name from the Greenhouse API without fetching HTML.
 * Uses: https://boards-api.greenhouse.io/v1/boards/{slug}
 * Returns the human-readable company name, or the slug as fallback.
 */
export async function greenhouseApiDetect(url: string): Promise<{ company: string; error?: string }> {
  const slug = extractGreenhouseSlug(url);
  if (!slug) return { company: '', error: 'Could not extract company slug from Greenhouse URL' };

  const apiUrl = `https://boards-api.greenhouse.io/v1/boards/${slug}`;
  const { data, error } = await fetchJson(apiUrl);
  if (error) {
    // Fallback: prettify the slug itself
    const fallback = slug.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    return { company: fallback };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const payload = data as any;
  const name: string = payload?.name || '';
  if (name) return { company: name };

  // Fallback to prettified slug
  const fallback = slug.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  return { company: fallback };
}

/**
 * Greenhouse ATS parser.
 *
 * Supports two board formats:
 *
 * 1. New format – https://job-boards.greenhouse.io/<company>
 *    This is a Remix SPA: job data is server-side rendered as JSON inside a
 *    <script>window.__remixContext = {...}</script> block.
 *    Path: state.loaderData["routes/$url_token"].posts.data[]
 *    Each entry has: id, title, location, absolute_url, department.name
 *
 * 2. Legacy format – https://boards.greenhouse.io/<company>
 *    Classic HTML: each job is a <div class="opening"> containing
 *    an <a> for title/link and a <span class="location"> for location.
 */
export function greenhouseParser(html: string, baseUrl: string): ParsedJob[] {
  // ── New Greenhouse "job-boards" format (Remix SPA) ──────────────────────────
  if (html.includes('window.__remixContext')) {
    const $ = cheerio.load(html);
    let remixCtx: unknown = null;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    $('script').each((_i: number, el: any) => {
      if (remixCtx) return; // already found
      const content = $(el).html() ?? '';
      if (!content.includes('window.__remixContext')) return;

      // Extract the JSON object assigned to window.__remixContext
      const eqIdx = content.indexOf('window.__remixContext');
      const braceIdx = content.indexOf('{', eqIdx);
      if (braceIdx === -1) return;

      // Walk the string to find the matching closing brace
      let depth = 0;
      let end = braceIdx;
      for (; end < content.length; end++) {
        if (content[end] === '{') depth++;
        else if (content[end] === '}') {
          depth--;
          if (depth === 0) break;
        }
      }
      try {
        remixCtx = JSON.parse(content.slice(braceIdx, end + 1));
      } catch {
        // ignore malformed JSON, fall through to legacy parser
      }
    });

    if (remixCtx) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ctx = remixCtx as any;
      const routeData =
        ctx?.state?.loaderData?.['routes/$url_token'] ??
        ctx?.loaderData?.['routes/$url_token'];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const posts: any[] = routeData?.jobPosts?.data ?? routeData?.posts?.data ?? [];
      const jobs: ParsedJob[] = [];
      for (const p of posts) {
        const title: string = p.title ?? '';
        const url: string = p.absolute_url ?? resolveUrl(String(p.id), baseUrl);
        if (!title || !url) continue;
        // location can be a plain string or an object {name: string}
        const rawLoc = p.location;
        const rawLocStr = (typeof rawLoc === 'string' ? rawLoc : (rawLoc?.name ?? '')).trim();
        const GH_PLACEHOLDER_LOCS = new Set(['n/a', 'na', 'location', 'tbd', 'tba', 'remote']);
        const location: string | undefined =
          rawLocStr && !GH_PLACEHOLDER_LOCS.has(rawLocStr.toLowerCase()) ? rawLocStr : undefined;
        jobs.push({
          title,
          url,
          location,
          department: p.department?.name || undefined,
        });
      }
      if (jobs.length > 0) return jobs;
      // If we parsed the context but got zero jobs, fall through to legacy DOM
    }
  }

  // ── Legacy Greenhouse "boards" format (DOM-based) ───────────────────────────
  const $ = cheerio.load(html);
  const jobs: ParsedJob[] = [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  $('.opening').each((_i: number, el: any) => {
    const $el = $(el);
    const link = $el.find('a').first();
    const title = link.text().trim();
    const href = link.attr('href') ?? '';
    const url = resolveUrl(href, baseUrl);
    const location = $el.find('.location').text().trim() || undefined;
    // Some Greenhouse boards expose job type / workplace in extra spans
    const commitment =
      $el.find('.job-type, [class*="type"], [class*="employment"]').first().text().trim() || undefined;
    const workplace_type =
      $el.find('[class*="workplace"], [class*="remote"]').first().text().trim() || undefined;

    if (title && url) {
      jobs.push({ title, url, location, commitment, workplace_type });
    }
  });

  return jobs;
}
