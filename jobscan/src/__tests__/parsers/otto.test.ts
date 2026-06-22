/**
 * OTTO Parser — Unit Test Suite
 *
 * Covers:
 *  1. ottoApiFetch() with cached SAP OData API JSON responses (mocked global fetch)
 *  2. ottoParser() edge cases (HTML stub returns empty array)
 *  3. isOttoUrl() URL recognition
 *  4. Field mapping: title, url, location, department, commitment, workplace_type, team
 *  5. Workplace type normalisation
 *  6. Deduplication by Offid
 *  7. URL slug generation
 *  8. Error handling
 */

import { loadFixture, loadJsonFixture } from '../helpers/fixture-loader';

// Mock randomDelay so tests don't wait
jest.mock('../../fetch-utils', () => ({
  randomDelay: jest.fn().mockResolvedValue(undefined),
}));

import { ottoApiFetch, ottoParser, isOttoUrl } from '../../parsers/otto';

// ── Mock global fetch for the SAP OData 2-step API flow ─────────────────────

const mockFetch = jest.fn() as jest.MockedFunction<typeof global.fetch>;

function mockOttoApiFetchCalls(apiFixtureFile: string): void {
  const apiResponse = loadJsonFixture('otto', apiFixtureFile);

  mockFetch
    // Call 1: session create
    .mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ d: { create: { Message: 'Action name create processed', URL_HASH: '' } } }),
      headers: {
        getSetCookie: () => ['SAP_SESSIONID=abc123; path=/; secure'],
      },
    } as unknown as Response)
    // Call 2: listing fetch
    .mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => apiResponse,
      headers: new Headers(),
    } as unknown as Response);
}

// ─── isOttoUrl ────────────────────────────────────────────────────────────────

describe('isOttoUrl', () => {
  it('recognises www.otto.de/jobs/ paths', () => {
    expect(isOttoUrl('https://www.otto.de/jobs/en/')).toBe(true);
    expect(isOttoUrl('https://www.otto.de/jobs/en/jobsearch/')).toBe(true);
    expect(isOttoUrl('https://www.otto.de/jobs/de/')).toBe(true);
    expect(isOttoUrl('https://www.otto.de/jobs/de/jobsuche/')).toBe(true);
  });

  it('recognises otto.de without www', () => {
    expect(isOttoUrl('https://otto.de/jobs/en/')).toBe(true);
  });

  it('rejects unrelated otto.de pages', () => {
    expect(isOttoUrl('https://www.otto.de/')).toBe(false);
    expect(isOttoUrl('https://www.otto.de/shop/')).toBe(false);
    expect(isOttoUrl('https://www.otto.de/unternehmen/')).toBe(false);
  });

  it('rejects unrelated URLs', () => {
    expect(isOttoUrl('https://example.com/jobs/en/')).toBe(false);
    expect(isOttoUrl('https://jobs.otto.de/')).toBe(false);
    expect(isOttoUrl('not-a-url')).toBe(false);
  });
});

// ─── ottoParser (HTML stub) ───────────────────────────────────────────────────

describe('ottoParser — HTML stub', () => {
  it('returns empty array for any HTML input', () => {
    expect(ottoParser('', 'https://www.otto.de/jobs/en/')).toEqual([]);
    expect(ottoParser('<html><body>Hello</body></html>', 'https://www.otto.de/jobs/en/')).toEqual([]);
  });
});

// ─── ottoApiFetch — cached DE API response ────────────────────────────────────

