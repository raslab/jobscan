import { ParsedJob } from '../types';
import { fetchHtml, fetchJson } from '../fetch-utils';
import { NodeHtmlMarkdown } from 'node-html-markdown';

/**
 * Extract the company slug from an Ashby job board URL.
 * Handles: https://jobs.ashbyhq.com/{slug}
 *          https://jobs.ashbyhq.com/{slug}/{posting-uuid}
 */
function extractAshbySlug(url: string): string | null {
  try {
    const u = new URL(url);
    if (!u.hostname.match(/^jobs\.ashbyhq\.com$/i)) return null;
    const parts = u.pathname.split('/').filter(Boolean);
    return parts[0] || null;
  } catch {
    return null;
  }
}

// ── Formatting helpers ────────────────────────────────────────────────────────

function formatEmploymentType(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  const map: Record<string, string> = {
    FullTime: 'Full-time',
    PartTime: 'Part-time',
    Contract: 'Contract',
    Intern: 'Intern',
    Temporary: 'Temporary',
  };
  return map[raw] ?? raw;
}

function formatWorkplaceType(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  const map: Record<string, string> = {
    Remote: 'Remote',
    Hybrid: 'Hybrid',
    OnSite: 'On-site',
  };
  return map[raw] ?? raw;
}

/**
 * Build a human-readable location string from primary + secondary locations.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildLocationString(primary: string | undefined, secondaryLocations: any[] | undefined): string | undefined {
  const names: string[] = [];
  if (primary) names.push(primary);
  if (Array.isArray(secondaryLocations)) {
    for (const loc of secondaryLocations) {
      // API uses `location`, HTML __appData uses `locationName`
      const name = loc.location || loc.locationName || loc.locationExternalName;
      if (name && !names.includes(name)) names.push(name);
    }
  }
  if (names.length > 5) {
    return names.slice(0, 5).join(' | ') + ` (+${names.length - 5} more)`;
  }
  return names.join(' | ') || undefined;
}

// ── Public functions ──────────────────────────────────────────────────────────

/**
 * Fetch jobs from the Ashby public posting API.
 * GET https://api.ashbyhq.com/posting-api/job-board/{slug}
 *
 * Returns ALL jobs with full descriptions (descriptionHtml) in a single call.
 * No per-job detail fetches needed — descriptions are included in the listing.
 */
export async function ashbyApiFetch(url: string): Promise<{ jobs: ParsedJob[]; error?: string }> {
  const slug = extractAshbySlug(url);
  if (!slug) return { jobs: [], error: 'Could not extract company slug from Ashby URL' };

  const apiUrl = `https://api.ashbyhq.com/posting-api/job-board/${slug}`;
  const { data, error } = await fetchJson(apiUrl);
  if (error) return { jobs: [], error };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const payload = data as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawJobs: any[] = payload?.jobs ?? [];

  const nhm = new NodeHtmlMarkdown({ bulletMarker: '-' });
  const jobs: ParsedJob[] = [];

  for (const j of rawJobs) {
    if (!j.isListed) continue;

    const title: string = j.title?.trim() ?? '';
    const postingId: string = j.id ?? '';
    if (!title || !postingId) continue;

    const jobUrl: string = j.jobUrl || `https://jobs.ashbyhq.com/${slug}/${postingId}`;
    const location = buildLocationString(j.location, j.secondaryLocations);
    const department: string | undefined = j.department || undefined;
    const team: string | undefined = j.team || undefined;
    const commitment = formatEmploymentType(j.employmentType);
    const workplace_type = formatWorkplaceType(j.workplaceType);

    // Descriptions come right in the listing — convert HTML to Markdown
    let description: string | undefined;
    const descHtml: string = j.descriptionHtml ?? '';
    if (descHtml) {
      description = nhm.translate(descHtml).trim().slice(0, 20_000) || undefined;
    }

    jobs.push({ title, url: jobUrl, location, department, team, commitment, workplace_type, description });
  }

  return { jobs };
}

/**
 * Detect company name from an Ashby board.
 * The posting API doesn't return the company name, so we extract
 * `organization.name` from the `window.__appData` embedded in the HTML.
 * Only called once when adding a source — not during sync.
 */
export async function ashbyDetect(url: string): Promise<{ company: string; error?: string }> {
  const slug = extractAshbySlug(url);
  if (!slug) return { company: '', error: 'Could not extract company slug from Ashby URL' };

  // Verify slug is valid via the API (fast)
  const apiUrl = `https://api.ashbyhq.com/posting-api/job-board/${slug}`;
  const { error: apiError } = await fetchJson(apiUrl);
  if (apiError) return { company: '', error: apiError };

  // API doesn't include org name → fetch HTML to get it from __appData
  const boardUrl = `https://jobs.ashbyhq.com/${slug}`;
  const { html } = await fetchHtml(boardUrl);
  if (html) {
    const m = html.match(/window\.__appData\s*=\s*(\{.*?\});\s*(?:const|var|let|<)/s);
    if (m) {
      try {
        const appData = JSON.parse(m[1]);
        const name: string = appData?.organization?.name;
        if (name) return { company: name };
      } catch { /* fall through to slug fallback */ }
    }
  }

  // Fallback: prettify slug
  const fallback = slug.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  return { company: fallback };
}

/**
 * Ashby HTML parser (fallback for the generic HTML scraping path).
 * Extracts `window.__appData` from server-rendered HTML. The API path
 * (ashbyApiFetch) is preferred since it includes descriptions too.
 */
export function ashbyParser(html: string, baseUrl: string): ParsedJob[] {
  const m = html.match(/window\.__appData\s*=\s*(\{.*?\});\s*(?:const|var|let|<)/s);
  if (!m) return [];

  const slug = extractAshbySlug(baseUrl);
  if (!slug) return [];

  let appData;
  try {
    appData = JSON.parse(m[1]);
  } catch {
    return [];
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const postings: any[] = appData?.jobBoard?.jobPostings ?? [];
  const jobs: ParsedJob[] = [];

  for (const p of postings) {
    if (!p.isListed) continue;
    const title: string = p.title?.trim() ?? '';
    const postingId: string = p.id ?? '';
    if (!title || !postingId) continue;

    const jobUrl = `https://jobs.ashbyhq.com/${slug}/${postingId}`;
    const location = buildLocationString(
      p.locationExternalName || p.locationName,
      p.secondaryLocations,
    );
    const department: string | undefined = p.departmentExternalName || p.departmentName || undefined;
    const team: string | undefined = p.teamExternalName || p.teamName || undefined;
    const commitment = formatEmploymentType(p.employmentType);
    const workplace_type = formatWorkplaceType(p.workplaceType);

    jobs.push({ title, url: jobUrl, location, department, team, commitment, workplace_type });
  }

  return jobs;
}
