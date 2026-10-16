/**
 * d.vinci ATS Parser — Unit Test Suite
 *
 * Covers:
 *  1. extractTenantId() — URL pattern recognition
 *  2. dvinciParser() — HTML listing page parsing
 *  3. extractDvinciData() — DvinciData JS object extraction from detail pages
 *  4. extractJsonLdDescription() — JSON-LD description extraction
 *  5. dvinciParseDetailHtml() — combined detail page parsing
 *  6. dvinciApiFetch() — end-to-end with mocked fetchHtml
 *  7. Edge cases: empty HTML, no jobs, invalid URLs
 *  8. Known job verification against CENIT fixtures
 *  9. Second company (Krones) fixture verification
 */

import { loadFixture } from '../helpers/fixture-loader';
import { expectMarkdownDescription } from '../helpers/markdown';

// Mock fetch-utils so dvinciApiFetch uses cached data instead of network
jest.mock('../../fetch-utils', () => ({
  fetchHtml: jest.fn(),
  fetchJson: jest.fn(),
  randomDelay: jest.fn().mockResolvedValue(undefined),
  sleep: jest.fn().mockResolvedValue(undefined),
}));

import {
  dvinciParser,
  dvinciApiFetch,
  dvinciParseDetailHtml,
  extractTenantId,
  extractDvinciData,
  extractJsonLdDescription,
} from '../../parsers/dvinci';
import { fetchHtml } from '../../fetch-utils';

const mockFetchHtml = fetchHtml as jest.MockedFunction<typeof fetchHtml>;

// ─── extractTenantId ──────────────────────────────────────────────────────────

describe('extractTenantId', () => {
  it('extracts tenant from standard dvinci-hr.com URL', () => {
    expect(extractTenantId('https://cenit.dvinci-hr.com/en/jobs/iframe')).toBe('cenit');
  });

  it('extracts tenant from root URL', () => {
    expect(extractTenantId('https://krones.dvinci-hr.com/')).toBe('krones');
  });

  it('extracts tenant from job detail URL', () => {
    expect(extractTenantId('https://cenit.dvinci-hr.com/en/jobs/30513/digital-manufacturing-application-engineer-mfd')).toBe('cenit');
  });

  it('returns null for non-dvinci URLs', () => {
    expect(extractTenantId('https://example.com/')).toBeNull();
    expect(extractTenantId('https://dvinci-hr.com/')).toBeNull();
  });

  it('returns null for invalid URLs', () => {
    expect(extractTenantId('not-a-url')).toBeNull();
    expect(extractTenantId('')).toBeNull();
  });
});

// ─── dvinciParser — CENIT listing fixture ──────────────────────────────────────

