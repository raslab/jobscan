import { ParserFn } from '../types';
import { greenhouseParser } from './greenhouse';
import { leverParser } from './lever';
import { workableParser } from './workable';
import { ashbyParser } from './ashby';
import { teamtailorParser } from './teamtailor';
import { jobviteParser } from './jobvite';
import { recruiteeParser } from './recruitee';
import { joinParser } from './join';
import { personioParser } from './personio';
import { crelateParser } from './crelate';
import { ultiproParser } from './ultipro';
import { smartrecruitersParser } from './smartrecruiters';
import { softgardenParser } from './softgarden';
import { workdayParser } from './workday';
import { icimsParser } from './icims';
import { eightfoldParser } from './eightfold';
import { successfactorsParser } from './successfactors';
import { teamviewerParser } from './teamviewer';
import { n26Parser } from './n26';
import { deliveryheroParser } from './deliveryhero';
import { celonisParser } from './celonis';
import { getyourguideParser } from './getyourguide';
import { jazzhrParser } from './jazzhr';
import { talentsconnectParser } from './talentsconnect';
import { ycombinatorParser } from './ycombinator';
import { dynatraceParser } from './dynatrace';
import { picnicParser } from './picnic';
import { freenowParser } from './freenow';
import { newworkParser } from './newwork';
import { ottoParser } from './otto';
import { jobylonParser } from './jobylon';
import { dvinciParser } from './dvinci';
import { dymatrixParser } from './dymatrix';
import { rohdeschwarzParser } from './rohdeschwarz';
import { schwarzitParser } from './schwarzit';
import { getroParser, isGetroHostname } from './getro';
import { discoverWorkdaySiteId } from './workday';
import * as cheerio from 'cheerio';
import { fetchHtml } from '../fetch-utils';

export const parserRegistry: Record<string, ParserFn> = {
  greenhouse: greenhouseParser,
  lever: leverParser,
  workable: workableParser,
  ashby: ashbyParser,
  teamtailor: teamtailorParser,
  jobvite: jobviteParser,
  recruitee: recruiteeParser,
  join: joinParser,
  personio: personioParser,
  crelate: crelateParser,
  ultipro: ultiproParser,
  smartrecruiters: smartrecruitersParser,
  softgarden: softgardenParser,
  workday: workdayParser,
  icims: icimsParser,
  eightfold: eightfoldParser,
  successfactors: successfactorsParser,
  celonis: celonisParser,
  n26: n26Parser,
  deliveryhero: deliveryheroParser,
  teamviewer: teamviewerParser,
  getyourguide: getyourguideParser,
  jazzhr: jazzhrParser,
  talentsconnect: talentsconnectParser,
  ycombinator: ycombinatorParser,
  dynatrace: dynatraceParser,
  picnic: picnicParser,
  freenow: freenowParser,
  newwork: newworkParser,
  otto: ottoParser,
  jobylon: jobylonParser,
  dvinci: dvinciParser,
  dymatrix: dymatrixParser,
  rohdeschwarz: rohdeschwarzParser,
  schwarzit: schwarzitParser,
  getro: getroParser,
};

export const parserNames = Object.keys(parserRegistry);

// ─────────────────────────────────────────────────────────────────────────────
// Detection result type
// ─────────────────────────────────────────────────────────────────────────────

export interface DetectionResult {
  /** Detected parser name */
  parser: string;
  /** The actual ATS URL to use (may differ from the input URL for custom domains) */
  atsUrl?: string;
  /** How the parser was detected */
  method: 'url' | 'dom' | 'links' | 'scripts' | 'iframes' | 'meta' | 'follow';
}

// ─────────────────────────────────────────────────────────────────────────────
// Stage 1: URL-pattern based detection (no fetch needed)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Try to detect the parser purely from the URL pattern — no HTML fetch needed.
 * Returns the parser name or null if the URL doesn't match a known ATS.
 */
