/**
 * FREE NOW Parser — Unit Test Suite
 *
 * Covers:
 *  1. isFreenowUrl() URL recognition
 *  2. freenowApiFetch() with mocked fetchJson (cached API fixture)
 *  3. freenowParser() HTML fallback stub (always returns empty array)
 *  4. Field mapping: title, url, location, department, description
 *  5. Content HTML entity decoding → Markdown conversion
 *  6. Edge cases: empty jobs array, missing fields
 *  7. Known job verification from real fixture
 */

import { loadJsonFixture } from '../helpers/fixture-loader';

// Mock fetch-utils so freenowApiFetch uses our cached fixture instead of network
jest.mock('../../fetch-utils', () => ({
  fetchJson: jest.fn(),
  fetchHtml: jest.fn(),
  randomDelay: jest.fn().mockResolvedValue(undefined),
  sleep: jest.fn().mockResolvedValue(undefined),
}));

import { freenowApiFetch, freenowParser, isFreenowUrl } from '../../parsers/freenow';
import { fetchJson } from '../../fetch-utils';

const mockFetchJson = fetchJson as jest.MockedFunction<typeof fetchJson>;

// ─── isFreenowUrl ─────────────────────────────────────────────────────────────

describe('isFreenowUrl', () => {
  it('recognises the main jobs listing page', () => {
    expect(isFreenowUrl('https://www.free-now.com/career/jobs/')).toBe(true);
  });

  it('recognises without trailing slash', () => {
    expect(isFreenowUrl('https://www.free-now.com/career/jobs')).toBe(true);
  });

  it('recognises individual job detail pages', () => {
    expect(isFreenowUrl('https://www.free-now.com/career/jobs/7481211/')).toBe(true);
  });

  it('rejects unrelated free-now pages', () => {
    expect(isFreenowUrl('https://www.free-now.com/career/')).toBe(false);
    expect(isFreenowUrl('https://www.free-now.com/')).toBe(false);
    expect(isFreenowUrl('https://www.free-now.com/uk/about-us/')).toBe(false);
  });

  it('rejects other job sites', () => {
    expect(isFreenowUrl('https://job-boards.greenhouse.io/freenow')).toBe(false);
    expect(isFreenowUrl('https://jobs.lever.co/freenow')).toBe(false);
    expect(isFreenowUrl('https://example.com/career/jobs')).toBe(false);
  });

  it('rejects malformed URLs gracefully', () => {
    expect(isFreenowUrl('not-a-url')).toBe(false);
    expect(isFreenowUrl('')).toBe(false);
  });
});

// ─── freenowParser (HTML stub) ────────────────────────────────────────────────

describe('freenowParser — HTML fallback stub', () => {
  it('returns empty array for empty HTML', () => {
    expect(freenowParser('', 'https://www.free-now.com/career/jobs/')).toEqual([]);
  });

  it('returns empty array for any non-empty HTML (always defers to API)', () => {
    const html = '<html><body><h1>Jobs</h1></body></html>';
    expect(freenowParser(html, 'https://www.free-now.com/career/jobs/')).toEqual([]);
  });
});

// ─── freenowApiFetch — edge cases ────────────────────────────────────────────

describe('freenowApiFetch — edge cases', () => {
  beforeEach(() => {
    mockFetchJson.mockReset();
  });

  it('returns empty array + error when fetchJson fails', async () => {
    mockFetchJson.mockResolvedValueOnce({ data: null, error: 'Network error' });
    const result = await freenowApiFetch('https://www.free-now.com/career/jobs/');
    expect(result.jobs).toEqual([]);
    expect(result.error).toBe('Network error');
  });

  it('returns empty array when API returns empty jobs list', async () => {
    mockFetchJson.mockResolvedValueOnce({ data: { jobs: [] }, error: undefined });
    const result = await freenowApiFetch('https://www.free-now.com/career/jobs/');
    expect(result.jobs).toEqual([]);
    expect(result.error).toBeUndefined();
  });

  it('skips jobs that have no title', async () => {
    mockFetchJson.mockResolvedValueOnce({
      data: {
        jobs: [
          { title: '', absolute_url: 'https://job-boards.greenhouse.io/freenow/jobs/1', location: { name: 'Berlin' }, departments: [] },
        ],
      },
      error: undefined,
    });
    const result = await freenowApiFetch('https://www.free-now.com/career/jobs/');
    expect(result.jobs).toEqual([]);
  });

  it('skips jobs that have no absolute_url', async () => {
    mockFetchJson.mockResolvedValueOnce({
      data: {
        jobs: [
          { title: 'Some Job', absolute_url: '', location: { name: 'Berlin' }, departments: [] },
        ],
      },
      error: undefined,
    });
    const result = await freenowApiFetch('https://www.free-now.com/career/jobs/');
    expect(result.jobs).toEqual([]);
  });

  it('handles null metadata gracefully (no crash)', async () => {
    mockFetchJson.mockResolvedValueOnce({
      data: {
        jobs: [
          {
            title: 'Test Job',
            absolute_url: 'https://job-boards.greenhouse.io/freenow/jobs/999',
            location: { name: 'Hamburg' },
            departments: [{ name: 'Tech' }],
            metadata: null,
            content: '',
          },
        ],
      },
      error: undefined,
    });
    const result = await freenowApiFetch('https://www.free-now.com/career/jobs/');
    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0].title).toBe('Test Job');
  });
});

