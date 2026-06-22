import * as cheerio from 'cheerio';
import { ParsedJob } from '../types';
import { fetchHtml, fetchJson } from '../fetch-utils';

/**
 * Check if a Personio board URL redirects to a different domain.
 * The entire *.jobs.personio.{de|com} infrastructure was deprecated — all
 * subdomains now 301-redirect to https://personio.de.  Detecting this early
 * avoids the expensive fetchHtml retry loop (10 attempts, exponential backoff)
 * that would otherwise burn minutes before returning an error.
 *
 * Uses a single HEAD request with redirect: 'manual' so the redirect is NOT
 * followed — we just inspect the Location header.
 */
async function isPersonioBoardDeprecated(boardUrl: string): Promise<boolean> {
  try {
    const response = await fetch(boardUrl, {
      method: 'HEAD',
      redirect: 'manual',
      signal: AbortSignal.timeout(8_000),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; JobScan/1.0)' },
    });
    // 3xx redirect to a different domain means the board is gone
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location') ?? '';
      try {
        const origHost = new URL(boardUrl).hostname;
        const redirHost = new URL(location, boardUrl).hostname;
        // If redirecting to a completely different domain (e.g. personio.de)
        // the board is deprecated
        if (redirHost !== origHost && !redirHost.endsWith(`.${origHost}`)) {
          return true;
        }
      } catch {
        // Malformed Location header — treat as deprecated to be safe
        return true;
      }
    }
  } catch {
    // Network error on pre-flight — fall through to normal fetch
  }
  return false;
}

function resolveUrl(href: string, baseUrl: string): string {
  if (!href) return '';
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return href;
  }
}

/**
 * Normalise a Personio board base URL.
 * Strips trailing slashes and any path segments so we always get
 * "https://{slug}.jobs.personio.{de|com}".
 */
function normaliseBaseUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.hostname}`;
  } catch {
    return url.replace(/\/+$/, '');
  }
}

/**
 * Extract the company slug from a Personio job board URL.
 * Handles:
 *   https://{slug}.jobs.personio.de
 *   https://{slug}.jobs.personio.com
 */
function extractPersonioSlug(url: string): string | null {
  try {
    const u = new URL(url);
    const match = u.hostname.match(/^([a-z0-9-]+)\.jobs\.personio\.(de|com)$/i);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

/**
 * Build commitment string from Personio fields (employmentType + schedule).
 * Examples: "permanent, full-time", "intern", "full-time"
 */
function buildCommitment(employmentType?: string, schedule?: string): string | undefined {
  const parts: string[] = [];
  if (employmentType) parts.push(employmentType);
  if (schedule && schedule.toLowerCase() !== employmentType?.toLowerCase()) {
    parts.push(schedule);
  }
  return parts.length > 0 ? parts.join(', ') : undefined;
}

/**
 * Build the full location string from the primary office + additional offices.
 */
function buildLocation(office?: string, additionalOffices?: string[]): string | undefined {
  const all = new Set<string>();
  if (office) all.add(office.trim());
  if (additionalOffices) {
    for (const o of additionalOffices) {
      const trimmed = o.trim();
      if (trimmed && !all.has(trimmed)) all.add(trimmed);
    }
  }
  return all.size > 0 ? [...all].join('; ') : undefined;
}

/**
 * Detect workplace type from location / office strings.
 */
function detectWorkplaceType(location?: string): string | undefined {
  if (!location) return undefined;
  const lower = location.toLowerCase();
  if (/\bremote\b/.test(lower) && /\bhybrid\b/.test(lower)) return 'hybrid';
  if (/\bfully\s+remote\b/.test(lower) || /\b100%?\s*remote\b/.test(lower)) return 'remote';
  if (/\bremote\b/.test(lower)) return 'remote';
  if (/\bhybrid\b/.test(lower)) return 'hybrid';
  if (/\bon[\s-]?site\b/.test(lower) || /\bin[\s-]?office\b/.test(lower)) return 'on-site';
  return undefined;
}

// ── Individual job HTML fallback (for jobs with empty XML descriptions) ───────

/**
 * Fetch the description for a single Personio job page.
 * Used when the XML feed has an empty <jobDescriptions> element.
 *
 * Strategy: extract the Schema.org JSON-LD `JobPosting.description` that
 * Personio embeds in every job page — it's authoritative, already HTML, and
 * available in the language requested via ?display=en.
 *
 * Falls back to scraping `.detail-block-description` elements when JSON-LD is
 * absent (older Personio layouts).
 */
async function fetchPersonioJobDescription(
  jobUrl: string,
  nhm: import('node-html-markdown').NodeHtmlMarkdown,
): Promise<string | undefined> {
  const { html, error } = await fetchHtml(`${jobUrl}?display=en`);
  if (error || !html) return undefined;

  // ── JSON-LD (preferred) ────────────────────────────────────────────────────
  const ldMatch = html.match(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/i);
  if (ldMatch) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ld = JSON.parse(ldMatch[1]) as any;
      if (ld?.['@type'] === 'JobPosting' && ld.description) {
        return nhm.translate(String(ld.description)).trim().slice(0, 20_000) || undefined;
      }
    } catch {
      // fall through to DOM scraping
    }
  }

  // ── DOM fallback: .detail-block-description elements ──────────────────────
  const $ = cheerio.load(html);
  const parts: string[] = [];
  $('.detail-content-block').each((_i, el) => {
    const title = $(el).find('.detail-block-title').text().trim();
    const body = $(el).find('.detail-block-description').html() ?? '';
    if (body) {
      if (title) parts.push(`## ${title}\n\n${nhm.translate(body)}`);
      else parts.push(nhm.translate(body));
    }
  });
  if (parts.length > 0) return parts.join('\n\n').trim().slice(0, 20_000);

  return undefined;
}

