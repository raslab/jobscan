import { ParsedJob } from '../types';
import { fetchJson } from '../fetch-utils';
import { NodeHtmlMarkdown } from 'node-html-markdown';

/**
 * GetYourGuide careers parser.
 *
 * URL pattern: https://www.getyourguide.careers/open-roles
 *              (or any path under getyourguide.careers)
 *
 * ── How it works ─────────────────────────────────────────────────────────────
 *
 * Although GetYourGuide hosts their careers page on their own custom Webflow
 * domain (www.getyourguide.careers), the underlying ATS is Greenhouse
 * (board slug: "getyourguide").  This is confirmed by:
 *   - The application iframe loaded from boards.greenhouse.io/embed/job_app?for=getyourguide
 *   - A visible fetch() call in the page JS referencing boards-api.greenhouse.io
 *
 * We bypass the Webflow frontend entirely and call the public Greenhouse JSON
 * API directly:
 *
 *   GET https://boards-api.greenhouse.io/v1/boards/getyourguide/jobs?content=true
 *
 * Response shape:
 *   {
 *     jobs: [
 *       {
 *         id:           7571062,
 *         title:        "Account Executive (Swedish speaker)",
 *         absolute_url: "https://getyourguide.careers/jobs/7571062?gh_jid=7571062",
 *         location:     { name: "Amsterdam" },
 *         departments:  [{ id: 1924, name: "Sales", ... }],
 *         metadata:     [{ name: "Time Type", value: "Full time" }],
 *         content:      "<h2>About the role</h2>...",  // HTML (may be entity-encoded)
 *         updated_at:   "2025-05-01T09:44:26-05:00",
 *       },
 *       ...
 *     ]
 *   }
 *
 * All 75 jobs + descriptions are returned in a single request (no pagination).
 * The `content` field is HTML — we convert it to Markdown for storage.
 *
 * Field mapping:
 *   title          ← title
 *   url            ← absolute_url  (canonical getyourguide.careers job URL)
 *   location       ← location.name
 *   workplace_type ← derived from location name or title (remote hint)
 *   commitment     ← metadata["Time Type"]  (e.g. "Full time")
 *   department     ← departments[0].name
 *   description    ← content (HTML → Markdown)
 */

const GH_BOARD_SLUG = 'getyourguide';
const GH_API_BASE = 'https://boards-api.greenhouse.io/v1/boards';

// ── Workplace type derivation ─────────────────────────────────────────────────

/**
 * Derive workplace type from the location name or job title.
 * GetYourGuide does not expose an explicit remote field; infer from text hints.
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
 * The Greenhouse API sometimes returns `content` as HTML-entity-encoded HTML
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
 * Fetch all GetYourGuide job listings via the Greenhouse public API.
 *
 * A single GET request with `content=true` returns all open positions
 * including their descriptions.  No pagination is needed.
 *
 * @param _url  The GetYourGuide careers page URL (unused — API endpoint is fixed).
 */
export async function getyourguideApiFetch(_url: string): Promise<{ jobs: ParsedJob[]; error?: string }> {
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

    // Description: HTML (possibly entity-encoded) → decode → Markdown
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
 * Detect company name for GetYourGuide.
 * Queries the Greenhouse board metadata endpoint which returns
 * { name: "GetYourGuide" }.  Falls back to "GetYourGuide" if the request fails.
 */
export async function getyourguideDetect(_url: string): Promise<{ company: string; error?: string }> {
  const apiUrl = `${GH_API_BASE}/${GH_BOARD_SLUG}`;
  const { data, error } = await fetchJson(apiUrl, {
    headers: { 'Accept': 'application/json' },
  });

  if (error || !data) return { company: 'GetYourGuide' };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const name: string = (data as any)?.name ?? '';
  return { company: name || 'GetYourGuide' };
}

// ── HTML fallback parser ──────────────────────────────────────────────────────

/**
 * HTML fallback parser for GetYourGuide.
 * GetYourGuide is fully covered by the Greenhouse API — this stub satisfies
 * the registry type constraint.  The scraper always uses the API path.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function getyourguideParser(_html: string, _baseUrl: string): ParsedJob[] {
  return [];
}
