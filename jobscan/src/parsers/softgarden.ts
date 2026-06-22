import { ParsedJob } from '../types';
import { fetchJson } from '../fetch-utils';
import { NodeHtmlMarkdown } from 'node-html-markdown';

/**
 * Extract the origin (scheme + host) from a Softgarden career page URL.
 * Softgarden career sites follow the pattern: https://{company}.career.softgarden.de/
 * Some may also be on custom domains that redirect here, but the feed is always at {origin}/jobs.feed.json.
 *
 * Examples:
 *   https://softgarden.career.softgarden.de/en/  → https://softgarden.career.softgarden.de
 *   https://acme.career.softgarden.de/           → https://acme.career.softgarden.de
 */
function extractSoftgardenOrigin(url: string): string | null {
  try {
    const u = new URL(url);
    return u.origin;
  } catch {
    return null;
  }
}

// ── Employment-type mapping ────────────────────────────────────────────────────
// Softgarden exposes Schema.org employmentType values (all-caps, underscore-separated)

function formatEmploymentType(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const map: Record<string, string> = {
    FULL_TIME: 'Full-time',
    PART_TIME: 'Part-time',
    CONTRACTOR: 'Contract',
    TEMPORARY: 'Temporary',
    INTERN: 'Internship',
    VOLUNTEER: 'Volunteer',
    PER_DIEM: 'Per Diem',
  };
  return map[raw.toUpperCase()] ?? undefined;
}

// ── Location builder ──────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildLocation(address: any): string | undefined {
  if (!address) return undefined;
  const parts: string[] = [];
  const city: string = (address.addressLocality ?? '').trim();
  const region: string = (address.addressRegion ?? '').trim();
  const country: string = (address.addressCountry ?? '').trim();

  if (city) parts.push(city);
  // Only add region when it's distinct from the city (avoid "Berlin, Berlin, DE")
  if (region && region !== city) parts.push(region);
  if (country) parts.push(country);

  return parts.length > 0 ? parts.join(', ') : undefined;
}

// ── Public API functions ──────────────────────────────────────────────────────

/**
 * Fetch ALL jobs from a Softgarden career page via the built-in Schema.org JSON feed.
 *
 * Endpoint: GET {origin}/jobs.feed.json
 * Response: Schema.org DataFeed — all jobs returned in one request, each with full HTML description.
 * No pagination or per-job detail fetches required.
 *
 * Feed structure:
 *   {
 *     "@type": "DataFeed",
 *     "numberOfItems": N,
 *     "dataFeedElement": [
 *       {
 *         "@type": "DataFeedItem",
 *         "item": {
 *           "@type": "JobPosting",
 *           "title": "...",
 *           "url": "https://{company}.career.softgarden.de/jobs/{id}/{slug}/",
 *           "employmentType": "FULL_TIME",
 *           "description": "<html>...",
 *           "hiringOrganization": { "name": "...", ... },
 *           "jobLocation": { "address": { "addressLocality": "...", "addressCountry": "...", ... } }
 *         }
 *       }
 *     ]
 *   }
 */
export async function softgardenApiFetch(
  url: string,
): Promise<{ jobs: ParsedJob[]; error?: string }> {
  const origin = extractSoftgardenOrigin(url);
  if (!origin) {
    return { jobs: [], error: 'Could not extract origin from Softgarden URL' };
  }

  const feedUrl = `${origin}/jobs.feed.json`;
  const { data, error } = await fetchJson(feedUrl);
  if (error) return { jobs: [], error };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const payload = data as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const elements: any[] = payload?.dataFeedElement ?? [];

  if (elements.length === 0) return { jobs: [] };

  const nhm = new NodeHtmlMarkdown({ bulletMarker: '-' });
  const jobs: ParsedJob[] = [];

  for (const element of elements) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const j: any = element?.item;
    if (!j || j['@type'] !== 'JobPosting') continue;

    const title: string = (j.title ?? '').trim();
    const jobUrl: string = (j.url ?? '').trim();
    if (!title || !jobUrl) continue;

    const location = buildLocation(j.jobLocation?.address);
    const commitment = formatEmploymentType(j.employmentType);

    // Description is included directly as HTML in the listing
    let description: string | undefined;
    const descHtml: string = j.description ?? '';
    if (descHtml) {
      description = nhm.translate(descHtml).trim().slice(0, 20_000) || undefined;
    }

    jobs.push({ title, url: jobUrl, location, commitment, description });
  }

  return { jobs };
}

/**
 * Detect the human-readable company name from a Softgarden career page URL.
 * Fetches the JSON feed and reads hiringOrganization.name from the first job posting.
 * Falls back to a prettified hostname slug if the feed is empty or unavailable.
 */
export async function softgardenApiDetect(
  url: string,
): Promise<{ company: string; error?: string }> {
  const origin = extractSoftgardenOrigin(url);
  if (!origin) {
    return { company: '', error: 'Could not extract origin from Softgarden URL' };
  }

  const feedUrl = `${origin}/jobs.feed.json`;
  const { data, error } = await fetchJson(feedUrl);

  if (!error) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const payload = data as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const firstItem: any = payload?.dataFeedElement?.[0];
    const name: string = firstItem?.item?.hiringOrganization?.name ?? '';
    if (name) return { company: name };
  }

  // Fallback: extract subdomain from origin and prettify it
  // e.g. "acme-corp.career.softgarden.de" → "Acme Corp"
  try {
    const hostname = new URL(origin).hostname;
    const slug = hostname.split('.')[0] ?? '';
    const fallback = slug
      .replace(/[-_]+/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
    return { company: fallback };
  } catch {
    return { company: '', error: error ?? 'Could not determine company name' };
  }
}

/**
 * Softgarden HTML parser (fallback only).
 *
 * Softgarden career pages are Next.js SPAs — all job data is fetched client-side.
 * The API path (softgardenApiFetch) via /jobs.feed.json is always preferred and
 * returns all jobs with descriptions in a single request.
 *
 * This function is intentionally a no-op; it exists to satisfy the ParserFn interface
 * requirement in the registry.
 */
export function softgardenParser(
  _html: string,
  _baseUrl: string,
): ParsedJob[] {
  return [];
}
