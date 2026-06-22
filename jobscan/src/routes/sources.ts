import { Router, Request, Response } from 'express';
import * as db from '../db/index';
import { runSyncOneSource } from '../sync';
import { scrapeSource } from '../scraper';
import { isUrl404 } from '../fetch-utils';
import { parserNames, detectParserFromUrl, detectAllDeep, DetectionResult } from '../parsers/registry';
import { greenhouseApiDetect } from '../parsers/greenhouse';
import { leverApiDetect } from '../parsers/lever';
import { workableApiDetect } from '../parsers/workable';
import { ashbyDetect } from '../parsers/ashby';
import { teamtailorDetect } from '../parsers/teamtailor';
import { jobviteDetect } from '../parsers/jobvite';
import { recruiteeDetect } from '../parsers/recruitee';
import { joinDetect } from '../parsers/join';
import { personioApiDetect } from '../parsers/personio';
import { crelateApiDetect } from '../parsers/crelate';
import { ultiproDetect } from '../parsers/ultipro';
import { smartrecruitersApiDetect } from '../parsers/smartrecruiters';
import { softgardenApiDetect } from '../parsers/softgarden';
import { workdayApiDetect } from '../parsers/workday';
import { icimsApiDetect } from '../parsers/icims';
import { eightfoldDetect } from '../parsers/eightfold';
import { successfactorsApiDetect } from '../parsers/successfactors';
import { celonisDetect } from '../parsers/celonis';
import { n26Detect } from '../parsers/n26';
import { deliveryheroDetect } from '../parsers/deliveryhero';
import { teamviewerDetect } from '../parsers/teamviewer';
import { getyourguideDetect } from '../parsers/getyourguide';
import { jazzhrDetect } from '../parsers/jazzhr';
import { talentsconnectDetectCompany } from '../parsers/talentsconnect';
import { ycombinatorDetect } from '../parsers/ycombinator';
import { dynatraceDetect } from '../parsers/dynatrace';
import { picnicDetect } from '../parsers/picnic';
import { jobylonDetect } from '../parsers/jobylon';
import { getroDetect } from '../parsers/getro';
import { Source } from '../types';

// ── Detect-function registry ──────────────────────────────────────────────────
// Maps parser name → async function that resolves company name from a URL
type DetectFn = (url: string) => Promise<{ company: string; error?: string }>;

const detectFnRegistry: Record<string, DetectFn> = {
  greenhouse: greenhouseApiDetect,
  lever: leverApiDetect,
  workable: workableApiDetect,
  ashby: ashbyDetect,
  teamtailor: teamtailorDetect,
  jobvite: jobviteDetect,
  recruitee: recruiteeDetect,
  join: joinDetect,
  personio: personioApiDetect,
  crelate: crelateApiDetect,
  ultipro: ultiproDetect,
  smartrecruiters: smartrecruitersApiDetect,
  softgarden: softgardenApiDetect,
  workday: workdayApiDetect,
  icims: icimsApiDetect,
  eightfold: eightfoldDetect,
  successfactors: successfactorsApiDetect,
  celonis: celonisDetect,
  n26: n26Detect,
  deliveryhero: deliveryheroDetect,
  teamviewer: teamviewerDetect,
  getyourguide: getyourguideDetect,
  jazzhr: jazzhrDetect,
  talentsconnect: talentsconnectDetectCompany,
  ycombinator: ycombinatorDetect,
  dynatrace: dynatraceDetect,
  picnic: picnicDetect,
  jobylon: jobylonDetect,
  getro: getroDetect,
};

const router = Router();