// ── XML-based API fetch (preferred — single call, full data) ──────────────────

/**
 * Fetch ALL jobs from a Personio board via the public XML feed.
/**
 * Check whether a URL points to Personio's own corporate careers page
 * at www.personio.com/about-personio/careers/ (or personio.com/careers/).
 */
export function isPersonioComUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return /^(?:www\.)?personio\.com$/i.test(u.hostname) &&
      /\/(?:about-personio\/)?careers\b/.test(u.pathname);
  } catch {
    return false;
  }
}

// ── Personio.com corporate JSON API ──────────────────────────────────────────

/** Shape of a single job from the /api/careers/jobs/list/ endpoint. */
interface PersonioComJob {
  slug: string;
  id: string;          // UUID
  name: string;
  office: string;
  otherOffices: string[];
  allOffices: string[];
  employmentType: string;
  department: string;
  compensation: string;
  createdAt: string;   // ISO date (YYYY-MM-DD)
}

/**
 * Fetch jobs from Personio's own corporate careers API.
 * Endpoint: https://www.personio.com/api/careers/jobs/list/
 *
 * Returns all open positions as JSON — single call, no pagination, no
 * auth required, no Vercel bot-protection on the API endpoint.
 */
export async function personioComApiFetch(
  url: string,
): Promise<{ jobs: ParsedJob[]; error?: string }> {
  const apiUrl = 'https://www.personio.com/api/careers/jobs/list/';

  const { data, error } = await fetchJson(apiUrl);
  if (error) return { jobs: [], error };
  if (!Array.isArray(data)) {
    return { jobs: [], error: 'Unexpected response from Personio corporate API' };
  }

  const rawJobs = data as PersonioComJob[];
  const jobs: ParsedJob[] = rawJobs
    .filter((j) => j.name && j.id)
    .map((j) => {
      const location = buildLocation(j.office, j.otherOffices);
      return {
        title: j.name,
        url: `https://www.personio.com/careers/${j.id}/`,
        location,
        department: j.department || undefined,
        commitment: j.employmentType || undefined,
        workplace_type: detectWorkplaceType(location),
      };
    });

  return { jobs };
}

// ── XML-based API fetch (preferred for *.jobs.personio.{de|com} boards) ──────

