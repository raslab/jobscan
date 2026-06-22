import { ParsedJob } from '../types';
import { fetchJson } from '../fetch-utils';
import { NodeHtmlMarkdown } from 'node-html-markdown';

/**
 * NEWWORK Software careers parser.
 *
 * URL pattern: https://www.newwork.com/careers
 *              https://www.newwork.com/careers/
 *
 * ── How it works ─────────────────────────────────────────────────────────────
 *
 * NEWWORK hosts their careers page on their own WordPress site (newwork.com).
 * The careers page itself renders an empty <main> section — job listings are
 * managed via a custom WordPress `jobs` post type and exposed through the
 * standard WordPress REST API:
 *
 *   GET https://www.newwork.com/wp-json/wp/v2/jobs?per_page=100
 *
 * Each job object follows the standard WP REST API shape:
 *
 *   {
 *     "id":     101,
 *     "link":   "https://www.newwork.com/senior-engineering-manager/",
 *     "title":  { "rendered": "Senior Engineering Manager" },
 *     "content":{ "rendered": "<p>…description HTML…</p>" },
 *     "excerpt":{ "rendered": "<p>…short description…</p>" },
 *     "meta":   {
 *       "job_location":   "Remote, Worldwide",   // may be empty string or absent
 *       "job_department": "Engineering",          // may be empty string or absent
 *       "job_type":       "Full-time"             // may be empty string or absent
 *     }
 *   }
 *
 * Pagination: up to 100 items per page; the API supports `?page=N&per_page=100`.
 * We fetch all pages until no more items are returned.
 *
 * Field mapping:
 *   title          ← title.rendered
 *   url            ← link
 *   location       ← meta.job_location (falls back to empty)
 *   department     ← meta.job_department (falls back to empty)
 *   commitment     ← meta.job_type (falls back to empty)
 *   workplace_type ← derived from location / title text (Remote / Hybrid)
 *   description    ← content.rendered (HTML → Markdown)
 *
 * Note: The `newworkParser` (HTML parser) is provided as a required registry
 * entry but is never invoked in practice — the `newworkApiFetch` function
 * bypasses HTML parsing entirely.
 */

const NEWWORK_HOSTNAME = 'www.newwork.com';
const WP_JOBS_API = 'https://www.newwork.com/wp-json/wp/v2/jobs';

// ── URL helpers ───────────────────────────────────────────────────────────────

/**
 * Return true if the URL belongs to NEWWORK's careers site.
 * Accepts both:
 *   https://www.newwork.com/careers
 *   https://www.newwork.com/careers/
 */
export function isNewworkUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return (
      u.hostname.toLowerCase() === NEWWORK_HOSTNAME &&
      /\/careers\/?$/i.test(u.pathname)
    );
  } catch {
    return false;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Derive the workplace_type from the location string or job title.
 * NEWWORK doesn't have a dedicated remote field — we infer from text hints.
 */
function deriveWorkplaceType(location: string, title: string): string | undefined {
  const combined = `${location} ${title}`.toLowerCase();
  if (/\bremote\b/.test(combined)) return 'Remote';
  if (/\bhybrid\b/.test(combined)) return 'Hybrid';
  return undefined;
}

/**
 * Read a meta value from a WP REST API meta object, trying common naming
 * patterns. Returns undefined if the value is absent or empty.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function metaValue(meta: Record<string, any> | undefined, ...keys: string[]): string | undefined {
  if (!meta) return undefined;
  for (const key of keys) {
    const v = meta[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return undefined;
}

// ── Public API functions ──────────────────────────────────────────────────────

/**
 * Fetch all NEWWORK job listings via the WordPress REST API.
 *
 * Paginates through all pages (up to 100 per page) and returns all published jobs.
 *
 * @param _url  The NEWWORK careers URL (unused — API endpoint is fixed).
 */
export async function newworkApiFetch(_url: string): Promise<{ jobs: ParsedJob[]; error?: string }> {
  const nhm = new NodeHtmlMarkdown({ bulletMarker: '-' });
  const jobs: ParsedJob[] = [];

  let page = 1;
  const PER_PAGE = 100;

  while (true) {
    const apiUrl = `${WP_JOBS_API}?per_page=${PER_PAGE}&page=${page}&_fields=id,title,link,content,excerpt,meta`;
    const { data, error } = await fetchJson(apiUrl, {
      headers: { 'Accept': 'application/json' },
    });

    if (error) {
      if (jobs.length > 0) break; // already have some results — stop without error
      return { jobs: [], error };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rawJobs: any[] = Array.isArray(data) ? data : [];

    if (rawJobs.length === 0) break; // no more pages

    for (const j of rawJobs) {
      const title: string = (j.title?.rendered ?? '').replace(/&#(\d+);/g, (_m: string, code: string) => String.fromCharCode(Number(code))).trim();
      const jobUrl: string = (j.link ?? '').trim();

      if (!title || !jobUrl) continue;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const meta: Record<string, any> = j.meta ?? {};

      const location: string | undefined = metaValue(meta, 'job_location', 'location', '_location');
      const department: string | undefined = metaValue(meta, 'job_department', 'department', '_department');
      const commitment: string | undefined = metaValue(meta, 'job_type', 'employment_type', 'commitment', '_job_type');
      const workplaceType = deriveWorkplaceType(location ?? '', title);

      // Description: convert content HTML → Markdown
      let description: string | undefined;
      const rawHtml: string = (j.content?.rendered ?? '').trim();
      if (rawHtml) {
        const md = nhm.translate(rawHtml).trim().slice(0, 20_000);
        description = md || undefined;
      }

      jobs.push({
        title,
        url: jobUrl,
        location: location || undefined,
        workplace_type: workplaceType,
        commitment,
        department,
        description,
      });
    }

    if (rawJobs.length < PER_PAGE) break; // last page

    page++;
  }

  return { jobs };
}

/**
 * Detect company name for NEWWORK.
 * Queries the WordPress REST API root to get the site name.
 * Falls back to "NEWWORK" if the request fails.
 */
export async function newworkDetect(_url: string): Promise<{ company: string; error?: string }> {
  const { data, error } = await fetchJson('https://www.newwork.com/wp-json/', {
    headers: { 'Accept': 'application/json' },
  });

  if (error || !data) return { company: 'NEWWORK' };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const name: string = ((data as any)?.name ?? '').trim();
  return { company: name || 'NEWWORK' };
}

// ── HTML parser (registry fallback) ───────────────────────────────────────────

/**
 * HTML parser for NEWWORK careers page.
 *
 * The careers page renders an empty <main> section — all job data is loaded
 * via the WordPress REST API in newworkApiFetch(). This function exists only
 * to satisfy the parserRegistry interface and always returns an empty array.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function newworkParser(_html: string, _baseUrl: string): ParsedJob[] {
  return [];
}
