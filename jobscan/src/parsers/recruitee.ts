import * as cheerio from 'cheerio';
import { ParsedJob } from '../types';
import { fetchJson } from '../fetch-utils';
import { NodeHtmlMarkdown } from 'node-html-markdown';

/**
 * Extract the company slug from a Recruitee career-site URL.
 * Handles:
 *   https://{slug}.recruitee.com
 *   https://{slug}.recruitee.com/o/{job-slug}
 */
function extractRecruiteeSlug(url: string): string | null {
  try {
    const u = new URL(url);
    const match = u.hostname.match(/^([a-z0-9-]+)\.recruitee\.com$/i);
    if (!match) return null;
    const slug = match[1];
    // Exclude non-company subdomains
    if (['www', 'api', 'app', 'admin', 'help', 'support', 'docs', 'blog'].includes(slug)) return null;
    return slug;
  } catch {
    return null;
  }
}

// ── Workplace-type mapping ────────────────────────────────────────────────────

function formatWorkplaceType(offer: { remote?: boolean; hybrid?: boolean; on_site?: boolean }): string | undefined {
  if (offer.remote) return 'Remote';
  if (offer.hybrid) return 'Hybrid';
  if (offer.on_site) return 'On-site';
  return undefined;
}

// ── Commitment / employment-type mapping ──────────────────────────────────────

function formatEmploymentType(code: string | undefined): string | undefined {
  if (!code) return undefined;
  const map: Record<string, string> = {
    fulltime_permanent: 'Full-time',
    fulltime_temporary: 'Full-time (Temporary)',
    parttime_permanent: 'Part-time',
    parttime_temporary: 'Part-time (Temporary)',
    freelance: 'Freelance',
    internship: 'Internship',
    apprenticeship: 'Apprenticeship',
    volunteer: 'Volunteer',
  };
  return map[code.toLowerCase()] ?? code.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// ── Location builder ──────────────────────────────────────────────────────────

interface RecruiteeLocation {
  city?: string;
  state?: string;
  country?: string;
  name?: string;
}

/**
 * Build a readable location string.
 * Prefers structured `locations[]` array (city, state, country) when available.
 * Falls back to the pre-formatted `locationStr` only when there are no entries
 * in the array and the string isn't just a workplace-type label (e.g. "Remote job").
 */
function buildLocation(
  locationStr: string | undefined,
  locations: RecruiteeLocation[]
): string | undefined {
  // Prefer the structured locations array — it contains city/state/country detail
  if (locations && locations.length > 0) {
    const parts: string[] = [];
    for (const loc of locations) {
      const label =
        [loc.city, loc.state, loc.country].filter(Boolean).join(', ')
        || loc.name || '';
      if (label && !parts.includes(label)) parts.push(label);
    }
    if (parts.length > 0) {
      if (parts.length > 5) {
        return parts.slice(0, 5).join(' | ') + ` (+${parts.length - 5} more)`;
      }
      return parts.join(' | ');
    }
  }

  // Fall back to pre-formatted string, but discard pure remote/workplace labels
  if (locationStr && !/^remote(\s+job)?$/i.test(locationStr.trim())) {
    return locationStr;
  }
  return undefined;
}

// ── Public API functions ──────────────────────────────────────────────────────

/**
 * Fetch all jobs from a Recruitee career site via its public JSON API.
 * Endpoint: https://{slug}.recruitee.com/api/offers
 *
 * Returns ALL jobs with full descriptions, department, location, employment type
 * in a single HTTP request — no per-job detail fetches needed.
 */
export async function recruiteeApiFetch(url: string): Promise<{ jobs: ParsedJob[]; error?: string }> {
  const slug = extractRecruiteeSlug(url);
  if (!slug) return { jobs: [], error: 'Could not extract company slug from Recruitee URL' };

  const apiUrl = `https://${slug}.recruitee.com/api/offers`;
  const { data, error } = await fetchJson(apiUrl);
  if (error) return { jobs: [], error };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = data as any;
  const offers: any[] = Array.isArray(raw?.offers) ? raw.offers : [];

  const nhm = new NodeHtmlMarkdown({ bulletMarker: '-' });
  const jobs: ParsedJob[] = [];

  for (const o of offers) {
    const title: string = o.title ?? '';
    // Prefer the careers_url (public-facing link), fall back to constructed URL
    const jobUrl: string =
      o.careers_url ||
      `https://${slug}.recruitee.com/o/${o.slug || o.id}`;
    if (!title || !jobUrl) continue;

    // Location
    const location = buildLocation(o.location, o.locations ?? []);

    // Department
    const department: string | undefined = o.department || undefined;

    // Workplace type (remote / hybrid / on-site)
    const workplace_type = formatWorkplaceType(o);

    // Commitment / employment type
    const commitment = formatEmploymentType(o.employment_type_code);

    // Description — combine description + requirements HTML
    let description: string | undefined;
    const descParts: string[] = [];
    if (o.description) {
      descParts.push(nhm.translate(o.description).trim());
    }
    if (o.requirements) {
      descParts.push(nhm.translate(o.requirements).trim());
    }
    if (descParts.length > 0) {
      description = descParts.join('\n\n').slice(0, 20_000) || undefined;
    }

    jobs.push({ title, url: jobUrl, location, department, workplace_type, commitment, description });
  }

  return { jobs };
}

/**
 * Detect company name from a Recruitee career site.
 * Uses the API to peek at the first offer's company_name field,
 * or falls back to prettifying the slug.
 */
export async function recruiteeDetect(url: string): Promise<{ company: string; error?: string }> {
  const slug = extractRecruiteeSlug(url);
  if (!slug) return { company: '', error: 'Could not extract company slug from Recruitee URL' };

  const apiUrl = `https://${slug}.recruitee.com/api/offers`;
  const { data, error } = await fetchJson(apiUrl);

  if (!error) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = data as any;
    const offers: any[] = Array.isArray(raw?.offers) ? raw.offers : [];
    if (offers.length > 0 && offers[0].company_name) {
      return { company: offers[0].company_name };
    }
  }

  // Fallback: prettify slug
  const fallback = slug.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  return { company: fallback };
}

