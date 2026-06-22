/**
 * Schwarz IT / Schwarz Group "Trinity" CMS Parser — Unit Test Suite
 *
 * Covers:
 *  1. isSchwarzItUrl() — domain recognition
 *  2. extractLangPrefix() — language prefix extraction
 *  3. buildApiUrl() — API URL construction
 *  4. schwarzitApiFetch() — API-based fetch with mocked fetchJson
 *  5. schwarzitParser() — HTML fallback parsing
 *  6. Edge cases: empty HTML, invalid URLs, error responses
 *  7. Known job verification against schwarz-digits fixture
 *  8. Second company (jobs.schwarz) fixture verification
 */

import { loadFixture, loadJsonFixture } from '../helpers/fixture-loader';

// Mock fetch-utils so schwarzitApiFetch uses cached data instead of network
jest.mock('../../fetch-utils', () => ({
  fetchJson: jest.fn(),
  fetchHtml: jest.fn(),
  randomDelay: jest.fn().mockResolvedValue(undefined),
  sleep: jest.fn().mockResolvedValue(undefined),
}));

import {
  schwarzitParser,
  schwarzitApiFetch,
  isSchwarzItUrl,
  extractLangPrefix,
  buildApiUrl,
} from '../../parsers/schwarzit';
import { fetchJson } from '../../fetch-utils';

const mockFetchJson = fetchJson as jest.MockedFunction<typeof fetchJson>;

// ─── isSchwarzItUrl ──────────────────────────────────────────────────────────

describe('isSchwarzItUrl', () => {
  it('recognises schwarz-digits.de', () => {
    expect(isSchwarzItUrl('https://schwarz-digits.de/en/jobsearch')).toBe(true);
  });

  it('recognises jobs.schwarz', () => {
    expect(isSchwarzItUrl('https://jobs.schwarz/en/jobsearch')).toBe(true);
  });

  it('recognises with www prefix', () => {
    expect(isSchwarzItUrl('https://www.schwarz-digits.de/en/jobsearch')).toBe(true);
  });

  it('rejects unknown domains', () => {
    expect(isSchwarzItUrl('https://example.com/jobsearch')).toBe(false);
    expect(isSchwarzItUrl('https://lidl.de/careers')).toBe(false);
  });

  it('rejects invalid URLs', () => {
    expect(isSchwarzItUrl('not-a-url')).toBe(false);
    expect(isSchwarzItUrl('')).toBe(false);
  });
});

// ─── extractLangPrefix ──────────────────────────────────────────────────────

describe('extractLangPrefix', () => {
  it('extracts "en" from /en/jobsearch', () => {
    expect(extractLangPrefix('https://schwarz-digits.de/en/jobsearch')).toBe('en');
  });

  it('extracts "de" from /de/jobsearch', () => {
    expect(extractLangPrefix('https://schwarz-digits.de/de/jobsearch')).toBe('de');
  });

  it('defaults to "en" when no language prefix', () => {
    expect(extractLangPrefix('https://schwarz-digits.de/jobsearch')).toBe('en');
  });

  it('defaults to "en" for invalid URLs', () => {
    expect(extractLangPrefix('not-a-url')).toBe('en');
  });
});

// ─── buildApiUrl ────────────────────────────────────────────────────────────

describe('buildApiUrl', () => {
  it('builds API URL for schwarz-digits.de English', () => {
    expect(buildApiUrl('https://schwarz-digits.de/en/jobsearch')).toBe(
      'https://schwarz-digits.de/en/api/v1/job/search',
    );
  });

  it('builds API URL for schwarz-digits.de German', () => {
    expect(buildApiUrl('https://schwarz-digits.de/de/jobsearch')).toBe(
      'https://schwarz-digits.de/de/api/v1/job/search',
    );
  });

  it('builds API URL for jobs.schwarz', () => {
    expect(buildApiUrl('https://jobs.schwarz/en/jobsearch')).toBe(
      'https://jobs.schwarz/en/api/v1/job/search',
    );
  });

  it('returns null for invalid URLs', () => {
    expect(buildApiUrl('not-a-url')).toBeNull();
  });
});

// ─── schwarzitApiFetch — schwarz-digits.de fixture ──────────────────────────

