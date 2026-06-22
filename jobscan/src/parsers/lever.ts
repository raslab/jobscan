import * as cheerio from 'cheerio';
import { ParsedJob } from '../types';
import { fetchJson } from '../fetch-utils';

function resolveUrl(href: string, baseUrl: string): string {
  if (!href) return '';
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return href;
  }
}

/**
 * Extract the company slug and whether it's an EU board from a Lever URL.
 * Handles:
 *   https://jobs.lever.co/{company}
 *   https://jobs.eu.lever.co/{company}
 */
function extractLeverSlug(url: string): { slug: string; isEu: boolean } | null {
  try {
    const u = new URL(url);
    const match = u.hostname.match(/^jobs(?:\.(eu))?\.lever\.co$/i);
    if (!match) return null;
    const parts = u.pathname.split('/').filter(Boolean);
    const slug = parts[0];
    if (!slug) return null;
    return { slug, isEu: !!match[1] };
  } catch {
    return null;
  }
}

/**
 * Fetch jobs via the Lever public JSON API.
 * Endpoint: https://api.lever.co/v0/postings/{company}?mode=json
 * EU:       https://api.eu.lever.co/v0/postings/{company}?mode=json
 * This avoids HTML scraping and is less aggressively rate-limited.
 */
export async function leverApiFetch(url: string): Promise<{ jobs: ParsedJob[]; error?: string }> {
  const info = extractLeverSlug(url);
  if (!info) return { jobs: [], error: 'Could not extract company slug from Lever URL' };

  const apiBase = info.isEu ? 'https://api.eu.lever.co' : 'https://api.lever.co';
  const apiUrl = `${apiBase}/v0/postings/${info.slug}?mode=json`;
  const { data, error } = await fetchJson(apiUrl);
  if (error) return { jobs: [], error };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawJobs: any[] = Array.isArray(data) ? data : [];
  const jobs: ParsedJob[] = [];

  for (const j of rawJobs) {
    const title: string = j.text ?? '';
    const jobUrl: string = j.hostedUrl ?? j.applyUrl ?? '';
    if (!title || !jobUrl) continue;

    const location: string | undefined =
      j.categories?.location || undefined;
    const department: string | undefined =
      j.categories?.department || j.categories?.team || undefined;
    const commitment: string | undefined =
      j.categories?.commitment || undefined;
    const workplace_type: string | undefined =
      j.categories?.allLocations?.join(', ') || j.workplaceType || undefined;

    // Lever API returns descriptionPlain or description (HTML)
    let description: string | undefined;
    if (j.descriptionPlain) {
      description = j.descriptionPlain.trim().slice(0, 20_000) || undefined;
    } else if (j.description) {
      const { NodeHtmlMarkdown } = await import('node-html-markdown');
      const nhm = new NodeHtmlMarkdown({ bulletMarker: '-' });
      description = nhm.translate(j.description).trim().slice(0, 20_000) || undefined;
    }

    // Also append additional lists (requirements, responsibilities, etc.)
    if (j.lists && Array.isArray(j.lists)) {
      const parts: string[] = description ? [description] : [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const list of j.lists as any[]) {
        if (list.text) parts.push(`\n## ${list.text}\n`);
        if (list.content) {
          const { NodeHtmlMarkdown } = await import('node-html-markdown');
          const nhm = new NodeHtmlMarkdown({ bulletMarker: '-' });
          parts.push(nhm.translate(list.content));
        }
      }
      if (parts.length > 0) {
        description = parts.join('\n').trim().slice(0, 20_000) || undefined;
      }
    }

    jobs.push({ title, url: jobUrl, location, department, commitment, workplace_type, description });
  }

  return { jobs };
}

/**
 * Detect company name from the Lever API without fetching HTML.
 * Peeks at the first posting to extract the company name, or falls back to slug.
 */
export async function leverApiDetect(url: string): Promise<{ company: string; error?: string }> {
  const info = extractLeverSlug(url);
  if (!info) return { company: '', error: 'Could not extract company slug from Lever URL' };

  const apiBase = info.isEu ? 'https://api.eu.lever.co' : 'https://api.lever.co';
  const apiUrl = `${apiBase}/v0/postings/${info.slug}?mode=json&limit=1`;
  const { data, error } = await fetchJson(apiUrl);

  if (!error && Array.isArray(data) && data.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const first = data[0] as any;
    // Lever API includes categories.team or the company name in various fields
    // The posting doesn't have a direct "company" field but the hosted URL slug is the company
  }

  // Prettify the slug as company name
  const fallback = info.slug
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
  return { company: fallback };
}

