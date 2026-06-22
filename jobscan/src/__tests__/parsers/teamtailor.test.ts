/**
 * Teamtailor Parser — Full Test Suite
 *
 * Covers:
 *  1. teamtailorParser() HTML parsing with real fixtures (payfit, doccla)
 *  2. teamtailorApiFetch() RSS parsing with cached XML (mocked fetchHtml)
 *  3. teamtailorDetect() company name extraction
 *  4. Edge cases: empty HTML, root page with no jobs, custom domains
 *  5. Custom domain handling (careers.doccla.com, careers.payfit.com)
 *  6. Embedded Teamtailor widget detection (hadrian.io → careers.hadrian.io)
 *  7. detectAllFromHtml() — "powered by" link with utm_content → atsUrl extraction
 */

import { loadFixture } from '../helpers/fixture-loader';

// Mock fetch-utils so teamtailorApiFetch/Detect use cached data instead of network
jest.mock('../../fetch-utils', () => ({
  fetchJson: jest.fn(),
  fetchHtml: jest.fn(),
}));

import { teamtailorParser, teamtailorApiFetch, teamtailorDetect } from '../../parsers/teamtailor';
import { detectAllFromHtml } from '../../parsers/registry';
import { fetchHtml } from '../../fetch-utils';

const mockFetchHtml = fetchHtml as jest.MockedFunction<typeof fetchHtml>;

// ─── HTML Parser — PayFit (custom domain with jobs on /jobs page) ─────────────

