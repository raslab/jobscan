/**
 * Rohde & Schwarz careers parser — Unit Test Suite
 *
 * Covers:
 *  1. isRohdeSchwarzUrl() — URL pattern recognition
 *  2. rohdeschwarzParser() — HTML page parsing with real fixtures
 *  3. extractTotalCount() — total job counter extraction
 *  4. rohdeschwarzApiFetch() — paginated fetch with mocked fetchHtml
 *  5. Edge cases: empty HTML, no jobs, invalid content
 *  6. Known job verification against page-0 fixture
 *  7. Second page (page-30) fixture verification
 */

import { loadFixture } from '../helpers/fixture-loader';

// Mock fetch-utils so rohdeschwarzApiFetch uses cached data instead of network
jest.mock('../../fetch-utils', () => ({
  fetchHtml: jest.fn(),
  fetchJson: jest.fn(),
  randomDelay: jest.fn().mockResolvedValue(undefined),
  sleep: jest.fn().mockResolvedValue(undefined),
}));

import {
  rohdeschwarzParser,
  rohdeschwarzApiFetch,
  extractTotalCount,
  isRohdeSchwarzUrl,
} from '../../parsers/rohdeschwarz';
import { fetchHtml } from '../../fetch-utils';

const mockFetchHtml = fetchHtml as jest.MockedFunction<typeof fetchHtml>;

// ─── isRohdeSchwarzUrl ────────────────────────────────────────────────────────

describe('isRohdeSchwarzUrl', () => {
  it('recognises German careers URL', () => {
    expect(isRohdeSchwarzUrl('https://www.rohde-schwarz.com/de/karriere/stellenangebote/karriere-stellenangebote_251573.html')).toBe(true);
  });

  it('recognises English careers URL', () => {
    expect(isRohdeSchwarzUrl('https://www.rohde-schwarz.com/en/career/job-offers/career-job-offers_251573.html')).toBe(true);
  });

  it('recognises URL without www', () => {
    expect(isRohdeSchwarzUrl('https://rohde-schwarz.com/de/karriere/stellenangebote/karriere-stellenangebote_251573.html')).toBe(true);
  });

  it('rejects non-career URLs on rohde-schwarz.com', () => {
    expect(isRohdeSchwarzUrl('https://www.rohde-schwarz.com/de/produkte/')).toBe(false);
  });

  it('rejects unrelated domains', () => {
    expect(isRohdeSchwarzUrl('https://example.com/karriere/')).toBe(false);
  });

  it('rejects invalid URLs', () => {
    expect(isRohdeSchwarzUrl('not-a-url')).toBe(false);
    expect(isRohdeSchwarzUrl('')).toBe(false);
  });
});

// ─── rohdeschwarzParser — page-0 fixture ──────────────────────────────────────

