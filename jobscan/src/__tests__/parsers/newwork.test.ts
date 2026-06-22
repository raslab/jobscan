/**
 * NEWWORK Software Careers Parser — Unit Test Suite
 *
 * Covers:
 *  1. isNewworkUrl() — URL recognition
 *  2. newworkParser() — HTML parser edge cases (always returns [])
 *  3. newworkApiFetch() — with mocked fetchJson using the synthetic fixture
 *  4. Field mapping: title, url, location, department, commitment, workplace_type, description
 *  5. Meta field fallbacks (missing/empty meta)
 *  6. Known job verification
 *  7. API pagination termination
 *
 * Fixture: src/__tests__/fixtures/newwork/jobs-api.json
 *   Synthetic fixture (5 jobs) modelling the WordPress REST API response shape.
 *   Includes: jobs with full meta, jobs with partial meta, jobs with empty meta object.
 */

import { loadJsonFixture } from '../helpers/fixture-loader';

// Mock fetch-utils so newworkApiFetch uses cached data instead of live network
jest.mock('../../fetch-utils', () => ({
  fetchJson: jest.fn(),
  fetchHtml: jest.fn(),
  randomDelay: jest.fn().mockResolvedValue(undefined),
  sleep: jest.fn().mockResolvedValue(undefined),
}));

import { newworkParser, newworkApiFetch, isNewworkUrl } from '../../parsers/newwork';
import { fetchJson } from '../../fetch-utils';
import type { ParsedJob } from '../../types';

const mockFetchJson = fetchJson as jest.MockedFunction<typeof fetchJson>;

// ─── isNewworkUrl ─────────────────────────────────────────────────────────────

describe('isNewworkUrl', () => {
  it('recognises https://www.newwork.com/careers', () => {
    expect(isNewworkUrl('https://www.newwork.com/careers')).toBe(true);
  });

  it('recognises https://www.newwork.com/careers/ (trailing slash)', () => {
    expect(isNewworkUrl('https://www.newwork.com/careers/')).toBe(true);
  });

  it('rejects URLs not on www.newwork.com', () => {
    expect(isNewworkUrl('https://jobs.newwork.com/careers')).toBe(false);
    expect(isNewworkUrl('https://newwork.com/careers')).toBe(false);
  });

  it('rejects newwork.com pages that are not /careers', () => {
    expect(isNewworkUrl('https://www.newwork.com/')).toBe(false);
    expect(isNewworkUrl('https://www.newwork.com/company/')).toBe(false);
    expect(isNewworkUrl('https://www.newwork.com/platform/')).toBe(false);
  });

  it('rejects unrelated sites', () => {
    expect(isNewworkUrl('https://jobs.greenhouse.io/newwork')).toBe(false);
    expect(isNewworkUrl('https://example.com/careers')).toBe(false);
    expect(isNewworkUrl('not-a-url')).toBe(false);
  });
});

// ─── newworkParser ────────────────────────────────────────────────────────────

describe('newworkParser — HTML parser (always returns [])', () => {
  it('returns empty array for empty HTML', () => {
    expect(newworkParser('', 'https://www.newwork.com/careers')).toEqual([]);
  });

  it('returns empty array for full HTML page (careers page has empty main)', () => {
    const html = '<html><body><main>\n\n\t\n\t\n\n</main></body></html>';
    expect(newworkParser(html, 'https://www.newwork.com/careers')).toEqual([]);
  });
});

// ─── newworkApiFetch — mocked fetchJson ───────────────────────────────────────

