import { ParsedJob } from '../types';
import { fetchHtml, sleep } from '../fetch-utils';
import * as cheerio from 'cheerio';
import { NodeHtmlMarkdown } from 'node-html-markdown';

const nhm = new NodeHtmlMarkdown({ bulletMarker: '-' });

/** Heuristic: does the string contain HTML tags (vs already-Markdown text)? */
const HTML_TAG_RE = /<[a-z][\s\S]*>/i;

/**
 * Normalize a YC job detail description to Markdown.
 * YC detail pages embed escaped HTML (e.g. &lt;p&gt;) in the data-page JSON;
 * some descriptions are already Markdown — only convert when HTML tags are
 * present so nhm never mangles MD.
 */
function normalizeDescription(raw: string): string {
  if (!raw) return '';
  return HTML_TAG_RE.test(raw) ? nhm.translate(raw).trim() : raw;
}

/**
 * Extract the company slug from a YCombinator jobs URL.
 * Handles: https://www.ycombinator.com/companies/{slug}/jobs
 *          https://www.ycombinator.com/companies/{slug}/jobs/{job-slug}
 */
function extractYCSlug(url: string): string | null {
  try {
    const u = new URL(url);
    if (!u.hostname.match(/^(www\.)?ycombinator\.com$/i)) return null;
    const m = u.pathname.match(/^\/companies\/([a-z0-9_-]+)/i);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

/**
 * Decode the embedded React data-page JSON from YC HTML.
 *
 * YCombinator uses a server-rendered React div with a `data-page` attribute
 * containing HTML-entity-encoded JSON with all page props:
 *   <div id="WaasShowJobsPage-react-component-..." data-page="{&quot;component&quot;:...}">
 */
function extractPageProps(html: string): Record<string, unknown> | null {
  const $ = cheerio.load(html);
  const el = $('[data-page]').first();
  if (!el.length) return null;

  const raw = el.attr('data-page');
  if (!raw) return null;

  try {
    const data = JSON.parse(raw) as { props?: Record<string, unknown> };
    return data.props ?? null;
  } catch {
    return null;
  }
}

// ── Metadata header builder ───────────────────────────────────────────────────

/**
 * Build a structured metadata header from YC job fields.
 * Prepended to the description so all searchable metadata is stored.
 *
 * Fields (only included when present):
 *   Salary, Equity, Location, Job type, Role, Experience, Visa, Skills, Contact
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildMetadataHeader(j: any): string {
  const lines: string[] = [];
  if (j.salaryRange) lines.push(`Salary: ${j.salaryRange}`);
  if (j.equityRange) lines.push(`Equity: ${j.equityRange}`);
  if (j.location?.trim()) lines.push(`Location: ${j.location.trim()}`);
  if (j.type) lines.push(`Job type: ${j.type}`);
  const roleParts: string[] = [];
  if (j.prettyRole) roleParts.push(j.prettyRole);
  if (j.roleSpecificType) roleParts.push(j.roleSpecificType);
  if (roleParts.length > 0) lines.push(`Role: ${roleParts.join(', ')}`);
  if (j.minExperience) lines.push(`Experience: ${j.minExperience}`);
  if (j.visa) lines.push(`Visa: ${j.visa}`);
  if (Array.isArray(j.skills) && j.skills.length > 0) lines.push(`Skills: ${j.skills.join(', ')}`);
  if (j.hiringManager) {
    const hm = j.hiringManager;
    const name = [hm.first_name, hm.last_name].filter(Boolean).join(' ');
    if (name) lines.push(`Contact: ${name}`);
  }
  return lines.join('\n');
}

// ── Public functions ──────────────────────────────────────────────────────────

/**
 * Fetch jobs from a YCombinator company jobs page.
 *
 * YC doesn't have a public REST API for jobs. Instead, the listing page at
 * `/companies/{slug}/jobs` embeds all job data as server-rendered JSON in
 * a `data-page` attribute (React on Rails pattern).
 *
 * The listing only provides metadata (title, location, role, salary, etc.)
 * but NOT descriptions. Descriptions are available on individual job pages.
 * We fetch descriptions for each job with a small delay to be polite.
 */
export async function ycombinatorApiFetch(url: string): Promise<{ jobs: ParsedJob[]; error?: string }> {
  const slug = extractYCSlug(url);
  if (!slug) return { jobs: [], error: 'Could not extract company slug from YCombinator URL' };

  const listingUrl = `https://www.ycombinator.com/companies/${slug}/jobs`;
  const { html, error } = await fetchHtml(listingUrl);
  if (error) return { jobs: [], error };

  const props = extractPageProps(html);
  if (!props) return { jobs: [], error: 'Could not extract page data from HTML' };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawJobs: any[] = (props.jobPostings as any[]) ?? [];
  const jobs: ParsedJob[] = [];

  // Keep raw job data around to build metadata headers after description fetch
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawJobMap: Map<string, any> = new Map();

  for (const j of rawJobs) {
    const title: string = j.title?.trim() ?? '';
    const relUrl: string = j.url ?? '';
    if (!title || !relUrl) continue;

    const jobUrl = `https://www.ycombinator.com${relUrl}`;
    const location: string | undefined = j.location?.trim() || undefined;
    const commitment: string | undefined = j.type || undefined;
    const department: string | undefined = j.prettyRole || undefined;

    jobs.push({ title, url: jobUrl, location, commitment, department });
    rawJobMap.set(jobUrl, j);
  }

  // Fetch descriptions from individual job pages with throttling
  for (const job of jobs) {
    await sleep(300); // polite delay
    const { html: detailHtml } = await fetchHtml(job.url, { maxRetries: 1 });

    let rawDesc = '';
    if (detailHtml) {
      const detailProps = extractPageProps(detailHtml);
      if (detailProps) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const detailJob = detailProps.job as any;
        if (detailJob?.description) rawDesc = normalizeDescription(detailJob.description.trim());
        // Detail page may have hiringManager not present in listing
        if (detailJob?.hiringManager && !rawJobMap.get(job.url)?.hiringManager) {
          rawJobMap.get(job.url).hiringManager = detailJob.hiringManager;
        }
      }
    }

    // Build metadata header + description body
    const rawJob = rawJobMap.get(job.url);
    const header = rawJob ? buildMetadataHeader(rawJob) : '';
    const parts = [header, rawDesc].filter(Boolean);
    job.description = parts.length > 0
      ? parts.join('\n---\n').slice(0, 20_000) || undefined
      : undefined;
  }

  return { jobs };
}

/**
 * Detect company name from a YCombinator company page.
 */
export async function ycombinatorDetect(url: string): Promise<{ company: string; error?: string }> {
  const slug = extractYCSlug(url);
  if (!slug) return { company: '', error: 'Could not extract company slug from YCombinator URL' };

  const listingUrl = `https://www.ycombinator.com/companies/${slug}/jobs`;
  const { html, error } = await fetchHtml(listingUrl);
  if (error) return { company: '', error };

  const props = extractPageProps(html);
  if (props) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const company = props.company as any;
    if (company?.name) return { company: company.name };
  }

  // Fallback: prettify slug
  const fallback = slug.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  return { company: fallback };
}

