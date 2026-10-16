import { ParsedJob, Source } from './types';
import { parserRegistry } from './parsers/registry';
import * as cheerio from 'cheerio';
import { NodeHtmlMarkdown } from 'node-html-markdown';
import { fetchHtml, randomDelay } from './fetch-utils';

// Re-export so existing imports from './scraper' still work
export { fetchHtml, fetchJson, sleep, randomDelay } from './fetch-utils';

/**
 * Thrown by scrapeJobDetail when a 429/403 rate-limit response is detected.
 * Caught by the sync layer to stop the detail-fetch batch early and save
 * whatever results were already collected, rather than burning time on retries.
 */
export class RateLimitError extends Error {
  constructor(url: string, httpStatus: string) {
    super(`Rate limited (${httpStatus}) fetching ${url}`);
    this.name = 'RateLimitError';
  }
}

/**
 * Thrown by scrapeJobDetail when a detail fetch fails with a definitive 4xx
 * status (other than the 403/429 rate-limit codes handled by {@link
 * RateLimitError}) — e.g. 404: the job posting no longer exists. The sync
 * layer catches this to clear the row's needs_backfill flag so dead records
 * are permanently retired from the backfill backlog instead of being retried
 * on every sync (review comment rc:4283312025, owner comment 6195486910).
 */
export class JobGoneError extends Error {
  constructor(url: string, httpStatus: string) {
    super(`Job gone (${httpStatus}) fetching ${url}`);
    this.name = 'JobGoneError';
  }
}

/** True when a fetch error string (from fetchWithRetry's `HTTP <status>`
 *  format) indicates a definitive 4xx client error. Checked only AFTER the
 *  existing 403/429 RateLimitError checks. */
function isGoneError(error: string): boolean {
  return /HTTP 4\d\d/.test(error);
}

export interface ScrapeResult {
  jobs: ParsedJob[];
  html: string;
  error?: string;
}

// ── API-based scrapers (preferred for Greenhouse, Lever, Workable & Ashby) ────
import { greenhouseApiFetch } from './parsers/greenhouse';
import { leverApiFetch } from './parsers/lever';
import { workableApiFetch } from './parsers/workable';
import { ashbyApiFetch } from './parsers/ashby';
import { teamtailorApiFetch } from './parsers/teamtailor';
import { recruiteeApiFetch } from './parsers/recruitee';
import { joinApiFetch, extractJoinJobFromHtml } from './parsers/join';
import { personioApiFetch } from './parsers/personio';
import { crelateApiFetch } from './parsers/crelate';
import { ultiproApiFetch } from './parsers/ultipro';
import { smartrecruitersApiFetch, smartrecruitersJobDetailApiFetch } from './parsers/smartrecruiters';
import { softgardenApiFetch } from './parsers/softgarden';
import { workdayApiFetch, workdayJobDetailApiFetch } from './parsers/workday';
import { icimsApiFetch, icimsJobDetailFetch } from './parsers/icims';
import { eightfoldApiFetch, eightfoldJobDetailApiFetch } from './parsers/eightfold';
import { successfactorsApiFetch, successfactorsJobDetailFetch } from './parsers/successfactors';
import { celonisApiFetch, celonisJobDetailApiFetch } from './parsers/celonis';
import { n26ApiFetch } from './parsers/n26';
import { deliveryheroApiFetch, deliveryheroJobDetailFetch } from './parsers/deliveryhero';
import { teamviewerApiFetch } from './parsers/teamviewer';
import { getyourguideApiFetch } from './parsers/getyourguide';
import { jazzhrApiFetch } from './parsers/jazzhr';
import { talentsconnectApiFetch } from './parsers/talentsconnect';
import { ycombinatorApiFetch } from './parsers/ycombinator';
import { dynatraceApiFetch } from './parsers/dynatrace';
import { picnicApiFetch } from './parsers/picnic';
import { freenowApiFetch } from './parsers/freenow';
import { newworkApiFetch } from './parsers/newwork';
import { ottoApiFetch } from './parsers/otto';
import { jobylonApiFetch } from './parsers/jobylon';
import { dvinciApiFetch } from './parsers/dvinci';
import { rohdeschwarzApiFetch } from './parsers/rohdeschwarz';
import { dymatrixApiFetch } from './parsers/dymatrix';
import { schwarzitApiFetch } from './parsers/schwarzit';
import { getroApiFetch, getKnownDomains } from './parsers/getro';

