import * as cheerio from 'cheerio';
import { ParsedJob } from '../types';
import { fetchHtml } from '../fetch-utils';
import { NodeHtmlMarkdown } from 'node-html-markdown';

/**
 * Jobylon ATS parser.
 *
 * URL patterns:
 *   https://emp.jobylon.com/companies/{id}/
 *   https://emp.jobylon.com/companies/{id}-{slug}/
 *   Custom domains embedding Jobylon via cdn.jobylon.com/embedder.js
 *
 * ── How it works ─────────────────────────────────────────────────────────────
 *
 * Jobylon provides a public embed widget for companies to display job listings.
 * The v1 embed endpoint returns a JavaScript file containing pre-rendered HTML
 * with all published jobs for a given company ID:
 *
 *   GET https://cdn.jobylon.com/jobs/companies/{companyId}/embed/v1/?page_size=100
 *   Content-Type: text/javascript
 *
 * The JavaScript wraps an HTML string assigned to `html_embed`, containing a
 * `.jobylon-job-list` div with one `.jobylon-job` per job. Each job div has:
 *
 *   - .jobylon-job-title          → title
 *   - .jobylon-apply-btn[href]    → URL to emp.jobylon.com/jobs/{id}-{slug}/
 *   - .jobylon-location           → "Location: City" (may include "+N more")
 *   - .jobylon-function           → "Function: Department Name"
 *   - .jobylon-experience         → "Experience: Level"
 *   - .jobylon-job-excerpt        → truncated HTML description
 *   - .jobylon-job-summary        → plain-text summary (often "NA")
 *
 * For full job descriptions, individual job pages at emp.jobylon.com/jobs/{id}/
 * contain JSON-LD structured data (schema.org/JobPosting) with the full HTML
 * description. The API fetcher can optionally fetch these for richer data.
 *
 * Field mapping:
 *   title       ← .jobylon-job-title text
 *   url         ← first .jobylon-apply-btn href (not the application link)
 *   location    ← .jobylon-location text (after "Location:" prefix)
 *   department  ← .jobylon-function text (after "Function:" prefix)
 *   commitment  ← .jobylon-experience text (after "Experience:" prefix)
 */

const EMBED_BASE = 'https://cdn.jobylon.com/jobs/companies';
const EMP_BASE = 'https://emp.jobylon.com';

// ── URL helpers ───────────────────────────────────────────────────────────────

/**
 * Extract the Jobylon company ID from a URL.
 *
 * Supported patterns:
 *   emp.jobylon.com/companies/505/
 *   emp.jobylon.com/companies/505-withsecure/
 *   cdn.jobylon.com/jobs/companies/505/embed/...
 */