// ─── freenowApiFetch — real fixture ──────────────────────────────────────────

describe('freenowApiFetch — freenow-api.json fixture', () => {
  let jobs: Awaited<ReturnType<typeof freenowApiFetch>>['jobs'];

  beforeAll(async () => {
    const apiData = loadJsonFixture('freenow', 'freenow-api.json');
    mockFetchJson.mockResolvedValueOnce({ data: apiData, error: undefined });
    const result = await freenowApiFetch('https://www.free-now.com/career/jobs/');
    jobs = result.jobs;
  });

  // ── Basic counts ─────────────────────────────────────────────────────────

  it('should parse a non-zero number of jobs', () => {
    expect(jobs.length).toBeGreaterThan(0);
  });

  it('should parse approximately the expected job count (fixture has 68 jobs)', () => {
    expect(jobs.length).toBeGreaterThanOrEqual(50);
    expect(jobs.length).toBeLessThanOrEqual(120);
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

  it('every url should be an absolute https URL', () => {
    for (const job of jobs) {
      expect(job.url).toMatch(/^https:\/\//);
    }
  });

  it('all urls should point to job-boards.greenhouse.io/freenow', () => {
    for (const job of jobs) {
      expect(job.url).toMatch(/job-boards\.greenhouse\.io\/freenow\/jobs\/\d+/);
    }
  });

  // ── Location ─────────────────────────────────────────────────────────────

  it('most jobs should have a location', () => {
    const withLoc = jobs.filter((j) => j.location);
    expect(withLoc.length).toBeGreaterThan(jobs.length * 0.8);
  });

  it('should not store empty string as location', () => {
    for (const job of jobs) {
      if (job.location !== undefined) {
        expect(job.location.length).toBeGreaterThan(0);
      }
    }
  });

  // ── Department ───────────────────────────────────────────────────────────

  it('most jobs should have a department', () => {
    const withDept = jobs.filter((j) => j.department);
    expect(withDept.length).toBeGreaterThan(jobs.length * 0.8);
  });

  it('should parse multiple distinct departments', () => {
    const depts = new Set(jobs.map((j) => j.department).filter(Boolean));
    expect(depts.size).toBeGreaterThan(4);
  });

  it('should include expected departments', () => {
    const depts = new Set(jobs.map((j) => j.department));
    expect(depts.has('Tech')).toBe(true);
    expect(depts.has('Marketing')).toBe(true);
  });

  // ── Description ──────────────────────────────────────────────────────────

  it('most jobs should have a description', () => {
    const withDesc = jobs.filter((j) => j.description);
    expect(withDesc.length).toBeGreaterThan(jobs.length * 0.8);
  });

  it('descriptions should be Markdown (not raw HTML entities)', () => {
    for (const job of jobs) {
      if (job.description) {
        // Should not contain raw entity encoding like &lt; or &gt;
        expect(job.description).not.toMatch(/&lt;|&gt;|&amp;/);
      }
    }
  });

  it('descriptions should not contain raw HTML tags', () => {
    for (const job of jobs) {
      if (job.description) {
        // After Markdown conversion there should be no <p>, <div>, <span> etc.
        expect(job.description).not.toMatch(/<\/?(p|div|span|ul|li|h[1-6]|strong|em)\b/i);
      }
    }
  });

  it('descriptions should be non-trivially long', () => {
    const withDesc = jobs.filter((j) => j.description);
    for (const job of withDesc) {
      expect(job.description!.length).toBeGreaterThan(50);
    }
  });

  // ── Known job verification ────────────────────────────────────────────────

  it('should find the known EM job from the fixture', () => {
    const titles = jobs.map((j) => j.title);
    expect(titles).toContain('Engineering Manager, Driver Onboarding (m/f/d)');
  });

  it('the EM job should have correct metadata', () => {
    const emJob = jobs.find((j) => j.title === 'Engineering Manager, Driver Onboarding (m/f/d)');
    expect(emJob).toBeDefined();
    expect(emJob!.location).toBe('Barcelona, Barcelona, Spain');
    expect(emJob!.department).toBe('Tech');
    expect(emJob!.url).toContain('job-boards.greenhouse.io/freenow/jobs/');
    expect(emJob!.description).toBeTruthy();
  });

  it('should find the known B2B Marketing Operations Manager job', () => {
    const job = jobs.find((j) => j.title === 'B2B Marketing Operations Manager');
    expect(job).toBeDefined();
    expect(job!.department).toBe('Marketing');
    expect(job!.location).toBe('Barcelona, Barcelona, Spain');
  });
});
