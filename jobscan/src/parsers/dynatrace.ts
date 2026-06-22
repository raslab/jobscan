import { ParsedJob } from '../types';
import { fetchJson } from '../fetch-utils';

/**
 * Dynatrace careers parser.
 *
 * URL pattern: https://careers.dynatrace.com/
 *              https://www.dynatrace.com/careers/
 *              (both resolve to the same site; primary canonical: careers.dynatrace.com)
 *
 * ── How it works ──────────────────────────────────────────────────────────────
 *
 * Dynatrace's careers site is an Astro + React application backed by a Coveo
 * enterprise search platform.  A single POST request to the public Coveo proxy
 * endpoint returns all open positions (up to 1 000) in one shot:
 *
 *   POST https://www.dynatrace.com/api/coveo/search/
 *   Content-Type: application/json
 *   Body:
 *     {
 *       "q": "",
 *       "numberOfResults": 1000,
 *       "wildcards": true,
 *       "fieldsToInclude": ["team","office_locations","country","seniority",
 *                           "flex_option","employment_type","job_id","region",
 *                           "capability"],
 *       "facets": []
 *     }
 *
 * Response shape:
 *   {
 *     totalCount:  135,
 *     results: [
 *       {
 *         title:    "Principal Product Manager - Cloud Integration (m/f/x)",
 *         clickUri: "https://www.dynatrace.com/careers/jobs/1330130600",
 *         raw: {
 *           job_id:           "3420",
 *           team:             ["Product Management"],
 *           office_locations: ["Vienna", "Linz"],
 *           country:          ["Austria"],
 *           seniority:        ["Principal and Expert"],
 *           flex_option:      ["Hybrid"],           // "Hybrid" | "Remote" | "Office Based"
 *           employment_type:  ["Full-time"],
 *           region:           ["EMEA"],
 *           capability:       ["Data Acquisition"], // optional
 *         }
 *       },
 *       ...
 *     ]
 *   }
 *
 * All jobs and their listing-level metadata are returned in a single request.
 * Descriptions are not included in this endpoint and are not fetched here
 * (the individual job pages are Astro-rendered HTML — enrichment is left out
 * intentionally because 100+ full page fetches would be slow and rate-limiting
 * for a non-API source).
 *
 * Field mapping:
 *   title          ← title
 *   url            ← clickUri
 *   location       ← raw.office_locations joined with ", ", optionally suffixed
 *                    with raw.country[0] (e.g. "Vienna, Linz, Austria")
 *   workplace_type ← raw.flex_option[0]  ("Remote" | "Hybrid" | "On-site")
 *                    Note: "Office Based" is normalised to "On-site".
 *   department     ← raw.team[0]
 *   commitment     ← raw.employment_type[0]
 *   team           ← raw.capability[0] (optional sub-team / product area)
 */

const COVEO_API_URL = 'https://www.dynatrace.com/api/coveo/search/';

const COVEO_REQUEST_BODY = JSON.stringify({
  q: '',
  numberOfResults: 1000,
  wildcards: true,
  fieldsToInclude: [
    'team',
    'office_locations',
    'country',
    'seniority',
    'flex_option',
    'employment_type',
    'job_id',
    'region',
    'capability',
  ],
  facets: [],
});

// ── URL helpers ───────────────────────────────────────────────────────────────

/**
 * Check whether the given URL belongs to the Dynatrace careers site.
 */
export function isDynatraceUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    if (host === 'careers.dynatrace.com') return true;
    if (host === 'www.dynatrace.com' && /^\/careers/.test(u.pathname)) return true;
    return false;
  } catch {
    return false;
  }
}

// ── Field normalisation helpers ───────────────────────────────────────────────

/**
 * Normalise the flex_option value into the standard workplace_type vocabulary.
 *
 * Dynatrace API values:
 *   "Hybrid"       → "Hybrid"
 *   "Remote"       → "Remote"
 *   "Office Based" → "On-site"
 */
function normaliseWorkplaceType(flexOption: string | undefined): string | undefined {
  if (!flexOption) return undefined;
  if (/office\s*based/i.test(flexOption)) return 'On-site';
  return flexOption.trim() || undefined;
}

/**
 * Build a human-readable location string from office_locations and country.
 *
 * Examples:
 *   ["Boston"], ["United States"]  → "Boston, United States"
 *   ["Vienna", "Linz"], ["Austria"] → "Vienna, Linz, Austria"
 *   ["Bengaluru"], ["India"]        → "Bengaluru, India"
 */
function buildLocation(officeLocations: string[], country: string[]): string | undefined {
  const parts = [...(officeLocations ?? [])];
  const countryName = country?.[0]?.trim();
  if (countryName) parts.push(countryName);
  const loc = parts.filter(Boolean).join(', ').trim();
  return loc || undefined;
}

// ── Public API functions ──────────────────────────────────────────────────────

/**
 * Fetch all Dynatrace job listings via the Coveo search proxy in a single request.
 *
 * The `url` parameter is the Dynatrace careers page URL (e.g. careers.dynatrace.com
 * or www.dynatrace.com/careers/).  It is used only to validate the source; the
 * actual API call always targets the fixed Coveo proxy endpoint.
 *
 * No pagination is needed — all open positions are returned in one response.
 */
export async function dynatraceApiFetch(_url: string): Promise<{ jobs: ParsedJob[]; error?: string }> {
  const { data, error } = await fetchJson(COVEO_API_URL, {
    method: 'POST',
    body: COVEO_REQUEST_BODY,
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
  });

  if (error) return { jobs: [], error };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const payload = data as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawResults: any[] = payload?.results ?? [];

  const jobs: ParsedJob[] = [];

  for (const r of rawResults) {
    const title: string = (r.title ?? '').trim();
    const jobUrl: string = (r.clickUri ?? '').trim();
    if (!title || !jobUrl) continue;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw: Record<string, any> = r.raw ?? {};

    const officeLocations: string[] = (raw.office_locations ?? []).map((s: string) => s.trim()).filter(Boolean);
    const country: string[] = (raw.country ?? []).map((s: string) => s.trim()).filter(Boolean);

    const location = buildLocation(officeLocations, country);
    const workplaceType = normaliseWorkplaceType(raw.flex_option?.[0]);
    const department: string | undefined = (raw.team?.[0] ?? '').trim() || undefined;
    const commitment: string | undefined = (raw.employment_type?.[0] ?? '').trim() || undefined;
    // capability (e.g. "Data Acquisition") is stored as the sub-team field
    const team: string | undefined = (raw.capability?.[0] ?? '').trim() || undefined;

    jobs.push({
      title,
      url: jobUrl,
      location,
      workplace_type: workplaceType,
      department,
      commitment,
      team,
    });
  }

  return { jobs };
}

/**
 * HTML parser stub — Dynatrace's job listing page is a client-side React app;
 * the server-rendered HTML contains no job data.  This function always returns
 * an empty array and exists only to satisfy the ParserFn interface so the
 * registry can include 'dynatrace' without special-casing.
 *
 * The API-based `dynatraceApiFetch` is the primary (and only) fetch path.
 */
export function dynatraceParser(_html: string, _baseUrl: string): ParsedJob[] {
  return [];
}

// ── Detect ────────────────────────────────────────────────────────────────────

/**
 * Detect company name for Dynatrace — always returns "Dynatrace".
 */
export async function dynatraceDetect(_url: string): Promise<{ company: string; error?: string }> {
  return { company: 'Dynatrace' };
}