const apiScrapers: Record<string, (url: string) => Promise<{ jobs: ParsedJob[]; error?: string }>> = {
  greenhouse: greenhouseApiFetch,
  lever: leverApiFetch,
  workable: workableApiFetch,
  ashby: ashbyApiFetch,
  teamtailor: teamtailorApiFetch,
  recruitee: recruiteeApiFetch,
  join: joinApiFetch,
  personio: personioApiFetch,
  crelate: crelateApiFetch,
  ultipro: ultiproApiFetch,
  smartrecruiters: smartrecruitersApiFetch,
  softgarden: softgardenApiFetch,
  workday: workdayApiFetch,
  icims: icimsApiFetch,
  eightfold: eightfoldApiFetch,
  successfactors: successfactorsApiFetch,
  celonis: celonisApiFetch,
  n26: n26ApiFetch,
  deliveryhero: deliveryheroApiFetch,
  teamviewer: teamviewerApiFetch,
  getyourguide: getyourguideApiFetch,
  jazzhr: jazzhrApiFetch,
  talentsconnect: talentsconnectApiFetch,
  ycombinator: ycombinatorApiFetch,
  dynatrace: dynatraceApiFetch,
  picnic: picnicApiFetch,
  freenow: freenowApiFetch,
  newwork: newworkApiFetch,
  otto: ottoApiFetch,
  jobylon: jobylonApiFetch,
  dvinci: dvinciApiFetch,
  dymatrix: dymatrixApiFetch,
  rohdeschwarz: rohdeschwarzApiFetch,
  schwarzit: schwarzitApiFetch,
  getro: getroApiFetch,
};

export async function scrapeSource(source: Source): Promise<ScrapeResult> {
  // 1. Try API-based fetch first (no HTML scraping, avoids Cloudflare)
  const apiFn = apiScrapers[source.parser];
  if (apiFn) {
    console.log(`[scraper] Trying API fetch for ${source.company} (${source.parser})`);
    const apiResult = await apiFn(source.url);
    if (!apiResult.error && apiResult.jobs.length > 0) {
      console.log(`[scraper] API fetch OK for ${source.company}: ${apiResult.jobs.length} jobs`);
      return { jobs: apiResult.jobs, html: '' };
    }
    if (apiResult.error) {
      console.log(`[scraper] API fetch failed for ${source.company}: ${apiResult.error}`);
      // If the API error is definitive (e.g. deprecated board, permanent redirect),
      // don't fall back to HTML — it would hit the same dead endpoint and burn
      // minutes in retry loops.
      if (apiResult.error.includes('no longer available') || apiResult.error.includes('deprecated')) {
        return { jobs: [], html: '', error: apiResult.error };
      }
      console.log(`[scraper] Falling back to HTML for ${source.company}`);
    } else {
      console.log(`[scraper] API fetch returned 0 jobs for ${source.company}, falling back to HTML`);
    }
  }

  // 2. Fall back to HTML scraping
  const { html, error } = await fetchHtml(source.url);
  if (error) return { jobs: [], html: '', error };

  const parserFn = parserRegistry[source.parser];
  if (!parserFn) {
    return { jobs: [], html, error: `No parser found for "${source.parser}"` };
  }
  let jobs: ParsedJob[] = [];
  try {
    jobs = parserFn(html, source.url);
  } catch (err) {
    return { jobs: [], html, error: `Parser error: ${String(err)}` };
  }

  return { jobs, html };
}

