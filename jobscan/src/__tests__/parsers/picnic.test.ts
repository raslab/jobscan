/**
 * Picnic Careers Parser — Unit Test Suite
 *
 * Covers:
 *  1. picnicParser() with cached SSR HTML fixture (jobs.html)
 *  2. picnicApiFetch() with mocked fetchHtml
 *  3. isPicnicUrl() URL recognition
 *  4. Field mapping: title, url, location, department
 *  5. Locale deduplication (EN preferred over DE/NL)
 *  6. Edge cases: empty HTML, no RSC payload
 *  7. Known job verification
 */

import { loadFixture } from '../helpers/fixture-loader';

// Mock fetch-utils so picnicApiFetch uses cached data instead of live network
jest.mock('../../fetch-utils', () => ({
  fetchHtml: jest.fn(),
  fetchJson: jest.fn(),
  randomDelay: jest.fn().mockResolvedValue(undefined),
  sleep: jest.fn().mockResolvedValue(undefined),
}));

import { picnicParser, picnicApiFetch, isPicnicUrl, picnicDetect } from '../../parsers/picnic';
import { fetchHtml } from '../../fetch-utils';

const mockFetchHtml = fetchHtml as jest.MockedFunction<typeof fetchHtml>;

// ─── isPicnicUrl ──────────────────────────────────────────────────────────────

describe('isPicnicUrl', () => {
  it('recognises jobs.picnic.app root', () => {
    expect(isPicnicUrl('https://jobs.picnic.app/')).toBe(true);
  });

  it('recognises jobs.picnic.app/en/', () => {
    expect(isPicnicUrl('https://jobs.picnic.app/en/')).toBe(true);
  });

  it('recognises jobs.picnic.app/en/jobs', () => {
    expect(isPicnicUrl('https://jobs.picnic.app/en/jobs')).toBe(true);
  });

  it('rejects unrelated job sites', () => {
    expect(isPicnicUrl('https://jobs.greenhouse.io/picnic')).toBe(false);
    expect(isPicnicUrl('https://www.picnic.app/')).toBe(false);
    expect(isPicnicUrl('https://picnic.app/careers')).toBe(false);
    expect(isPicnicUrl('https://example.com/')).toBe(false);
    expect(isPicnicUrl('not-a-url')).toBe(false);
  });
});

// ─── picnicParser — HTML stub (edge cases) ────────────────────────────────────

describe('picnicParser — edge cases', () => {
  it('returns empty array for empty HTML', () => {
    expect(picnicParser('', 'https://jobs.picnic.app/en/jobs')).toEqual([]);
  });

  it('returns empty array for HTML without RSC payload', () => {
    const html = '<html><body><h1>Hello</h1></body></html>';
    expect(picnicParser(html, 'https://jobs.picnic.app/en/jobs')).toEqual([]);
  });
});

// ─── picnicParser — real fixture ──────────────────────────────────────────────

