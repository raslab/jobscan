import * as cheerio from 'cheerio';
import { ParsedJob } from '../types';
import { fetchHtml } from '../fetch-utils';
import { NodeHtmlMarkdown } from 'node-html-markdown';

/**
 * TeamViewer ATS parser.
 *
 * TeamViewer hosts their careers page at https://careers.teamviewer.com which
 * is a custom-domain install of TeamTailor (the same backend used at
 * *.teamtailor.com, but served under teamviewer.com's subdomain).
 *
 * ── How it works ───────────────────────────────────────────────────────────
 *
 * TeamTailor exposes a public RSS feed at {origin}/jobs.rss that returns ALL
 * current job listings in a single request, with full HTML descriptions,
 * locations, department, remote status, and direct job URLs.
 *
 * RSS feed: https://careers.teamviewer.com/jobs.rss
 *
 * Each <item> provides:
 *   <title>         – job title
 *   <link>          – direct URL to the job posting
 *   <description>   – full HTML description (CDATA-encoded)
 *   <remoteStatus>  – "hybrid" | "fully" | "onsite" | "none"
 *   <tt:department> – department name
 *   <tt:role>       – team/role name (often empty)
 *   <tt:locations>  – structured location elements:
 *                       <tt:city>, <tt:country>, <tt:name>
 *
 * This is a single-request approach — no per-job detail fetches needed.
 *
 * ── URL pattern ────────────────────────────────────────────────────────────
 *
 * Supported input URL:  https://careers.teamviewer.com[/...]
 *
 * The parser derives the RSS endpoint as: https://careers.teamviewer.com/jobs.rss
 */

// ── Remote-status normalisation ───────────────────────────────────────────────

function formatRemoteStatus(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const map: Record<string, string> = {
    fully: 'Remote',
    hybrid: 'Hybrid',
    onsite: 'On-site',
    none: 'On-site',
    temporarily: 'Temporarily Remote',
  };
  return (map[raw.trim().toLowerCase()] ?? raw.trim()) || undefined;
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
 * Parse jobs from a TeamTailor-format RSS XML feed.
 * Identical structure to *.teamtailor.com/jobs.rss but served from a custom domain.
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

    // Team / role
    const team = $item.children('tt\\:role, role').text().trim() || undefined;

    // Locations — structured <tt:location> elements
    const locations: TTLocation[] = [];
    $item.find('tt\\:location, location').each((_j, locEl) => {
      const $loc = $(locEl);
      locations.push({
        name:    $loc.children('tt\\:name, name').text().trim() || undefined,
        city:    $loc.children('tt\\:city, city').text().trim() || undefined,
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
 * Fetch all jobs from careers.teamviewer.com via the TeamTailor RSS feed.
 * Endpoint: https://careers.teamviewer.com/jobs.rss
 *
 * Returns all jobs with full descriptions in a single HTTP request.
 */
export async function teamviewerApiFetch(url: string): Promise<{ jobs: ParsedJob[]; error?: string }> {
  let origin: string;
  try {
    origin = new URL(url).origin;
  } catch {
    return { jobs: [], error: 'Invalid TeamViewer careers URL' };
  }

  // TeamTailor RSS feeds default to 100 items. Use per_page=500 to get all jobs.
  const rssUrl = `${origin}/jobs.rss?per_page=500`;
  const { html: xml, error } = await fetchHtml(rssUrl);
  if (error) return { jobs: [], error };

  try {
    const { jobs } = parseRssXml(xml);
    return { jobs };
  } catch (err) {
    return { jobs: [], error: `Failed to parse TeamViewer RSS: ${String(err)}` };
  }
}

/**
 * Detect company name from careers.teamviewer.com via the RSS feed channel title.
 * Returns "TeamViewer" as fallback if the feed is unreachable.
 */
export async function teamviewerDetect(url: string): Promise<{ company: string; error?: string }> {
  let origin: string;
  try {
    origin = new URL(url).origin;
  } catch {
    return { company: 'TeamViewer', error: 'Invalid TeamViewer careers URL' };
  }

  const rssUrl = `${origin}/jobs.rss`;
  const { html: xml, error } = await fetchHtml(rssUrl);
  if (error) {
    return { company: 'TeamViewer' };
  }

  try {
    const $ = cheerio.load(xml, { xmlMode: true });
    const name = $('channel > title').first().text().trim();
    if (name) return { company: name };
  } catch { /* fall through */ }

  return { company: 'TeamViewer' };
}

// ── HTML parser (fallback) ────────────────────────────────────────────────────

/**
 * Fallback HTML parser for careers.teamviewer.com.
 * Only used if the RSS feed is unavailable. Parses TeamTailor job card links.
 */
export function teamviewerParser(html: string, baseUrl: string): ParsedJob[] {
  const $ = cheerio.load(html);
  const jobs: ParsedJob[] = [];
  const seenUrls = new Set<string>();

  $('a[href*="/jobs/"]').each((_i, el) => {
    const $el = $(el);
    const href = $el.attr('href') ?? '';
    if (!/\/jobs\/\d+/.test(href)) return;

    const url = resolveUrl(href, baseUrl);
    if (!url || seenUrls.has(url)) return;
    seenUrls.add(url);

    let title =
      $el.find('span, h3, h4, div').first().text().trim() ||
      $el.text().trim();

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