/**
 * Fetch a job detail page and enrich the ParsedJob with description,
 * workplace_type, commitment, department, and team extracted from that page.
 * Description HTML is converted to Markdown for clean storage / display.
 *
 * A random delay is added before fetching to avoid hammering the server.
 *
 * @throws {RateLimitError} if a 429/403 rate-limit response is detected, so
 *   the sync layer can stop the batch early and save partial results.
 */
export async function scrapeJobDetail(job: ParsedJob): Promise<ParsedJob> {
  // If we already have a description, skip
  if (job.description) return job;

  // ── YCombinator: descriptions already fetched in ycombinatorApiFetch — skip detail fetch ──
  if (/(?:www\.)?ycombinator\.com\/companies\//i.test(job.url)) {
    return job;
  }

  // ── Dynatrace: listing API returns all available metadata (no descriptions in API) —
  // individual job pages are Astro-rendered HTML with no extractable description.
  // Skip detail fetch entirely; all fields are set from the Coveo search response.
  if (/(?:www\.)?dynatrace\.com\/careers\/jobs\//i.test(job.url)) {
    return job;
  }

  // ── Picnic: all available listing metadata is returned by the SSR HTML fetch;
  // job detail pages are Next.js SSR with no extractable structured description.
  // Skip detail fetch entirely.
  if (/jobs\.picnic\.app/i.test(job.url)) {
    return job;
  }

  // ── OTTO: listing API returns metadata but no descriptions; job detail pages
  // are Weblication CMS rendered with no structured description. Skip detail fetch.
  if (/(?:www\.)?otto\.de\/jobs\//i.test(job.url)) {
    return job;
  }

  // ── d.vinci: descriptions and metadata already enriched during API fetch — skip detail fetch ──
  if (/[a-z0-9-]+\.dvinci-hr\.com/i.test(job.url)) {
    return job;
  }

  // ── DYMATRIX: descriptions already enriched during API fetch — skip detail fetch ──
  if (/(?:www\.)?dymatrix\.de\/.*\/stellenangebote\/details\//i.test(job.url)) {
    return job;
  }

  // ── Schwarz IT / Schwarz Group: listing API has no descriptions; job detail
  // pages are Trinity CMS SPA with no extractable structured description.
  // Skip detail fetch entirely.
  if (/(?:schwarz-digits\.de|jobs\.schwarz)\/(?:en|de)\/jobsearch\//i.test(job.url)) {
    return job;
  }

  // ── Getro boards: descriptions already fetched from Getro v1 API — skip detail fetch ──
  const getroDomains = getKnownDomains().map(d => d.replace(/\./g, '\\.'));
  if (new RegExp(`(?:${getroDomains.join('|')})\/companies\/`, 'i').test(job.url)) {
    return job;
  }

  // ── Workable: descriptions come from the API listing (?details=true) — skip detail fetch ──
  if (/apply\.workable\.com/i.test(job.url)) {
    return job;
  }

  // ── Ashby: descriptions already come from the API listing — skip detail fetch ──
  if (/jobs\.ashbyhq\.com/i.test(job.url)) {
    return job;
  }

  // ── Teamtailor: descriptions already come from the RSS feed — skip detail fetch ──
  if (/\.teamtailor\.com/i.test(job.url)) {
    return job;
  }

  // ── TeamViewer (custom-domain TeamTailor): descriptions come from RSS feed — skip detail fetch ──
  if (/careers\.teamviewer\.com/i.test(job.url)) {
    return job;
  }

  // ── Recruitee: descriptions already come from the API listing — skip detail fetch ──
  if (/\.recruitee\.com/i.test(job.url)) {
    return job;
  }

  // ── Personio: descriptions already come from the XML feed / corporate API — skip detail fetch ──
  // Also skip personio.com/careers/ pages which are behind Vercel bot-protection.
  if (/\.jobs\.personio\.(de|com)/i.test(job.url) || /personio\.com\/careers\//i.test(job.url)) {
    return job;
  }

  // ── UltiPro: brief description comes from the API listing — skip detail fetch ──
  if (/recruiting\.ultipro\.com/i.test(job.url)) {
    return job;
  }

  // ── Crelate: descriptions come from GetAllJobs API listing — skip detail fetch ──
  if (/jobs\.crelate\.com\/portal\//i.test(job.url)) {
    return job;
  }

  // ── SmartRecruiters: fetch description via the posting detail API.
  // Uses a short delay (API, not HTML) and maxRetries:1 to fail fast on rate-limiting.
  if (/(?:jobs|careers)\.smartrecruiters\.com/i.test(job.url)) {
    await randomDelay(300, 600);
    const { description, error } = await smartrecruitersJobDetailApiFetch(job.url);
    if (error && /429|403/.test(error)) throw new RateLimitError(job.url, error);
    if (error && isGoneError(error)) throw new JobGoneError(job.url, error);
    return { ...job, description: description || undefined };
  }

  // ── Softgarden: descriptions already come from the /jobs.feed.json — skip detail fetch ──
  if (/\.career\.softgarden\.de/i.test(job.url)) {
    return job;
  }

  // ── Eightfold: standard mode includes descriptions in the listing API.
  // PCSX mode does NOT — fetch the description via /api/apply/v2/jobs/{id} for those.
  if (/\.eightfold\.ai/i.test(job.url)) {
    // If description is already present (standard mode), nothing to do.
    if (job.description) return job;
    // PCSX jobs have no description from the listing — fetch it individually.
    await randomDelay(300, 600);
    const { description, error } = await eightfoldJobDetailApiFetch(job.url);
    if (error && /429|403/.test(error)) throw new RateLimitError(job.url, error);
    if (error && isGoneError(error)) throw new JobGoneError(job.url, error);
    return { ...job, description: description || undefined };
  }

  // ── N26: descriptions already included in the Greenhouse API listing — skip detail fetch ──
  if (/(?:^|\.)n26\.com$/i.test(new URL(job.url).hostname)) {
    return job;
  }

  // ── Celonis: fetch description via the dxp-api detail endpoint ──
  // Uses a short delay (JSON API) and maxRetries:1 to fail fast on rate-limiting.
  if (/careers\.celonis\.com/i.test(job.url)) {
    await randomDelay(300, 600);
    const { description, error } = await celonisJobDetailApiFetch(job.url);
    if (error && /429|403/.test(error)) throw new RateLimitError(job.url, error);
    if (error && isGoneError(error)) throw new JobGoneError(job.url, error);
    return { ...job, description: description || undefined };
  }

  // ── Delivery Hero (Attrax): fetch description from the DescriptionWidget HTML ──
  // Uses a moderate delay (HTML page, not JSON API).
  if (/careers\.deliveryhero\.com/i.test(job.url)) {
    await randomDelay(1000, 2500);
    const { description } = await deliveryheroJobDetailFetch(job.url);
    return { ...job, description: job.description || description || undefined };
  }


  // ── SuccessFactors: fetch location + description from the job detail page ──
  // SF rate-limits aggressively — use a longer 4-9 s delay to avoid 403s.
  // Matches both classic career*.successfactors.* URLs and the
  // career*/hcm*.sapsf.(eu|com) hosts that CSB custom domains
  // (e.g. careers.capgemini.com) resolve job links to via sfExtractCSBInfo —
  // without the sapsf alternation, CSB jobs fall through to the generic
  // detail path and never receive successfactorsJobDetailFetch metadata.
  if (/career\d+\.successfactors\.|(?:career|hcm)\d*\.sapsf\.(?:eu|com)/i.test(job.url)) {
    await randomDelay(3000, 5000);
    const { description, location, error } = await successfactorsJobDetailFetch(job.url, {
      postingDate: (job as { postingDate?: string }).postingDate,
    });
    if (error && /429|403/.test(error)) throw new RateLimitError(job.url, error);
    if (error && isGoneError(error)) throw new JobGoneError(job.url, error);
    return {
      ...job,
      description:    job.description || description || undefined,
      location:       job.location    || location    || undefined,
    };
  }

  // ── Workday: use the CXS detail API to fetch the job description ──
  // The CXS endpoint is a lightweight JSON API — a short 300–600 ms pause is enough
  // to stay under Cloudflare's burst limit without adding minutes to large syncs.
  if (/\.wd\d+\.myworkdayjobs\.com/i.test(job.url)) {
    await randomDelay(300, 600);
    const { description, error } = await workdayJobDetailApiFetch(job.url);
    if (error && /429|403|502/.test(error)) throw new RateLimitError(job.url, error);
    if (error && isGoneError(error)) throw new JobGoneError(job.url, error);
    return { ...job, description: job.description || description || undefined };
  }

  // ── Jobvite: HTML detail page but known ATS server — shorter delay than generic ──
  if (/jobs\.jobvite\.com/i.test(job.url)) {
    await randomDelay(800, 1500);
  } else {
    // Throttle: random delay before each HTML detail page request
    await randomDelay(2000, 5000);
  }

  // ── iCIMS: fetch description from the iframe job detail page ──
  if (/[a-z0-9-]+\.icims\.com/i.test(job.url)) {
    const { description, department, workplace_type, error } = await icimsJobDetailFetch(job.url);
    if (error && /429|403/.test(error)) throw new RateLimitError(job.url, error);
    if (error && isGoneError(error)) throw new JobGoneError(job.url, error);
    return {
      ...job,
      description:    job.description    || description    || undefined,
      department:     job.department     || department     || undefined,
      workplace_type: job.workplace_type || workplace_type || undefined,
    };
  }

  const { html, error } = await fetchHtml(job.url);
  if (error && isGoneError(error)) throw new JobGoneError(job.url, error);
  if (error || !html) return job;

  // ── JOIN: extract structured data from __NEXT_DATA__ on the detail page ──
  if (/join\.com\/companies\//i.test(job.url)) {
    const joinData = extractJoinJobFromHtml(html);
    if (joinData) {
      return {
        ...job,
        description:    job.description    || joinData.description    || undefined,
        workplace_type: job.workplace_type || joinData.workplace_type || undefined,
        commitment:     job.commitment     || joinData.commitment     || undefined,
        department:     job.department     || joinData.department     || undefined,
        location:       job.location       || joinData.location       || undefined,
      };
    }
    // Fall through to generic extraction if __NEXT_DATA__ parsing failed
  }

  const $ = cheerio.load(html);
  const isLever = /jobs\.(eu\.)?lever\.co/i.test(job.url);
  const isJobvite = /jobs\.jobvite\.com/i.test(job.url);

  let descriptionHtml = '';
  let department: string | undefined;
  let team: string | undefined;
  let commitment: string | undefined;

  if (isJobvite) {
    // ── Jobvite-specific: extract from JSON-LD and .jv-job-detail-description ──
    // The detail page embeds a <script type="application/ld+json"> with description HTML,
    // employmentType, industry (=department), and location details.
    try {
      const ldJsonText = $('script[type="application/ld+json"]').first().html();
      if (ldJsonText) {
        const ld = JSON.parse(ldJsonText);
        if (ld.description) {
          descriptionHtml = ld.description;
        }
        if (ld.employmentType) {
          commitment = ld.employmentType;
        }
        if (ld.industry) {
          department = ld.industry;
        }
      }
    } catch {
      // JSON-LD parse failed — fall through to DOM extraction
    }

    // Fallback: grab description from the DOM
    if (!descriptionHtml) {
      const $desc = $('.jv-job-detail-description');
      if ($desc.length) {
        // Skip the <h3>Description</h3> heading itself, grab the inner <p>
        const $body = $desc.find('p[ng-non-bindable]');
        descriptionHtml = ($body.length ? $body.html() : $desc.html()) ?? '';
      }
    }
  } else if (isLever) {
    // ── Lever-specific: grab ALL content sections up to last-section-apply ──
    // The content lives in .section-wrapper > .section.page-centered divs
    // We collect everything between the posting-header and last-section-apply
    const sections: string[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    $('.content .section-wrapper .section.page-centered').each((_i: number, el: any) => {
      const $section = $(el);
      // Skip the header section and the apply button section
      if ($section.hasClass('posting-header')) return;
      if ($section.hasClass('last-section-apply')) return;
      sections.push($section.html() ?? '');
    });

    // Also grab sections that are direct children of .section-wrapper without .page-centered
    // (some Lever pages structure content differently)
    if (sections.length === 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      $('[data-qa="job-description"]').each((_i: number, el: any) => {
        sections.push($(el).html() ?? '');
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      $('.posting-requirements').each((_i: number, el: any) => {
        // Get the parent section which includes the h3 heading
        const parent = $(el).closest('.section');
        sections.push(parent.html() ?? $(el).html() ?? '');
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      $('[data-qa="closing-description"]').each((_i: number, el: any) => {
        sections.push($(el).html() ?? '');
      });
    }

    descriptionHtml = sections.join('\n');

    // ── Department / Team from posting-categories ──
    const deptRaw = $('.sort-by-team').text().trim().replace(/\/\s*$/, '').trim();
    if (deptRaw) {
      // Lever often puts "Dept – Team" in one field
      const parts = deptRaw.split(/\s*[–—-]\s*/);
      department = parts[0]?.trim() || undefined;
      team = parts.length > 1 ? parts.slice(1).join(' – ').trim() : undefined;
    }
  } else {
    // ── Generic extraction ──────────────────────────────────────────────────
    const descEl =
      $('[data-qa="job-description"]').first().length ? $('[data-qa="job-description"]').first() :
      $('.posting-description').first().length ? $('.posting-description').first() :
      $('.job-description').first().length ? $('.job-description').first() :
      $('[class*="description"]').first().length ? $('[class*="description"]').first() :
      $('section.content').first().length ? $('section.content').first() : null;

    descriptionHtml = descEl ? (descEl.html() ?? '') : '';

    if (!descriptionHtml) {
      // fallback to body text
      $('nav, header, footer, script, style, [class*="cookie"], [class*="banner"]').remove();
      descriptionHtml = $('main, article, [role="main"], body').first().html() ?? '';
    }
  }

  // ── Convert HTML → Markdown ───────────────────────────────────────────────
  const nhm = new NodeHtmlMarkdown({
    bulletMarker: '-',
  });
  const description = descriptionHtml
    ? nhm.translate(descriptionHtml).trim().slice(0, 20_000) || undefined
    : undefined;

  // ── Workplace type ────────────────────────────────────────────────────────
  const workplaceRaw =
    $('[data-qa="workplace-type"]').text().trim() ||
    $('.workplace-type, .workplaceTypes').text().trim() ||
    $('[class*="workplace"]').first().text().trim() ||
    extractPatternFromText(description ?? '', /\b(remote|hybrid|on.?site|in.?office)\b/i);

  // ── Commitment ────────────────────────────────────────────────────────────
  const commitmentRaw =
    commitment ||
    $('[data-qa="commitment"]').text().trim() ||
    $('.commitment').text().trim() ||
    $('[class*="commitment"]').first().text().trim() ||
    extractPatternFromText(description ?? '', /\b(full.?time|part.?time|contract|freelance|internship)\b/i);

  return {
    ...job,
    description:    job.description    || description    || undefined,
    workplace_type: job.workplace_type || normalise(workplaceRaw) || undefined,
    commitment:     job.commitment     || normalise(commitmentRaw) || undefined,
    department:     job.department     || department     || undefined,
    team:           job.team           || team           || undefined,
  };
}

function extractPatternFromText(text: string, pattern: RegExp): string {
  const m = text.match(pattern);
  return m ? m[0] : '';
}

function normalise(s: string): string {
  return s.replace(/\s+/g, ' ').trim().slice(0, 100);
}
