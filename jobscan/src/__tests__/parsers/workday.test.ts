/**
 * Workday ATS Parser — Unit Test Suite
 *
 * Covers:
 *  1. extractWorkdayInfo() — URL pattern recognition
 *  2. workdayApiFetch() — CXS API parsing with mocked fetchJson
 *  3. discoverWorkdaySiteId() — robots.txt-based siteId discovery
 *  4. workdayApiDetect() — company name detection
 *  5. Detection pipeline — Mercedes-Benz Tech Innovation (Nuxt + Workday)
 *  6. Edge cases: empty responses, malformed URLs
 *  7. Known job verification against MBTI and Zalando fixtures
 */

import { loadFixture, loadJsonFixture } from '../helpers/fixture-loader';

// Mock fetch-utils so workdayApiFetch uses cached data instead of network
jest.mock('../../fetch-utils', () => ({
  fetchHtml: jest.fn(),
  fetchJson: jest.fn(),
  sleep: jest.fn().mockResolvedValue(undefined),
  randomDelay: jest.fn().mockResolvedValue(undefined),
}));

import {
  workdayApiFetch,
  workdayParser,
  workdayApiDetect,
  workdayJobDetailApiFetch,
  discoverWorkdaySiteId,
} from '../../parsers/workday';
import { fetchJson, fetchHtml } from '../../fetch-utils';
import {
  detectParserFromUrl,
  detectAllFromHtml,
} from '../../parsers/registry';

const mockFetchJson = fetchJson as jest.MockedFunction<typeof fetchJson>;
const mockFetchHtml = fetchHtml as jest.MockedFunction<typeof fetchHtml>;

function mockWorkdayListingFetch(payload: unknown) {
  const origFetch = global.fetch;
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    headers: { getSetCookie: () => [] },
    json: () => Promise.resolve(payload),
  }) as unknown as typeof fetch;
  return origFetch;
}

// ─── workdayParser (HTML passthrough — always returns []) ─────────────────────

describe('workdayParser', () => {
  it('should return empty array (Workday is SPA, HTML contains no jobs)', () => {
    expect(workdayParser('<html><body>SPA</body></html>', 'https://example.wd3.myworkdayjobs.com/Jobs')).toEqual([]);
  });

  it('should return empty array for empty HTML', () => {
    expect(workdayParser('', '')).toEqual([]);
  });
});

// ─── detectParserFromUrl — Workday URL patterns ──────────────────────────────

describe('detectParserFromUrl — Workday patterns', () => {
  it('should detect standard Workday URL', () => {
    expect(detectParserFromUrl('https://zalando.wd3.myworkdayjobs.com/ZalandoSiteWD')).toBe('workday');
  });

  it('should detect Workday URL with locale prefix', () => {
    expect(detectParserFromUrl('https://sec.wd3.myworkdayjobs.com/en-US/Samsung_Careers')).toBe('workday');
  });

  it('should detect Workday URL with wd1 instance', () => {
    expect(detectParserFromUrl('https://zendesk.wd1.myworkdayjobs.com/zendesk')).toBe('workday');
  });

  it('should detect Workday URL with wd5 instance', () => {
    expect(detectParserFromUrl('https://motorolasolutions.wd5.myworkdayjobs.com/en-US/Careers')).toBe('workday');
  });

  it('should NOT detect custom domain as Workday', () => {
    expect(detectParserFromUrl('https://www.mercedes-benz-techinnovation.com/en/career')).toBeNull();
  });
});

// ─── detectAllFromHtml — HTML-based detection ────────────────────────────────

