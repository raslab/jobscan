import * as cheerio from 'cheerio';
import { ParsedJob } from '../types';

function resolveUrl(href: string, baseUrl: string): string {
  if (!href) return '';
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return href;
  }
}

/**
 * Default heuristic parser.
 *
 * Strategy (in priority order):
 * 1. JSON-LD <script> blocks containing JobPosting schema
 * 2. ATS URL-pattern links: href containing /jobs/, /careers/, /positions/, /openings/
 * 3. Fallback: <li> or <div> containing a heading (h2–h4) with a sibling/child link
 */
export function defaultParser(html: string, baseUrl: string): ParsedJob[] {
  const $ = cheerio.load(html);
  const seen = new Set<string>();
  const jobs: ParsedJob[] = [];

  function addJob(job: ParsedJob) {
    if (!job.title || !job.url) return;
    const key = job.url;
    if (seen.has(key)) return;
    seen.add(key);
    jobs.push(job);
  }

  // ── Strategy 1: JSON-LD JobPosting ────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  $('script[type="application/ld+json"]').each((_i: number, el: any) => {
    try {
      const raw = $(el).html() ?? '';
      const data = JSON.parse(raw);
      const entries: unknown[] = Array.isArray(data) ? data : [data];
      for (const entry of entries) {
        const e = entry as Record<string, unknown>;
        if (e['@type'] === 'JobPosting') {
          const title = String(e['title'] ?? '').trim();
          const rawUrl = String(e['url'] ?? e['sameAs'] ?? '').trim();
          const url = resolveUrl(rawUrl, baseUrl);
          const location =
            typeof e['jobLocation'] === 'object' && e['jobLocation'] !== null
              ? String(
                  (
                    (e['jobLocation'] as Record<string, unknown>)[
                      'address'
                    ] as Record<string, unknown>
                  )?.['addressLocality'] ?? ''
                ).trim() || undefined
              : undefined;
          const description =
            typeof e['description'] === 'string'
              ? e['description'].trim()
              : undefined;
          if (title && url) addJob({ title, url, location, description });
        }
      }
    } catch {
      // Malformed JSON-LD — skip
    }
  });

  if (jobs.length > 0) return jobs;

  // ── Strategy 2: ATS URL-pattern links ────────────────────────────────────
  const atsPattern = /\/(jobs|careers|positions|openings|job-listings?)\//i;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  $('a[href]').each((_i: number, el: any) => {
    const $el = $(el);
    const href = $el.attr('href') ?? '';
    if (!atsPattern.test(href)) return;
    const title = $el.text().trim();
    if (!title || title.length < 3) return;
    const url = resolveUrl(href, baseUrl);
    // Try to find a nearby location hint
    const parent = $el.parent();
    const locationEl = parent.find('[class*="location"],[class*="city"],[class*="place"]').first();
    const location = locationEl.text().trim() || undefined;
    addJob({ title, url, location });
  });

  if (jobs.length > 0) return jobs;

  // ── Strategy 3: Heading + link inside li/div ──────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  $('li, article, div').each((_i: number, el: any) => {
    const $el = $(el);
    const heading = $el.find('h2, h3, h4').first();
    if (!heading.length) return;
    const link = $el.find('a[href]').first();
    if (!link.length) return;
    const href = link.attr('href') ?? '';
    const title = (heading.text().trim() || link.text().trim());
    if (!title || title.length < 3) return;
    const url = resolveUrl(href, baseUrl);
    if (!url) return;
    const locationEl = $el
      .find('[class*="location"],[class*="city"],[class*="place"]')
      .first();
    const location = locationEl.text().trim() || undefined;
    addJob({ title, url, location });
  });

  return jobs;
}
