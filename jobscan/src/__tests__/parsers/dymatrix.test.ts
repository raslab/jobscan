/**
 * DYMATRIX Careers Parser — Unit Test Suite
 *
 * Covers:
 *  1. dymatrixParser() — listing page HTML parsing (page 1, 2, 3)
 *  2. extractPaginationPages() — pagination link extraction
 *  3. dymatrixParseDetailHtml() — detail page parsing (description, location, commitment)
 *  4. dymatrixApiFetch() — end-to-end with mocked fetchHtml (pagination + detail enrichment)
 *  5. Edge cases: empty HTML, no jobs, malformed input
 *  6. Known job verification against fixtures
 *  7. Metadata coverage (location, department, team, commitment)
 */

import { loadFixture } from '../helpers/fixture-loader';

// Mock fetch-utils so dymatrixApiFetch uses cached data instead of network
jest.mock('../../fetch-utils', () => ({
  fetchHtml: jest.fn(),
  fetchJson: jest.fn(),
  randomDelay: jest.fn().mockResolvedValue(undefined),
  sleep: jest.fn().mockResolvedValue(undefined),
}));

import {
  dymatrixParser,
  dymatrixApiFetch,
  dymatrixParseDetailHtml,
  extractPaginationPages,
} from '../../parsers/dymatrix';
import { fetchHtml } from '../../fetch-utils';

const mockFetchHtml = fetchHtml as jest.MockedFunction<typeof fetchHtml>;

// ─── dymatrixParser — Page 1 listing fixture ──────────────────────────────────