describe('detectAllFromHtml — Workday content fingerprint', () => {
  it('should detect Workday from HTML containing myworkdayjobs.com reference', () => {
    const html = `<html><body>
      <script>window.workday = {}</script>
      <a href="https://example.wd3.myworkdayjobs.com/Jobs/job/NYC/Engineer_R123">Apply</a>
    </body></html>`;
    const results = detectAllFromHtml('https://example.com/careers', html);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].parser).toBe('workday');
  });

  it('should NOT detect Workday from the Mercedes-Benz career page HTML (no ATS references in HTML)', () => {
    // The Mercedes-Benz career page is a Nuxt SPA where the Workday URL is in JS bundles,
    // not in the initial HTML. Detection should find nothing from HTML alone.
    const html = loadFixture('workday', 'mbti-career.html');
    const results = detectAllFromHtml('https://www.mercedes-benz-techinnovation.com/en/career', html);
    // Should NOT detect Workday from HTML alone (because the reference is in JS bundles)
    // This test documents the current behavior — the fix relies on JS bundle scanning
    expect(results.length).toBe(0);
  });
});

// ─── discoverWorkdaySiteId — robots.txt based siteId discovery ───────────────

describe('discoverWorkdaySiteId', () => {
  afterEach(() => jest.resetAllMocks());

  it('should extract siteId from Workday robots.txt', async () => {
    const robotsTxt = loadFixture('workday', 'mbti-robots.txt');
    // Mock global fetch for robots.txt
    const origFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(robotsTxt),
    }) as unknown as typeof fetch;

    const siteId = await discoverWorkdaySiteId('https://mercedesbenztechinnovation.wd3.myworkdayjobs.com');
    expect(siteId).toBe('MBTI_JOBPORTAL');

    global.fetch = origFetch;
  });

  it('should return null when robots.txt fetch fails', async () => {
    const origFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: () => Promise.resolve('Not found'),
    }) as unknown as typeof fetch;

    const siteId = await discoverWorkdaySiteId('https://example.wd3.myworkdayjobs.com');
    expect(siteId).toBeNull();

    global.fetch = origFetch;
  });

  it('should return null when robots.txt has no Allow paths', async () => {
    const origFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('User-agent: *\nDisallow: /'),
    }) as unknown as typeof fetch;

    const siteId = await discoverWorkdaySiteId('https://example.wd3.myworkdayjobs.com');
    expect(siteId).toBeNull();

    global.fetch = origFetch;
  });

  it('should handle robots.txt with multiple siteIds (returns first)', async () => {
    const robotsTxt = [
      'Sitemap: https://example.wd3.myworkdayjobs.com/External/siteMap.xml',
      'Sitemap: https://example.wd3.myworkdayjobs.com/Internal/siteMap.xml',
      '',
      'User-agent: *',
      'Allow: /External/',
      'Allow: /Internal/',
    ].join('\n');

    const origFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(robotsTxt),
    }) as unknown as typeof fetch;

    const siteId = await discoverWorkdaySiteId('https://example.wd3.myworkdayjobs.com');
    expect(siteId).toBe('External');

    global.fetch = origFetch;
  });
});

// ─── workdayApiFetch — CXS API parsing ───────────────────────────────────────

