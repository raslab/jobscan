import { ParsedJob } from '../types';
import { fetchHtml, fetchJson } from '../fetch-utils';
import { NodeHtmlMarkdown } from 'node-html-markdown';

/**
 * TalentsConnect (job-shop.com / my-job-shop.com) ATS parser.
 *
 * ── Platform ─────────────────────────────────────────────────────────────────
 *
 * TalentsConnect is a German ATS/career-site platform that powers custom-domain
 * career portals (e.g. jobs.neura-robotics.com, jobs.example.com) built with
 * Nuxt.js.  All job data is stored in a Typesense search index and queried via:
 *   https://api.my-job-shop.com/api/typesense/collections/offers/documents/search
 *
 * ── How detection works ───────────────────────────────────────────────────────
 *
 * The carrier page embeds:
 *   - CSS/JS from: https://api.my-job-shop.com/new-cf/_nuxt/…
 *   - Images/fonts from: https://cdn.job-shop.com/ or https://tc-media.job-shop.com/
 *   - A <script id="__NUXT_DATA__" type="application/json"> payload
 *   - A footer privacy link pointing to: https://www.talentsconnect-ag.de/…
 *
 * ── How it works ─────────────────────────────────────────────────────────────
 *
 * 1. Fetch the careers page HTML (e.g. https://jobs.neura-robotics.com/search).
 *
 * 2. Locate the inline Nuxt SSR payload:
 *      <script id="__NUXT_DATA__" type="application/json">[...]</script>
 *    Parse it as a JSON array.  The array encodes all store state as a flat
 *    list of values with index-based references.
 *
 * 3. Walk the JSON array to extract:
 *    - jobShopId  — a UUID like "013afa23-9bcb-476e-ad6f-9965eacc5874"
 *    - typesenseApiKey  — a Typesense scoped key; accessed via the key
 *      "typesenseApiKey-{jobShopId}" in the data object
 *    - jobShopUrl  — the canonical base URL (e.g. https://jobs.neura-robotics.com/)
 *
 * 4. Query the Typesense API in batches of 250 until all jobs are fetched:
 *      GET https://api.my-job-shop.com/api/typesense/collections/offers/documents/search
 *        ?q=*&per_page=250&page={N}
 *      Header: X-TYPESENSE-API-KEY: {typesenseApiKey}
 *
 *    The scoped key already embeds a filter_by clause that restricts results
 *    to the specific tenant and vanity:
 *      {"filter_by":"tenant_id:=neura-robotics&&backoffice_vanity:=career"}
 *    so no additional filter_by parameter is needed.
 *
 * 5. Map each Typesense hit.document to a ParsedJob:
 *    - title      → document.title
 *    - url        → constructed as {jobShopUrl}offer/{title_slug}/{offer_uuid}
 *    - location   → document.location[0] (city name)
 *    - department → document.department[0]
 *    - description → document.description (HTML → Markdown)
 *
 * ── Job document shape (relevant fields) ────────────────────────────────────
 *
 *   {
 *     "offer_uuid": "9a1d73d0-...",
 *     "title": "Software Product Manager",
 *     "title_slug": "software-product-manager-robotics-human",
 *     "location": ["Metzingen"],
 *     "department": ["Product"],
 *     "work_mode": [],
 *     "description": "<span>...</span>",    // full HTML description
 *     "status": "ACTIVE"
 *   }
 */

const TYPESENSE_API_URL =
  'https://api.my-job-shop.com/api/typesense/collections/offers/documents/search';

const NHM = new NodeHtmlMarkdown({ bulletMarker: '-' });

// ── NUXT data extraction ──────────────────────────────────────────────────────

interface NuxtExtracted {
  jobShopId: string;
  typesenseApiKey: string;
  jobShopUrl: string;
}

/**
 * Parse the flat NUXT SSR JSON array and extract typesenseApiKey and jobShopUrl.
 *
 * The `__NUXT_DATA__` payload is a flat JSON array where values reference each
 * other by index.  Object entries appear as plain JS objects within the array.
 * The API key is stored as a long base64 string directly in the array (>=80 chars).
 * The jobShopUrl is the `https://jobs.example.com/` origin URL.
 *
 * We walk the array looking for:
 *  1. API key  — the one very long base64-only string with no dots/https
 *  2. jobShopUrl — https://jobs.example.com/ (trailing slash, "jobs." in hostname)
 *
 * jobShopId is NOT required for the actual API call and is therefore optional.
 */