describe('dymatrixParser — Page 1 listing', () => {
  let jobs: ReturnType<typeof dymatrixParser>;

  beforeAll(() => {
    const html = loadFixture('dymatrix', 'listing-page1.html');
    jobs = dymatrixParser(html, 'https://www.dymatrix.de/de/unternehmen/stellenangebote');
  });

  it('should parse a non-zero number of jobs', () => {
    expect(jobs.length).toBeGreaterThan(0);
  });

  it('should parse expected number of jobs on page 1 (9)', () => {
    expect(jobs.length).toBe(9);
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

  it('every url should point to dymatrix.de', () => {
    for (const job of jobs) {
      expect(job.url).toContain('dymatrix.de');
    }
  });

  it('every url should contain /details/ path', () => {
    for (const job of jobs) {
      expect(job.url).toContain('/stellenangebote/details/');
    }
  });

  it('should parse locations for most jobs', () => {
    const withLoc = jobs.filter(j => j.location);
    expect(withLoc.length).toBeGreaterThan(jobs.length * 0.5);
  });

  it('should parse departments for most jobs', () => {
    const withDept = jobs.filter(j => j.department);
    expect(withDept.length).toBeGreaterThan(0);
  });

  it('should parse team (company) for most jobs', () => {
    const withTeam = jobs.filter(j => j.team);
    expect(withTeam.length).toBeGreaterThan(0);
  });

  it('should parse commitment for most jobs', () => {
    const withCommitment = jobs.filter(j => j.commitment);
    expect(withCommitment.length).toBeGreaterThan(0);
  });

  it('should find the "Technical Customer Success Manager" job', () => {
    const found = jobs.find(j => /Technical Customer Success Manager/i.test(j.title));
    expect(found).toBeDefined();
    expect(found!.url).toContain('/details/technical-customer-success-manager');
    expect(found!.location).toContain('Stuttgart');
    expect(found!.team).toBe('CleverPush GmbH');
    expect(found!.department).toBe('Customer Service');
  });

  it('should find the "Software Engineer Java" job', () => {
    const found = jobs.find(j => /Software Engineer Java/i.test(j.title));
    expect(found).toBeDefined();
    expect(found!.url).toContain('/details/software-engineer-java');
  });

  it('should handle multiple locations (comma-separated)', () => {
    const multiLoc = jobs.find(j => j.location && j.location.includes(','));
    expect(multiLoc).toBeDefined();
  });
});

// ─── dymatrixParser — Page 2 listing fixture ──────────────────────────────────

describe('dymatrixParser — Page 2 listing', () => {
  let jobs: ReturnType<typeof dymatrixParser>;

  beforeAll(() => {
    const html = loadFixture('dymatrix', 'listing-page2.html');
    jobs = dymatrixParser(html, 'https://www.dymatrix.de/de/unternehmen/stellenangebote');
  });

  it('should parse 9 jobs on page 2', () => {
    expect(jobs.length).toBe(9);
  });

  it('every job should have title and url', () => {
    for (const job of jobs) {
      expect(job.title).toBeTruthy();
      expect(job.url).toMatch(/^https?:\/\/.*dymatrix\.de.*\/details\//);
    }
  });

  it('should find "Account Executive" job', () => {
    const found = jobs.find(j => /Account Executive/i.test(j.title));
    expect(found).toBeDefined();
  });
});

// ─── dymatrixParser — Page 3 listing fixture ──────────────────────────────────

describe('dymatrixParser — Page 3 listing', () => {
  let jobs: ReturnType<typeof dymatrixParser>;

  beforeAll(() => {
    const html = loadFixture('dymatrix', 'listing-page3.html');
    jobs = dymatrixParser(html, 'https://www.dymatrix.de/de/unternehmen/stellenangebote');
  });

  it('should parse 4 jobs on page 3', () => {
    expect(jobs.length).toBe(4);
  });

  it('every job should have title and url', () => {
    for (const job of jobs) {
      expect(job.title).toBeTruthy();
      expect(job.url).toMatch(/^https?:\/\//);
    }
  });
});

// ─── extractPaginationPages ───────────────────────────────────────────────────

describe('extractPaginationPages', () => {
  it('should extract page numbers from page 1 HTML', () => {
    const html = loadFixture('dymatrix', 'listing-page1.html');
    const pages = extractPaginationPages(html);
    expect(pages).toContain(1);
    expect(pages).toContain(2);
    expect(pages).toContain(3);
    expect(pages.length).toBe(3);
  });

  it('should extract page numbers from page 2 HTML', () => {
    const html = loadFixture('dymatrix', 'listing-page2.html');
    const pages = extractPaginationPages(html);
    expect(pages).toContain(1);
    expect(pages).toContain(2);
    expect(pages).toContain(3);
  });

  it('should return empty array for empty HTML', () => {
    expect(extractPaginationPages('')).toEqual([]);
  });

  it('should return empty array for HTML without pagination', () => {
    expect(extractPaginationPages('<html><body>Hello</body></html>')).toEqual([]);
  });
});

// ─── dymatrixParseDetailHtml ──────────────────────────────────────────────────

describe('dymatrixParseDetailHtml — Technical CSM detail page', () => {
  let result: ReturnType<typeof dymatrixParseDetailHtml>;

  beforeAll(() => {
    const html = loadFixture('dymatrix', 'detail-technical-csm.html');
    result = dymatrixParseDetailHtml(html);
  });

  it('should extract description', () => {
    expect(result.description).toBeTruthy();
    expect(result.description!.length).toBeGreaterThan(100);
  });

  it('description should contain job-specific text', () => {
    expect(result.description).toMatch(/CleverPush|Customer Success|Push-Benachrichtigungen/i);
  });

  it('should extract location', () => {
    expect(result.location).toBeTruthy();
    expect(result.location).toContain('Stuttgart');
  });

  it('should extract commitment', () => {
    expect(result.commitment).toBeTruthy();
    expect(result.commitment).toMatch(/Festanstellung|Voll|Teilzeit/i);
  });
});

describe('dymatrixParseDetailHtml — edge cases', () => {
  it('returns empty object for empty HTML', () => {
    const result = dymatrixParseDetailHtml('');
    expect(result.description).toBeUndefined();
    expect(result.location).toBeUndefined();
    expect(result.commitment).toBeUndefined();
  });

  it('returns empty object for HTML without detail content', () => {
    const result = dymatrixParseDetailHtml('<html><body>Hello</body></html>');
    expect(result.description).toBeUndefined();
  });
});

// ─── dymatrixParser — Edge cases ──────────────────────────────────────────────

describe('dymatrixParser — Edge cases', () => {
  it('should return empty array for empty HTML', () => {
    expect(dymatrixParser('', 'https://www.dymatrix.de/de/unternehmen/stellenangebote')).toEqual([]);
  });

  it('should return empty array for HTML with no job data', () => {
    expect(dymatrixParser('<html><body>Hello</body></html>', 'https://www.dymatrix.de/de/unternehmen/stellenangebote')).toEqual([]);
  });

  it('should handle invalid baseUrl gracefully', () => {
    const html = loadFixture('dymatrix', 'listing-page1.html');
    const jobs = dymatrixParser(html, 'not-a-url');
    expect(jobs.length).toBeGreaterThan(0);
  });
});

// ─── dymatrixApiFetch — end-to-end with mocked fetchHtml ─────────────────────

describe('dymatrixApiFetch', () => {
  afterEach(() => mockFetchHtml.mockReset());

  it('should fetch all pages and return combined jobs', async () => {
    const page1Html = loadFixture('dymatrix', 'listing-page1.html');
    const page2Html = loadFixture('dymatrix', 'listing-page2.html');
    const page3Html = loadFixture('dymatrix', 'listing-page3.html');
    const detailHtml = loadFixture('dymatrix', 'detail-technical-csm.html');

    // Mock fetchHtml to return different pages based on URL
    mockFetchHtml.mockImplementation(async (url: string) => {
      if (url.includes('currentPageNumber') && url.includes('2')) {
        return { html: page2Html };
      }
      if (url.includes('currentPageNumber') && url.includes('3')) {
        return { html: page3Html };
      }
      if (url.includes('/details/')) {
        return { html: detailHtml };
      }
      // Page 1 (no pagination param)
      return { html: page1Html };
    });

    const result = await dymatrixApiFetch('https://www.dymatrix.de/de/unternehmen/stellenangebote');

    expect(result.error).toBeUndefined();
    expect(result.jobs.length).toBe(22); // 9 + 9 + 4
  });

  it('should enrich jobs with descriptions from detail pages', async () => {
    const page1Html = loadFixture('dymatrix', 'listing-page1.html');
    const detailHtml = loadFixture('dymatrix', 'detail-technical-csm.html');

    // Only return page 1 (simulate single page, no pagination overlap)
    // Remove pagination from the HTML to simulate a single page scenario
    const singlePageHtml = page1Html.replace(/<ul class="pagination">[\s\S]*?<\/ul>/g, '');

    mockFetchHtml.mockImplementation(async (url: string) => {
      if (url.includes('/details/')) {
        return { html: detailHtml };
      }
      return { html: singlePageHtml };
    });

    const result = await dymatrixApiFetch('https://www.dymatrix.de/de/unternehmen/stellenangebote');

    expect(result.error).toBeUndefined();
    expect(result.jobs.length).toBeGreaterThan(0);

    // Check that at least some jobs got enriched with descriptions
    const withDesc = result.jobs.filter(j => j.description);
    expect(withDesc.length).toBeGreaterThan(0);
  });

  it('should handle rate limiting gracefully', async () => {
    const page1Html = loadFixture('dymatrix', 'listing-page1.html');
    const singlePageHtml = page1Html.replace(/<ul class="pagination">[\s\S]*?<\/ul>/g, '');
    let detailCallCount = 0;

    mockFetchHtml.mockImplementation(async (url: string) => {
      if (url.includes('/details/')) {
        detailCallCount++;
        if (detailCallCount >= 3) {
          return { html: '', error: '429 Too Many Requests' };
        }
        return { html: loadFixture('dymatrix', 'detail-technical-csm.html') };
      }
      return { html: singlePageHtml };
    });

    const result = await dymatrixApiFetch('https://www.dymatrix.de/de/unternehmen/stellenangebote');

    expect(result.error).toBeUndefined();
    // Should still return all jobs even if some detail fetches failed
    expect(result.jobs.length).toBeGreaterThan(0);
  });

  it('should return error when listing page fails', async () => {
    mockFetchHtml.mockResolvedValue({ html: '', error: '500 Internal Server Error' });

    const result = await dymatrixApiFetch('https://www.dymatrix.de/de/unternehmen/stellenangebote');

    expect(result.error).toBeTruthy();
    expect(result.jobs).toEqual([]);
  });

  it('should return empty jobs for page with no job cards', async () => {
    mockFetchHtml.mockResolvedValue({ html: '<html><body>No jobs here</body></html>' });

    const result = await dymatrixApiFetch('https://www.dymatrix.de/de/unternehmen/stellenangebote');

    expect(result.error).toBeUndefined();
    expect(result.jobs).toEqual([]);
  });
});