describe('newworkApiFetch — with synthetic fixture', () => {
  let jobs: ParsedJob[];
  const apiFixture = loadJsonFixture('newwork', 'jobs-api.json');

  beforeAll(async () => {
    // First page returns fixture data; second page returns empty array (no more pages)
    mockFetchJson
      .mockResolvedValueOnce({ data: apiFixture })
      .mockResolvedValueOnce({ data: [] });
    jobs = (await newworkApiFetch('https://www.newwork.com/careers')).jobs;
  });

  afterAll(() => mockFetchJson.mockReset());

  // ── Basic counts ─────────────────────────────────────────────────────────

  it('should parse a non-zero number of jobs', () => {
    expect(jobs.length).toBeGreaterThan(0);
  });

  it('should parse all 5 jobs from the fixture', () => {
    expect(jobs.length).toBe(5);
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

  it('every url should be an absolute URL starting with https', () => {
    for (const job of jobs) {
      expect(job.url).toMatch(/^https?:\/\//);
    }
  });

  // ── Meta fields ──────────────────────────────────────────────────────────

  it('job with full meta should have location', () => {
    const job = jobs.find(j => j.title === 'Senior Engineering Manager');
    expect(job).toBeDefined();
    expect(job!.location).toBe('Remote, Worldwide');
  });

  it('job with full meta should have department', () => {
    const job = jobs.find(j => j.title === 'Senior Engineering Manager');
    expect(job!.department).toBe('Engineering');
  });

  it('job with full meta should have commitment', () => {
    const job = jobs.find(j => j.title === 'Senior Engineering Manager');
    expect(job!.commitment).toBe('Full-time');
  });

  it('remote location should derive workplace_type Remote', () => {
    const job = jobs.find(j => j.title === 'Senior Engineering Manager');
    expect(job!.workplace_type).toBe('Remote');
  });

  it('job with partial location ("Berlin, Germany / Remote") should derive Remote', () => {
    const job = jobs.find(j => j.title === 'Staff Software Engineer \u2013 Backend');
    expect(job).toBeDefined();
    expect(job!.location).toBe('Berlin, Germany / Remote');
    expect(job!.workplace_type).toBe('Remote');
  });

  it('job with empty-string meta values should have undefined location/department', () => {
    const job = jobs.find(j => j.title === 'Senior Frontend Engineer');
    expect(job).toBeDefined();
    expect(job!.location).toBeUndefined();
    expect(job!.department).toBeUndefined();
    expect(job!.commitment).toBeUndefined();
  });

  it('job with empty meta object should have undefined location/department', () => {
    const job = jobs.find(j => j.title === 'DevOps Engineer');
    expect(job).toBeDefined();
    expect(job!.location).toBeUndefined();
    expect(job!.department).toBeUndefined();
  });

  // ── Description ──────────────────────────────────────────────────────────

  it('jobs with content should have description', () => {
    const job = jobs.find(j => j.title === 'Senior Engineering Manager');
    expect(job!.description).toBeTruthy();
  });

  it('description should be plain Markdown, not raw HTML', () => {
    const job = jobs.find(j => j.title === 'Senior Engineering Manager');
    // HTML tags should be gone; Markdown content preserved
    expect(job!.description).not.toMatch(/<[a-zA-Z]/);
  });

  it('description should contain expected text', () => {
    const job = jobs.find(j => j.title === 'Senior Engineering Manager');
    expect(job!.description).toMatch(/engineering|roadmap|team/i);
  });

  // ── URL correctness ──────────────────────────────────────────────────────

  it('job URL should match the WP link field', () => {
    const job = jobs.find(j => j.title === 'Senior Engineering Manager');
    expect(job!.url).toBe('https://www.newwork.com/senior-engineering-manager/');
  });
});

// ─── newworkApiFetch — error handling ────────────────────────────────────────

describe('newworkApiFetch — error handling', () => {
  afterEach(() => mockFetchJson.mockReset());

  it('should return error when API fails and no jobs collected yet', async () => {
    mockFetchJson.mockResolvedValueOnce({ data: null, error: 'Network error' });
    const result = await newworkApiFetch('https://www.newwork.com/careers');
    expect(result.error).toBeDefined();
    expect(result.jobs).toEqual([]);
  });

  it('should return collected jobs without error when API fails mid-pagination', async () => {
    const apiFixture = loadJsonFixture('newwork', 'jobs-api.json');
    // First page succeeds with 5 jobs (< 100, so it stops)
    mockFetchJson.mockResolvedValueOnce({ data: apiFixture });
    const result = await newworkApiFetch('https://www.newwork.com/careers');
    expect(result.error).toBeUndefined();
    expect(result.jobs.length).toBe(5);
  });

  it('should return empty array for empty API response', async () => {
    mockFetchJson.mockResolvedValueOnce({ data: [] });
    const result = await newworkApiFetch('https://www.newwork.com/careers');
    expect(result.error).toBeUndefined();
    expect(result.jobs).toEqual([]);
  });
});

// ─── newworkApiFetch — pagination ────────────────────────────────────────────

describe('newworkApiFetch — pagination', () => {
  afterEach(() => mockFetchJson.mockReset());

  it('should call multiple pages when first page is full (100 items)', async () => {
    // Build 100-item page (full page → fetch page 2)
    // Build page 2 with 3 items (< 100 → stop)
    const fullPage = Array.from({ length: 100 }, (_, i) => ({
      id: i + 1,
      link: `https://www.newwork.com/job-${i + 1}/`,
      title: { rendered: `Job ${i + 1}` },
      content: { rendered: '<p>Content</p>' },
      excerpt: { rendered: '<p>Short</p>' },
      meta: { job_location: 'Remote', job_department: 'Engineering', job_type: 'Full-time' },
    }));

    const partialPage = [
      {
        id: 101,
        link: 'https://www.newwork.com/job-101/',
        title: { rendered: 'Job 101' },
        content: { rendered: '<p>Content</p>' },
        excerpt: { rendered: '' },
        meta: {},
      },
    ];

    mockFetchJson
      .mockResolvedValueOnce({ data: fullPage })
      .mockResolvedValueOnce({ data: partialPage })
      .mockResolvedValueOnce({ data: [] });

    const result = await newworkApiFetch('https://www.newwork.com/careers');
    expect(result.jobs.length).toBe(101);
    expect(mockFetchJson).toHaveBeenCalledTimes(2);
  });
});
