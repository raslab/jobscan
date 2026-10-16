import { ParsedJob } from '../types';
import { fetchHtml, fetchJson, sleep } from '../fetch-utils';
import * as cheerio from 'cheerio';
import { NodeHtmlMarkdown } from 'node-html-markdown';

const nhm = new NodeHtmlMarkdown({ bulletMarker: '-' });

/** Heuristic: does the string contain HTML tags (vs already-Markdown text)? */
const HTML_TAG_RE = /<[a-z][\s\S]*>/i;

/**
 * Normalize a Getro API description to Markdown.
 * Some boards (e.g. jobs.protocol.ai) already return Markdown — only convert
 * when the payload actually contains HTML tags, so nhm never mangles MD.
 */
function normalizeDescription(raw: string): string {
  if (!raw) return '';
  return HTML_TAG_RE.test(raw) ? nhm.translate(raw).trim() : raw;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const GETRO_API_BASE = 'https://api.getro.com/api/v1';
/** Polite delay between individual job-detail API calls (ms). */
const THROTTLE_MS = 300;

/**
 * Known Getro-powered VC board domains.
 * Map from hostname → default collection_id (used as fallback if __NEXT_DATA__
 * doesn't provide the network.id).
 * Add new boards here — no other code changes required.
 */
const KNOWN_DOMAINS: Record<string, number> = {
  'talent.cherry.vc': 44081,
  'hv.getro.com': 234,
  'jobs.earlybird.com': 617,
  'careers.play.vc': 1624,
  'jobs.femtechinsider.com': 14612,
  'jobs.protocol.ai': 1336,
  'impactjobs.doen.nl': 9662,
  'jobs.venturesplatform.com': 10784,
  'jobs.sapphireventures.com': 199,
};

// ── Types ─────────────────────────────────────────────────────────────────────

export interface GetroCompany {
  id: number;
  name: string;
  description?: string;
  slug: string;
  domain?: string;
  founded?: string;
  stage?: string;
  industryTags?: string[];
  approxEmployees?: number;
  activeJobsCount?: number;
  locations?: Array<{ id: string; name: string }>;
  jobFunctions?: Array<{ id: string; name: string }>;
  websiteUrl?: string;
  linkedinUrl?: string;
}

interface GetroNetwork {
  id: string;
  label?: string;
  description?: string;
  slug?: string;
}

export interface GetroPageProps {
  company?: GetroCompany;
  network?: GetroNetwork;
  host?: string;
  protocol?: string;
}

interface GetroJobDetail {
  title: string;
  slug: string;
  url: string;
  description: string;
  id: number;
  status: string;
  source: string;
  posted_at: string;
  locations: Array<{ id: number; name: string; place_id?: string; description?: string }>;
  organization: {
    id: number;
    name: string;
    domain?: string;
    slug: string;
    logo_url?: string;
  };
  job_functions: Array<{ id: number; name: string }>;
  employment_types: string[];
  compensation_currency: string | null;
  compensation_period: string | null;
  compensation_amount_min_cents: number | null;
  compensation_amount_max_cents: number | null;
  compensation_offers_equity: boolean | null;
  compensation_public: boolean;
}

// ── URL helpers ───────────────────────────────────────────────────────────────

/**
 * Check if a hostname is a known Getro board domain.
 */
export function isGetroHostname(hostname: string): boolean {
  return hostname in KNOWN_DOMAINS;
}

/**
 * Extract hostname and company slug from any Getro board URL.
 * Returns null if the URL doesn't match a known Getro domain + /companies/ path.
 */
export function parseGetroUrl(url: string): { hostname: string; companySlug: string } | null {
  try {
    const u = new URL(url);
    if (!isGetroHostname(u.hostname)) return null;
    const m = u.pathname.match(/^\/companies\/([a-z0-9_-]+)/i);
    if (!m) return null;
    return { hostname: u.hostname, companySlug: m[1] };
  } catch {
    return null;
  }
}

// ── __NEXT_DATA__ extraction ──────────────────────────────────────────────────

/**
 * Extract pageProps from the __NEXT_DATA__ script tag in a Getro board HTML page.
 * Works for all Getro-powered boards (Cherry VC, HV Capital, Earlybird, Play VC, etc.).
 */
export function extractNextData(html: string): GetroPageProps | null {
  const $ = cheerio.load(html);
  const script = $('script#__NEXT_DATA__').first();
  if (!script.length) return null;

  const raw = script.html();
  if (!raw) return null;

  try {
    const data = JSON.parse(raw);
    return data?.props?.pageProps ?? null;
  } catch {
    return null;
  }
}

// ── Metadata header builder ──────────────────────────────────────────────────

/**
 * Build a structured metadata header from Getro job API fields + company info.
 * Prepended to the description so all searchable metadata is stored.
 */
export function buildMetadataHeader(
  job: GetroJobDetail,
  company?: GetroCompany,
): string {
  const lines: string[] = [];

  // Compensation
  if (job.compensation_amount_min_cents != null || job.compensation_amount_max_cents != null) {
    const currency = job.compensation_currency?.toUpperCase() || 'USD';
    const period = job.compensation_period && job.compensation_period !== 'period_not_defined'
      ? `/${job.compensation_period}` : '';
    const min = job.compensation_amount_min_cents != null
      ? `${currency} ${(job.compensation_amount_min_cents / 100).toLocaleString('en-US')}` : '';
    const max = job.compensation_amount_max_cents != null
      ? `${currency} ${(job.compensation_amount_max_cents / 100).toLocaleString('en-US')}` : '';
    if (min && max) {
      lines.push(`Salary: ${min} - ${max}${period}`);
    } else if (min || max) {
      lines.push(`Salary: ${min || max}${period}`);
    }
  }
  if (job.compensation_offers_equity === true) {
    lines.push('Equity: Yes');
  }

  // Location
  if (job.locations?.length > 0) {
    lines.push(`Location: ${job.locations.map(l => l.name).join(', ')}`);
  }

  // Department (job functions — filter out parenthesized duplicates)
  const departments = job.job_functions
    ?.filter(jf => !jf.name.startsWith('('))
    .map(jf => jf.name) ?? [];
  if (departments.length > 0) {
    lines.push(`Department: ${departments.join(', ')}`);
  }

  // Employment types
  if (job.employment_types?.length > 0) {
    lines.push(`Job type: ${job.employment_types.join(', ')}`);
  }

  // Company metadata (from VC board — richer than original job pages)
  if (company) {
    if (company.industryTags?.length) {
      lines.push(`Industry: ${company.industryTags.join(', ')}`);
    }
    if (company.stage && company.stage !== 'other') {
      lines.push(`Stage: ${company.stage.replace(/_/g, ' ')}`);
    }
    if (company.approxEmployees) {
      lines.push(`Company size: ~${company.approxEmployees} employees`);
    }
    if (company.founded) {
      lines.push(`Founded: ${company.founded}`);
    }
  }

  return lines.join('\n');
}

// ── Sitemap parsing ──────────────────────────────────────────────────────────

/**
 * Extract job slugs for a specific company from a Getro sitemap XML.
 * Domain-agnostic: uses the provided base URL to construct the prefix.
 */
export function extractJobSlugsFromSitemap(
  sitemapXml: string,
  baseUrl: string,
  companySlug: string,
): string[] {
  const $ = cheerio.load(sitemapXml, { xmlMode: true });
  const prefix = `${baseUrl}/companies/${companySlug}/jobs/`;
  const slugs: string[] = [];

  $('url > loc').each((_, el) => {
    const loc = $(el).text().trim();
    if (loc.startsWith(prefix)) {
      const slug = loc.slice(prefix.length);
      if (slug) slugs.push(slug);
    }
  });

  return slugs;
}

// ── Public functions ─────────────────────────────────────────────────────────

/**
 * Fetch jobs from any Getro-powered VC board company page.
 *
 * Strategy:
 *   1. Parse the URL → extract hostname + company slug
 *   2. Fetch the company HTML → extract __NEXT_DATA__ → company metadata + network ID
 *   3. Fetch the sitemap.xml → filter for company slug → get all job slugs
 *   4. For each job slug, call the Getro v1 API → full job detail with description
 *   5. Build metadata headers with company info + job data
 */
export async function getroApiFetch(url: string): Promise<{ jobs: ParsedJob[]; error?: string }> {
  const parsed = parseGetroUrl(url);
  if (!parsed) return { jobs: [], error: 'Could not parse Getro board URL' };

  const { hostname, companySlug } = parsed;
  const baseUrl = `https://${hostname}`;
  const fallbackCollectionId = KNOWN_DOMAINS[hostname] ?? 0;

  // Step 1: Fetch company page → extract company metadata
  const companyUrl = `${baseUrl}/companies/${companySlug}`;
  const { html, error: htmlError } = await fetchHtml(companyUrl);
  if (htmlError) return { jobs: [], error: htmlError };

  const pageProps = extractNextData(html);
  const company = pageProps?.company ?? undefined;
  const networkId = pageProps?.network?.id
    ? parseInt(pageProps.network.id, 10)
    : fallbackCollectionId;

  // Step 2: Fetch sitemap → extract job slugs for this company
  const sitemapUrl = `${baseUrl}/sitemap.xml`;
  const { html: sitemapXml, error: sitemapError } = await fetchHtml(sitemapUrl);
  if (sitemapError) return { jobs: [], error: `Failed to fetch sitemap: ${sitemapError}` };

  const jobSlugs = extractJobSlugsFromSitemap(sitemapXml, baseUrl, companySlug);
  if (jobSlugs.length === 0) {
    return { jobs: [], error: `No jobs found in sitemap for company: ${companySlug}` };
  }

  // Step 3: Fetch each job detail from the Getro v1 API
  const jobs: ParsedJob[] = [];

  for (const slug of jobSlugs) {
    await sleep(THROTTLE_MS);

    const apiUrl = `${GETRO_API_BASE}/jobs/${slug}?collection_id=${networkId}`;
    const { data, error: apiError } = await fetchJson(apiUrl, {
      maxRetries: 1,
      headers: { 'Accept': 'application/json' },
    });

    if (apiError || !data) continue;

    const jobData = data as GetroJobDetail;
    if (!jobData.title || !jobData.slug) continue;

    const title = jobData.title.trim();
    const jobUrl = `${baseUrl}/companies/${companySlug}/jobs/${jobData.slug}`;

    // Build location string
    const location = jobData.locations?.map(l => l.name).join(', ') || undefined;

    // Map job_functions to department
    const deptNames = jobData.job_functions
      ?.filter(jf => !jf.name.startsWith('('))
      .map(jf => jf.name) ?? [];
    const department = deptNames.length > 0 ? deptNames.join(', ') : undefined;

    // Build metadata header + description
    const header = buildMetadataHeader(jobData, company);
    const rawDesc = normalizeDescription(jobData.description?.trim() ?? '');
    const parts = [header, rawDesc].filter(Boolean);
    const description = parts.length > 0
      ? parts.join('\n---\n').slice(0, 20_000) || undefined
      : undefined;

    jobs.push({
      title,
      url: jobUrl,
      location,
      department,
      description,
    });
  }

  return { jobs };
}

/**
 * Detect company name from any Getro board company page.
 */
export async function getroDetect(url: string): Promise<{ company: string; error?: string }> {
  const parsed = parseGetroUrl(url);
  if (!parsed) return { company: '', error: 'Could not parse Getro board URL' };

  const { hostname, companySlug } = parsed;
  const companyUrl = `https://${hostname}/companies/${companySlug}`;
  const { html, error } = await fetchHtml(companyUrl);
  if (error) return { company: '', error };

  const pageProps = extractNextData(html);
  if (pageProps?.company?.name) {
    return { company: pageProps.company.name };
  }

  // Fallback: prettify slug
  const fallback = companySlug.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  return { company: fallback };
}

/**
 * Getro HTML parser (for the generic HTML scraping path).
 *
 * Jobs are NOT present in the server-rendered HTML (they are loaded
 * client-side via the Getro SPA). The API fetch path (getroApiFetch) handles
 * actual job fetching via the sitemap + Getro v1 API.
 */
export function getroParser(_html: string, _baseUrl: string): ParsedJob[] {
  return [];
}

/**
 * Get the list of known Getro domain hostnames.
 * Useful for URL detection and scrapeJobDetail skip patterns.
 */
export function getKnownDomains(): string[] {
  return Object.keys(KNOWN_DOMAINS);
}