function extractNuxtData(html: string): NuxtExtracted | null {
  // Locate the NUXT DATA script tag
  const match = html.match(/<script[^>]+id="__NUXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
  if (!match) return null;

  let arr: unknown[];
  try {
    arr = JSON.parse(match[1]);
  } catch {
    return null;
  }

  if (!Array.isArray(arr)) return null;

  let typesenseApiKey: string | null = null;
  let jobShopUrl: string | null = null;
  // jobShopId is optional — found by scanning object keys in the array
  let jobShopId: string | null = null;

  for (const val of arr) {
    // ── Object elements: scan keys for typesenseApiKey-{uuid} ──────────────
    if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
      for (const key of Object.keys(val as Record<string, unknown>)) {
        const m = key.match(/^typesenseApiKey-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
        if (m && !jobShopId) {
          jobShopId = m[1];
          // The value is an index into the array pointing to the API key string
          const idx = (val as Record<string, unknown>)[key];
          if (typeof idx === 'number' && typeof arr[idx] === 'string') {
            typesenseApiKey = arr[idx] as string;
          }
        }
      }
    }

    if (typeof val !== 'string') continue;

    // ── Long base64-only string → API key (fallback if object scan failed) ─
    if (
      !typesenseApiKey &&
      val.length > 80 &&
      /^[A-Za-z0-9+/=]{40,}$/.test(val) &&
      !val.includes('https') &&
      !val.includes('.')
    ) {
      typesenseApiKey = val;
    }

    // ── jobShopUrl: https://{something-with-jobs.}/  ───────────────────────
    if (
      !jobShopUrl &&
      /^https?:\/\/[a-z0-9.-]+\/$/i.test(val) &&
      val.includes('jobs.')
    ) {
      jobShopUrl = val;
    }
  }

  // Fallback: extract jobShopUrl via regex if not found in array walk
  if (!jobShopUrl) {
    const urlMatch = html.match(/"jobShopUrl"\s*:\s*"(https?:\/\/[^"]+)"/);
    if (urlMatch) jobShopUrl = urlMatch[1].replace(/\/+$/, '') + '/';
  }

  // Fallback: extract API key via regex if not found in array walk
  if (!typesenseApiKey) {
    const keyMatch = html.match(/typesenseApiKey[^"]*"\s*:\s*"([A-Za-z0-9+/=]{80,})"/);
    if (keyMatch) typesenseApiKey = keyMatch[1];
  }

  if (!typesenseApiKey || !jobShopUrl) return null;

  return { jobShopId: jobShopId ?? '', typesenseApiKey, jobShopUrl };
}

// ── Typesense query ───────────────────────────────────────────────────────────

interface TypesenseHit {
  document: {
    offer_uuid?: string;
    title?: string;
    title_slug?: string;
    location?: string[];
    location_objects?: Array<{ city?: string; country?: string; name?: string }>;
    department?: string[];
    work_mode?: string[];
    description?: string;
    status?: string;
    company?: string;
  };
}

interface TypesenseResponse {
  found?: number;
  hits?: TypesenseHit[];
  page?: number;
  out_of?: number;
}

async function fetchAllJobs(
  typesenseApiKey: string,
  baseUrl: string,
): Promise<{ jobs: ParsedJob[]; error?: string }> {
  const PER_PAGE = 250;
  const jobs: ParsedJob[] = [];
  let page = 1;
  let totalFound = Infinity;

  while (jobs.length < totalFound) {
    const url = `${TYPESENSE_API_URL}?q=*&per_page=${PER_PAGE}&page=${page}`;

    const { data, error } = await fetchJson(url, {
      headers: { 'X-TYPESENSE-API-KEY': typesenseApiKey },
    });

    if (error) {
      if (jobs.length > 0) break; // Partial success — return what we have
      return { jobs: [], error };
    }

    const resp = data as TypesenseResponse;
    if (typeof resp?.found === 'number' && totalFound === Infinity) {
      totalFound = resp.found;
    }

    const hits = resp?.hits ?? [];
    if (hits.length === 0) break;

    for (const hit of hits) {
      const doc = hit.document;
      if (!doc.title || !doc.offer_uuid) continue;
      if (doc.status && doc.status !== 'ACTIVE') continue;

      // Build canonical job URL
      const slug = doc.title_slug ?? doc.title.toLowerCase().replace(/\s+/g, '-');
      const jobUrl = `${baseUrl.replace(/\/+$/, '')}/offer/${slug}/${doc.offer_uuid}`;

      // Location: prefer first city name
      let location: string | undefined;
      if (doc.location && doc.location.length > 0) {
        location = doc.location[0];
      } else if (doc.location_objects && doc.location_objects.length > 0) {
        const loc = doc.location_objects[0];
        location = loc.city ?? loc.name;
      }

      // Department
      const department =
        doc.department && doc.department.length > 0 ? doc.department[0] : undefined;

      // Workplace type
      let workplace_type: string | undefined;
      if (doc.work_mode && doc.work_mode.length > 0) {
        const raw = doc.work_mode[0].toLowerCase();
        if (raw === 'remote') workplace_type = 'Remote';
        else if (raw === 'hybrid') workplace_type = 'Hybrid';
        else if (raw === 'onsite' || raw === 'on-site') workplace_type = 'On-site';
        else workplace_type = doc.work_mode[0];
      }

      // Description: HTML → Markdown
      let description: string | undefined;
      if (doc.description) {
        try {
          description = NHM.translate(doc.description).trim().slice(0, 20_000) || undefined;
        } catch {
          // Ignore markdown conversion errors
        }
      }

      jobs.push({ title: doc.title, url: jobUrl, location, department, workplace_type, description });
    }

    if (hits.length < PER_PAGE) break; // Last page
    page++;
  }

  return { jobs };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Fetch all jobs from a TalentsConnect career site.
 *
 * @param url The career site URL (e.g. https://jobs.neura-robotics.com/search)
 */
export async function talentsconnectApiFetch(
  url: string,
): Promise<{ jobs: ParsedJob[]; error?: string }> {
  // Normalize: always fetch the /search page for best NUXT data availability
  let fetchUrl = url;
  try {
    const u = new URL(url);
    if (!u.pathname.includes('search') && !u.pathname.includes('offer')) {
      fetchUrl = `${u.origin}/search`;
    }
  } catch { /* keep original */ }

  const { html, error: fetchError } = await fetchHtml(fetchUrl);
  if (fetchError) return { jobs: [], error: fetchError };

  const extracted = extractNuxtData(html);
  if (!extracted) {
    return {
      jobs: [],
      error: 'Could not extract TalentsConnect NUXT data from page — missing __NUXT_DATA__ or required fields',
    };
  }

  const { typesenseApiKey, jobShopUrl } = extracted;

  return fetchAllJobs(typesenseApiKey, jobShopUrl);
}

/**
 * Detect company name from a TalentsConnect career page.
 * Reads the og:title or the jobShopTitle from the NUXT data.
 */
export async function talentsconnectDetectCompany(
  url: string,
): Promise<{ company: string; error?: string }> {
  let fetchUrl = url;
  try {
    const u = new URL(url);
    if (!u.pathname.includes('search')) {
      fetchUrl = `${u.origin}/search`;
    }
  } catch { /* keep original */ }

  const { html, error: fetchError } = await fetchHtml(fetchUrl);
  if (fetchError) return { company: '', error: fetchError };

  // Try NUXT data first for the company title
  const titleMatch = html.match(/"jobShopTitle"\s*:\s*"([^"]+)"/);
  if (titleMatch) return { company: titleMatch[1] };

  // Fallback to og:title
  const ogMatch = html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i)
    ?? html.match(/<meta[^>]+content="([^"]+)"[^>]+property="og:title"/i);
  if (ogMatch) return { company: ogMatch[1].replace(/\s*[-|].*$/, '').trim() };

  // Fallback to <title>
  const htmlTitleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (htmlTitleMatch) return { company: htmlTitleMatch[1].replace(/\s*[-|].*$/, '').trim() };

  return { company: '', error: 'Could not extract company name' };
}

/**
 * HTML-based parser fallback (registered in parserRegistry).
 * TalentsConnect sites are Nuxt SPAs — HTML is mostly skeleton markup.
 * This parser always returns an empty array; the real work is done by
 * talentsconnectApiFetch() which is called first by the scraper.
 */
export function talentsconnectParser(_html: string, _baseUrl: string): ParsedJob[] {
  return [];
}