/**
 * YCombinator HTML parser (for the generic HTML scraping path).
 *
 * Extracts job data from the `data-page` attribute embedded in the
 * server-rendered HTML. This is the "offline" parser that works with
 * cached HTML — no network calls.
 *
 * Note: Descriptions are NOT available in the listing HTML; only on
 * individual job pages. The API fetch path (ycombinatorApiFetch)
 * handles description fetching.
 */
export function ycombinatorParser(html: string, baseUrl: string): ParsedJob[] {
  const props = extractPageProps(html);
  if (!props) return [];

  // Handle listing page (WaasShowJobsPage)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawJobs: any[] = (props.jobPostings as any[]) ?? [];

  // Handle single job page (WaasShowJobPage) — may also be passed to the parser
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const singleJob = props.job as any;
  if (rawJobs.length === 0 && singleJob) {
    const title: string = singleJob.title?.trim() ?? '';
    const relUrl: string = singleJob.url ?? '';
    if (!title || !relUrl) return [];

    const resolvedUrl = relUrl.startsWith('http')
      ? relUrl
      : `https://www.ycombinator.com${relUrl}`;

    const header = buildMetadataHeader(singleJob);
    const rawDesc = normalizeDescription(singleJob.description?.trim() ?? '');
    const parts = [header, rawDesc].filter(Boolean);
    const description = parts.length > 0
      ? parts.join('\n---\n').slice(0, 20_000) || undefined
      : undefined;

    return [{
      title,
      url: resolvedUrl,
      location: singleJob.location?.trim() || undefined,
      commitment: singleJob.type || undefined,
      department: singleJob.prettyRole || undefined,
      description,
    }];
  }

  const jobs: ParsedJob[] = [];

  for (const j of rawJobs) {
    const title: string = j.title?.trim() ?? '';
    const relUrl: string = j.url ?? '';
    if (!title || !relUrl) continue;

    const jobUrl = relUrl.startsWith('http')
      ? relUrl
      : `https://www.ycombinator.com${relUrl}`;

    const location: string | undefined = j.location?.trim() || undefined;
    const commitment: string | undefined = j.type || undefined;
    const department: string | undefined = j.prettyRole || undefined;

    jobs.push({ title, url: jobUrl, location, commitment, department });
  }

  return jobs;
}