describe('dvinciParser — CENIT listing', () => {
  let jobs: ReturnType<typeof dvinciParser>;

  beforeAll(() => {
    const html = loadFixture('dvinci', 'cenit-listing.html');
    jobs = dvinciParser(html, 'https://cenit.dvinci-hr.com/en/jobs/iframe');
  });

  it('should parse a non-zero number of jobs', () => {
    expect(jobs.length).toBeGreaterThan(0);
  });

  it('should parse expected number of CENIT jobs (20+)', () => {
    expect(jobs.length).toBeGreaterThan(20);
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

  it('every url should point to dvinci-hr.com', () => {
    for (const job of jobs) {
      expect(job.url).toContain('dvinci-hr.com');
    }
  });

  it('every url should contain a numeric job ID', () => {
    for (const job of jobs) {
      expect(job.url).toMatch(/\/jobs\/\d+\//);
    }
  });

  it('should find the "Digital Manufacturing Application Engineer" job', () => {
    const found = jobs.find(j => /Digital Manufacturing Application Engineer/i.test(j.title));
    expect(found).toBeDefined();
    expect(found!.url).toContain('/30513/');
  });
});

// ─── dvinciParser — Krones listing fixture ─────────────────────────────────────

describe('dvinciParser — Krones listing (large board)', () => {
  let jobs: ReturnType<typeof dvinciParser>;

  beforeAll(() => {
    const html = loadFixture('dvinci', 'krones-listing.html');
    jobs = dvinciParser(html, 'https://krones.dvinci-hr.com/en/jobs/iframe');
  });

  it('should parse 200+ jobs from Krones', () => {
    expect(jobs.length).toBeGreaterThan(200);
  });

  it('every job should have title and absolute URL', () => {
    for (const job of jobs) {
      expect(job.title).toBeTruthy();
      expect(job.url).toMatch(/^https:\/\/krones\.dvinci-hr\.com/);
    }
  });
});

// ─── extractDvinciData — CENIT detail page ─────────────────────────────────────

describe('extractDvinciData — CENIT job detail', () => {
  let dvData: ReturnType<typeof extractDvinciData>;

  beforeAll(() => {
    const html = loadFixture('dvinci', 'cenit-job-detail.html');
    dvData = extractDvinciData(html);
  });

  it('should extract DvinciData object', () => {
    expect(dvData).not.toBeNull();
  });

  it('should have correct job title (position)', () => {
    expect(dvData!.position).toBe('Digital Manufacturing Application Engineer (m/f/d)');
  });

  it('should have jobOpening with location', () => {
    expect(dvData!.jobOpening).toBeDefined();
    expect(dvData!.jobOpening!.location).toBe('Auburn Hills');
  });

  it('should have department', () => {
    expect(dvData!.jobOpening!.department).toBe('Professional Services');
  });

  it('should have workingTimes', () => {
    expect(dvData!.jobOpening!.workingTimes).toBeDefined();
    expect(dvData!.jobOpening!.workingTimes!.length).toBeGreaterThan(0);
    expect(dvData!.jobOpening!.workingTimes![0].name).toContain('Full-time');
  });

  it('should have orgUnit (team)', () => {
    expect(dvData!.jobOpening!.orgUnit).toBeDefined();
    expect(dvData!.jobOpening!.orgUnit!.name).toBe('CENIT - US');
  });

  it('should have company info', () => {
    expect(dvData!.jobOpening!.company).toBeDefined();
    expect(dvData!.jobOpening!.company!.name).toBe('CENIT North America Inc.');
  });

  it('should have contract period', () => {
    expect(dvData!.jobOpening!.contractPeriod).toBeDefined();
    expect(dvData!.jobOpening!.contractPeriod!.name).toBe('Permanent');
  });
});

describe('extractDvinciData — edge cases', () => {
  it('returns null for empty HTML', () => {
    expect(extractDvinciData('')).toBeNull();
  });

  it('returns null for HTML without DvinciData', () => {
    expect(extractDvinciData('<html><body>Hello</body></html>')).toBeNull();
  });
});

// ─── extractJsonLdDescription ─────────────────────────────────────────────────

describe('extractJsonLdDescription — CENIT job detail', () => {
  let description: string | null;

  beforeAll(() => {
    const html = loadFixture('dvinci', 'cenit-job-detail.html');
    description = extractJsonLdDescription(html);
  });

  it('should extract a description from JSON-LD', () => {
    expect(description).toBeTruthy();
  });

  it('description should contain HTML content', () => {
    expect(description).toContain('About us');
  });

  it('description should contain job-specific text', () => {
    expect(description).toMatch(/CENIT|Auburn Hills|Digital Manufacturing/i);
  });
});

describe('extractJsonLdDescription — edge cases', () => {
  it('returns null for empty HTML', () => {
    expect(extractJsonLdDescription('')).toBeNull();
  });

  it('returns null for HTML without JSON-LD', () => {
    expect(extractJsonLdDescription('<html><body>Hello</body></html>')).toBeNull();
  });
});

// ─── dvinciParseDetailHtml — combined detail parsing ──────────────────────────

describe('dvinciParseDetailHtml — CENIT job detail', () => {
  let result: ReturnType<typeof dvinciParseDetailHtml>;

  beforeAll(() => {
    const html = loadFixture('dvinci', 'cenit-job-detail.html');
    result = dvinciParseDetailHtml(html);
  });

  it('should extract location', () => {
    expect(result.location).toBe('Auburn Hills');
  });

  it('should extract department', () => {
    expect(result.department).toBe('Professional Services');
  });

  it('should extract commitment (normalised)', () => {
    expect(result.commitment).toBe('Full-time');
  });

  it('should extract team (orgUnit)', () => {
    expect(result.team).toBe('CENIT - US');
  });

  it('should extract description as Markdown', () => {
    expect(result.description).toBeTruthy();
    // Should be Markdown, not raw HTML
    expect(result.description).not.toContain('<br>');
    // Markdown contract: no HTML tags at all in the stored description
    expectMarkdownDescription(result.description);
    // Should contain meaningful content
    expect(result.description).toMatch(/CENIT|Digital Manufacturing/i);
  });
});

// ─── dvinciApiFetch — mocked end-to-end ───────────────────────────────────────

describe('dvinciApiFetch — mocked with CENIT fixtures', () => {
  afterEach(() => mockFetchHtml.mockReset());

  it('should parse jobs from listing and enrich with detail data', async () => {
    const listingHtml = loadFixture('dvinci', 'cenit-listing.html');
    const detailHtml = loadFixture('dvinci', 'cenit-job-detail.html');

    // First call → listing page, subsequent calls → detail pages
    mockFetchHtml
      .mockResolvedValueOnce({ html: listingHtml, error: undefined })
      .mockResolvedValue({ html: detailHtml, error: undefined });

    const result = await dvinciApiFetch('https://cenit.dvinci-hr.com/en/jobs/iframe');
    expect(result.error).toBeUndefined();
    expect(result.jobs.length).toBeGreaterThan(0);

    // All jobs should have titles and URLs
    for (const job of result.jobs) {
      expect(job.title).toBeTruthy();
      expect(job.url).toMatch(/^https?:\/\//);
    }

    // Enriched jobs should have metadata from detail pages
    const enriched = result.jobs.filter(j => j.location);
    expect(enriched.length).toBeGreaterThan(0);
    expect(enriched[0].department).toBeTruthy();
    expect(enriched[0].commitment).toBeTruthy();
  });

  it('should return error for invalid URL (no tenant ID)', async () => {
    const result = await dvinciApiFetch('https://example.com/invalid');
    expect(result.error).toBeDefined();
    expect(result.jobs).toEqual([]);
  });

  it('should handle listing page fetch error gracefully', async () => {
    mockFetchHtml.mockResolvedValueOnce({ html: '', error: 'Network error' });

    const result = await dvinciApiFetch('https://cenit.dvinci-hr.com/en/jobs/iframe');
    expect(result.error).toBeDefined();
    expect(result.jobs).toEqual([]);
  });

  it('should handle zero jobs in listing gracefully', async () => {
    mockFetchHtml.mockResolvedValueOnce({
      html: '<html><body><table class="table"><tbody></tbody></table></body></html>',
      error: undefined,
    });

    const result = await dvinciApiFetch('https://cenit.dvinci-hr.com/en/jobs/iframe');
    expect(result.error).toBeUndefined();
    expect(result.jobs).toEqual([]);
  });

  it('should handle detail page errors gracefully (return jobs without enrichment)', async () => {
    const listingHtml = loadFixture('dvinci', 'cenit-listing.html');

    mockFetchHtml
      .mockResolvedValueOnce({ html: listingHtml, error: undefined })
      .mockResolvedValue({ html: '', error: 'Server error' });

    const result = await dvinciApiFetch('https://cenit.dvinci-hr.com/en/jobs/iframe');
    expect(result.error).toBeUndefined();
    expect(result.jobs.length).toBeGreaterThan(0);
    // Jobs should still have titles/URLs even without enrichment
    for (const job of result.jobs) {
      expect(job.title).toBeTruthy();
      expect(job.url).toBeTruthy();
    }
  });
});

// ─── dvinciParser — Edge cases ────────────────────────────────────────────────

describe('dvinciParser — Edge cases', () => {
  it('should return empty array for empty HTML', () => {
    expect(dvinciParser('', 'https://example.dvinci-hr.com')).toEqual([]);
  });

  it('should return empty array for HTML with no job data', () => {
    expect(dvinciParser('<html><body>Hello</body></html>', 'https://example.dvinci-hr.com')).toEqual([]);
  });

  it('should return empty array for table with no links', () => {
    const html = '<table class="table"><tbody><tr><td>Something</td></tr></tbody></table>';
    expect(dvinciParser(html, 'https://example.dvinci-hr.com')).toEqual([]);
  });
});
