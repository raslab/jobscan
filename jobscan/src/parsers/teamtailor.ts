import * as cheerio from 'cheerio';
import { ParsedJob } from '../types';
import { fetchHtml } from '../fetch-utils';
import { NodeHtmlMarkdown } from 'node-html-markdown';

/**
 * Extract the company slug from a Teamtailor career-site URL.
 * Handles:
 *   https://{slug}.teamtailor.com
 *   https://{slug}.teamtailor.com/jobs
 *   https://{slug}.teamtailor.com/jobs/12345-some-title
 */
function extractTeamtailorSlug(url: string): string | null {
  try {
    const u = new URL(url);
    const match = u.hostname.match(/^([a-z0-9-]+)\.teamtailor\.com$/i);
    if (!match) return null;
    const slug = match[1];
    // Exclude CDN / asset subdomains
    if (['assets-aws', 'assets', 'www', 'api', 'app', 'screenshots'].includes(slug)) return null;
    return slug;
  } catch {
    return null;
  }
}

// ── Remote-status mapping ─────────────────────────────────────────────────────

function formatRemoteStatus(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const map: Record<string, string> = {
    fully: 'Remote',
    hybrid: 'Hybrid',
    onsite: 'On-site',
    none: 'On-site',
    temporarily: 'Temporarily Remote',
  };
  return map[raw.toLowerCase()] ?? raw;
}

// ── Location builder ──────────────────────────────────────────────────────────

interface TTLocation {
  name?: string;
  city?: string;
  country?: string;
}

function buildLocationString(locations: TTLocation[]): string | undefined {
  if (!locations.length) return undefined;
  const parts: string[] = [];
  for (const loc of locations) {
    // Prefer "City, Country" — fall back to name
    const label =
      loc.city && loc.country ? `${loc.city}, ${loc.country}` :
      loc.city || loc.country || loc.name || '';
    if (label && !parts.includes(label)) parts.push(label);
  }
  if (parts.length > 5) {
    return parts.slice(0, 5).join(' | ') + ` (+${parts.length - 5} more)`;
  }
  return parts.join(' | ') || undefined;
}

// ── RSS XML parser ────────────────────────────────────────────────────────────

/**
 * Parse jobs from a Teamtailor RSS XML feed.
 * Each <item> provides: title, link, description (full HTML), remoteStatus,
 * tt:department, tt:role, and tt:locations with structured address data.
 */
function parseRssXml(xml: string): { companyName: string; jobs: ParsedJob[] } {
  const $ = cheerio.load(xml, { xmlMode: true });
  const nhm = new NodeHtmlMarkdown({ bulletMarker: '-' });

  const companyName = $('channel > title').first().text().trim();
  const jobs: ParsedJob[] = [];

  $('item').each((_i, el) => {
    const $item = $(el);

    const title = $item.children('title').text().trim();
    const url = $item.children('link').text().trim();
    if (!title || !url) return;

    // Description — full HTML of the job posting
    const descHtml = $item.children('description').text().trim();
    let description: string | undefined;
    if (descHtml) {
      description = nhm.translate(descHtml).trim().slice(0, 20_000) || undefined;
    }

    // Remote / workplace type
    const remoteStatus = $item.children('remoteStatus').text().trim();
    const workplace_type = formatRemoteStatus(remoteStatus);

    // Department
    const department = $item.children('tt\\:department, department').text().trim() || undefined;

    // Team / role (Teamtailor calls it "role" in RSS)
    const team = $item.children('tt\\:role, role').text().trim() || undefined;

    // Locations — structured <tt:location> elements
    const locations: TTLocation[] = [];
    $item.find('tt\\:location, location').each((_j, locEl) => {
      const $loc = $(locEl);
      locations.push({
        name: $loc.children('tt\\:name, name').text().trim() || undefined,
        city: $loc.children('tt\\:city, city').text().trim() || undefined,
        country: $loc.children('tt\\:country, country').text().trim() || undefined,
      });
    });
    const location = buildLocationString(locations);

    jobs.push({ title, url, location, department, team, workplace_type, description });
  });

  return { companyName, jobs };
}

// ── Public API functions ──────────────────────────────────────────────────────

/**
 * Build the RSS feed URL for a Teamtailor career site.
 * Supports both *.teamtailor.com slugs and custom domains (e.g. careers.payfit.com).
 */