/**
 * Fetch ALL jobs from a Personio board via the public XML feed.
 * Endpoint: https://{slug}.jobs.personio.{de|com}/xml
 *
 * This returns every open position with full descriptions, department,
 * location, employment type, schedule, seniority, etc. — one call, no
 * pagination, no rate-limit issues.
 */
export async function personioApiFetch(
  url: string,
): Promise<{ jobs: ParsedJob[]; error?: string }> {
  // Dispatch to the corporate API for personio.com URLs
  if (isPersonioComUrl(url)) {
    return personioComApiFetch(url);
  }

  const base = normaliseBaseUrl(url);
  const xmlUrl = `${base}/xml`;

  // Fast pre-flight: detect deprecated boards (*.jobs.personio.de → personio.de)
  // so we don't waste minutes on fetchHtml's exponential backoff retries.
  if (await isPersonioBoardDeprecated(xmlUrl)) {
    return {
      jobs: [],
      error:
        'This Personio career page is no longer available — ' +
        '*.jobs.personio.de has been deprecated. ' +
        'The company may have moved to a different career page platform.',
    };
  }

  const { html: xmlText, error } = await fetchHtml(xmlUrl);
  if (error) return { jobs: [], error };
  if (!xmlText || !xmlText.includes('<workzag-jobs')) {
    return { jobs: [], error: 'Response is not a valid Personio XML feed' };
  }

  return parsePersonioXml(xmlText, base);
}

/**
 * Parse the Personio XML feed into ParsedJob[].
 */
async function parsePersonioXml(
  xmlText: string,
  baseUrl: string,
): Promise<{ jobs: ParsedJob[]; error?: string }> {
  const $ = cheerio.load(xmlText, { xmlMode: true });
  const positions = $('position');
  if (positions.length === 0) {
    return { jobs: [], error: 'No <position> elements found in XML' };
  }

  const { NodeHtmlMarkdown } = await import('node-html-markdown');
  const nhm = new NodeHtmlMarkdown({ bulletMarker: '-' });
  const jobs: ParsedJob[] = [];
  // Track which jobs need a description fetched from their HTML page
  const needsDescFetch: number[] = [];

  positions.each((_i, el) => {
    const $pos = $(el);

    const id = $pos.find('> id').text().trim();
    const title = $pos.find('> name').text().trim();
    if (!title || !id) return; // skip malformed entries

    // Job detail URL
    const jobUrl = `${baseUrl}/job/${id}`;

    // Location: primary office + additional offices
    const primaryOffice = $pos.find('> office').text().trim() || undefined;
    const additionalOffices: string[] = [];
    $pos.find('> additionalOffices > office').each((_j, officeEl) => {
      const text = $(officeEl).text().trim();
      if (text) additionalOffices.push(text);
    });
    const location = buildLocation(primaryOffice, additionalOffices);

    // Department
    const department = $pos.find('> department').text().trim() || undefined;

    // Team (subcompany in Personio)
    const team = $pos.find('> subcompany').text().trim() || undefined;

    // Commitment: employmentType + schedule
    const employmentType = $pos.find('> employmentType').text().trim() || undefined;
    const schedule = $pos.find('> schedule').text().trim() || undefined;
    const commitment = buildCommitment(employmentType, schedule);

    // Workplace type inferred from location strings
    const workplace_type = detectWorkplaceType(location);

    // Description: concatenate all jobDescription sections
    const descParts: string[] = [];
    $pos.find('jobDescription').each((_j, descEl) => {
      const sectionName = $(descEl).find('> name').text().trim();
      const sectionHtml = $(descEl).find('> value').text().trim(); // CDATA content
      if (sectionHtml) {
        if (sectionName) {
          descParts.push(`## ${sectionName}\n\n${nhm.translate(sectionHtml)}`);
        } else {
          descParts.push(nhm.translate(sectionHtml));
        }
      }
    });
    const description = descParts.length > 0
      ? descParts.join('\n\n').trim().slice(0, 20_000) || undefined
      : undefined;

    const jobIndex = jobs.length;
    jobs.push({
      title,
      url: jobUrl,
      location,
      department,
      team,
      commitment,
      workplace_type,
      description,
    });

    // If the XML had no description, queue this job for an HTML fallback fetch
    if (!description) needsDescFetch.push(jobIndex);
  });

  // ── Fallback: fetch individual HTML pages for jobs with empty XML descriptions
  if (needsDescFetch.length > 0) {
    const CONCURRENCY = 5;
    for (let i = 0; i < needsDescFetch.length; i += CONCURRENCY) {
      const batch = needsDescFetch.slice(i, i + CONCURRENCY);
      await Promise.all(
        batch.map(async (idx) => {
          const job = jobs[idx];
          const desc = await fetchPersonioJobDescription(job.url, nhm);
          if (desc) job.description = desc;
        }),
      );
    }
  }

  return { jobs };
}

