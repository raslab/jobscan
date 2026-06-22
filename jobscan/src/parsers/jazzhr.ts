import { ParsedJob } from '../types';
import { fetchHtml } from '../fetch-utils';
import * as cheerio from 'cheerio';

/**
 * Extract the company slug from a JazzHR board URL.
 * Handles: https://{slug}.applytojob.com/apply
 *          https://{slug}.applytojob.com/apply/{jobCode}/{title}
 */
function extractJazzHRSlug(url: string): string | null {
  try {
    const u = new URL(url);
    if (!u.hostname.endsWith('.applytojob.com')) return null;
    const slug = u.hostname.replace(/\.applytojob\.com$/i, '');
    return slug || null;
  } catch {
    return null;
  }
}

/**
 * Parse the JazzHR job board HTML into a list of jobs.
 *
 * Board URL: https://{slug}.applytojob.com/apply
 * Structure:
 *   .jobs-list .list-group > li.list-group-item
 *     h3.list-group-item-heading > a[href]   ← title + URL
 *     ul.list-inline.list-group-item-text li ← location (with leading icon text stripped)
 */
export function jazzhrParser(html: string, baseUrl: string): ParsedJob[] {
  const $ = cheerio.load(html);
  const jobs: ParsedJob[] = [];

  $('.jobs-list .list-group li.list-group-item').each((_i, el) => {
    const anchor = $(el).find('h3.list-group-item-heading a').first();
    const title = anchor.text().trim();
    const href = anchor.attr('href');
    if (!title || !href) return;

    let jobUrl: string;
    try {
      jobUrl = new URL(href, baseUrl).toString();
    } catch {
      jobUrl = href;
    }

    // Location: strip any Font-Awesome icon text (e.g. "") and join remaining li text
    const locationParts: string[] = [];
    $(el).find('ul.list-inline li').each((_j, li) => {
      // Remove <i> icon elements, then grab text
      const liClone = $(li).clone();
      liClone.find('i').remove();
      const text = liClone.text().trim();
      if (text) locationParts.push(text);
    });
    const location = locationParts.join(', ') || undefined;

    jobs.push({ title, url: jobUrl, location });
  });

  return jobs;
}

/**
 * Fetch all jobs from a JazzHR board page.
 * The board URL is https://{slug}.applytojob.com/apply
 */
export async function jazzhrApiFetch(url: string): Promise<{ jobs: ParsedJob[]; error?: string }> {
  const slug = extractJazzHRSlug(url);
  if (!slug) return { jobs: [], error: 'Could not extract company slug from JazzHR URL' };

  const boardUrl = `https://${slug}.applytojob.com/apply`;
  const { html, error } = await fetchHtml(boardUrl);
  if (error || !html) return { jobs: [], error: error ?? 'Failed to fetch JazzHR board' };

  const jobs = jazzhrParser(html, boardUrl);
  return { jobs };
}

/**
 * Detect company name from a JazzHR board URL.
 * Fetches the board page and extracts the title: "{Company} - Career Page"
 */
export async function jazzhrDetect(url: string): Promise<{ company: string; error?: string }> {
  const slug = extractJazzHRSlug(url);
  if (!slug) return { company: '' };

  const boardUrl = `https://${slug}.applytojob.com/apply`;
  const { html, error } = await fetchHtml(boardUrl);
  if (error || !html) {
    // Fallback: prettify slug
    return { company: slug.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) };
  }

  // <title>{Company} - Career Page</title>  (or similar suffix)
  const $ = cheerio.load(html);
  const title = $('title').first().text().trim();
  // Strip common suffixes like " - Career Page", " - Careers", " - Jobs"
  const company = title
    .replace(/\s*[-|]\s*(career\s*page|careers|jobs|job\s*board).*$/i, '')
    .trim();

  if (company) return { company };

  // Fallback: try DV_WEBSITE_URL_HTTPS var or prettify slug
  const dvMatch = html.match(/var\s+DV_WEBSITE_URL_HTTPS\s*=\s*["']https?:\/\/([^"'.]+)\.applytojob\.com["']/i);
  if (dvMatch?.[1]) {
    return { company: dvMatch[1].replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) };
  }

  return { company: slug.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) };
}