// ── GET /api/sources ─────────────────────────────────────────────────────────
router.get('/', async (req: Request, res: Response) => {
  try {
    // Support paginated or unpaginated (backward compat)
    if (typeof req.query['page'] === 'string') {
      const page = Math.max(1, Number(req.query['page']) || 1);
      const pageSize = Math.min(100, Math.max(1, Number(req.query['pageSize']) || 25));
      const search = typeof req.query['search'] === 'string' ? req.query['search'].trim() : '';
      const status = typeof req.query['status'] === 'string' ? req.query['status'].trim() : '';
      const result = await db.getSourcesPaginated(page, pageSize, search, status);
      res.json(result);
    } else {
      // Unpaginated - used internally by dedup check etc.
      const sources = await db.getSources();
      res.json(sources);
    }
  } catch (err) {
    console.error('[sources] GET / error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /api/sources/parsers  (before /:id to avoid param clash) ─────────────
router.get('/parsers', (_req: Request, res: Response) => {
  res.json(parserNames);
});

// ── POST /api/sources/detect ─────────────────────────────────────────────────
// Fetch the URL, auto-detect company name and best parser. Does NOT save.
// Detection flow:
//   1. URL-pattern matching (instant, no fetch needed)
//   2. If URL doesn't match → fetch HTML and deep-scan for ATS fingerprints:
//      - Scan all <a href>, <script src>, <iframe src> for known ATS domains
//      - DOM fingerprinting (CSS classes, element structures)
//      - <meta> tag analysis (generator, og:site_name)
//      - Inline <script> content scanning (JS config objects)
//   Returns all detected ATS candidates (may be multiple for multi-region pages).
router.post('/detect', async (req: Request, res: Response) => {
  const { url } = req.body as { url?: string };
  const trimmedUrl = (url ?? '').trim();
  if (!trimmedUrl) {
    res.status(400).json({ error: 'url is required' });
    return;
  }
  try { new URL(trimmedUrl); } catch {
    res.status(400).json({ error: 'url must be a valid URL' });
    return;
  }

  // ── Run full detection pipeline (URL-based → HTML deep scan) ──
  let detections: DetectionResult[] = [];
  try {
    detections = await detectAllDeep(trimmedUrl);
  } catch (err) {
    console.error('[detect] Deep detection error:', err);
  }

  if (detections.length === 0) {
    res.status(400).json({
      error: `No ATS recognized for this URL. Supported ATS platforms: ${parserNames.join(', ')}`,
    });
    return;
  }

  // ── Resolve company name for each candidate via parser detect functions ──
  const candidates = await Promise.all(
    detections.map(async ({ parser, atsUrl, method }) => {
      const detectFn = detectFnRegistry[parser];
      let company = '';
      if (detectFn) {
        const detectUrl = atsUrl || trimmedUrl;
        try {
          const result = await detectFn(detectUrl);
          company = result.company || '';
        } catch (err) {
          console.warn(`[detect] ${parser} detect function failed for ${detectUrl}:`, err);
        }
      }
      return {
        parser,
        url: atsUrl || trimmedUrl,
        company,
        detection: { method, ...(atsUrl ? { atsUrl } : {}) },
      };
    }),
  );

  // Single result: return flat response for backward compatibility
  if (candidates.length === 1) {
    const c = candidates[0];
    res.json({ url: c.url, company: c.company, parser: c.parser, detection: c.detection });
    return;
  }

  // Multiple candidates: return flat best + full candidates list
  const best = candidates[0];
  res.json({
    url: best.url,
    company: best.company,
    parser: best.parser,
    detection: best.detection,
    candidates,
  });
});

/**
 * Derive the best URL to probe for a 404 check, given the selected parser.
 *
 * Some ATS platforms are SPAs that always serve HTTP 200 from their HTML page
 * even when the company slug doesn't exist (soft 404).  For those we probe
 * their backing JSON/RSS API instead, which returns real HTTP 404s.
 *
 * Parsers NOT listed here (join, crelate, ultipro, personio, jobvite, default)
 * fall back to checking the raw user-provided URL.
 */
function getPreflightCheckUrl(url: string, parser: string): string {
  try {
    const u = new URL(url);
    const parts = u.pathname.split('/').filter(Boolean);

    switch (parser) {
      case 'greenhouse': {
        // boards-api returns real 404 for unknown slugs
        const slug = parts[0];
        if (slug) return `https://boards-api.greenhouse.io/v1/boards/${slug}`;
        break;
      }
      case 'workable': {
        // SPA always returns 200 — widget API returns real 404
        const slug = parts[0];
        if (slug && slug !== 'j' && slug !== 'api') {
          return `https://apply.workable.com/api/v1/widget/accounts/${slug}`;
        }
        break;
      }
      case 'ashby': {
        // SPA always returns 200 — posting API returns real 404
        const slug = parts[0];
        if (slug) return `https://api.ashbyhq.com/posting-api/job-board/${slug}`;
        break;
      }
      case 'lever': {
        // Lever API returns real 404 for unknown slugs
        const slug = parts[0];
        const isEu = u.hostname.includes('.eu.');
        const base = isEu ? 'https://api.eu.lever.co' : 'https://api.lever.co';
        if (slug) return `${base}/v0/postings/${slug}?mode=json`;
        break;
      }
      case 'recruitee': {
        const m = u.hostname.match(/^([a-z0-9-]+)\.recruitee\.com$/i);
        if (m) return `https://${m[1]}.recruitee.com/api/offers`;
        break;
      }
      case 'teamtailor': {
        const m = u.hostname.match(/^([a-z0-9-]+)\.teamtailor\.com$/i);
        if (m) return `https://${m[1]}.teamtailor.com/jobs.rss`;
        break;
      }
      case 'teamviewer': {
        // TeamTailor-backed custom domain — probe the RSS feed directly
        return `${u.origin}/jobs.rss`;
      }
      case 'smartrecruiters': {
        // SPA always returns 200 — posting API returns real 404 for unknown company
        const identifier = parts[0];
        if (identifier) return `https://api.smartrecruiters.com/v1/companies/${identifier}/postings?limit=1`;
        break;
      }
      case 'softgarden': {
        // Next.js SPA always returns 200 — feed returns real 404 for unknown slugs
        return `${u.origin}/jobs.feed.json`;
      }
      case 'workday': {
        // React SPA always returns 200 — CXS jobs API returns real 404/400 for unknown tenants
        // URL: https://{company}.wd{n}.myworkdayjobs.com/[{locale}/]{siteId}
        const wdMatch = u.hostname.match(/^([a-z0-9-]+)\.(wd\d+)\.myworkdayjobs\.com$/i);
        // Skip optional locale prefix (e.g. "en-US") — same logic as extractWorkdayInfo
        const siteIdIndex = parts[0] && /^[a-z]{2,3}(-[a-zA-Z]{2,4})?$/i.test(parts[0]) ? 1 : 0;
        const siteId = parts[siteIdIndex];
        if (wdMatch && siteId) {
          const tenant = wdMatch[1];
          // We use POST but isUrl404 uses HEAD/GET — probe the listing endpoint with GET
          // A non-existent tenant returns 404; valid tenant returns 200/400
          return `${u.origin}/wday/cxs/${tenant}/${siteId}/jobs`;
        }
        break;
      }
    }
  } catch { /* fall through */ }
  return url; // default: probe the URL itself
}

/**
 * Parsed representation of a URL for dedup comparison.
 * hostname: TLD-stripped, www-stripped, lowercased hostname key.
 * path: pathname with trailing slashes stripped (empty string for root).
 */
interface NormalizedUrl {
  hostname: string;
  path: string;
  query: string; // sorted query string, e.g. "?company=acme"
}

/**
 * Normalize a URL for dedup comparison.
 * Strips protocol, www prefix, and TLD (last segment after final dot).
 * Returns { hostname, path, query } so that path-prefix overlap can be detected.
 * Query string is included so that ATS platforms that identify tenants via query
 * params (e.g. SuccessFactors ?company=X) are not falsely flagged as duplicates.
 */
function normalizeUrlForDedup(raw: string): NormalizedUrl {
  let url = raw.trim();
  // Add protocol if missing so URL constructor can parse it
  if (!/^https?:\/\//i.test(url)) {
    url = 'https://' + url;
  }
  try {
    const parsed = new URL(url);
    let hostname = parsed.hostname.toLowerCase();
    // Strip www. prefix
    hostname = hostname.replace(/^www\./, '');
    // Strip the TLD (last segment after the final dot)
    const lastDot = hostname.lastIndexOf('.');
    if (lastDot > 0) {
      hostname = hostname.substring(0, lastDot);
    }
    // Normalize path: strip trailing slashes
    const path = parsed.pathname.replace(/\/+$/, '') || '';
    // Normalize query: sort params so order differences don't matter
    const sortedParams = [...parsed.searchParams.entries()]
      .sort(([a], [b]) => a.localeCompare(b));
    const query = sortedParams.length > 0
      ? '?' + sortedParams.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')
      : '';
    return { hostname, path, query };
  } catch {
    return { hostname: url.toLowerCase(), path: '', query: '' };
  }
}

/**
 * Returns true when two URLs should be considered duplicates.
 *
 * Matches when:
 *  1. Exact same host+path+query  (e.g. same URL, different protocol/TLD/www)
 *  2. One URL's path is a prefix of the other on the same host, when neither
 *     has a distinguishing query string (e.g. "/jobs" vs "/" — the root covers
 *     everything under the domain)
 *
 * Two URLs with DIFFERENT non-empty query strings on the same path are treated
 * as distinct sources (e.g. SuccessFactors ?company=X vs ?company=Y).
 *
 * The prefix check uses a "/" boundary so "/jobs" does NOT match "/jobs-board".
 */
function isDuplicateUrl(a: NormalizedUrl, b: NormalizedUrl): boolean {
  if (a.hostname !== b.hostname) return false;
  // Different non-empty query strings → always distinct (different ATS tenants)
  if (a.query && b.query && a.query !== b.query) return false;
  if (a.path === b.path && a.query === b.query) return true;
  // Path-prefix logic only applies when query strings are compatible (both empty
  // or one is empty, meaning the URL without a query covers the whole host)
  if (a.query && b.query) return false; // different queries already ruled above
  // Root path ("") is a prefix of every path
  if (a.path === '' || b.path === '') return true;
  // Check proper path-prefix relationship (must be followed by "/")
  if (b.path.startsWith(a.path + '/')) return true;
  if (a.path.startsWith(b.path + '/')) return true;
  return false;
}

// ── POST /api/sources ─────────────────────────────────────────────────────────
router.post('/', async (req: Request, res: Response) => {
  const { company, url, parser } = req.body as {
    company?: string; url?: string; parser?: string;
  };

  const trimmedCompany = (company ?? '').trim();
  if (!trimmedCompany || trimmedCompany.length > 200) {
    res.status(400).json({ error: 'company is required (max 200 characters)' });
    return;
  }

  const trimmedUrl = (url ?? '').trim();
  if (!trimmedUrl || trimmedUrl.length > 2048) {
    res.status(400).json({ error: 'url is required (max 2048 characters)' });
    return;
  }
  try { new URL(trimmedUrl); } catch {
    res.status(400).json({ error: 'url must be a valid URL' });
    return;
  }

  const selectedParser = (parser ?? '').trim();
  if (!selectedParser || !parserNames.includes(selectedParser)) {
    res.status(400).json({ error: `Unknown parser "${selectedParser}". Available parsers: ${parserNames.join(', ')}` });
    return;
  }

  // ── Dedup check: reject URLs that match an existing source after normalization ──
  // Catches exact matches AND path-prefix overlaps (e.g. "/jobs" vs "/").
  const normalizedNew = normalizeUrlForDedup(trimmedUrl);
  const existingSources = await db.getSources();
  const duplicate = existingSources.find(
    (s) => isDuplicateUrl(normalizeUrlForDedup(s.url), normalizedNew)
  );
  if (duplicate) {
    res.status(409).json({
      error: `Duplicate source: "${trimmedUrl}" matches existing source "${duplicate.url}" (${duplicate.company}).`
    });
    return;
  }

  // ── Pre-flight: reject URLs that return 404 ──────────────────────────────
  const notFound = await isUrl404(getPreflightCheckUrl(trimmedUrl, selectedParser));
  if (notFound) {
    res.status(400).json({
      error: `The URL returned a 404 (page not found). Please verify the careers page URL is correct.`
    });
    return;
  }

  let sourceId: number;
  try {
    sourceId = await db.insertSource(trimmedCompany, trimmedUrl, selectedParser);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('UNIQUE constraint failed') || msg.includes('unique constraint')) {
      res.status(409).json({ error: `A source with URL "${trimmedUrl}" already exists.` });
      return;
    }
    res.status(500).json({ error: 'Failed to save source' });
    return;
  }

  const source = await db.getSourceById(sourceId) as Source;

  // ── Lightweight first scrape: listing only, no detail-page enrichment ──────
  // We only want to verify the source works and count the available jobs.
  // Full job insertion + description enrichment happens on the first real sync.
  const firstScrape: { count: number; error?: string; warning?: string } = { count: 0 };
  try {
    const { jobs, error: scrapeErr } = await scrapeSource(source);
    if (scrapeErr) {
      firstScrape.error = scrapeErr;
    } else if (jobs.length === 0) {
      firstScrape.warning = '0 jobs found — consider selecting a different parser';
    } else {
      firstScrape.count = jobs.length;
      // Update last_count so the source card shows the job count immediately
      await db.updateSourceSync(sourceId, 'ok', jobs.length);
    }
  } catch (err) {
    firstScrape.error = `First scrape failed: ${err instanceof Error ? err.message : String(err)}`;
  }

  const updatedSource = await db.getSourceById(sourceId) as Source;

  res.status(201).json({ source: updatedSource, firstScrape });
});

// ── DELETE /api/sources/:id ───────────────────────────────────────────────────
router.delete('/:id', async (req: Request, res: Response) => {
  const id = Number(req.params['id']);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: 'Invalid source id' });
    return;
  }
  try {
    const source = await db.getSourceById(id);
    if (!source) {
      res.status(404).json({ error: 'Source not found' });
      return;
    }
    await db.deleteSource(id);
    res.status(204).send();
  } catch (err) {
    console.error('[sources] DELETE /:id error:', err);
    res.status(500).json({ error: `Failed to delete source: ${err instanceof Error ? err.message : String(err)}` });
  }
});

export default router;
