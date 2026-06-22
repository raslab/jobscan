import { ParsedJob } from '../types';
import { fetchJson } from '../fetch-utils';
import { NodeHtmlMarkdown } from 'node-html-markdown';

/**
 * FREE NOW careers parser.
 *
 * URL pattern: https://www.free-now.com/career/jobs
 *              https://www.free-now.com/career/jobs/
 *
 * ── How it works ─────────────────────────────────────────────────────────────
 *
 * FREE NOW hosts their careers page on their own domain (free-now.com).
 * The page is a client-side React app that loads job data at runtime from
 * Greenhouse (board slug: "freenow").  The initial HTML contains no job links,
 * so DOM-based detection fails; we skip it entirely.
 *
 * We bypass the FREE NOW website and call the public Greenhouse JSON API:
 *
 *   GET https://boards-api.greenhouse.io/v1/boards/freenow/jobs?content=true
 *
 * Response shape:
 *   {
 *     jobs: [
 *       {
 *         id:           7686350,
 *         title:        "B2B Marketing Operations Manager",
 *         absolute_url: "https://job-boards.greenhouse.io/freenow/jobs/7686350",
 *         location:     { name: "Barcelona, Barcelona, Spain" },
 *         departments:  [{ id: 20916, name: "Marketing", ... }],
 *         metadata:     null,
 *         content:      "&lt;p&gt;...&lt;/p&gt;",   // HTML-entity-encoded HTML
 *         updated_at:   "2025-11-05T09:00:00-05:00",
 *       },
 *       ...
 *     ]
 *   }
 *
 * All 60-70 jobs + descriptions are returned in a single request.
 * The `content` field is HTML-entity-encoded HTML — decoded & converted to Markdown.
 * Note: `metadata` is null for this board (no commitment/time-type info).
 *
 * Field mapping:
 *   title       ← title
 *   url         ← absolute_url  (canonical Greenhouse job URL)
 *   location    ← location.name
 *   department  ← departments[0].name
 *   description ← content (entity-decoded + HTML→Markdown)
 */

const GH_BOARD_SLUG = 'freenow';
const GH_API_BASE = 'https://boards-api.greenhouse.io/v1/boards';

// ── URL helpers ───────────────────────────────────────────────────────────────

/**
 * Return true if the URL belongs to FREE NOW's careers site.
 */
export function isFreenowUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return (
      /(?:^|\.)free-now\.com$/i.test(u.hostname) &&
      /\/career\/jobs/.test(u.pathname)
    );
  } catch {
    return false;
  }
}

// ── Workplace type derivation ─────────────────────────────────────────────────

function deriveWorkplaceType(location: string, title: string): string | undefined {
  const combined = `${location} ${title}`.toLowerCase();
  if (/\bremote\b/.test(combined)) return 'Remote';
  if (/\bhybrid\b/.test(combined)) return 'Hybrid';
  return undefined;
}

// ── HTML entity decoder ───────────────────────────────────────────────────────

function decodeHtmlEntities(encoded: string): string {
  return encoded
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/')
    .replace(/&nbsp;/g, ' ')
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&hellip;/g, '…')
    .replace(/&#(\d+);/g, (_m, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex) => String.fromCharCode(parseInt(hex, 16)));
}

// ── Public API functions ──────────────────────────────────────────────────────

/**
 * Fetch all FREE NOW job listings via the Greenhouse public API.
 *
 * A single GET with `content=true` returns all open positions including
 * their descriptions.  No pagination needed (~60-70 jobs).
 *
 * @param _url  The FREE NOW careers page URL (unused — API endpoint is fixed).
 */
export async function freenowApiFetch(_url: string): Promise<{ jobs: ParsedJob[]; error?: string }> {
  const apiUrl = `${GH_API_BASE}/${GH_BOARD_SLUG}/jobs?content=true`;
  const { data, error } = await fetchJson(apiUrl, {
    headers: { 'Accept': 'application/json' },
  });

  if (error) return { jobs: [], error };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const payload = data as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawJobs: any[] = payload?.jobs ?? [];

  const nhm = new NodeHtmlMarkdown({ bulletMarker: '-' });
  const jobs: ParsedJob[] = [];

  for (const j of rawJobs) {
    const title: string = (j.title ?? '').trim();
    const jobUrl: string = (j.absolute_url ?? '').trim();
    if (!title || !jobUrl) continue;

    const locationName: string = (j.location?.name ?? '').trim();
    const department: string | undefined =
      (j.departments?.[0]?.name ?? '').trim() || undefined;

    const workplaceType = deriveWorkplaceType(locationName, title);

    // Description: HTML-entity-encoded HTML → decode → Markdown
    let description: string | undefined;
    const rawContent: string = (j.content ?? '').trim();
    if (rawContent) {
      const decodedHtml = decodeHtmlEntities(rawContent);
      const md = nhm.translate(decodedHtml).trim().slice(0, 20_000);
      description = md || undefined;
    }

    jobs.push({
      title,
      url: jobUrl,
      location: locationName || undefined,
      workplace_type: workplaceType,
      department,
      description,
    });
  }

  return { jobs };
}

// ── HTML fallback parser ──────────────────────────────────────────────────────

/**
 * HTML fallback parser for FREE NOW.
 * FREE NOW is fully covered by the Greenhouse API — this stub satisfies the
 * registry type constraint.  The scraper always uses the API path.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function freenowParser(_html: string, _baseUrl: string): ParsedJob[] {
  return [];
}