export function extractCompanyId(url: string): string | null {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();

    // emp.jobylon.com/companies/{id}[-slug]/
    if (host === 'emp.jobylon.com') {
      const m = u.pathname.match(/^\/companies\/(\d+)/);
      return m ? m[1] : null;
    }

    // cdn.jobylon.com/jobs/companies/{id}/embed/...
    if (host === 'cdn.jobylon.com') {
      const m = u.pathname.match(/^\/jobs\/companies\/(\d+)\//);
      return m ? m[1] : null;
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Build the v1 embed widget URL for a Jobylon company.
 */
function buildEmbedUrl(companyId: string, pageSize = 100): string {
  return `${EMBED_BASE}/${companyId}/embed/v1/?page_size=${pageSize}`;
}

// ── Embed HTML extraction ─────────────────────────────────────────────────────

/**
 * Extract the HTML content from a Jobylon v1 embed JS response.
 *
 * The v1 endpoint returns JavaScript like:
 *   (function(){ ... var html_embed = '<div class="jobylon-job-list">...</div>'; ... })()
 *
 * We extract the HTML string assigned to `html_embed`.
 */
export function extractEmbedHtml(jsContent: string): string {
  const marker = "var html_embed = '";
  const startIdx = jsContent.indexOf(marker);
  if (startIdx === -1) return '';

  const htmlStart = startIdx + marker.length;
  // Find the closing single quote — the HTML string uses JS-escaped single quotes
  // We need to find the unescaped closing quote: ';
  const endMarker = "';";
  let searchFrom = htmlStart;
  let endIdx = -1;

  while (searchFrom < jsContent.length) {
    const pos = jsContent.indexOf(endMarker, searchFrom);
    if (pos === -1) break;
    // Check it's not escaped (preceded by backslash)
    if (pos > 0 && jsContent[pos - 1] === '\\') {
      searchFrom = pos + 1;
      continue;
    }
    endIdx = pos;
    break;
  }

  if (endIdx === -1) return '';

  const rawHtml = jsContent.substring(htmlStart, endIdx);
  // Unescape JS string escapes
  return rawHtml
    .replace(/\\'/g, "'")
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\\\/g, '\\');
}

// ── Strip "label:" prefix ─────────────────────────────────────────────────────

function stripPrefix(text: string, prefix: string): string {
  const trimmed = text.trim();
  const re = new RegExp(`^${prefix}:\\s*`, 'i');
  return trimmed.replace(re, '').trim();
}

// ── HTML parser ───────────────────────────────────────────────────────────────

/**
 * Parse jobs from Jobylon embed widget HTML.
 *
 * This parser works on the HTML extracted from the v1 embed JS response,
 * or any page containing the `.jobylon-job-list` structure.
 */
export function jobylonParser(html: string, _baseUrl: string): ParsedJob[] {
  if (!html || !html.includes('jobylon-job')) return [];

  const $ = cheerio.load(html);
  const jobs: ParsedJob[] = [];

  $('.jobylon-job').each((_i, el) => {
    const $job = $(el);

    const title = $job.find('.jobylon-job-title').first().text().trim();
    if (!title) return;

    // Get the "Read more" link (not the "Apply" link)
    const readMoreBtn = $job.find('.jobylon-apply-btn').not('.jobylon-actual-apply-btn').first();
    let url = readMoreBtn.attr('href') || '';
    if (!url) return;
    // Ensure absolute URL
    if (url.startsWith('/')) {
      url = `${EMP_BASE}${url}`;
    }

    // Location — strip "Location:" prefix
    const locationEl = $job.find('.jobylon-location').first();
    const locationRaw = locationEl.text().trim();
    const location = locationRaw ? stripPrefix(locationRaw, 'Location') : undefined;

    // Department / Function — strip "Function:" prefix
    const functionEl = $job.find('.jobylon-function').first();
    const functionRaw = functionEl.text().trim();
    const department = functionRaw ? stripPrefix(functionRaw, 'Function') : undefined;

    // Experience / Commitment — strip "Experience:" prefix
    const experienceEl = $job.find('.jobylon-experience').first();
    const experienceRaw = experienceEl.text().trim();
    const commitment = experienceRaw ? stripPrefix(experienceRaw, 'Experience') : undefined;

    jobs.push({
      title,
      url,
      location: location || undefined,
      department: department || undefined,
      commitment: commitment || undefined,
    });
  });

  return jobs;
}

// ── API fetch (primary entry point) ──────────────────────────────────────────

/**
 * Fetch all jobs from a Jobylon company using the public embed widget API.
 *
 * Accepts:
 *   - emp.jobylon.com/companies/{id}/ URLs → extracts company ID
 *   - cdn.jobylon.com/jobs/companies/{id}/embed/ URLs → extracts company ID
 *
 * Returns all published jobs with title, url, location, department, experience.
 */
export async function jobylonApiFetch(
  url: string,
): Promise<{ jobs: ParsedJob[]; error?: string }> {
  const companyId = extractCompanyId(url);
  if (!companyId) {
    return { jobs: [], error: `Could not extract Jobylon company ID from URL: ${url}` };
  }

  const embedUrl = buildEmbedUrl(companyId);
  console.log(`[jobylon] Fetching embed widget from ${embedUrl}`);

  const { html: jsContent, error } = await fetchHtml(embedUrl);
  if (error || !jsContent) {
    return { jobs: [], error: error || 'Empty response from Jobylon embed endpoint' };
  }

  const embedHtml = extractEmbedHtml(jsContent);
  if (!embedHtml) {
    return { jobs: [], error: 'Could not extract HTML from Jobylon embed response' };
  }

  const jobs = jobylonParser(embedHtml, url);

  if (jobs.length === 0) {
    // Check if the response has the "no jobs" marker
    if (jsContent.includes('jobylon-no-jobs')) {
      return { jobs: [], error: undefined }; // Zero jobs is valid, not an error
    }
    return { jobs: [], error: 'Parsed 0 jobs from embed HTML' };
  }

  return { jobs };
}

// ── Detection (company name extraction) ──────────────────────────────────────

/**
 * Detect the company name from a Jobylon employer page URL.
 *
 * Extracts the company name from the URL slug (e.g. "387-detectify" → "Detectify")
 * or falls back to fetching the page title.
 */
export async function jobylonDetect(
  url: string,
): Promise<{ company: string; error?: string }> {
  // Try to get company name from URL slug: /companies/{id}-{slug}/
  try {
    const u = new URL(url);
    const m = u.pathname.match(/^\/companies\/\d+-([a-z0-9_-]+)/i);
    if (m) {
      const slug = m[1];
      const prettified = slug
        .replace(/[-_]+/g, ' ')
        .replace(/\b\w/g, c => c.toUpperCase());
      return { company: prettified };
    }
  } catch { /* */ }

  // Fallback: try fetching the page to extract <title>
  const companyId = extractCompanyId(url);
  if (!companyId) {
    return { company: '', error: 'Could not extract Jobylon company ID from URL' };
  }

  const { html, error } = await fetchHtml(`${EMP_BASE}/companies/${companyId}/`);
  if (error || !html) {
    return { company: '', error: error || 'Empty response' };
  }

  // Title is usually: "CompanyName | Jobylon"
  const titleMatch = html.match(/<title>\s*([^<|]+)/i);
  if (titleMatch) {
    const name = titleMatch[1].trim();
    if (name && name.toLowerCase() !== 'jobylon') {
      return { company: name };
    }
  }

  return { company: '', error: 'Could not extract company name' };
}