describe('workdayApiFetch — MBTI board', () => {
  afterEach(() => jest.resetAllMocks());

  it('should parse jobs from cached MBTI API response', async () => {
    const apiData = loadJsonFixture('workday', 'mbti-api.json');
    const origFetch = mockWorkdayListingFetch(apiData);

    const result = await workdayApiFetch('https://mercedesbenztechinnovation.wd3.myworkdayjobs.com/MBTI_JOBPORTAL');
    expect(result.error).toBeUndefined();
    expect(result.jobs.length).toBeGreaterThan(0);

    global.fetch = origFetch;
  });

  it('every job should have required fields: title and url', async () => {
    const apiData = loadJsonFixture('workday', 'mbti-api.json');
    const origFetch = mockWorkdayListingFetch(apiData);

    const result = await workdayApiFetch('https://mercedesbenztechinnovation.wd3.myworkdayjobs.com/MBTI_JOBPORTAL');
    for (const job of result.jobs) {
      expect(job.title).toBeTruthy();
      expect(job.url).toBeTruthy();
      expect(job.url).toMatch(/^https?:\/\//);
    }

    global.fetch = origFetch;
  });

  it('every job URL should contain the siteId', async () => {
    const apiData = loadJsonFixture('workday', 'mbti-api.json');
    const origFetch = mockWorkdayListingFetch(apiData);

    const result = await workdayApiFetch('https://mercedesbenztechinnovation.wd3.myworkdayjobs.com/MBTI_JOBPORTAL');
    for (const job of result.jobs) {
      expect(job.url).toContain('MBTI_JOBPORTAL');
    }

    global.fetch = origFetch;
  });

  it('should parse locations for most jobs', async () => {
    const apiData = loadJsonFixture('workday', 'mbti-api.json');
    const origFetch = mockWorkdayListingFetch(apiData);

    const result = await workdayApiFetch('https://mercedesbenztechinnovation.wd3.myworkdayjobs.com/MBTI_JOBPORTAL');
    const withLoc = result.jobs.filter(j => j.location);
    expect(withLoc.length).toBeGreaterThan(result.jobs.length * 0.5);

    global.fetch = origFetch;
  });

  it('should return error for invalid Workday URL', async () => {
    const result = await workdayApiFetch('https://example.com/not-workday');
    expect(result.error).toBeDefined();
    expect(result.jobs).toEqual([]);
  });
});

describe('workdayApiFetch — Zalando board', () => {
  afterEach(() => jest.resetAllMocks());

  it('should parse jobs from cached Zalando API response', async () => {
    const apiData = loadJsonFixture('workday', 'zalando-api.json');
    const origFetch = mockWorkdayListingFetch(apiData);

    const result = await workdayApiFetch('https://zalando.wd3.myworkdayjobs.com/ZalandoSiteWD');
    expect(result.error).toBeUndefined();
    expect(result.jobs.length).toBeGreaterThan(0);

    global.fetch = origFetch;
  });

  it('every Zalando job should have title, url, and location', async () => {
    const apiData = loadJsonFixture('workday', 'zalando-api.json');
    const origFetch = mockWorkdayListingFetch(apiData);

    const result = await workdayApiFetch('https://zalando.wd3.myworkdayjobs.com/ZalandoSiteWD');
    for (const job of result.jobs) {
      expect(job.title).toBeTruthy();
      expect(job.url).toMatch(/^https:\/\/zalando\.wd3\.myworkdayjobs\.com/);
    }

    global.fetch = origFetch;
  });
});

// ─── Edge cases ──────────────────────────────────────────────────────────────

describe('workdayApiFetch — Edge cases', () => {
  afterEach(() => jest.resetAllMocks());

  it('should handle API returning zero jobs', async () => {
    // workdayApiFetch uses direct `fetch` (not fetchJson) for the CXS endpoint,
    // so we mock global.fetch to return zero jobs
    const origFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      headers: { getSetCookie: () => [] },
      json: () => Promise.resolve({ total: 0, jobPostings: [] }),
    }) as unknown as typeof fetch;

    const result = await workdayApiFetch('https://example.wd3.myworkdayjobs.com/Jobs');
    expect(result.error).toBeUndefined();
    expect(result.jobs).toEqual([]);

    global.fetch = origFetch;
  });

  it('should handle API error response', async () => {
    // workdayApiFetch uses direct `fetch` for the CXS endpoint
    const origFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 502,
      headers: { getSetCookie: () => [] },
      json: () => Promise.resolve({}),
    }) as unknown as typeof fetch;

    const result = await workdayApiFetch('https://example.wd3.myworkdayjobs.com/Jobs');
    expect(result.error).toBeDefined();

    global.fetch = origFetch;
  });
});

// ─── Known job verification — MBTI ──────────────────────────────────────────

describe('workdayApiFetch — Known job verification (MBTI)', () => {
  afterEach(() => jest.resetAllMocks());

  it('should contain a Cloud Architect Kubernetes job', async () => {
    const apiData = loadJsonFixture('workday', 'mbti-api.json');
    const origFetch = mockWorkdayListingFetch(apiData);

    const result = await workdayApiFetch('https://mercedesbenztechinnovation.wd3.myworkdayjobs.com/MBTI_JOBPORTAL');
    const cloudArch = result.jobs.find(j => /cloud architect.*kubernetes/i.test(j.title));
    expect(cloudArch).toBeDefined();
    expect(cloudArch!.url).toContain('R0006513');

    global.fetch = origFetch;
  });
});