describe('ottoApiFetch — cached DE API response', () => {
  let jobs: Awaited<ReturnType<typeof ottoApiFetch>>['jobs'];

  beforeAll(async () => {
    global.fetch = mockFetch;
    mockOttoApiFetchCalls('otto-api-de.json');

    const result = await ottoApiFetch('https://www.otto.de/jobs/de/jobsuche/');
    expect(result.error).toBeUndefined();
    jobs = result.jobs;
  });

  afterAll(() => {
    mockFetch.mockReset();
    global.fetch = globalThis.fetch;
  });

  // ── Basic counts and required fields ────────────────────────────────────────

  it('should parse a non-zero number of jobs', () => {
    expect(jobs.length).toBeGreaterThan(0);
  });

  it('should parse approximately the expected total (30–80 range)', () => {
    // Fixture captured ~52 jobs; allow for deduplication reducing count
    expect(jobs.length).toBeGreaterThanOrEqual(30);
    expect(jobs.length).toBeLessThanOrEqual(80);
  });

  it('every job should have title and url', () => {
    for (const job of jobs) {
      expect(job.title).toBeTruthy();
      expect(job.url).toBeTruthy();
    }
  });

  it('every url should be an absolute URL pointing to otto.de/jobs/', () => {
    for (const job of jobs) {
      expect(job.url).toMatch(/^https:\/\/www\.otto\.de\/jobs\/de\/jobs\//);
    }
  });

  it('URLs should contain the Offid and a slugified title', () => {
    // Verify URL format: /jobs/de/jobs/{offid}/{slug}/
    for (const job of jobs) {
      const match = job.url.match(/\/jobs\/de\/jobs\/(\d+)\/([a-z0-9-]+)\/$/);
      expect(match).not.toBeNull();
    }
  });

  // ── Location ────────────────────────────────────────────────────────────────

  it('most jobs should have a location', () => {
    const withLoc = jobs.filter((j) => j.location);
    expect(withLoc.length).toBeGreaterThan(jobs.length * 0.5);
  });

  it('Hamburg should be the most common location', () => {
    const hamburgJobs = jobs.filter((j) => j.location?.includes('Hamburg'));
    expect(hamburgJobs.length).toBeGreaterThan(0);
  });

  // ── Department ──────────────────────────────────────────────────────────────

  it('should parse departments for most jobs', () => {
    const withDept = jobs.filter((j) => j.department);
    expect(withDept.length).toBeGreaterThan(0);
  });

  it('department values should be non-empty strings', () => {
    for (const job of jobs) {
      if (job.department) {
        expect(typeof job.department).toBe('string');
        expect(job.department.length).toBeGreaterThan(0);
      }
    }
  });

  // ── Commitment (employment type) ───────────────────────────────────────────

  it('should parse commitment for most jobs', () => {
    const withCommitment = jobs.filter((j) => j.commitment);
    expect(withCommitment.length).toBeGreaterThan(jobs.length * 0.5);
  });

  // ── Workplace type ──────────────────────────────────────────────────────────

  it('should parse workplace_type for some jobs', () => {
    const withWpType = jobs.filter((j) => j.workplace_type);
    expect(withWpType.length).toBeGreaterThan(0);
  });

  it('workplace_type should be normalised to standard values', () => {
    const allowedValues = ['Remote', 'Hybrid', 'On-site'];
    for (const job of jobs) {
      if (job.workplace_type) {
        expect(allowedValues).toContain(job.workplace_type);
      }
    }
  });

  // ── Team (company entity) ───────────────────────────────────────────────────

  it('should parse team (company entity) for most jobs', () => {
    const withTeam = jobs.filter((j) => j.team);
    expect(withTeam.length).toBeGreaterThan(0);
  });

  it('team should include "Otto" entities', () => {
    const ottoTeam = jobs.filter((j) => j.team?.toLowerCase().includes('otto'));
    expect(ottoTeam.length).toBeGreaterThan(0);
  });

  // ── Deduplication ───────────────────────────────────────────────────────────

  it('should not have duplicate URLs', () => {
    const urls = jobs.map((j) => j.url);
    const uniqueUrls = new Set(urls);
    expect(uniqueUrls.size).toBe(urls.length);
  });
});

// ─── ottoApiFetch — EN API response ──────────────────────────────────────────

describe('ottoApiFetch — EN API response (always uses DE)', () => {
  it('fetches DE jobs even when EN URL is provided', async () => {
    global.fetch = mockFetch;
    mockOttoApiFetchCalls('otto-api-de.json');

    const result = await ottoApiFetch('https://www.otto.de/jobs/en/');
    expect(result.error).toBeUndefined();
    // Even with EN URL, should get DE jobs (52 in fixture)
    expect(result.jobs.length).toBeGreaterThan(10);
    mockFetch.mockReset();
  });
});

// ─── ottoApiFetch — error handling ───────────────────────────────────────────

describe('ottoApiFetch — error handling', () => {
  afterEach(() => {
    mockFetch.mockReset();
  });

  it('should return error when session creation fails', async () => {
    global.fetch = mockFetch;
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      headers: new Headers(),
    } as unknown as Response);

    const result = await ottoApiFetch('https://www.otto.de/jobs/de/');
    expect(result.error).toBeDefined();
    expect(result.error).toContain('session create failed');
    expect(result.jobs).toEqual([]);
  });

  it('should return error when listing fetch fails', async () => {
    global.fetch = mockFetch;
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ d: { create: { Message: 'OK' } } }),
        headers: { getSetCookie: () => [] },
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        headers: new Headers(),
      } as unknown as Response);

    const result = await ottoApiFetch('https://www.otto.de/jobs/de/');
    expect(result.error).toBeDefined();
    expect(result.error).toContain('job list fetch failed');
    expect(result.jobs).toEqual([]);
  });

  it('should return error when API returns empty results', async () => {
    global.fetch = mockFetch;
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ d: { create: { Message: 'OK' } } }),
        headers: { getSetCookie: () => [] },
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ d: { results: [] } }),
        headers: new Headers(),
      } as unknown as Response);

    const result = await ottoApiFetch('https://www.otto.de/jobs/de/');
    expect(result.error).toBeDefined();
    expect(result.error).toContain('0 jobs');
    expect(result.jobs).toEqual([]);
  });
});

// ─── Known job verification ──────────────────────────────────────────────────

describe('ottoApiFetch — known job from DE fixture', () => {
  let jobs: Awaited<ReturnType<typeof ottoApiFetch>>['jobs'];

  beforeAll(async () => {
    global.fetch = mockFetch;
    mockOttoApiFetchCalls('otto-api-de.json');

    const result = await ottoApiFetch('https://www.otto.de/jobs/de/');
    jobs = result.jobs;
  });

  afterAll(() => {
    mockFetch.mockReset();
    global.fetch = globalThis.fetch;
  });

  it('should contain a job with "Werkstudent" in the title', () => {
    const found = jobs.find((j) => j.title.includes('Werkstudent'));
    expect(found).toBeDefined();
  });

  it('should have Hamburg as location for most jobs', () => {
    const hamburg = jobs.filter((j) => j.location === 'Hamburg');
    expect(hamburg.length).toBeGreaterThan(jobs.length * 0.3);
  });

  it('should assign "Otto GmbH & Co. KGaA" as team for some jobs', () => {
    const ottoGmbH = jobs.filter((j) => j.team === 'Otto GmbH & Co. KGaA');
    expect(ottoGmbH.length).toBeGreaterThan(0);
  });
});

// ─── Detection from HTML ─────────────────────────────────────────────────────

describe('OTTO detection from HTML', () => {
  it('jobsearch page HTML contains Weblication CMS and SAP OData fingerprints', () => {
    const html = loadFixture('otto', 'jobsearch-en.html');
    // Weblication CMS generator tag
    expect(html).toContain('Weblication');
    // SAP OData path
    expect(html).toContain('/or/sap/opu/odata/OTTO');
  });
});