// ── HTML parser (fallback for the generic HTML scraping path) ─────────────────

/**
 * Recruitee HTML parser.
 *
 * Recruitee career sites render job listings as HTML with links to /o/{job-slug}.
 * This is only used as a fallback when the API-based fetch (recruiteeApiFetch)
 * is not available. The API is strongly preferred because it returns all jobs
 * with full descriptions in one call.
 */
export function recruiteeParser(html: string, baseUrl: string): ParsedJob[] {
  const $ = cheerio.load(html);
  const jobs: ParsedJob[] = [];
  const seenUrls = new Set<string>();

  // Recruitee renders job cards as links to /o/{job-slug}
  $('a[href*="/o/"]').each((_i, el) => {
    const $el = $(el);
    const href = $el.attr('href') ?? '';

    // Match actual offer links: /o/{slug}
    if (!/\/o\/[a-z0-9-]+/i.test(href)) return;
    // Skip apply links (/o/{slug}/c/new)
    if (/\/c\/new/i.test(href)) return;

    const url = resolveUrl(href, baseUrl);
    if (!url || seenUrls.has(url)) return;
    seenUrls.add(url);

    // Title — typically in a heading or prominent text inside the card
    const title =
      $el.find('h2, h3, h4, span, div').first().text().trim() ||
      $el.text().trim();
    if (!title) return;

    // Try to extract department and location from sibling elements
    const department =
      $el.find('[class*="department"]').text().trim() || undefined;
    const location =
      $el.find('[class*="location"]').text().trim() || undefined;

    jobs.push({ title, url, department, location });
  });

  return jobs;
}

function resolveUrl(href: string, baseUrl: string): string {
  if (!href) return '';
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return href;
  }
}