export function detectParserFromUrl(url: string): string | null {
  if (/jobs\.(eu\.)?lever\.co/i.test(url)) return 'lever';
  if (/job-boards\.(eu\.)?greenhouse\.io|boards\.(eu\.)?greenhouse\.io|greenhouse\.io\/jobs/i.test(url)) return 'greenhouse';
  if (/apply\.workable\.com/i.test(url)) return 'workable';
  if (/jobs\.ashbyhq\.com/i.test(url)) return 'ashby';
  if (/[a-z0-9-]+\.teamtailor\.com/i.test(url)) return 'teamtailor';
  if (/jobs\.jobvite\.com/i.test(url)) return 'jobvite';
  if (/[a-z0-9-]+\.recruitee\.com/i.test(url)) return 'recruitee';
  if (/join\.com\/companies\//i.test(url)) return 'join';
  if (/[a-z0-9-]+\.jobs\.personio\.(de|com)/i.test(url)) return 'personio';
  // Personio's own corporate careers page (Next.js + Contentful site with /api/careers/ JSON API)
  if (/(?:www\.)?personio\.com\/(?:about-personio\/)?careers\b/i.test(url)) return 'personio';
  if (/jobs\.crelate\.com\/portal\//i.test(url)) return 'crelate';
  if (/recruiting\.ultipro\.com\//i.test(url)) return 'ultipro';
  if (/(?:jobs|careers)\.smartrecruiters\.com\/[A-Za-z0-9]/i.test(url)) return 'smartrecruiters';
  if (/[a-z0-9-]+\.career\.softgarden\.de/i.test(url)) return 'softgarden';
  if (/[a-z0-9-]+\.wd\d+\.myworkdayjobs\.com/i.test(url)) return 'workday';
  if (/[a-z0-9-]+\.icims\.com/i.test(url)) return 'icims';
  if (/[a-z0-9-]+\.eightfold\.ai/i.test(url)) return 'eightfold';
  if (/career\d+\.successfactors\.[a-z]{2,3}/i.test(url)) return 'successfactors';
  if (/careers\.celonis\.com/i.test(url)) return 'celonis';
  // N26 custom careers site (backed by Greenhouse board slug "n26")
  if (/(?:^|\.)n26\.com$/i.test(new URL(url).hostname) && /\/careers/.test(new URL(url).pathname)) return 'n26';
  // Delivery Hero (Attrax ATS)
  if (/careers\.deliveryhero\.com/i.test(url)) return 'deliveryhero';
  // TeamViewer custom TeamTailor-backed careers site
  if (/careers\.teamviewer\.com/i.test(url)) return 'teamviewer';
  // GetYourGuide custom Webflow careers site (backed by Greenhouse board slug "getyourguide")
  if (/(?:www\.)?getyourguide\.careers/i.test(url)) return 'getyourguide';
  // JazzHR / The Resumator — *.applytojob.com
  if (/[a-z0-9-]+\.applytojob\.com/i.test(url)) return 'jazzhr';
  // YCombinator — company job boards on ycombinator.com
  if (/(?:www\.)?ycombinator\.com\/companies\/[a-z0-9_-]+\/jobs/i.test(url)) return 'ycombinator';
  // Dynatrace — custom Coveo-backed careers site
  if (/careers\.dynatrace\.com/i.test(url)) return 'dynatrace';
  if (/(?:www\.)?dynatrace\.com\/careers/i.test(url)) return 'dynatrace';
  // Picnic — custom Next.js careers portal
  if (/jobs\.picnic\.app/i.test(url)) return 'picnic';
  // FREE NOW — custom React careers site (backed by Greenhouse board slug "freenow")
  if (/(?:www\.)?free-now\.com\/career\/jobs/i.test(url)) return 'freenow';
  // NEWWORK Software — custom WordPress CPT-based careers site
  if (/(?:www\.)?newwork\.com\/careers\/?$/i.test(url)) return 'newwork';
  // OTTO — custom Weblication CMS + SAP OData careers site
  if (/(?:www\.)?otto\.de\/jobs\b/i.test(url)) return 'otto';
  // Jobylon — ATS used by Nordic companies (WithSecure, PwC, etc.)
  if (/emp\.jobylon\.com\/companies\/\d+/i.test(url)) return 'jobylon';
  // d.vinci — German ATS ({tenant}.dvinci-hr.com)
  if (/[a-z0-9-]+\.dvinci-hr\.com/i.test(url)) return 'dvinci';
  // DYMATRIX — TYPO3 CMS with UdgJobs extension
  if (/(?:www\.)?dymatrix\.de\/.*\/stellenangebote/i.test(url)) return 'dymatrix';
  // Rohde & Schwarz — custom FirstSpirit CMS job board
  if (/(?:www\.)?rohde-schwarz\.com\/.*(?:karriere\/stellenangebote|career\/job-offers)/i.test(url)) return 'rohdeschwarz';
  // Schwarz IT / Schwarz Group — custom Trinity CMS job portal
  if (/(?:www\.)?schwarz-digits\.de\/(?:en|de)\/jobsearch/i.test(url)) return 'schwarzit';
  if (/jobs\.schwarz\/(?:en|de)\/jobsearch/i.test(url)) return 'schwarzit';
  // Getro-powered VC talent boards — single source of truth is KNOWN_DOMAINS in getro.ts
  try {
    const u = new URL(url);
    if (isGetroHostname(u.hostname) && /^\/companies\/[a-z0-9_-]+/i.test(u.pathname)) return 'getro';
  } catch { /* invalid URL */ }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Stage 2: HTML content-based detection (DOM fingerprinting)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Link-pattern rules: each rule maps a regex on href values to a parser name.
 * When a match is found, the full matched href is returned as atsUrl so the
 * caller can use the actual ATS URL instead of the custom-domain URL.
 */
interface LinkRule {
  parser: string;
  /** Regex tested against each <a href>, <iframe src>, <script src> value */
  pattern: RegExp;
  /** Given a matched URL, extract a clean ATS base URL for the parser */
  extractAtsUrl?: (matchedUrl: string) => string | null;
}

const LINK_RULES: LinkRule[] = [
  // iCIMS — job links point to *.icims.com/jobs/…
  {
    parser: 'icims',
    pattern: /[a-z0-9-]+\.icims\.com/i,
    extractAtsUrl: (href) => {
      try {
        const u = new URL(href);
        return `${u.origin}/jobs/search`;
      } catch { return null; }
    },
  },
  // Greenhouse — job links point to boards.greenhouse.io/{slug} or job-boards.greenhouse.io/{slug}
  // Also handles the embedded board JS:  boards.greenhouse.io/embed/job_board/js?for={slug}
  {
    parser: 'greenhouse',
    pattern: /(?:job-)?boards(?:\.eu)?\.greenhouse\.io\//i,
    extractAtsUrl: (href) => {
      try {
        const u = new URL(href);
        // Embedded board script: /embed/... with ?for={slug}
        if (u.pathname.startsWith('/embed')) {
          const forParam = u.searchParams.get('for');
          if (forParam) return `${u.origin}/${forParam}`;
          return null;
        }
        const parts = u.pathname.split('/').filter(Boolean);
        if (parts[0]) return `${u.origin}/${parts[0]}`;
      } catch { /* */ }
      return null;
    },
  },
  // Greenhouse — REST API endpoint embedded in JS bundles
  //   e.g. https://boards-api.greenhouse.io/v1/boards/moniepoint/jobs?content=true
  {
    parser: 'greenhouse',
    pattern: /boards-api(?:\.eu)?\.greenhouse\.io\/v1\/boards\/[a-z0-9_-]+/i,
    extractAtsUrl: (href) => {
      try {
        const u = new URL(href);
        // pathname: /v1/boards/{slug}/jobs[?...]
        const parts = u.pathname.split('/').filter(Boolean);
        // parts: ['v1', 'boards', slug, ...]
        const slug = parts[2];
        if (slug) return `https://boards.greenhouse.io/${slug}`;
      } catch { /* */ }
      return null;
    },
  },
  // Lever — job links point to jobs.lever.co/{slug}
  {
    parser: 'lever',
    pattern: /jobs(?:\.eu)?\.lever\.co\/[a-z0-9_-]+/i,
    extractAtsUrl: (href) => {
      try {
        const u = new URL(href);
        const parts = u.pathname.split('/').filter(Boolean);
        if (parts[0]) return `${u.origin}/${parts[0]}`;
      } catch { /* */ }
      return null;
    },
  },
  // Workable
  {
    parser: 'workable',
    pattern: /apply\.workable\.com\/[a-z0-9_-]+/i,
    extractAtsUrl: (href) => {
      try {
        const u = new URL(href);
        const parts = u.pathname.split('/').filter(Boolean);
        if (parts[0] && parts[0] !== 'j' && parts[0] !== 'api') return `${u.origin}/${parts[0]}`;
      } catch { /* */ }
      return null;
    },
  },
  // Ashby — public job board
  {
    parser: 'ashby',
    pattern: /jobs\.ashbyhq\.com\/[a-z0-9_-]+/i,
    extractAtsUrl: (href) => {
      try {
        const u = new URL(href);
        const parts = u.pathname.split('/').filter(Boolean);
        if (parts[0]) return `https://jobs.ashbyhq.com/${parts[0]}`;
      } catch { /* */ }
      return null;
    },
  },
  // Ashby — API endpoint embedded in custom job-board widgets
  //   e.g. https://api.ashbyhq.com/posting-api/job-board/kin?includeCompensation=false
  {
    parser: 'ashby',
    pattern: /api\.ashbyhq\.com\/posting-api\/job-board\/[a-z0-9_-]+/i,
    extractAtsUrl: (href) => {
      try {
        const u = new URL(href);
        const parts = u.pathname.split('/').filter(Boolean);
        // pathname: /posting-api/job-board/{slug}
        const slug = parts[2];
        if (slug) return `https://jobs.ashbyhq.com/${slug}`;
      } catch { /* */ }
      return null;
    },
  },
  // Workday
  {
    parser: 'workday',
    pattern: /[a-z0-9-]+\.wd\d+\.myworkdayjobs\.com/i,
    extractAtsUrl: (href) => {
      try {
        const u = new URL(href);
        return u.origin + u.pathname.replace(/\/+$/, '');
      } catch { return null; }
    },
  },
  // SmartRecruiters
  {
    parser: 'smartrecruiters',
    pattern: /(?:jobs|careers)\.smartrecruiters\.com\/[a-z0-9_-]+/i,
    extractAtsUrl: (href) => {
      try {
        const u = new URL(href);
        const parts = u.pathname.split('/').filter(Boolean);
        if (parts[0]) return `${u.origin}/${parts[0]}`;
      } catch { /* */ }
      return null;
    },
  },
  // Eightfold
  {
    parser: 'eightfold',
    pattern: /[a-z0-9-]+\.eightfold\.ai/i,
    extractAtsUrl: (href) => {
      try {
        const u = new URL(href);
        return `${u.origin}/careers`;
      } catch { return null; }
    },
  },
  // SuccessFactors
  {
    parser: 'successfactors',
    pattern: /career\d+\.successfactors\.[a-z]{2,3}/i,
    extractAtsUrl: (href) => {
      try {
        const u = new URL(href);
        const companyId = u.searchParams.get('company');
        if (companyId) {
          // Reconstruct the canonical career board URL from any job/search link
          // e.g. /sfcareer/jobreqcareer?jobId=123&company=acme  →  /career?company=acme
          return `${u.origin}/career?company=${encodeURIComponent(companyId)}`;
        }
        // Already a canonical board URL (e.g. /career or /careers path, no company param
        // means company is somehow embedded differently — return as-is)
        if (/^\/careers?$/.test(u.pathname)) return href;
        // Job-level URL without company param means the URL was truncated during raw-text
        // extraction (the page embeds links in JSON with \u0026 which the URL regex stops at).
        // Return null so all such hits collapse into successfactors::__none__ for upgrade.
        return null;
      } catch { return null; }
    },
  },
  // Jobvite
  {
    parser: 'jobvite',
    pattern: /jobs\.jobvite\.com\/[a-z0-9_-]+/i,
    extractAtsUrl: (href) => {
      try {
        const u = new URL(href);
        const parts = u.pathname.split('/').filter(Boolean);
        // Exclude Jobvite's own infrastructure paths (e.g. __assets__, __api__)
        if (parts[0] && !parts[0].startsWith('__')) return `${u.origin}/${parts[0]}`;
      } catch { /* */ }
      return null;
    },
  },
  // Recruitee
  {
    parser: 'recruitee',
    pattern: /[a-z0-9-]+\.recruitee\.com/i,
    extractAtsUrl: (href) => {
      try {
        const u = new URL(href);
        return u.origin;
      } catch { return null; }
    },
  },
  // Personio
  {
    parser: 'personio',
    pattern: /[a-z0-9-]+\.jobs\.personio\.(de|com)/i,
    extractAtsUrl: (href) => {
      try {
        const u = new URL(href);
        return u.origin;
      } catch { return null; }
    },
  },
  // Softgarden
  {
    parser: 'softgarden',
    pattern: /[a-z0-9-]+\.career\.softgarden\.de/i,
    extractAtsUrl: (href) => {
      try {
        const u = new URL(href);
        return u.origin;
      } catch { return null; }
    },
  },
  // Teamtailor — look for links pointing to *.teamtailor.com
  {
    parser: 'teamtailor',
    pattern: /[a-z0-9-]+\.teamtailor\.com/i,
    extractAtsUrl: (href) => {
      try {
        const u = new URL(href);
        const slug = u.hostname.replace(/\.teamtailor\.com$/i, '');
        if (['assets-aws', 'assets', 'api', 'app', 'screenshots'].includes(slug)) return null;
        // www.teamtailor.com "powered by" links carry the custom career domain
        // in the utm_content query parameter (e.g. utm_content=careers.hadrian.io)
        if (slug === 'www') {
          const customDomain = u.searchParams.get('utm_content');
          if (customDomain && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(customDomain)) {
            return `https://${customDomain}`;
          }
          return null;
        }
        return u.origin;
      } catch { return null; }
    },
  },
  // UltiPro / UKG
  {
    parser: 'ultipro',
    pattern: /recruiting\.ultipro\.com\/[a-z0-9_-]+/i,
    extractAtsUrl: (href) => {
      try {
        const u = new URL(href);
        return u.origin + u.pathname.replace(/\/+$/, '');
      } catch { return null; }
    },
  },
  // Crelate
  {
    parser: 'crelate',
    pattern: /jobs\.crelate\.com\/portal\/[a-z0-9_-]+/i,
    extractAtsUrl: (href) => {
      try { return href; } catch { return null; }
    },
  },
  // SuccessFactors Career Site Builder (CSB) — custom-domain pages embed scripts
  // from hcm*.sapsf.eu or career*.sapsf.eu.  We can't reconstruct the canonical
  // ATS URL from just the script URL (we need to fetch the page for ssoCompanyId
  // + ssoUrl), so atsUrl is intentionally null here; the parser handles it via
  // sfExtractCSBInfo().
  {
    parser: 'successfactors',
    pattern: /(?:hcm|career)\d*\.sapsf\.(eu|com)/i,
    extractAtsUrl: (_href) => null,
  },
  // Join.com
  {
    parser: 'join',
    pattern: /join\.com\/companies\/[a-z0-9_-]+/i,
    extractAtsUrl: (href) => {
      try {
        const u = new URL(href);
        const parts = u.pathname.split('/').filter(Boolean);
        if (parts[0] === 'companies' && parts[1]) return `${u.origin}/companies/${parts[1]}`;
      } catch { /* */ }
      return null;
    },
  },
  // JazzHR / The Resumator — job links go to {slug}.applytojob.com/apply/...
  {
    parser: 'jazzhr',
    pattern: /[a-z0-9-]+\.applytojob\.com/i,
    extractAtsUrl: (href) => {
      try {
        const u = new URL(href);
        if (!u.hostname.endsWith('.applytojob.com')) return null;
        return `${u.origin}/apply`;
      } catch { return null; }
    },
  },
  // Jobylon — job links point to emp.jobylon.com/jobs/{id}-{slug}/
  {
    parser: 'jobylon',
    pattern: /emp\.jobylon\.com\/jobs\/\d+/i,
    extractAtsUrl: (href) => {
      // Try to find the company page URL from the job URL slug
      // Job URLs: emp.jobylon.com/jobs/{jobId}-{company}-{title}/
      // We can't determine the company ID from the job URL alone,
      // so return null — detection will find the company page separately.
      return null;
    },
  },
  // d.vinci — job links point to {tenant}.dvinci-hr.com/en/jobs/{id}/...
  {
    parser: 'dvinci',
    pattern: /[a-z0-9-]+\.dvinci-hr\.com\/(?:en|de)\/jobs\/\d+/i,
    extractAtsUrl: (href) => {
      try {
        const u = new URL(href);
        // Reconstruct the listing URL from any job link
        return `${u.origin}/en/jobs/iframe`;
      } catch { return null; }
    },
  },
  // Jobylon — CDN embedder script or embed iframe
  {
    parser: 'jobylon',
    pattern: /cdn\.jobylon\.com\/(?:embedder\.js|jobs\/companies\/\d+)/i,
    extractAtsUrl: (href) => {
      try {
        const m = href.match(/companies\/(\d+)/);
        if (m) return `https://emp.jobylon.com/companies/${m[1]}/`;
      } catch { /* */ }
      return null;
    },
  },
];

/**
 * Fingerprint rules tested against the full HTML body text.
 * Ordered by specificity (most specific first).
 */
interface ContentFingerprint {
  parser: string;
  /** All patterns must match for this rule to fire */
  patterns: RegExp[];
  /** Additional cheerio-based check (optional) */
  domCheck?: ($: cheerio.CheerioAPI) => boolean;
}

const CONTENT_FINGERPRINTS: ContentFingerprint[] = [
  // Lever — classic DOM structure
  {
    parser: 'lever',
    patterns: [],
    domCheck: ($) =>
      $('.posting').length > 0 &&
      ($('.posting-btn-submit').length > 0 || $('[data-qa="posting-name"]').length > 0),
  },
  // Greenhouse — classic DOM structure
  {
    parser: 'greenhouse',
    patterns: [],
    domCheck: ($) => $('.opening').length > 0 && $('.location').length > 0,
  },
  // Greenhouse — Remix SPA
  {
    parser: 'greenhouse',
    patterns: [/window\.__remixContext/i, /greenhouse\.io/i],
  },
  // Teamtailor CDN or cookie policy link
  {
    parser: 'teamtailor',
    patterns: [/teamtailor-cdn\.com|teamtailor\.com\/cookie-policy/i],
  },
  // Jobvite SPA
  {
    parser: 'jobvite',
    patterns: [/jv\.careersite/i],
    domCheck: ($) => $('table.jv-job-list').length > 0,
  },
  // Recruitee scripts/CDN
  {
    parser: 'recruitee',
    patterns: [/recruitee\.com|d10zminp1cyta8\.cloudfront\.net/i],
  },
  // Personio scripts/links
  {
    parser: 'personio',
    patterns: [/personio\.(de|com)|workzag/i],
  },
  // UltiPro / UKG CDN
  {
    parser: 'ultipro',
    patterns: [/ultipro\.com|rec-cdn-prod\.cdn\.ultipro\.com/i],
  },
  // SmartRecruiters CDN
  {
    parser: 'smartrecruiters',
    patterns: [/smartrecruiters\.com|smartrecruiters-cdn\.com/i],
  },
  // Softgarden API / generator tag
  {
    parser: 'softgarden',
    patterns: [/career\.softgarden\.de|softgarden Karriereseite Pro|pcw-api\.softgarden\.de/i],
  },
  // Workday SPA
  {
    parser: 'workday',
    patterns: [/myworkdayjobs\.com|window\.workday|wday\/cxs/i],
  },
  // iCIMS CDN / table / Jibe integration
  {
    parser: 'icims',
    patterns: [/\.icims\.com|iCIMS_JobsTable|jibeapply|jibecdn\.com/i],
  },
  // Eightfold AI
  {
    parser: 'eightfold',
    patterns: [/eightfold\.ai|_EF_GROUP_ID|vscdn\.net\/fonts\/css\/eightfold/i],
  },
  // SuccessFactors DWR
  {
    parser: 'successfactors',
    patterns: [/successfactors\.(eu|com|cn|sa)|careerJobSearchControllerProxy|sapsf\.(eu|com)/i],
  },
  // Delivery Hero (Attrax ATS)
  {
    parser: 'deliveryhero',
    patterns: [/attraxAntiforgeryToken/i],
    domCheck: () => true, // only fires if attrax token is present
  },
  // Ashby — embedded widgets / scripts
  {
    parser: 'ashby',
    patterns: [/ashbyhq\.com/i],
  },
  // Crelate — app.crelate.com scripts
  {
    parser: 'crelate',
    patterns: [/app\.crelate\.com|crelate\.com\/portal/i],
  },
  // Join.com — embedded widget
  {
    parser: 'join',
    patterns: [/join\.com\/api\/widget/i],
  },
  // JazzHR / The Resumator — class names and JS vars
  {
    parser: 'jazzhr',
    patterns: [/resumator-jobboard|applytojob\.com|DV_PAGE_TITLE\s*=\s*["']JazzHR["']/i],
  },
  // TalentsConnect / job-shop.com — CDN, API and font domains
  {
    parser: 'talentsconnect',
    patterns: [/api\.my-job-shop\.com|cdn\.job-shop\.com|tc-media\.job-shop\.com|talentsconnect-ag\.de/i],
  },
  // OTTO — Weblication CMS with SAP OData backend
  {
    parser: 'otto',
    patterns: [/Weblication/i, /\/or\/sap\/opu\/odata\/OTTO/i],
  },
  // Jobylon — embed widget, CDN references, or jobylon-form class
  {
    parser: 'jobylon',
    patterns: [/cdn\.jobylon\.com|emp\.jobylon\.com|jobylon-form/i],
  },
  // d.vinci — dvinci-hr.com references, meta tags, AngularJS app, or static CDN
  {
    parser: 'dvinci',
    patterns: [/dvinci-hr\.com|dvinci-easy\.com|dvinci\.apps\.Dvinci|dvinciVersion/i],
  },
  // DYMATRIX — TYPO3 UdgJobs extension
  {
    parser: 'dymatrix',
    patterns: [/tx_udgjobs/i],
  },
  // Rohde & Schwarz — custom FirstSpirit jobboard widget
  {
    parser: 'rohdeschwarz',
    patterns: [],
    domCheck: ($) =>
      $('[data-view="jobboard-table"]').length > 0 &&
      $('[data-view="jobboard-filter"]').length > 0,
  },
  // Schwarz IT / Schwarz Group — Trinity CMS with DigitsSearch component
  {
    parser: 'schwarzit',
    patterns: [/DigitsSearch|DigitsJobDetailPage|assets-digits/i],
  },
];

/**
 * Detect ALL distinct ATS sources referenced by a page's HTML.
 *
 * The link-scanning stage collects every unique ATS URL found across all
 * <a href>, <script src>, and <iframe src> attributes — so a page that links
 * to both `careers-na-*.icims.com` and `careers-uk-*.icims.com` will return
 * two separate DetectionResult entries (same parser, different atsUrl).
 *
 * Non-link stages (DOM fingerprinting, meta, inline scripts, iframes) return
 * a single result and are only reached when link-scanning finds nothing.
 */
export function detectAllFromHtml(url: string, html: string): DetectionResult[] {
  const $ = cheerio.load(html);

  // ── Collect all URLs from links, scripts, iframes ──────────────────────────
  const allHrefs: string[] = [];
  $('a[href]').each((_i, el) => {
    const href = $(el).attr('href');
    if (href) {
      try {
        allHrefs.push(new URL(href, url).toString());
      } catch {
        allHrefs.push(href);
      }
    }
  });

  const allScriptSrcs: string[] = [];
  $('script[src]').each((_i, el) => {
    const src = $(el).attr('src');
    if (src) {
      try {
        allScriptSrcs.push(new URL(src, url).toString());
      } catch {
        allScriptSrcs.push(src);
      }
    }
  });

  const allIframeSrcs: string[] = [];
  $('iframe[src]').each((_i, el) => {
    const src = $(el).attr('src');
    if (src) {
      try {
        allIframeSrcs.push(new URL(src, url).toString());
      } catch {
        allIframeSrcs.push(src);
      }
    }
  });

  // Combine all external URLs for link-pattern scanning
  const allUrls = [...allHrefs, ...allScriptSrcs, ...allIframeSrcs];

  // Also extract raw URLs embedded in the HTML text (JSON blobs, inline scripts,
  // data attributes, etc.) that wouldn't appear in element attributes.
  // This handles custom career pages that embed ATS job links in __NEXT_DATA__,
  // window.__appData, or other JSON/script payloads rather than real <a> tags.
  const elementUrlSet = new Set(allUrls);
  const rawTextUrls: string[] = [];
  for (const m of html.matchAll(/https?:\/\/[^\s"'<>)\\]+/g)) {
    const u = m[0].replace(/[,;]+$/, ''); // strip trailing punctuation
    if (!elementUrlSet.has(u)) rawTextUrls.push(u);
  }

  // ── Stage 2a: Scan links/iframes/scripts for known ATS domain patterns ────
  // Track each unique atsUrl separately so we can return multiple sources.
  // Key: `${parser}::${atsUrl}` → hit count
  const linkHitsByAtsUrl = new Map<string, { parser: string; atsUrl: string | null; count: number }>();

  for (const href of [...allUrls, ...rawTextUrls]) {
    for (const rule of LINK_RULES) {
      if (rule.pattern.test(href)) {
        const atsUrl = rule.extractAtsUrl ? rule.extractAtsUrl(href) : null;
        const key = `${rule.parser}::${atsUrl ?? '__none__'}`;
        const existing = linkHitsByAtsUrl.get(key);
        if (existing) {
          existing.count++;
        } else {
          linkHitsByAtsUrl.set(key, { parser: rule.parser, atsUrl, count: 1 });
        }
        break; // one rule per href
      }
    }
  }

  if (linkHitsByAtsUrl.size > 0) {
    // For Jobvite: if the only hit is the infrastructure path (atsUrl = null,
    // stored under "__none__"), try to upgrade it with the company slug from
    // the embedded career-site widget attribute <div data-careersite="{slug}">.
    const jvNoneHit = linkHitsByAtsUrl.get('jobvite::__none__');
    if (jvNoneHit) {
      const jvSlug = $('[data-careersite]').first().attr('data-careersite');
      if (jvSlug) {
        linkHitsByAtsUrl.delete('jobvite::__none__');
        linkHitsByAtsUrl.set(`jobvite::https://jobs.jobvite.com/${jvSlug}`, {
          parser: 'jobvite',
          atsUrl: `https://jobs.jobvite.com/${jvSlug}`,
          count: jvNoneHit.count,
        });
      }
    }

    // For SuccessFactors: links embedded in JSON with \u0026 encoding get their URLs
    // truncated by the raw-text URL regex (which stops at backslash), so the company
    // param is lost and all hits collapse to successfactors::__none__.  Recover the
    // company ID by scanning the raw HTML for the known URL structure.
    const sfNoneHit = linkHitsByAtsUrl.get('successfactors::__none__');
    if (sfNoneHit) {
      // Match the SF host and the company param even when separated by \u0026 sequences
      const sfMatch = html.match(/(career\d+\.successfactors\.[a-z]{2,3})[^"']{0,200}?company=([a-z0-9_-]+)/i);
      if (sfMatch) {
        const sfHost = sfMatch[1];
        const sfCompany = sfMatch[2];
        const canonicalUrl = `https://${sfHost}/career?company=${encodeURIComponent(sfCompany)}`;
        linkHitsByAtsUrl.delete('successfactors::__none__');
        linkHitsByAtsUrl.set(`successfactors::${canonicalUrl}`, {
          parser: 'successfactors',
          atsUrl: canonicalUrl,
          count: sfNoneHit.count,
        });
      }
    }

    // Sort by parser name then by hit count descending
    const sorted = [...linkHitsByAtsUrl.values()].sort((a, b) => {
      if (a.parser !== b.parser) return a.parser.localeCompare(b.parser);
      return b.count - a.count;
    });
    return sorted.map((hit) => ({
      parser: hit.parser,
      atsUrl: hit.atsUrl ?? undefined,
      method: 'links' as const,
    }));
  }

  // ── Stage 2b: DOM fingerprinting ──────────────────────────────────────────
  // Special case: Jobvite embedded career-site widget.
  // The page contains a <div class="jv-careersite" data-careersite="{slug}">
  // element whose data-careersite attribute is the company slug.
  const jvSlug = $('[data-careersite]').first().attr('data-careersite');
  if (jvSlug) {
    return [{ parser: 'jobvite', atsUrl: `https://jobs.jobvite.com/${jvSlug}`, method: 'dom' }];
  }

  // Special case: WordPress / custom Greenhouse block widget.
  // Some sites embed a <section data-board="{slug}"> element — the value is the
  // Greenhouse board token, used by a companion JS bundle that calls
  // https://boards-api.greenhouse.io/v1/boards/${slug}/jobs
  // Only treat it as Greenhouse when the class also references "open-roles"
  // (the naming convention used by known Greenhouse WordPress block themes)
  // to avoid false positives from other `data-board` usages.
  const ghBoardEl = $('[data-board]').filter((_i, el) => {
    const cls = ($(el).attr('class') ?? '').toLowerCase();
    return cls.includes('open-roles') || cls.includes('greenhouse') || cls.includes('gh-jobs');
  }).first();
  const ghBoardSlug = ghBoardEl.attr('data-board');
  if (ghBoardSlug && /^[a-z0-9][a-z0-9_-]{1,60}$/i.test(ghBoardSlug)) {
    return [{ parser: 'greenhouse', atsUrl: `https://boards.greenhouse.io/${ghBoardSlug}`, method: 'dom' }];
  }

  for (const fp of CONTENT_FINGERPRINTS) {
    const patternsMatch = fp.patterns.length === 0 || fp.patterns.every((p) => p.test(html));
    const domMatch = !fp.domCheck || fp.domCheck($);
    if (patternsMatch && domMatch && (fp.patterns.length > 0 || fp.domCheck)) {
      return [{ parser: fp.parser, method: 'dom' }];
    }
  }

  // ── Stage 2c: Check <meta> tags for generator or ATS hints ────────────────
  const generator = $('meta[name="generator"]').attr('content') ?? '';
  if (/teamtailor/i.test(generator)) return [{ parser: 'teamtailor', method: 'meta' }];
  if (/greenhouse/i.test(generator)) return [{ parser: 'greenhouse', method: 'meta' }];
  if (/lever/i.test(generator)) return [{ parser: 'lever', method: 'meta' }];
  if (/workable/i.test(generator)) return [{ parser: 'workable', method: 'meta' }];
  if (/ashby/i.test(generator)) return [{ parser: 'ashby', method: 'meta' }];
  if (/smartrecruiters/i.test(generator)) return [{ parser: 'smartrecruiters', method: 'meta' }];
  if (/recruitee/i.test(generator)) return [{ parser: 'recruitee', method: 'meta' }];
  if (/personio/i.test(generator)) return [{ parser: 'personio', method: 'meta' }];

  const ogSiteName = $('meta[property="og:site_name"]').attr('content') ?? '';
  if (/teamtailor/i.test(ogSiteName)) return [{ parser: 'teamtailor', method: 'meta' }];

  // d.vinci — meta tags on detail pages
  const dvinciVersion = $('meta[name="dvinciVersion"]').attr('content') ?? '';
  const tenantId = $('meta[name="tenantId"]').attr('content') ?? '';
  if (dvinciVersion || tenantId) return [{ parser: 'dvinci', method: 'meta' }];

  // ── Stage 2d: Inline <script> content scanning ────────────────────────────
  let inlineScripts = '';
  $('script:not([src])').each((_i, el) => {
    inlineScripts += $(el).html() ?? '';
  });

  if (/window\._EF_GROUP_ID/i.test(inlineScripts)) return [{ parser: 'eightfold', method: 'scripts' }];
  if (/window\.workday/i.test(inlineScripts)) return [{ parser: 'workday', method: 'scripts' }];
  if (/window\.__remixContext.*greenhouse/i.test(inlineScripts)) return [{ parser: 'greenhouse', method: 'scripts' }];
  if (/jibeapply|icims/i.test(inlineScripts)) return [{ parser: 'icims', method: 'scripts' }];
  if (/ashbyhq\.com/i.test(inlineScripts)) return [{ parser: 'ashby', method: 'scripts' }];
  if (/lever\.co/i.test(inlineScripts) && /postings/i.test(inlineScripts)) return [{ parser: 'lever', method: 'scripts' }];
  // Lever embed widget: window.leverJobsOptions = {accountName: "slug"}
  // Used by sites that embed Lever via a third-party widget (e.g. lever-jobs-embed)
  // without any direct jobs.lever.co reference in the inline scripts.
  const leverEmbedMatch = inlineScripts.match(/leverJobsOptions\s*=\s*\{[^}]*accountName\s*:\s*["']([a-z0-9_-]+)["']/i);
  if (leverEmbedMatch) return [{ parser: 'lever', atsUrl: `https://jobs.lever.co/${leverEmbedMatch[1]}`, method: 'scripts' }];
  if (/recruitee/i.test(inlineScripts)) return [{ parser: 'recruitee', method: 'scripts' }];
  if (/smartrecruiters/i.test(inlineScripts)) return [{ parser: 'smartrecruiters', method: 'scripts' }];
  if (/successfactors/i.test(inlineScripts)) return [{ parser: 'successfactors', method: 'scripts' }];
  if (/personio/i.test(inlineScripts)) return [{ parser: 'personio', method: 'scripts' }];
  if (/softgarden/i.test(inlineScripts)) return [{ parser: 'softgarden', method: 'scripts' }];
  if (/crelate/i.test(inlineScripts)) return [{ parser: 'crelate', method: 'scripts' }];
  if (/resumator-jobboard|DV_PAGE_TITLE\s*=\s*["']JazzHR["']/i.test(inlineScripts)) return [{ parser: 'jazzhr', method: 'scripts' }];
  if (/api\.my-job-shop\.com|cdn\.job-shop\.com|talentsconnect/i.test(inlineScripts)) return [{ parser: 'talentsconnect', method: 'scripts' }];

  // ── Stage 2e: iframe-based detection ──────────────────────────────────────
  for (const src of allIframeSrcs) {
    const iframeParser = detectParserFromUrl(src);
    if (iframeParser) {
      return [{ parser: iframeParser, atsUrl: src, method: 'iframes' }];
    }
  }

  return [];
}

/**
 * Detect ATS from HTML content only (no URL matching).
 * Returns only the first (best) result. Use detectAllFromHtml() to get all.
 */
export function detectParserFromHtml(url: string, html: string): DetectionResult | null {
  return detectAllFromHtml(url, html)[0] ?? null;
}


// ─────────────────────────────────────────────────────────────────────────────
// Stage 3: JS bundle scanning helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Scan raw text (JS bundle content, etc.) for embedded ATS URLs using the
 * LINK_RULES patterns. Used by the JS-bundle scanning stage.
 */
function scanRawTextForAts(text: string): DetectionResult[] {
  const linkHitsByAtsUrl = new Map<string, { parser: string; atsUrl: string | null; count: number }>();
  for (const m of text.matchAll(/https?:\/\/[^\s"'`<>)\\]+/g)) {
    const u = m[0].replace(/[,;]+$/, '');
    for (const rule of LINK_RULES) {
      if (rule.pattern.test(u)) {
        const atsUrl = rule.extractAtsUrl ? rule.extractAtsUrl(u) : null;
        const key = `${rule.parser}::${atsUrl ?? '__none__'}`;
        const existing = linkHitsByAtsUrl.get(key);
        if (existing) existing.count++;
        else linkHitsByAtsUrl.set(key, { parser: rule.parser, atsUrl, count: 1 });
        break;
      }
    }
  }
  if (linkHitsByAtsUrl.size === 0) return [];
  return [...linkHitsByAtsUrl.values()]
    .sort((a, b) => b.count - a.count)
    .map((hit) => ({ parser: hit.parser, atsUrl: hit.atsUrl ?? undefined, method: 'scripts' as const }));
}

/**
 * For Gatsby/Next.js SPAs that proxy Greenhouse calls through a backend and
 * only store the board slug as a webpack env variable (not as a full URL).
 *
 * Handles these patterns in JS bundles:
 *
 * Pattern 1 — webpack string concatenation (minified):
 *   "https://api.greenhouse.io/v1/boards/"+r.YF+"/jobs/"
 *   YF:function(){return P}
 *   P=(null!==(m="fingerprint")?m:"fallback")
 *
 * Pattern 2 — template literal with runtime fallback (WordPress / plain JS):
 *   const BOARD_TOKEN = root.getAttribute("data-board") || 'datavant2'
 *   const apiUrl = `https://boards-api.greenhouse.io/v1/boards/${BOARD_TOKEN}/jobs`
 *
 * Returns the slug string (e.g. "datavant2") or null if not found.
 */
function extractGreenhouseSlugFromBundle(text: string): string | null {
  // Pattern 1: webpack string concatenation
  // Step 1: find the API URL construction, e.g.:
  //   "...api.greenhouse.io/v1/boards/"+r.YF+"/jobs"
  const apiUrlPat = /["']https?:\/\/(?:boards-)?api\.greenhouse\.io\/v1\/boards\/["']\s*\+\s*([\w.]+)\s*\+\s*["']\/jobs/;
  const apiMatch = text.match(apiUrlPat);
  if (apiMatch) {
    const varRef = apiMatch[1]; // e.g. "r.YF"

    // If varRef is already a plain identifier (no dot), treat it as the slug directly
    if (/^[a-z][a-z0-9_-]+$/i.test(varRef)) return varRef;

    // Extract the property name from "obj.PROP"
    const propName = varRef.split('.').pop();
    if (propName) {
      // Step 2: find the export wrapper: PROP:function(){return VAR}
      const exportPat = new RegExp(`\\b${propName}\\s*:\\s*function\\s*\\(\\)\\s*\\{\\s*return\\s+(\\w+)\\s*\\}`);
      const exportMatch = text.match(exportPat);
      if (exportMatch) {
        const localVar = exportMatch[1]; // e.g. "P"

        // JS keywords / values that are NOT valid Greenhouse slugs
        const SLUG_DENYLIST = new Set(['undefined', 'null', 'true', 'false', 'this', 'new', 'return', 'function', 'var', 'let', 'const']);

        // Step 3a — null-coalescing ternary:
        //   VAR=(p=...,h=...,null!==(m="slug")?m:"fallback")
        const ternaryPat = new RegExp(`(?<![\\w.])${localVar}\\s*=\\s*[^;{]*?null\\s*!==\\s*\\(\\s*\\w\\s*=\\s*["']([a-z][a-z0-9_-]*)["']\\s*\\)`);
        const ternaryMatch = text.match(ternaryPat);
        if (ternaryMatch && !SLUG_DENYLIST.has(ternaryMatch[1])) return ternaryMatch[1];

        // Step 3b — simple string assignment: VAR="slug"
        const simpleAssignPat = new RegExp(`(?<![\\w.])${localVar}\\s*=\\s*["']([a-z][a-z0-9_-]*)["'](?![\\w-])`);
        const simpleMatch = text.match(simpleAssignPat);
        if (simpleMatch && !SLUG_DENYLIST.has(simpleMatch[1])) return simpleMatch[1];
      }
    }
  }

  // Pattern 2: template literal with runtime default fallback.
  // Looks for:  `https://boards-api.greenhouse.io/v1/boards/${VARNAME}/jobs`
  // Then finds: const VARNAME = <anything> || 'slug'
  const templatePat = /`https?:\/\/boards-api(?:\.eu)?\.greenhouse\.io\/v1\/boards\/\$\{(\w+)\}\/jobs/;
  const templateMatch = text.match(templatePat);
  if (templateMatch) {
    const varName = templateMatch[1]; // e.g. "BOARD_TOKEN" or "boardToken"
    // Find the fallback string: VARNAME = ... || 'slug'  or  VARNAME = ... || "slug"
    const fallbackPat = new RegExp(`\\b${varName}\\b[\\s\\S]{0,300}?\\|\\|\\s*['"]([a-z][a-z0-9_-]*)['"]`);
    const fallbackMatch = text.match(fallbackPat);
    if (fallbackMatch) return fallbackMatch[1];
  }

  return null;
}

// Filenames / URLs that indicate framework/vendor/runtime code unlikely to contain ATS URLs.
// Tested against the full URL (not just pathname) so analytics CDN hostnames are also caught.
const JS_SKIP_PATTERN = /polyfill|framework|runtime|vendor|webpack|gtm|analytics|segment|intercom|zendesk|recaptcha|sentry|clarity|hotjar|hubspot|drift/i;

/**
 * For SPAs (Gatsby, Next.js, custom React) that ship Greenhouse/Lever/etc.
 * API URLs inside their compiled JS bundles: fetch candidate app bundles and
 * scan them for embedded ATS URLs.
 *
 * Only runs when all HTML-based detection stages have found nothing.
 * Limits fetched bundles to avoid being slow (max 8 files, max 512KB each).
 */
async function scanJsBundlesForAts(pageUrl: string, html: string): Promise<DetectionResult[]> {
  const $ = cheerio.load(html);
  const pageOrigin = (() => { try { return new URL(pageUrl).origin; } catch { return ''; } })();

  // Collect <script src> URLs from the page.
  // We intentionally include cross-origin scripts because many modern sites
  // host their app bundles on a separate CDN or deployment subdomain
  // (e.g. Vercel preview URLs, Cloudflare Pages, custom CDN prefixes).
  // The JS_SKIP_PATTERN guards against fetching known 3rd-party analytics /
  // framework bundles — tested against the full URL so that CDN hostnames
  // like googletagmanager.com are caught even without a telltale filename.
  const scriptSrcs: string[] = [];
  $('script[src]').each((_i, el) => {
    const src = $(el).attr('src');
    if (!src) return;
    try {
      const fullUrl = new URL(src, pageUrl).toString();
      const { pathname } = new URL(fullUrl);
      // Skip known framework / polyfill / analytics bundles (test full URL)
      if (JS_SKIP_PATTERN.test(fullUrl)) return;
      // Skip sourcemap and manifest files that never contain app logic
      if (/\.map$|_buildManifest|_ssgManifest/i.test(pathname)) return;
      scriptSrcs.push(fullUrl);
    } catch { /* */ }
  });

  // Also collect <link rel="modulepreload"> and <link rel="preload" as="script">
  // URLs. Modern Nuxt/Vite apps use ES module preloading via <link> tags rather
  // than <script src> for their code-split chunks.
  const seenUrls = new Set(scriptSrcs);
  $('link[rel="modulepreload"][href], link[rel="preload"][as="script"][href]').each((_i, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    try {
      const fullUrl = new URL(href, pageUrl).toString();
      if (seenUrls.has(fullUrl)) return;
      if (JS_SKIP_PATTERN.test(fullUrl)) return;
      if (/\.map$|_buildManifest|_ssgManifest/i.test(new URL(fullUrl).pathname)) return;
      scriptSrcs.push(fullUrl);
      seenUrls.add(fullUrl);
    } catch { /* */ }
  });

  // Sort: prefer page-specific bundles first, then app/main/index, then the rest.
  // Extract the last meaningful path segment of the page URL to detect page-specific bundles
  // e.g. for "https://moniepoint.com/careers" the segment is "careers"
  const pagePathSegment = (() => {
    try {
      const parts = new URL(pageUrl).pathname.split('/').filter(Boolean);
      return parts[parts.length - 1]?.toLowerCase() ?? '';
    } catch { return ''; }
  })();

  scriptSrcs.sort((a, b) => {
    const priority = (u: string) => {
      const p = new URL(u).pathname.toLowerCase();
      // Page-specific bundle (e.g. Next.js pages/careers-*.js) — highest priority
      if (pagePathSegment && new RegExp(`[/]${pagePathSegment}[.\\-]`, 'i').test(p)) return 0;
      // Named app / main / index entry bundles
      if (/\/(app|main|index)[.\-_][a-z0-9]/i.test(p)) return 1;
      // Webpack code-split numbered chunks (e.g. 8241.6e36e79e.js).
      // These contain feature-specific code and often embed ATS API URLs.
      if (/\/\d+[.\-][a-f0-9]{6,}/i.test(p)) return 2;
      // Next.js page bundles (pages/*.js) — page-specific but may be large
      if (/\/pages\//i.test(p)) return 3;
      // Generic hash-named chunks and other bundles
      return 4;
    };
    return priority(a) - priority(b);
  });

  // Scan up to 20 bundles. Higher limit is needed for Nuxt/Vue/React apps
  // (e.g. Zapier, Builder.io, Mercedes-Benz Tech Innovation) that split ATS
  // logic into late-numbered code-split chunks.
  const candidates = scriptSrcs.slice(0, 20);
  for (const src of candidates) {
    try {
      const resp = await fetch(src, {
        method: 'GET',
        signal: AbortSignal.timeout(8_000),
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept': '*/*',
        },
        redirect: 'follow',
      });
      if (!resp.ok) continue;
      const buf = await resp.arrayBuffer();
      const text = new TextDecoder().decode(new Uint8Array(buf).slice(0, 512 * 1024));
      const results = scanRawTextForAts(text);

      // For Greenhouse results, try to upgrade the atsUrl using the actual
      // API slug extracted from webpack variable patterns.
      // This handles SPAs where the board display URL (boards.greenhouse.io/oldslug)
      // differs from the real API slug stored in an env variable.
      if (results.length > 0) {
        const ghIdx = results.findIndex(r => r.parser === 'greenhouse');
        if (ghIdx >= 0) {
          const apiSlug = extractGreenhouseSlugFromBundle(text);
          if (apiSlug) {
            results[ghIdx] = {
              ...results[ghIdx],
              atsUrl: `https://boards.greenhouse.io/${apiSlug}`,
            };
          }
        }

        // For Workday results with origin-only URL (no siteId), discover the
        // siteId via robots.txt.  Custom career sites (e.g. Nuxt/Vue SPAs)
        // often embed only the Workday origin as a URL prefix check, without
        // the full board path.
        const wdIdx = results.findIndex(r => r.parser === 'workday');
        if (wdIdx >= 0 && results[wdIdx].atsUrl) {
          try {
            const wdUrl = new URL(results[wdIdx].atsUrl!);
            const pathParts = wdUrl.pathname.split('/').filter(Boolean);
            if (pathParts.length === 0) {
              // Origin-only URL — discover siteId from robots.txt
              const siteId = await discoverWorkdaySiteId(wdUrl.origin);
              if (siteId) {
                results[wdIdx] = {
                  ...results[wdIdx],
                  atsUrl: `${wdUrl.origin}/${siteId}`,
                };
              }
            }
          } catch { /* ignore URL parse errors */ }
        }

        return results;
      }

      // Second pass: template-literal Greenhouse API URLs (e.g. boards-api.greenhouse.io
      // inside a backtick string) are not matched by scanRawTextForAts because the URL
      // character class excludes backticks.  Try extractGreenhouseSlugFromBundle directly.
      if (/boards-api(?:\.eu)?\.greenhouse\.io/i.test(text)) {
        const apiSlug = extractGreenhouseSlugFromBundle(text);
        if (apiSlug) {
          return [{ parser: 'greenhouse', atsUrl: `https://boards.greenhouse.io/${apiSlug}`, method: 'scripts' as const }];
        }
      }
    } catch { /* timeout or fetch error — skip */ }
  }
  return [];
}

/**
 * Stage 4: Follow a single job-detail link from a custom career portal.
 *
 * Some companies (e.g. Mozilla) build a fully custom careers frontend that
 * proxies an ATS (Greenhouse, Lever, …) server-side. Their listing page
 * contains only same-domain links like /careers/position/gh/12345/ — no
 * external ATS URLs appear until you open an individual job detail page.
 *
 * This function finds the first same-domain link whose pathname looks like an
 * individual job detail page, fetches it, and runs the full HTML detection
 * pipeline on the result. Only called when all earlier stages found nothing.
 */
async function followJobDetailLink(pageUrl: string, html: string): Promise<DetectionResult[]> {
  const $ = cheerio.load(html);
  let pageOrigin = '';
  try { pageOrigin = new URL(pageUrl).origin; } catch { return []; }

  // Pathname segments that indicate an individual job detail page rather than
  // a listing / filter / info page.
  const JOB_PATH_RE = /\/(?:job|position|opening|role|vacancy)[s]?\/[^/?#]{2,}/i;

  const seen = new Set<string>();
  const candidates: string[] = [];

  $('a[href]').each((_i, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    try {
      const full = new URL(href, pageUrl);
      // Same origin, must look like a job detail path, must not be the page itself
      if (full.origin !== pageOrigin) return;
      if (!JOB_PATH_RE.test(full.pathname)) return;
      if (full.pathname === new URL(pageUrl).pathname) return;
      if (!seen.has(full.href)) {
        seen.add(full.href);
        candidates.push(full.href);
      }
    } catch { /* */ }
  });

  if (candidates.length === 0) return [];

  // Fetch only the first candidate — one extra round-trip is enough
  try {
    const result = await fetchHtml(candidates[0]);
    if (result.error || !result.html) return [];
    const found = detectAllFromHtml(candidates[0], result.html);
    // Re-tag results so callers know this came from a followed link
    return found.map((r) => ({ ...r, method: 'follow' as const }));
  } catch {
    return [];
  }
}

/**
 * Full deep detection: fetches the page HTML and runs all detection stages.
 * Returns ALL distinct ATS sources found (multiple when a page links to
 * several distinct ATS URLs, e.g. different regional iCIMS boards).
 * Returns an empty array if no ATS can be identified.
 */
export async function detectAllDeep(url: string): Promise<DetectionResult[]> {
  // Stage 1: URL-based (single result, already a canonical ATS URL)
  const fromUrl = detectParserFromUrl(url);
  if (fromUrl) return [{ parser: fromUrl, method: 'url' }];

  // Stage 2: Fetch HTML and analyse content
  let html = '';
  try {
    let result = await fetchHtml(url);
    // Some static sites (e.g. GitHub Pages) return 404 for URLs with a trailing
    // slash but serve 200 for the same path without it. Retry once.
    if ((result.error || !result.html) && url.endsWith('/')) {
      result = await fetchHtml(url.slice(0, -1));
    }
    if (result.error || !result.html) return [];
    html = result.html;
  } catch {
    return [];
  }

  const fromHtml = detectAllFromHtml(url, html);
  if (fromHtml.length > 0) return fromHtml;

  // Stage 3: Scan external JS bundles for embedded ATS URLs.
  // Handles SPAs (Gatsby, Next.js, custom React) that fetch ATS data
  // client-side without surfacing any ATS URLs in the server-rendered HTML.
  const fromBundles = await scanJsBundlesForAts(url, html);
  if (fromBundles.length > 0) return fromBundles;

  // Stage 4: Follow a job-detail link from the page.
  // Handles custom career portals that proxy an ATS but only expose the
  // ATS URL on individual job detail pages (e.g. mozilla.org/careers).
  return followJobDetailLink(url, html);
}

/**
 * Full deep detection: fetches the page HTML and runs all detection stages.
 * Returns only the first (best) result. Use detectAllDeep() to get all.
 */
export async function detectParserDeep(url: string): Promise<DetectionResult | null> {
  const all = await detectAllDeep(url);
  return all[0] ?? null;
}

/**
 * Auto-detect the best parser for a given URL + HTML content.
 * Checks URL patterns first, then falls back to DOM fingerprints.
 * @deprecated Use detectParserFromHtml() or detectAllDeep() for richer results.
 */
export function detectParser(url: string, html: string): string {
  // URL-based detection (most reliable)
  const fromUrl = detectParserFromUrl(url);
  if (fromUrl) return fromUrl;

  // HTML-based detection
  const fromHtml = detectParserFromHtml(url, html);
  if (fromHtml) return fromHtml.parser;

  throw new Error(`No parser recognized for URL: ${url}`);
}