describe('picnicParser — jobs.html fixture', () => {
  let jobs: ReturnType<typeof picnicParser>;

  beforeAll(() => {
    const html = loadFixture('picnic', 'jobs.html');
    jobs = picnicParser(html, 'https://jobs.picnic.app/en/jobs');
  });

  // ── Basic counts ─────────────────────────────────────────────────────────

  it('should parse a non-zero number of jobs', () => {
    expect(jobs.length).toBeGreaterThan(0);
  });

  it('should parse at least 100 unique jobs from the fixture', () => {
    // Fixture contains 280+ jobs; use a conservative lower bound
    expect(jobs.length).toBeGreaterThanOrEqual(100);
  });

  // ── Required fields ──────────────────────────────────────────────────────

  it('every job should have a non-empty title', () => {
    for (const job of jobs) {
      expect(job.title).toBeTruthy();
    }
  });

  it('every job should have a non-empty url', () => {
    for (const job of jobs) {
      expect(job.url).toBeTruthy();
    }
  });

  it('every url should be an absolute https URL on jobs.picnic.app', () => {
    for (const job of jobs) {
      expect(job.url).toMatch(/^https:\/\/jobs\.picnic\.app\//);
    }
  });

  it('every url should contain a locale path segment', () => {
    const localeSegments = /\/(?:en\/vacancies|de\/jobangebot|nl\/vacatures|fr\/offres)\//;
    for (const job of jobs) {
      expect(job.url).toMatch(localeSegments);
    }
  });

  // ── Location ─────────────────────────────────────────────────────────────

  it('every job should have a location', () => {
    for (const job of jobs) {
      expect(job.location).toBeTruthy();
    }
  });

  it('every location should be a non-empty string', () => {
    for (const job of jobs) {
      expect(typeof job.location).toBe('string');
      expect(job.location!.length).toBeGreaterThan(0);
    }
  });

  it('most locations should contain city and country separated by a comma', () => {
    const withComma = jobs.filter(j => j.location?.includes(','));
    expect(withComma.length).toBeGreaterThan(jobs.length * 0.9);
  });

  // ── Department ───────────────────────────────────────────────────────────

  it('every job should have a department', () => {
    for (const job of jobs) {
      expect(job.department).toBeTruthy();
    }
  });

  it('should parse multiple distinct departments', () => {
    const depts = new Set(jobs.map(j => j.department));
    expect(depts.size).toBeGreaterThan(3);
  });

  // ── Locale deduplication ────────────────────────────────────────────────

  it('should prefer English locale URLs when available', () => {
    // The Engineering team at Amsterdam is in EN locale
    const enJobs = jobs.filter(j => j.url.includes('/en/vacancies/'));
    expect(enJobs.length).toBeGreaterThan(0);
  });

  it('should not produce duplicate job URLs', () => {
    const urls = jobs.map(j => j.url);
    const unique = new Set(urls);
    expect(unique.size).toBe(urls.length);
  });

  it('should not have multiple entries for the same job ID', () => {
    // Extract job IDs from URLs (8-char segment after the locale path)
    const idRe = /\/(?:vacancies|jobangebot|vacatures|offres)\/(J[A-Z0-9]{7})\//;
    const ids = jobs.map(j => {
      const m = idRe.exec(j.url);
      return m ? m[1] : null;
    }).filter(Boolean);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  // ── Known job verification ──────────────────────────────────────────────

  it('should include a known Engineering job as English locale', () => {
    // Tech Lead (Java) is a known Engineering job in Amsterdam, EN locale
    const job = jobs.find(j => j.title === 'Tech Lead (Java)');
    expect(job).toBeDefined();
    expect(job!.url).toContain('/en/vacancies/JJY6OH1V/');
    expect(job!.location).toBe('Amsterdam, Netherlands');
    expect(job!.department).toBe('Engineering');
  });
});

// ─── picnicApiFetch — mocked fetchHtml ───────────────────────────────────────

describe('picnicApiFetch — mocked HTML parse', () => {
  afterEach(() => mockFetchHtml.mockReset());

  it('should parse jobs from cached HTML (mocked fetchHtml)', async () => {
    const html = loadFixture('picnic', 'jobs.html');
    mockFetchHtml.mockResolvedValue({ html, error: undefined });

    const result = await picnicApiFetch('https://jobs.picnic.app/en/jobs');

    expect(result.error).toBeUndefined();
    expect(result.jobs.length).toBeGreaterThan(100);
    // All jobs should have required fields
    for (const job of result.jobs) {
      expect(job.title).toBeTruthy();
      expect(job.url).toBeTruthy();
    }
  });

  it('should return error when fetchHtml returns empty string', async () => {
    mockFetchHtml.mockResolvedValue({ html: '', error: undefined });

    const result = await picnicApiFetch('https://jobs.picnic.app/en/jobs');

    expect(result.error).toBeDefined();
    expect(result.jobs).toEqual([]);
  });

  it('should return error when HTML has no RSC payload', async () => {
    mockFetchHtml.mockResolvedValue({ html: '<html><body>Error page</body></html>', error: undefined });

    const result = await picnicApiFetch('https://jobs.picnic.app/en/jobs');

    expect(result.error).toBeDefined();
    expect(result.jobs).toEqual([]);
  });

  it('should ignore the input URL and always use the canonical /en/jobs endpoint', async () => {
    // Regardless of what URL the source was registered with, we always
    // fetch the English jobs list for consistent locale coverage
    const html = loadFixture('picnic', 'jobs.html');
    mockFetchHtml.mockResolvedValue({ html, error: undefined });

    const result = await picnicApiFetch('https://jobs.picnic.app/');

    expect(result.error).toBeUndefined();
    expect(result.jobs.length).toBeGreaterThan(100);
  });
});

// ─── picnicDetect ───────────────────────────────────────────────────────────────

describe('picnicDetect', () => {
  it('returns company name Picnic for any URL', async () => {
    const result = await picnicDetect('https://jobs.picnic.app/en/jobs');
    expect(result.company).toBe('Picnic');
    expect(result.error).toBeUndefined();
  });

  it('returns company name Picnic regardless of locale', async () => {
    const result = await picnicDetect('https://jobs.picnic.app/de/jobangebot');
    expect(result.company).toBe('Picnic');
    expect(result.error).toBeUndefined();
  });
});