describe('rohdeschwarzParser — page-0 (first 30 jobs)', () => {
  let jobs: ReturnType<typeof rohdeschwarzParser>;
  const baseUrl = 'https://www.rohde-schwarz.com/de/karriere/stellenangebote/karriere-stellenangebote_251573.html?offset=0';

  beforeAll(() => {
    const html = loadFixture('rohdeschwarz', 'page-0.html');
    jobs = rohdeschwarzParser(html, baseUrl);
  });

  it('should parse exactly 30 jobs from the first page', () => {
    expect(jobs.length).toBe(30);
  });

  it('every job should have required fields: title and url', () => {
    for (const job of jobs) {
      expect(job.title).toBeTruthy();
      expect(job.url).toBeTruthy();
    }
  });

  it('every url should be an absolute URL', () => {
    for (const job of jobs) {
      expect(job.url).toMatch(/^https?:\/\//);
    }
  });

  it('every url should point to rohde-schwarz.com', () => {
    for (const job of jobs) {
      expect(job.url).toContain('rohde-schwarz.com');
    }
  });

  it('should parse departments (Functional area) for most jobs', () => {
    const withDept = jobs.filter(j => j.department);
    expect(withDept.length).toBeGreaterThan(jobs.length * 0.5);
  });

  it('should parse commitment (Entry level) for most jobs', () => {
    const withCommitment = jobs.filter(j => j.commitment);
    expect(withCommitment.length).toBeGreaterThan(jobs.length * 0.5);
  });

  it('should parse locations for most jobs', () => {
    const withLoc = jobs.filter(j => j.location);
    expect(withLoc.length).toBeGreaterThan(jobs.length * 0.5);
  });

  it('should have no duplicate URLs', () => {
    const urls = jobs.map(j => j.url);
    expect(new Set(urls).size).toBe(urls.length);
  });
});

// ─── rohdeschwarzParser — page-30 fixture ─────────────────────────────────────

describe('rohdeschwarzParser — page-30 (second page)', () => {
  let jobs: ReturnType<typeof rohdeschwarzParser>;
  const baseUrl = 'https://www.rohde-schwarz.com/de/karriere/stellenangebote/karriere-stellenangebote_251573.html?offset=30';

  beforeAll(() => {
    const html = loadFixture('rohdeschwarz', 'page-30.html');
    jobs = rohdeschwarzParser(html, baseUrl);
  });

  it('should parse exactly 30 jobs from the second page', () => {
    expect(jobs.length).toBe(30);
  });

  it('every job should have title and absolute URL', () => {
    for (const job of jobs) {
      expect(job.title).toBeTruthy();
      expect(job.url).toMatch(/^https?:\/\/.*rohde-schwarz\.com/);
    }
  });

  it('jobs should be different from page 0', () => {
    const page0Html = loadFixture('rohdeschwarz', 'page-0.html');
    const page0Jobs = rohdeschwarzParser(page0Html, baseUrl);
    const page0Urls = new Set(page0Jobs.map(j => j.url));
    const page30Urls = jobs.map(j => j.url);

    // None of the page-30 URLs should appear in page-0
    for (const url of page30Urls) {
      expect(page0Urls.has(url)).toBe(false);
    }
  });
});

// ─── extractTotalCount ────────────────────────────────────────────────────────

describe('extractTotalCount', () => {
  it('should extract total count from page HTML', () => {
    const html = loadFixture('rohdeschwarz', 'page-0.html');
    const total = extractTotalCount(html);
    expect(total).toBeGreaterThan(100);
  });

  it('should return 0 for HTML without counter', () => {
    expect(extractTotalCount('<html><body>No jobs</body></html>')).toBe(0);
  });

  it('should return 0 for empty HTML', () => {
    expect(extractTotalCount('')).toBe(0);
  });
});

// ─── Known job verification ───────────────────────────────────────────────────

describe('rohdeschwarzParser — known job verification', () => {
  it('should find "T&M Sales Account Manager (Power Electronics)" in page-0', () => {
    const html = loadFixture('rohdeschwarz', 'page-0.html');
    const jobs = rohdeschwarzParser(html, 'https://www.rohde-schwarz.com/de/karriere/stellenangebote/karriere-stellenangebote_251573.html');

    const knownJob = jobs.find(j => j.title.includes('Sales Account Manager'));
    expect(knownJob).toBeDefined();
    expect(knownJob!.url).toContain('rohde-schwarz.com');
    expect(knownJob!.url).toContain('.html');
  });
});

// ─── Edge cases ───────────────────────────────────────────────────────────────

describe('rohdeschwarzParser — Edge cases', () => {
  const baseUrl = 'https://www.rohde-schwarz.com/de/karriere/stellenangebote/karriere-stellenangebote_251573.html';

  it('should return empty array for empty HTML', () => {
    expect(rohdeschwarzParser('', baseUrl)).toEqual([]);
  });

  it('should return empty array for HTML with no job data', () => {
    expect(rohdeschwarzParser('<html><body>Hello</body></html>', baseUrl)).toEqual([]);
  });

  it('should return empty array for HTML with accordion but no title links', () => {
    const html = '<div class="module-accordion"><div class="content"></div></div>';
    expect(rohdeschwarzParser(html, baseUrl)).toEqual([]);
  });
});

// ─── rohdeschwarzApiFetch (mocked fetchHtml) ──────────────────────────────────

describe('rohdeschwarzApiFetch — paginated fetch', () => {
  afterEach(() => mockFetchHtml.mockReset());

  it('should fetch all jobs across multiple pages', async () => {
    const page0Html = loadFixture('rohdeschwarz', 'page-0.html');
    const page30Html = loadFixture('rohdeschwarz', 'page-30.html');

    // Mock: page 0 → 30 jobs, page 30 → 30 jobs, page 60 → 0 jobs (empty)
    mockFetchHtml
      .mockResolvedValueOnce({ html: page0Html })    // offset=0
      .mockResolvedValueOnce({ html: page30Html })    // offset=30
      .mockResolvedValueOnce({ html: '<html><body><div class="module-counter-big"><span class="counter">60</span></div></body></html>' }); // offset=60 → 0 jobs

    const result = await rohdeschwarzApiFetch('https://www.rohde-schwarz.com/de/karriere/stellenangebote/karriere-stellenangebote_251573.html');

    expect(result.error).toBeUndefined();
    expect(result.jobs.length).toBe(60); // 30 + 30
    expect(mockFetchHtml).toHaveBeenCalledTimes(3);
  });

  it('should handle error on first page', async () => {
    mockFetchHtml.mockResolvedValueOnce({ html: '', error: 'HTTP 500' });

    const result = await rohdeschwarzApiFetch('https://www.rohde-schwarz.com/de/karriere/stellenangebote/karriere-stellenangebote_251573.html');

    expect(result.error).toBeDefined();
    expect(result.jobs).toEqual([]);
  });

  it('should return partial results if later page errors', async () => {
    const page0Html = loadFixture('rohdeschwarz', 'page-0.html');

    mockFetchHtml
      .mockResolvedValueOnce({ html: page0Html })
      .mockResolvedValueOnce({ html: '', error: 'HTTP 503' });

    const result = await rohdeschwarzApiFetch('https://www.rohde-schwarz.com/de/karriere/stellenangebote/karriere-stellenangebote_251573.html');

    // Should return the 30 jobs from page 0 even though page 1 failed
    expect(result.error).toBeUndefined();
    expect(result.jobs.length).toBe(30);
  });

  it('should stop when page returns fewer than 30 jobs', async () => {
    // Create a minimal HTML with counter and 5 jobs
    const fewJobsHtml = `<html><body>
      <div class="module-counter-big"><span class="counter">5</span></div>
      ${Array.from({length: 5}, (_, i) => `
        <div class="module-accordion">
          <div class="accordion-table-list">
            <div class="accordion-table-list-item column-2">
              <a href="/job-${i}.html" class="accordion-table-list-item-title-link">Job ${i}</a>
            </div>
          </div>
        </div>
      `).join('')}
    </body></html>`;

    mockFetchHtml.mockResolvedValueOnce({ html: fewJobsHtml });

    const result = await rohdeschwarzApiFetch('https://www.rohde-schwarz.com/de/karriere/stellenangebote/karriere-stellenangebote_251573.html');

    expect(result.error).toBeUndefined();
    expect(result.jobs.length).toBe(5);
    expect(mockFetchHtml).toHaveBeenCalledTimes(1); // Only one page fetch
  });
});