// ── Detect company name from the XML feed ─────────────────────────────────────

/**
 * Try to detect the company name from the Personio XML feed.
 * Looks at the first position's subcompany, or falls back to prettifying the slug.
 */
export async function personioApiDetect(
  url: string,
): Promise<{ company: string; error?: string }> {
  // Personio's own corporate careers page
  if (isPersonioComUrl(url)) {
    return { company: 'Personio' };
  }

  const slug = extractPersonioSlug(url);
  if (!slug) return { company: '', error: 'Could not extract slug from Personio URL' };

  const base = normaliseBaseUrl(url);
  const xmlUrl = `${base}/xml`;

  // Fast pre-flight: detect deprecated boards so detection doesn't hang.
  if (await isPersonioBoardDeprecated(xmlUrl)) {
    const fallback = slug.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    return {
      company: fallback,
      error:
        'This Personio career page is no longer available — ' +
        '*.jobs.personio.de has been deprecated.',
    };
  }

  const { html: xmlText, error } = await fetchHtml(xmlUrl);
  if (error) {
    const fallback = slug.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    return { company: fallback };
  }

  const $ = cheerio.load(xmlText, { xmlMode: true });
  // Try subcompany from the first position
  const subcompany = $('position > subcompany').first().text().trim();
  if (subcompany) return { company: subcompany };

  // Fallback: prettify the slug
  const fallback = slug.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  return { company: fallback };
}

// ── HTML fallback parser ──────────────────────────────────────────────────────

/**
 * Personio HTML fallback parser.
 *
 * The career page at https://{slug}.jobs.personio.{de|com} renders a list of
 * job positions. Each position is typically inside an anchor element with
 * class "job-box-link" containing the title, location, and schedule info.
 */
export function personioParser(html: string, baseUrl: string): ParsedJob[] {
  const $ = cheerio.load(html);
  const jobs: ParsedJob[] = [];
  const base = normaliseBaseUrl(baseUrl);

  // Personio uses <a class="job-box-link" href="/job/{id}"> elements
  $('a[href*="/job/"]').each((_i, el) => {
    const $el = $(el);
    const href = $el.attr('href') ?? '';
    if (!href.match(/\/job\/\d+/)) return;

    const jobUrl = resolveUrl(href, base);

    // Title is usually in a prominent heading or span inside the link
    const title =
      $el.find('h2, h3, h4, [class*="title"], [class*="name"]').first().text().trim() ||
      $el.find('span').first().text().trim() ||
      $el.text().trim().split('\n')[0]?.trim() || '';

    if (!title) return;

    // Location and schedule are usually in secondary elements
    const locationEl = $el.find('[class*="location"], [class*="office"]').first();
    const location = locationEl.text().trim() || undefined;

    const scheduleEl = $el.find('[class*="schedule"], [class*="type"]').first();
    const commitment = scheduleEl.text().trim() || undefined;

    const departmentEl = $el.find('[class*="department"]').first();
    const department = departmentEl.text().trim() || undefined;

    const workplace_type = detectWorkplaceType(location);

    jobs.push({ title, url: jobUrl, location, department, commitment, workplace_type });
  });

  // De-duplicate by URL (some pages might list the same job in different categories)
  const seen = new Set<string>();
  return jobs.filter((j) => {
    if (seen.has(j.url)) return false;
    seen.add(j.url);
    return true;
  });
}
