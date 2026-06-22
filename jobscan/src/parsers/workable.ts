import { ParsedJob } from '../types';
import { fetchJson } from '../fetch-utils';
import { NodeHtmlMarkdown } from 'node-html-markdown';

const nhm = new NodeHtmlMarkdown({ bulletMarker: '-' });

/**
 * Extract the company slug from a Workable careers page URL.
 * Handles: https://apply.workable.com/{slug}
 */
function extractWorkableSlug(url: string): string | null {
  try {
    const u = new URL(url);
    if (!u.hostname.match(/^apply\.workable\.com$/i)) return null;
    const parts = u.pathname.split('/').filter(Boolean);
    // Skip paths like /j/SHORTCODE (individual job links)
    if (parts[0] === 'j' || parts[0] === 'api') return null;
    return parts[0] || null;
  } catch {
    return null;
  }
}

/**
 * Fetch jobs via the Workable public widget JSON API.
 * List:   GET https://apply.workable.com/api/v1/widget/accounts/{slug}?details=true
 *
 * The ?details=true parameter includes the full HTML description in the listing
 * response, eliminating the need for per-job v2 API detail fetches (which are
 * aggressively rate-limited).
 */
export async function workableApiFetch(url: string): Promise<{ jobs: ParsedJob[]; error?: string }> {
  const slug = extractWorkableSlug(url);
  if (!slug) return { jobs: [], error: 'Could not extract company slug from Workable URL' };

  const apiUrl = `https://apply.workable.com/api/v1/widget/accounts/${slug}?details=true`;
  const { data, error } = await fetchJson(apiUrl);
  if (error) return { jobs: [], error };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const payload = data as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawJobs: any[] = payload?.jobs ?? [];

  // Deduplicate by shortcode (the API can return the same job multiple times
  // when it's posted to multiple location pages)
  const seen = new Set<string>();
  const jobs: ParsedJob[] = [];

  for (const j of rawJobs) {
    const title: string = j.title ?? '';
    const shortcode: string = j.shortcode ?? '';
    if (!title || !shortcode) continue;
    if (seen.has(shortcode)) continue;
    seen.add(shortcode);

    // Always construct the URL with the slug so the job link is user-friendly
    const jobUrl = `https://apply.workable.com/${slug}/j/${shortcode}`;

    // Build a readable location string from the locations array
    let location: string | undefined;
    if (Array.isArray(j.locations) && j.locations.length > 0) {
      const locs = j.locations
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .filter((l: any) => !l.hidden)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((l: any) => [l.city, l.region, l.country].filter(Boolean).join(', '))
        .filter(Boolean);
      // Deduplicate and join
      location = [...new Set(locs)].join(' | ') || undefined;
    } else {
      location = [j.city, j.state, j.country].filter(Boolean).join(', ') || undefined;
    }

    const department: string | undefined = j.department || undefined;
    const commitment: string | undefined = j.employment_type || undefined;
    const workplace_type: string | undefined =
      j.telecommuting ? 'Remote' : undefined;

    // Convert HTML description to Markdown (available via ?details=true)
    let description: string | undefined;
    if (j.description) {
      description = nhm.translate(j.description).trim().slice(0, 20_000) || undefined;
    }

    jobs.push({ title, url: jobUrl, location, department, commitment, workplace_type, description });
  }

  return { jobs };
}

/**
 * Detect company name from the Workable API without fetching HTML.
 */
export async function workableApiDetect(url: string): Promise<{ company: string; error?: string }> {
  const slug = extractWorkableSlug(url);
  if (!slug) return { company: '', error: 'Could not extract company slug from Workable URL' };

  const apiUrl = `https://apply.workable.com/api/v1/widget/accounts/${slug}`;
  const { data, error } = await fetchJson(apiUrl);

  if (!error && data) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const name = (data as any)?.name;
    if (name) return { company: name };
  }

  // Fallback: prettify slug
  const fallback = slug.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  return { company: fallback };
}

/**
 * Workable HTML parser (fallback — not typically needed since we have the API).
 * The Workable board is a React SPA, so HTML parsing won't yield much.
 * This is kept as a stub that returns an empty list; the API path is preferred.
 */
export function workableParser(_html: string, _baseUrl: string): ParsedJob[] {
  // Workable boards are React SPAs — no server-rendered job listings in HTML.
  // The API-based fetch is the primary path; this is just a registry placeholder.
  return [];
}
