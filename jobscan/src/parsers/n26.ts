import { ParsedJob } from '../types';
import { fetchJson } from '../fetch-utils';
import { NodeHtmlMarkdown } from 'node-html-markdown';

/**
 * N26 careers parser.
 *
 * URL pattern: https://n26.com/en-eu/careers  (or any locale variant)
 *              https://n26.com/en/careers
 *
 * ── How it works ─────────────────────────────────────────────────────────────
 *
 * Although N26 hosts their careers page on their own domain, they use
 * Greenhouse as their underlying ATS (board slug: "n26").  The CSP header
 * on n26.com explicitly allows boards.greenhouse.io and job-boards.greenhouse.io,
 * and the SSR React context contains a `greenhouseData` key with all jobs.
 *
 * We bypass the N26 website entirely and call the public Greenhouse JSON API
 * directly:
 *
 *   GET https://boards-api.greenhouse.io/v1/boards/n26/jobs?content=true
 *
 * Response shape:
 *   {
 *     jobs: [
 *       {
 *         id:           7556629,
 *         title:        "AFC Associate - SAR Delegate",
 *         absolute_url: "https://n26.com/en-eu/careers/positions/7556629?gh_jid=7556629",
 *         location:     { name: "Berlin" },
 *         departments:  [{ id: 78128, name: "Risk", ... }],
 *         metadata:     [{ name: "Time Type", value: "Full time" }],
 *         content:      "&lt;h2&gt;About the opportunity&lt;/h2&gt;...",  // HTML-entity-encoded
 *         updated_at:   "2026-01-29T09:44:26-05:00",
 *       },
 *       ...
 *     ]
 *   }
 *
 * All jobs + descriptions are returned in a single request (no pagination).
 * The `content` field is HTML-entity-encoded HTML — we decode it and convert
 * to Markdown for storage.
 *
 * Field mapping:
 *   title          ← title
 *   url            ← absolute_url  (canonical n26.com job URL)
 *   location       ← location.name
 *   workplace_type ← derived from location name or job title (remote hint)
 *   commitment     ← metadata["Time Type"]  (e.g. "Full time")
 *   department     ← departments[0].name
 *   description    ← content (decoded + HTML→Markdown)
 */

const GH_BOARD_SLUG = 'n26';
const GH_API_BASE = 'https://boards-api.greenhouse.io/v1/boards';
const N26_CAREERS_HOSTNAME = 'n26.com';

// ── URL helpers ───────────────────────────────────────────────────────────────

/**
 * Return true if the URL belongs to N26's careers site.
 * Accepts any locale variant:
 *   https://n26.com/en-eu/careers
 *   https://n26.com/en/careers
 *   https://n26.com/de-de/careers
 */
export function isN26Url(url: string): boolean {
  try {
    const u = new URL(url);
    return (
      u.hostname.toLowerCase() === N26_CAREERS_HOSTNAME &&
      /\/careers/.test(u.pathname)
    );
  } catch {
    return false;
  }
}

// ── Workplace type derivation ─────────────────────────────────────────────────

/**
 * Derive workplace type from the location name or job title.
 * N26 does not have an explicit remote field; we infer from text hints.
 */
function deriveWorkplaceType(location: string, title: string): string | undefined {
  const combined = `${location} ${title}`.toLowerCase();
  if (/\bremote\b/.test(combined)) return 'Remote';
  if (/\bhybrid\b/.test(combined)) return 'Hybrid';
  return undefined;
}

// ── HTML entity decoder ───────────────────────────────────────────────────────

/**
 * Decode HTML entities in a string.
 * The Greenhouse API returns the `content` field as HTML-entity-encoded HTML
 * (e.g. `&lt;p&gt;...&lt;/p&gt;`).  We decode it before converting to Markdown.
 */
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
 * Fetch all N26 job listings via the Greenhouse public API.
 *
 * A single GET request with `content=true` returns all open positions
 * including their descriptions.  No pagination is needed.
 *
 * @param _url  The N26 careers page URL (unused — API endpoint is fixed).
 */
export async function n26ApiFetch(_url: string): Promise<{ jobs: ParsedJob[]; error?: string }> {
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

    // Departments: use the first department name
    const department: string | undefined =
      (j.departments?.[0]?.name ?? '').trim() || undefined;

    // Commitment from metadata "Time Type"
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const meta: Record<string, string> = Object.fromEntries(
      (j.metadata ?? []).map((m: any) => [m.name, m.value ?? ''])
    );
    const commitmentRaw: string = (meta['Time Type'] ?? '').trim();
    const commitment: string | undefined = commitmentRaw || undefined;

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
      commitment,
      department,
      description,
    });
  }

  return { jobs };
}

/**
 * Detect company name for N26.
 * Queries the Greenhouse board metadata endpoint which returns { name: "N26" }.
 * Falls back to "N26" if the request fails.
 */
export async function n26Detect(_url: string): Promise<{ company: string; error?: string }> {
  const apiUrl = `${GH_API_BASE}/${GH_BOARD_SLUG}`;
  const { data, error } = await fetchJson(apiUrl, {
    headers: { 'Accept': 'application/json' },
  });

  if (error || !data) return { company: 'N26' };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const name: string = (data as any)?.name ?? '';
  return { company: name || 'N26' };
}

// ── HTML fallback parser ──────────────────────────────────────────────────────

/**
 * HTML fallback parser for N26.
 * N26 is fully covered by the Greenhouse API — this stub satisfies the registry
 * type constraint.  The scraper always uses the API path for N26.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function n26Parser(_html: string, _baseUrl: string): ParsedJob[] {
  return [];
}