/**
 * Clean trailing separators like " —", " -", " /", leading/trailing whitespace.
 */
function cleanField(val: string | undefined): string | undefined {
  if (!val) return undefined;
  const cleaned = val
    .replace(/[\s—–\-/]+$/g, '')  // trailing dashes, slashes, em-dashes
    .replace(/^[\s—–\-/]+/g, '')  // leading dashes, slashes, em-dashes
    .trim();
  return cleaned || undefined;
}

/**
 * Lever ATS parser.
 *
 * Supports both classic (jobs.lever.co) and EU (jobs.eu.lever.co) boards.
 *
 * Each job is in a <div class="posting"> element. The title link uses
 * [data-qa="posting-name"] on newer boards, or <h5.posting-title a> on older
 * ones. The Apply button (.posting-btn-submit) must be excluded — it contains
 * "Apply" not the job title.
 *
 * Location / workplace / commitment come from .posting-category spans:
 *   .sort-by-location, .sort-by-workplace-type, .sort-by-commitment
 */
export function leverParser(html: string, baseUrl: string): ParsedJob[] {
  const $ = cheerio.load(html);
  const jobs: ParsedJob[] = [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  $('.posting').each((_i: number, el: any) => {
    const $el = $(el);

    // ── Extract categories first (before title) so we can clean title ──
    const location = cleanField(
      $el.find('.sort-by-location').text().trim()
    );
    const workplace_type = cleanField(
      $el.find('.sort-by-workplace-type, .workplaceTypes').text().trim()
    );
    const commitment = cleanField(
      $el.find('.sort-by-commitment').text().trim()
    );
    const department = cleanField(
      $el.find('.sort-by-team').text().trim()
    );

    // ── Title extraction ──
    // On Lever boards, [data-qa="posting-name"] is often on the <h5> which
    // *contains* both the <a> title link and the .posting-categories spans.
    // Calling .text() on it concatenates everything. We must extract only the
    // actual title text.
    let title = '';

    // Strategy 1: find the specific title <a> inside h5
    const titleAnchor = $el.find('h5 a:not(.posting-btn-submit), [data-qa="posting-name"] a:not(.posting-btn-submit)').first();
    if (titleAnchor.length) {
      // Clone the anchor and remove any nested category elements
      const cloned = titleAnchor.clone();
      cloned.find('.posting-categories, .sort-by-location, .sort-by-workplace-type, .workplaceTypes, .sort-by-commitment, .sort-by-team').remove();
      title = cloned.text().trim();
    }

    // Strategy 2: if no anchor found, try the data-qa element directly but strip categories
    if (!title) {
      const nameEl = $el.find('[data-qa="posting-name"]').first();
      if (nameEl.length) {
        const cloned = nameEl.clone();
        cloned.find('.posting-categories, .sort-by-location, .sort-by-workplace-type, .workplaceTypes, .sort-by-commitment, .sort-by-team').remove();
        title = cloned.text().trim();
      }
    }

    // Strategy 3: fallback to h5.posting-title with cleanup
    if (!title) {
      const h5 = $el.find('h5.posting-title').first();
      if (h5.length) {
        const cloned = h5.clone();
        cloned.find('.posting-categories, .sort-by-location, .sort-by-workplace-type, .workplaceTypes, .sort-by-commitment, .sort-by-team, a.posting-btn-submit').remove();
        title = cloned.text().trim();
      }
    }

    // Final cleanup: if categories text still leaked into the title, strip them
    if (title) {
      const suffixes = [workplace_type, commitment, location, department].filter(Boolean) as string[];
      for (const suffix of suffixes) {
        // Remove the suffix if it appears concatenated at the end of the title
        if (title.endsWith(suffix)) {
          title = title.slice(0, -suffix.length).trim();
        }
      }
      // Also strip patterns like "Hybrid — CDI - PermanentBerlin / ..." that get glued on
      // by removing everything after the last occurrence of any category
      for (const suffix of suffixes) {
        const idx = title.indexOf(suffix);
        if (idx > 0) {
          title = title.slice(0, idx).trim();
        }
      }
      // Clean trailing separators
      title = title.replace(/[\s—–\-/]+$/, '').trim();
    }

    // URL — the apply button href is the canonical job URL
    const applyHref =
      $el.find('.posting-btn-submit').attr('href') ??
      (titleAnchor.length ? titleAnchor.attr('href') : '') ?? '';
    const url = resolveUrl(applyHref, baseUrl);

    if (title && url) {
      jobs.push({ title, url, location, workplace_type, commitment, department });
    }
  });

  return jobs;
}