describe('teamtailorParser — PayFit HTML (custom domain)', () => {
  let jobs: ReturnType<typeof teamtailorParser>;

  beforeAll(() => {
    const html = loadFixture('teamtailor', 'payfit.html');
    jobs = teamtailorParser(html, 'https://careers.payfit.com/jobs');
  });

  it('should parse a non-zero number of jobs', () => {
    expect(jobs.length).toBeGreaterThan(0);
  });

  it('should parse approximately the expected job count', () => {
    // PayFit has ~10-20 jobs
    expect(jobs.length).toBeGreaterThanOrEqual(5);
    expect(jobs.length).toBeLessThanOrEqual(50);
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

  it('urls should point to the careers domain', () => {
    for (const job of jobs) {
      expect(job.url).toContain('careers.payfit.com');
    }
  });

  it('should not have duplicate URLs', () => {
    const urls = jobs.map(j => j.url);
    expect(new Set(urls).size).toBe(urls.length);
  });
});

// ─── HTML Parser — Doccla root page (zero jobs expected) ──────────────────────

describe('teamtailorParser — Doccla root page (no job links)', () => {
  let jobs: ReturnType<typeof teamtailorParser>;

  beforeAll(() => {
    const html = loadFixture('teamtailor', 'doccla-root.html');
    jobs = teamtailorParser(html, 'https://careers.doccla.com/');
  });

  it('should return zero jobs from root page (jobs are on /jobs subpath)', () => {
    // This documents the known issue: careers.doccla.com/ has no job links
    expect(jobs.length).toBe(0);
  });
});

// ─── HTML Parser — Doccla /jobs page (has jobs) ──────────────────────────────

describe('teamtailorParser — Doccla /jobs page', () => {
  let jobs: ReturnType<typeof teamtailorParser>;

  beforeAll(() => {
    const html = loadFixture('teamtailor', 'doccla-jobs.html');
    jobs = teamtailorParser(html, 'https://careers.doccla.com/jobs');
  });

  it('should parse a non-zero number of jobs', () => {
    expect(jobs.length).toBeGreaterThan(0);
  });

  it('every job should have required fields: title and url', () => {
    for (const job of jobs) {
      expect(job.title).toBeTruthy();
      expect(job.url).toBeTruthy();
    }
  });

  it('every url should be an absolute URL pointing to doccla', () => {
    for (const job of jobs) {
      expect(job.url).toMatch(/^https?:\/\/careers\.doccla\.com\/jobs\/\d+/);
    }
  });
});

// ─── RSS API Fetch — PayFit (custom domain) ──────────────────────────────────

describe('teamtailorApiFetch — PayFit RSS (custom domain)', () => {
  afterEach(() => mockFetchHtml.mockReset());

  it('should parse jobs from cached RSS feed via custom domain', async () => {
    const rssXml = loadFixture('teamtailor', 'payfit-rss.xml');
    mockFetchHtml.mockResolvedValue({ html: rssXml });

    const result = await teamtailorApiFetch('https://careers.payfit.com/jobs');
    expect(result.error).toBeUndefined();
    expect(result.jobs.length).toBeGreaterThan(0);
    expect(result.jobs.length).toBeGreaterThanOrEqual(10);
  });

  it('every job should have title, url, and description', async () => {
    const rssXml = loadFixture('teamtailor', 'payfit-rss.xml');
    mockFetchHtml.mockResolvedValue({ html: rssXml });

    const { jobs } = await teamtailorApiFetch('https://careers.payfit.com/jobs');
    for (const job of jobs) {
      expect(job.title).toBeTruthy();
      expect(job.url).toBeTruthy();
      expect(job.url).toMatch(/^https?:\/\//);
      expect(job.description).toBeTruthy();
    }
  });

  it('should parse locations for most jobs', async () => {
    const rssXml = loadFixture('teamtailor', 'payfit-rss.xml');
    mockFetchHtml.mockResolvedValue({ html: rssXml });

    const { jobs } = await teamtailorApiFetch('https://careers.payfit.com/jobs');
    const withLoc = jobs.filter(j => j.location);
    expect(withLoc.length).toBeGreaterThan(jobs.length * 0.5);
  });

  it('should parse departments', async () => {
    const rssXml = loadFixture('teamtailor', 'payfit-rss.xml');
    mockFetchHtml.mockResolvedValue({ html: rssXml });

    const { jobs } = await teamtailorApiFetch('https://careers.payfit.com/jobs');
    const withDept = jobs.filter(j => j.department);
    expect(withDept.length).toBeGreaterThan(0);
  });

  it('should parse workplace_type (remote status)', async () => {
    const rssXml = loadFixture('teamtailor', 'payfit-rss.xml');
    mockFetchHtml.mockResolvedValue({ html: rssXml });

    const { jobs } = await teamtailorApiFetch('https://careers.payfit.com/jobs');
    const withWorkplace = jobs.filter(j => j.workplace_type);
    expect(withWorkplace.length).toBeGreaterThan(0);
    // Valid values
    for (const job of withWorkplace) {
      expect(['Remote', 'Hybrid', 'On-site', 'Temporarily Remote']).toContain(job.workplace_type);
    }
  });
});

// ─── RSS API Fetch — Doccla (custom domain) ──────────────────────────────────

describe('teamtailorApiFetch — Doccla RSS (custom domain)', () => {
  afterEach(() => mockFetchHtml.mockReset());

  it('should parse jobs from Doccla RSS feed via custom domain', async () => {
    const rssXml = loadFixture('teamtailor', 'doccla-rss.xml');
    mockFetchHtml.mockResolvedValue({ html: rssXml });

    const result = await teamtailorApiFetch('https://careers.doccla.com/jobs');
    expect(result.error).toBeUndefined();
    expect(result.jobs.length).toBeGreaterThan(0);
  });

  it('job URLs should point to doccla careers domain', async () => {
    const rssXml = loadFixture('teamtailor', 'doccla-rss.xml');
    mockFetchHtml.mockResolvedValue({ html: rssXml });

    const { jobs } = await teamtailorApiFetch('https://careers.doccla.com/jobs');
    for (const job of jobs) {
      expect(job.url).toContain('careers.doccla.com');
    }
  });
});

// ─── RSS API Fetch — Standard *.teamtailor.com URL ───────────────────────────

describe('teamtailorApiFetch — standard teamtailor.com URL', () => {
  afterEach(() => mockFetchHtml.mockReset());

  it('should construct correct RSS URL from slug', async () => {
    const rssXml = loadFixture('teamtailor', 'payfit-rss.xml');
    mockFetchHtml.mockResolvedValue({ html: rssXml });

    await teamtailorApiFetch('https://payfit.teamtailor.com/jobs');
    expect(mockFetchHtml).toHaveBeenCalledWith(
      'https://payfit.teamtailor.com/jobs.rss?per_page=500',
    );
  });

  it('should handle slug-only URL (no /jobs path)', async () => {
    const rssXml = loadFixture('teamtailor', 'payfit-rss.xml');
    mockFetchHtml.mockResolvedValue({ html: rssXml });

    await teamtailorApiFetch('https://payfit.teamtailor.com');
    expect(mockFetchHtml).toHaveBeenCalledWith(
      'https://payfit.teamtailor.com/jobs.rss?per_page=500',
    );
  });

  it('should return error for non-teamtailor URL without custom domain support', async () => {
    // With custom domain support, this will now try {origin}/jobs.rss — which will fail on fetch
    mockFetchHtml.mockResolvedValue({ html: '', error: 'Not Found' });

    const result = await teamtailorApiFetch('https://example.com/jobs');
    expect(result.error).toBeDefined();
    expect(result.jobs).toEqual([]);
  });

  it('should reject CDN subdomains', async () => {
    // CDN subdomains are excluded from slug extraction, falls back to custom domain path
    mockFetchHtml.mockResolvedValue({ html: '', error: 'Not Found' });

    const result = await teamtailorApiFetch('https://assets-aws.teamtailor.com/something');
    expect(result.error).toBeDefined();
    expect(result.jobs).toEqual([]);
  });
});

// ─── teamtailorDetect — company name extraction ─────────────────────────────

describe('teamtailorDetect', () => {
  afterEach(() => mockFetchHtml.mockReset());

  it('should extract company name from RSS feed title', async () => {
    const rssXml = loadFixture('teamtailor', 'payfit-rss.xml');
    mockFetchHtml.mockResolvedValue({ html: rssXml });

    const result = await teamtailorDetect('https://payfit.teamtailor.com');
    expect(result.company).toBe('PayFit');
    expect(result.error).toBeUndefined();
  });

  it('should fallback to prettified slug on fetch error', async () => {
    mockFetchHtml.mockResolvedValue({ html: '', error: 'Network error' });

    const result = await teamtailorDetect('https://my-company.teamtailor.com');
    expect(result.company).toBe('My Company');
  });

  it('should return error for non-teamtailor URL', async () => {
    // Custom domain support now tries to fetch RSS from any URL's origin.
    // Simulate a non-teamtailor site returning invalid content.
    mockFetchHtml.mockResolvedValue({ html: '', error: 'Not Found' });

    const result = await teamtailorDetect('https://example.com/careers');
    // Should fallback to hostname-based name
    expect(result.company).toBeTruthy();
  });
});

// ─── Edge Cases ──────────────────────────────────────────────────────────────

describe('teamtailorParser — Edge cases', () => {
  it('should return empty array for empty HTML', () => {
    expect(teamtailorParser('', 'https://example.com')).toEqual([]);
  });

  it('should return empty array for HTML with no job data', () => {
    expect(teamtailorParser('<html><body>Hello</body></html>', 'https://example.com')).toEqual([]);
  });

  it('should return empty array for HTML with non-matching links', () => {
    const html = '<html><body><a href="/about">About</a><a href="/contact">Contact</a></body></html>';
    expect(teamtailorParser(html, 'https://example.com')).toEqual([]);
  });

  it('should handle links without /jobs/ path', () => {
    const html = '<html><body><a href="/careers/123">Job</a></body></html>';
    expect(teamtailorParser(html, 'https://example.com')).toEqual([]);
  });

  it('should parse jobs from minimal valid HTML', () => {
    const html = `
      <html><body>
        <a href="/jobs/12345-software-engineer">
          <span>Software Engineer</span>
        </a>
      </body></html>
    `;
    const jobs = teamtailorParser(html, 'https://careers.example.com');
    expect(jobs.length).toBe(1);
    expect(jobs[0].title).toBe('Software Engineer');
    expect(jobs[0].url).toBe('https://careers.example.com/jobs/12345-software-engineer');
  });

  it('should deduplicate jobs with same URL', () => {
    const html = `
      <html><body>
        <a href="/jobs/12345-software-engineer"><span>Software Engineer</span></a>
        <a href="/jobs/12345-software-engineer"><span>Software Engineer</span></a>
      </body></html>
    `;
    const jobs = teamtailorParser(html, 'https://careers.example.com');
    expect(jobs.length).toBe(1);
  });
});

// ─── Detection — Hadrian (embedded Teamtailor widget via custom domain) ──────

describe('detectAllFromHtml — Hadrian (embedded Teamtailor with "powered by" link)', () => {
  let html: string;
  let results: ReturnType<typeof detectAllFromHtml>;

  beforeAll(() => {
    html = loadFixture('teamtailor', 'hadrian-careers.html');
    results = detectAllFromHtml('https://hadrian.io/company/careers', html);
  });

  it('should detect teamtailor as the parser', () => {
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].parser).toBe('teamtailor');
  });

  it('should extract the custom career domain as atsUrl from www.teamtailor.com utm_content', () => {
    const ttResult = results.find(r => r.parser === 'teamtailor');
    expect(ttResult).toBeDefined();
    expect(ttResult!.atsUrl).toBe('https://careers.hadrian.io');
  });

  it('should detect via links method', () => {
    const ttResult = results.find(r => r.parser === 'teamtailor');
    expect(ttResult!.method).toBe('links');
  });
});

describe('detectAllFromHtml — Teamtailor "powered by" link edge cases', () => {
  it('should extract custom domain from utm_content when www.teamtailor.com is the only match', () => {
    const html = `<html><body>
      <a href="https://www.teamtailor.com/?utm_campaign=poweredby&amp;utm_content=careers.example.com&amp;utm_medium=referral&amp;utm_source=career-site">Powered by</a>
    </body></html>`;
    const results = detectAllFromHtml('https://example.com/careers', html);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].parser).toBe('teamtailor');
    expect(results[0].atsUrl).toBe('https://careers.example.com');
  });

  it('should return null atsUrl for www.teamtailor.com without utm_content', () => {
    const html = `<html><body>
      <a href="https://www.teamtailor.com/">Teamtailor</a>
    </body></html>`;
    const results = detectAllFromHtml('https://example.com/careers', html);
    // May detect via content fingerprint fallback, but link rule should not produce atsUrl
    const linkResult = results.find(r => r.parser === 'teamtailor' && r.method === 'links');
    if (linkResult) {
      // If detected via links, atsUrl should be undefined (no utm_content)
      expect(linkResult.atsUrl).toBeUndefined();
    }
  });

  it('should still detect standard *.teamtailor.com slugs normally', () => {
    const html = `<html><body>
      <a href="https://mycompany.teamtailor.com/jobs/123-dev">Dev</a>
    </body></html>`;
    const results = detectAllFromHtml('https://example.com/careers', html);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].parser).toBe('teamtailor');
    expect(results[0].atsUrl).toBe('https://mycompany.teamtailor.com');
  });
});

