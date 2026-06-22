import * as cheerio from 'cheerio';
import { ParsedJob } from '../types';
import { fetchHtml } from '../fetch-utils';

function resolveUrl(href: string, baseUrl: string): string {
  if (!href) return '';
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return href;
  }
}

/**
 * Extract the company slug from a Jobvite careers page URL.
 * Handles:
 *   https://jobs.jobvite.com/{slug}
 *   https://jobs.jobvite.com/{slug}/jobs
 *   https://jobs.jobvite.com/{slug}/search
 *   https://jobs.jobvite.com/{slug}/job/{jobId}
 */
export function extractJobviteSlug(url: string): string | null {
  try {
    const u = new URL(url);
    if (!u.hostname.match(/^jobs\.jobvite\.com$/i)) return null;
    const parts = u.pathname.split('/').filter(Boolean);
    return parts[0] || null;
  } catch {
    return null;
  }
}

/**
 * Jobvite career site parser.
 *
 * Jobvite does NOT expose a public JSON API — all data is server-rendered HTML.
 * The listing page contains ALL open jobs in one page, grouped by department
 * under `<h3 class="h2">Department</h3>` headings.
 *
 * Page structure:
 *   <h3 class="h2">Department Name</h3>
 *   <table class="jv-job-list">
 *     <tbody>
 *       <tr>
 *         <td class="jv-job-list-name"><a href="/slug/job/ID">Title</a></td>
 *         <td class="jv-job-list-location">City, State</td>
 *       </tr>
 *     </tbody>
 *   </table>
 *
 * Detail pages (fetched later by scrapeJobDetail) provide:
 *   - JSON-LD <script type="application/ld+json"> with description HTML,
 *     employmentType, location details, etc.
 *   - <div class="jv-job-detail-description"> with the HTML description body.
 */
export function jobviteParser(html: string, baseUrl: string): ParsedJob[] {
  const $ = cheerio.load(html);
  const jobs: ParsedJob[] = [];
  const seen = new Set<string>();

  // Iterate over each table.jv-job-list — each is preceded by a department h3
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  $('table.jv-job-list').each((_tableIdx: number, tableEl: any) => {
    const $table = $(tableEl);

    // The department heading is the immediately preceding h3 sibling
    let department: string | undefined;
    const $prev = $table.prev('h3');
    if ($prev.length) {
      department = $prev.text().trim() || undefined;
    }

    // Each <tr> in the tbody is a job
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    $table.find('tbody tr').each((_rowIdx: number, rowEl: any) => {
      const $row = $(rowEl);
      const $nameCell = $row.find('td.jv-job-list-name');
      const $locCell = $row.find('td.jv-job-list-location');
      const $link = $nameCell.find('a').first();

      const title = $link.text().trim();
      const href = $link.attr('href') ?? '';
      if (!title || !href) return;

      const jobUrl = resolveUrl(href, baseUrl);
      if (!jobUrl) return;

      // De-duplicate by URL (some pages may list the same job in multiple sections)
      if (seen.has(jobUrl)) return;
      seen.add(jobUrl);

      const location = $locCell.text().trim().replace(/\s+/g, ' ') || undefined;

      jobs.push({
        title,
        url: jobUrl,
        location,
        department,
      });
    });
  });

  // Fallback: if no table.jv-job-list found, try generic link extraction
  // (some customised Jobvite themes may use a different layout)
  if (jobs.length === 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    $('a[href*="/job/"]').each((_i: number, el: any) => {
      const $a = $(el);
      const title = $a.text().trim();
      const href = $a.attr('href') ?? '';
      if (!title || !href) return;

      // Only match /slug/job/ID pattern (not /job/ in other contexts like apply)
      if (!/\/job\/[a-zA-Z0-9]+$/.test(href)) return;

      const jobUrl = resolveUrl(href, baseUrl);
      if (seen.has(jobUrl)) return;
      seen.add(jobUrl);

      jobs.push({ title, url: jobUrl });
    });
  }

  return jobs;
}

/**
 * Detect company name from a Jobvite career site URL.
 * Fetches the listing page HTML and extracts the company name from:
 *   1. <h1 class="jv-logo"><a>Company Name</a></h1>
 *   2. <title>Company Careers</title>
 *   3. Fallback: prettified URL slug
 */
export async function jobviteDetect(url: string): Promise<{ company: string; error?: string }> {
  const slug = extractJobviteSlug(url);
  if (!slug) return { company: '', error: 'Could not extract company slug from Jobvite URL' };

  const { html, error } = await fetchHtml(url);
  if (error || !html) {
    // Fallback: prettify slug
    const fallback = slug.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    return { company: fallback };
  }

  const $ = cheerio.load(html);

  // Try the logo heading first
  const logoText = $('h1.jv-logo a').text().trim();
  if (logoText) {
    // Remove trailing " Careers" or " Jobs" if present
    const cleaned = logoText.replace(/\s+(careers|jobs)\s*$/i, '').trim();
    return { company: cleaned || logoText };
  }

  // Try <title>
  const titleText = $('title').text().trim();
  if (titleText) {
    const cleaned = titleText.replace(/\s+(careers|jobs)\s*$/i, '').trim();
    return { company: cleaned || titleText };
  }

  // Fallback: prettify slug
  const fallback = slug.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  return { company: fallback };
}