describe('schwarzitApiFetch — schwarz-digits.de', () => {
  afterEach(() => mockFetchJson.mockReset());

  it('should parse jobs from cached API response', async () => {
    const apiResponse = loadJsonFixture('schwarzit', 'schwarz-digits-api.json');
    mockFetchJson.mockResolvedValue({ data: apiResponse });

    const result = await schwarzitApiFetch('https://schwarz-digits.de/en/jobsearch');
    expect(result.error).toBeUndefined();
    expect(result.jobs.length).toBeGreaterThan(0);
  });

  it('should parse 80+ jobs from schwarz-digits', async () => {
    const apiResponse = loadJsonFixture('schwarzit', 'schwarz-digits-api.json');
    mockFetchJson.mockResolvedValue({ data: apiResponse });

    const result = await schwarzitApiFetch('https://schwarz-digits.de/en/jobsearch');
    expect(result.jobs.length).toBeGreaterThan(80);
  });

  it('every job should have required fields: title and url', async () => {
    const apiResponse = loadJsonFixture('schwarzit', 'schwarz-digits-api.json');
    mockFetchJson.mockResolvedValue({ data: apiResponse });

    const result = await schwarzitApiFetch('https://schwarz-digits.de/en/jobsearch');
    for (const job of result.jobs) {
      expect(job.title).toBeTruthy();
      expect(job.url).toBeTruthy();
    }
  });

  it('every url should be an absolute URL', async () => {
    const apiResponse = loadJsonFixture('schwarzit', 'schwarz-digits-api.json');
    mockFetchJson.mockResolvedValue({ data: apiResponse });

    const result = await schwarzitApiFetch('https://schwarz-digits.de/en/jobsearch');
    for (const job of result.jobs) {
      expect(job.url).toMatch(/^https?:\/\//);
    }
  });

  it('every url should point to schwarz-digits.de', async () => {
    const apiResponse = loadJsonFixture('schwarzit', 'schwarz-digits-api.json');
    mockFetchJson.mockResolvedValue({ data: apiResponse });

    const result = await schwarzitApiFetch('https://schwarz-digits.de/en/jobsearch');
    for (const job of result.jobs) {
      expect(job.url).toContain('schwarz-digits.de');
    }
  });

  it('should parse locations for most jobs', async () => {
    const apiResponse = loadJsonFixture('schwarzit', 'schwarz-digits-api.json');
    mockFetchJson.mockResolvedValue({ data: apiResponse });

    const result = await schwarzitApiFetch('https://schwarz-digits.de/en/jobsearch');
    const withLoc = result.jobs.filter(j => j.location);
    expect(withLoc.length).toBeGreaterThan(result.jobs.length * 0.5);
  });

  it('should parse commitment (entryLevel) for most jobs', async () => {
    const apiResponse = loadJsonFixture('schwarzit', 'schwarz-digits-api.json');
    mockFetchJson.mockResolvedValue({ data: apiResponse });

    const result = await schwarzitApiFetch('https://schwarz-digits.de/en/jobsearch');
    const withCommitment = result.jobs.filter(j => j.commitment);
    expect(withCommitment.length).toBeGreaterThan(result.jobs.length * 0.5);
  });

  it('should find the "STACKIT Access Domain - Engineering Manager" job', async () => {
    const apiResponse = loadJsonFixture('schwarzit', 'schwarz-digits-api.json');
    mockFetchJson.mockResolvedValue({ data: apiResponse });

    const result = await schwarzitApiFetch('https://schwarz-digits.de/en/jobsearch');
    const em = result.jobs.find(j => /Engineering Manager.*STACKIT|STACKIT.*Engineering Manager/i.test(j.title));
    expect(em).toBeDefined();
    expect(em!.url).toContain('schwarz-digits.de');
  });

  it('should call fetchJson with POST method and correct body', async () => {
    const apiResponse = loadJsonFixture('schwarzit', 'schwarz-digits-api.json');
    mockFetchJson.mockResolvedValue({ data: apiResponse });

    await schwarzitApiFetch('https://schwarz-digits.de/en/jobsearch');

    expect(mockFetchJson).toHaveBeenCalledWith(
      'https://schwarz-digits.de/en/api/v1/job/search',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    // Verify the body contains the expected fields
    const callArgs = mockFetchJson.mock.calls[0];
    const body = JSON.parse(callArgs[1]!.body!);
    expect(body).toEqual(
      expect.objectContaining({ perPage: 100, page: 1, term: '', filters: {} }),
    );
  });
});

// ─── schwarzitApiFetch — jobs.schwarz fixture ───────────────────────────────

describe('schwarzitApiFetch — jobs.schwarz', () => {
  afterEach(() => mockFetchJson.mockReset());

  it('should parse jobs from jobs.schwarz API response', async () => {
    const apiResponse = loadJsonFixture('schwarzit', 'jobs-schwarz-api.json');
    mockFetchJson.mockResolvedValue({ data: apiResponse });

    const result = await schwarzitApiFetch('https://jobs.schwarz/en/jobsearch');
    expect(result.error).toBeUndefined();
    expect(result.jobs.length).toBeGreaterThan(0);
  });

  it('every job should have title and absolute URL', async () => {
    const apiResponse = loadJsonFixture('schwarzit', 'jobs-schwarz-api.json');
    mockFetchJson.mockResolvedValue({ data: apiResponse });

    const result = await schwarzitApiFetch('https://jobs.schwarz/en/jobsearch');
    for (const job of result.jobs) {
      expect(job.title).toBeTruthy();
      expect(job.url).toMatch(/^https?:\/\//);
    }
  });
});

// ─── schwarzitApiFetch — edge cases ─────────────────────────────────────────

describe('schwarzitApiFetch — edge cases', () => {
  afterEach(() => mockFetchJson.mockReset());

  it('should return error for non-Schwarz URL', async () => {
    const result = await schwarzitApiFetch('https://example.com/jobsearch');
    expect(result.error).toBeDefined();
    expect(result.jobs).toEqual([]);
  });

  it('should return error when API returns error', async () => {
    mockFetchJson.mockResolvedValue({ data: null, error: 'HTTP 500 Internal Server Error' });

    const result = await schwarzitApiFetch('https://schwarz-digits.de/en/jobsearch');
    expect(result.error).toBeDefined();
    expect(result.jobs).toEqual([]);
  });

  it('should return error for unexpected response format', async () => {
    mockFetchJson.mockResolvedValue({ data: { unexpected: true } });

    const result = await schwarzitApiFetch('https://schwarz-digits.de/en/jobsearch');
    expect(result.error).toBeDefined();
    expect(result.jobs).toEqual([]);
  });

  it('should handle empty jobs array gracefully', async () => {
    mockFetchJson.mockResolvedValue({
      data: {
        jobs: [],
        pagination: { count: 0, totalCount: 0, page: 1, resultsPerPage: 100 },
        filters: { groups: [] },
      },
    });

    const result = await schwarzitApiFetch('https://schwarz-digits.de/en/jobsearch');
    expect(result.error).toBeUndefined();
    expect(result.jobs).toEqual([]);
  });

  it('should handle pagination (multiple pages)', async () => {
    const page1 = {
      jobs: Array.from({ length: 100 }, (_, i) => ({
        id: String(i),
        title: `Job ${i}`,
        entryLevel: 'Experienced',
        location: 'Berlin',
        url: `https://schwarz-digits.de/en/jobsearch/job-${i}`,
        brand: null,
      })),
      pagination: { count: 100, totalCount: 150, page: 1, resultsPerPage: 100 },
      filters: { groups: [] },
    };
    const page2 = {
      jobs: Array.from({ length: 50 }, (_, i) => ({
        id: String(100 + i),
        title: `Job ${100 + i}`,
        entryLevel: 'Entry-level',
        location: 'Sofia',
        url: `https://schwarz-digits.de/en/jobsearch/job-${100 + i}`,
        brand: null,
      })),
      pagination: { count: 50, totalCount: 150, page: 2, resultsPerPage: 100 },
      filters: { groups: [] },
    };

    mockFetchJson
      .mockResolvedValueOnce({ data: page1 })
      .mockResolvedValueOnce({ data: page2 });

    const result = await schwarzitApiFetch('https://schwarz-digits.de/en/jobsearch');
    expect(result.error).toBeUndefined();
    expect(result.jobs.length).toBe(150);
    expect(mockFetchJson).toHaveBeenCalledTimes(2);
  });
});

// ─── schwarzitParser — HTML fallback ────────────────────────────────────────

describe('schwarzitParser — HTML parsing', () => {
  let jobs: ReturnType<typeof schwarzitParser>;

  beforeAll(() => {
    const html = loadFixture('schwarzit', 'schwarz-digits.html');
    jobs = schwarzitParser(html, 'https://schwarz-digits.de/en/jobsearch');
  });

  it('should return an empty array (SPA page — jobs loaded by JS)', () => {
    // The Trinity CMS renders jobs client-side via the DigitsSearch component.
    // The raw HTML won't contain job links, so the fallback parser returns [].
    // This is expected — the API fetch is the primary method.
    expect(jobs).toEqual([]);
  });
});

describe('schwarzitParser — edge cases', () => {
  it('should return empty array for empty HTML', () => {
    expect(schwarzitParser('', 'https://schwarz-digits.de/en/jobsearch')).toEqual([]);
  });

  it('should return empty array for HTML with no job data', () => {
    expect(schwarzitParser('<html><body>Hello</body></html>', 'https://schwarz-digits.de/en/jobsearch')).toEqual([]);
  });

  it('should parse jobs from HTML with embedded job links', () => {
    const html = `
      <html><body>
        <a href="/en/jobsearch/hr/software-engineer-m-f-d-GT1234">Software Engineer (m/f/d)</a>
        <a href="/en/jobsearch/devops-engineer-m-f-d-5678">DevOps Engineer (m/f/d)</a>
        <a href="/en/about">About Us</a>
      </body></html>
    `;
    const jobs = schwarzitParser(html, 'https://schwarz-digits.de/en/jobsearch');
    expect(jobs.length).toBe(2);
    expect(jobs[0].title).toContain('Software Engineer');
    expect(jobs[0].url).toContain('schwarz-digits.de');
    expect(jobs[1].title).toContain('DevOps Engineer');
  });
});