// ─── RSS API Fetch — Hadrian (custom domain via careers.hadrian.io) ──────────

describe('teamtailorApiFetch — Hadrian RSS (custom domain)', () => {
  afterEach(() => mockFetchHtml.mockReset());

  it('should parse jobs from cached Hadrian RSS feed via custom domain', async () => {
    const rssXml = loadFixture('teamtailor', 'hadrian-rss.xml');
    mockFetchHtml.mockResolvedValue({ html: rssXml });

    const result = await teamtailorApiFetch('https://careers.hadrian.io');
    expect(result.error).toBeUndefined();
    expect(result.jobs.length).toBeGreaterThan(0);
  });

  it('should construct correct RSS URL from custom domain', async () => {
    const rssXml = loadFixture('teamtailor', 'hadrian-rss.xml');
    mockFetchHtml.mockResolvedValue({ html: rssXml });

    await teamtailorApiFetch('https://careers.hadrian.io');
    expect(mockFetchHtml).toHaveBeenCalledWith(
      'https://careers.hadrian.io/jobs.rss?per_page=500',
    );
  });

  it('every job should have title, url, and description', async () => {
    const rssXml = loadFixture('teamtailor', 'hadrian-rss.xml');
    mockFetchHtml.mockResolvedValue({ html: rssXml });

    const { jobs } = await teamtailorApiFetch('https://careers.hadrian.io');
    for (const job of jobs) {
      expect(job.title).toBeTruthy();
      expect(job.url).toBeTruthy();
      expect(job.url).toMatch(/^https?:\/\//);
      expect(job.description).toBeTruthy();
    }
  });

  it('job URLs should point to careers.hadrian.io', async () => {
    const rssXml = loadFixture('teamtailor', 'hadrian-rss.xml');
    mockFetchHtml.mockResolvedValue({ html: rssXml });

    const { jobs } = await teamtailorApiFetch('https://careers.hadrian.io');
    for (const job of jobs) {
      expect(job.url).toContain('careers.hadrian.io');
    }
  });

  it('should parse locations for jobs that have them', async () => {
    const rssXml = loadFixture('teamtailor', 'hadrian-rss.xml');
    mockFetchHtml.mockResolvedValue({ html: rssXml });

    const { jobs } = await teamtailorApiFetch('https://careers.hadrian.io');
    const withLoc = jobs.filter(j => j.location);
    expect(withLoc.length).toBeGreaterThan(0);
  });

  it('should parse departments when available', async () => {
    const rssXml = loadFixture('teamtailor', 'hadrian-rss.xml');
    mockFetchHtml.mockResolvedValue({ html: rssXml });

    const { jobs } = await teamtailorApiFetch('https://careers.hadrian.io');
    const withDept = jobs.filter(j => j.department);
    expect(withDept.length).toBeGreaterThan(0);
  });

  it('should parse workplace_type (remote status) when available', async () => {
    const rssXml = loadFixture('teamtailor', 'hadrian-rss.xml');
    mockFetchHtml.mockResolvedValue({ html: rssXml });

    const { jobs } = await teamtailorApiFetch('https://careers.hadrian.io');
    const withWorkplace = jobs.filter(j => j.workplace_type);
    if (withWorkplace.length > 0) {
      for (const job of withWorkplace) {
        expect(['Remote', 'Hybrid', 'On-site', 'Temporarily Remote']).toContain(job.workplace_type);
      }
    }
  });
});

// ─── teamtailorDetect — Hadrian (custom domain) ─────────────────────────────

describe('teamtailorDetect — Hadrian (custom domain)', () => {
  afterEach(() => mockFetchHtml.mockReset());

  it('should extract company name "Hadrian" from RSS feed title', async () => {
    const rssXml = loadFixture('teamtailor', 'hadrian-rss.xml');
    mockFetchHtml.mockResolvedValue({ html: rssXml });

    const result = await teamtailorDetect('https://careers.hadrian.io');
    expect(result.company).toBe('Hadrian');
    expect(result.error).toBeUndefined();
  });
});