function buildRssUrl(url: string, params?: string): string | null {
  const slug = extractTeamtailorSlug(url);
  if (slug) {
    return `https://${slug}.teamtailor.com/jobs.rss${params ? `?${params}` : ''}`;
  }
  // Custom domain: construct RSS URL from the origin directly
  try {
    const u = new URL(url);
    return `${u.origin}/jobs.rss${params ? `?${params}` : ''}`;
  } catch {
    return null;
  }
}

/**
 * Fetch all jobs from a Teamtailor career site via its public RSS feed.
 * Supports both *.teamtailor.com slugs and custom domains (e.g. careers.payfit.com).
 *
 * Returns ALL jobs with full descriptions, department, location, remote status
 * in a single HTTP request — no per-job detail fetches needed.
 */
export async function teamtailorApiFetch(url: string): Promise<{ jobs: ParsedJob[]; error?: string }> {
  const rssUrl = buildRssUrl(url, 'per_page=500');
  if (!rssUrl) return { jobs: [], error: 'Could not build RSS URL from Teamtailor URL' };

  const { html: xml, error } = await fetchHtml(rssUrl);
  if (error) return { jobs: [], error };

  try {
    const { jobs } = parseRssXml(xml);
    return { jobs };
  } catch (err) {
    return { jobs: [], error: `Failed to parse Teamtailor RSS: ${String(err)}` };
  }
}

/**
 * Detect company name from a Teamtailor career site.
 * Uses the RSS feed <channel><title> which contains the human-readable name.
 * Supports both *.teamtailor.com slugs and custom domains.
 */
export async function teamtailorDetect(url: string): Promise<{ company: string; error?: string }> {
  const rssUrl = buildRssUrl(url);
  if (!rssUrl) return { company: '', error: 'Could not build RSS URL from Teamtailor URL' };

  const slug = extractTeamtailorSlug(url);
  const { html: xml, error } = await fetchHtml(rssUrl);
  if (error) {
    // Fallback: prettify slug or hostname
    const fallbackBase = slug ?? new URL(url).hostname.replace(/^(www|careers)\./, '').split('.')[0];
    const fallback = fallbackBase.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    return { company: fallback };
  }

  try {
    const $ = cheerio.load(xml, { xmlMode: true });
    const name = $('channel > title').first().text().trim();
    if (name) return { company: name };
  } catch { /* fall through */ }

  // Fallback: prettify slug or hostname
  const fallbackBase = slug ?? new URL(url).hostname.replace(/^(www|careers)\./, '').split('.')[0];
  const fallback = fallbackBase.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  return { company: fallback };
}

// ── HTML parser (fallback for the generic HTML scraping path) ─────────────────

/**
 * Teamtailor HTML parser.
 *
 * Teamtailor career sites render job listings server-side as HTML with a
 * consistent structure. Each job card is an <a> linking to /jobs/{id}-{slug},
 * containing a title element and location/status metadata.
 *
 * The HTML parsing path is only used as a fallback when the RSS-based API
 * fetch (teamtailorApiFetch) is not available. The RSS feed is strongly
 * preferred because it returns all jobs with full descriptions in one call.
 */
export function teamtailorParser(html: string, baseUrl: string): ParsedJob[] {
  const $ = cheerio.load(html);
  const jobs: ParsedJob[] = [];
  const seenUrls = new Set<string>();

  // Teamtailor renders job cards as links to /jobs/{id}-{slug}
  $('a[href*="/jobs/"]').each((_i, el) => {
    const $el = $(el);
    const href = $el.attr('href') ?? '';

    // Only match actual job detail links: /jobs/{numeric-id}-{title-slug}
    if (!/\/jobs\/\d+/.test(href)) return;

    const url = resolveUrl(href, baseUrl);
    if (!url || seenUrls.has(url)) return;
    seenUrls.add(url);

    // Title — typically in a heading or a prominent text element inside the card
    let title =
      $el.find('span, h3, h4, div').first().text().trim() ||
      $el.text().trim();

    // Clean up: remove location text if it leaked into the title
    const locationSpan = $el.find('[class*="location"], [class*="department"]').text().trim();
    if (locationSpan && title.endsWith(locationSpan)) {
      title = title.slice(0, -locationSpan.length).trim();
    }

    if (!title) return;

    jobs.push({ title, url });
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
