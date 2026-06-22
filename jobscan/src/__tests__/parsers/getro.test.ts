/**
 * Getro Unified Parser — Full Test Suite
 *
 * Tests the domain-agnostic Getro parser against fixtures from ALL known boards:
 *   - Cherry VC (talent.cherry.vc)
 *   - HV Capital (hv.getro.com)
 *   - Earlybird (jobs.earlybird.com)
 *   - Play VC (careers.play.vc)
 *
 * Covers:
 *  1. isGetroHostname() / parseGetroUrl() — URL detection & parsing
 *  2. extractNextData() — company metadata from __NEXT_DATA__ across all boards
 *  3. extractJobSlugsFromSitemap() — sitemap parsing for job slugs per domain
 *  4. buildMetadataHeader() — metadata header from Getro job + company data
 *  5. getroApiFetch() with mocked fetchHtml/fetchJson across all boards
 *  6. getroDetect() with mocked fetchHtml across all boards
 *  7. getroParser() — returns empty (jobs are SPA-loaded)
 *  8. Edge cases (invalid URLs, empty HTML, missing data, hash fragments)
 */

import { loadFixture, loadJsonFixture } from '../helpers/fixture-loader';

// Mock fetch-utils so API fetch uses cached data
jest.mock('../../fetch-utils', () => ({
  fetchHtml: jest.fn(),
  fetchJson: jest.fn(),
  sleep: jest.fn().mockResolvedValue(undefined),
  randomDelay: jest.fn().mockResolvedValue(undefined),
}));

import {
  isGetroHostname,
  parseGetroUrl,
  extractNextData,
  extractJobSlugsFromSitemap,
  buildMetadataHeader,
  getroApiFetch,
  getroDetect,
  getroParser,
  getKnownDomains,
} from '../../parsers/getro';
import { detectParserFromUrl } from '../../parsers/registry';
import { fetchHtml, fetchJson, sleep } from '../../fetch-utils';

const mockFetchHtml = fetchHtml as jest.MockedFunction<typeof fetchHtml>;
const mockFetchJson = fetchJson as jest.MockedFunction<typeof fetchJson>;
const mockSleep = sleep as jest.MockedFunction<typeof sleep>;

// ─── isGetroHostname ──────────────────────────────────────────────────────────

describe('isGetroHostname', () => {
  it('should recognise talent.cherry.vc', () => {
    expect(isGetroHostname('talent.cherry.vc')).toBe(true);
  });

  it('should recognise hv.getro.com', () => {
    expect(isGetroHostname('hv.getro.com')).toBe(true);
  });

  it('should recognise jobs.earlybird.com', () => {
    expect(isGetroHostname('jobs.earlybird.com')).toBe(true);
  });

  it('should recognise careers.play.vc', () => {
    expect(isGetroHostname('careers.play.vc')).toBe(true);
  });

  it('should recognise jobs.femtechinsider.com', () => {
    expect(isGetroHostname('jobs.femtechinsider.com')).toBe(true);
  });

  it('should recognise jobs.protocol.ai', () => {
    expect(isGetroHostname('jobs.protocol.ai')).toBe(true);
  });

  it('should recognise impactjobs.doen.nl', () => {
    expect(isGetroHostname('impactjobs.doen.nl')).toBe(true);
  });

  it('should recognise jobs.venturesplatform.com', () => {
    expect(isGetroHostname('jobs.venturesplatform.com')).toBe(true);
  });

  it('should recognise jobs.sapphireventures.com', () => {
    expect(isGetroHostname('jobs.sapphireventures.com')).toBe(true);
  });

  it('should reject unknown domains', () => {
    expect(isGetroHostname('example.com')).toBe(false);
    expect(isGetroHostname('getro.com')).toBe(false);
    expect(isGetroHostname('www.cherry.vc')).toBe(false);
  });
});

// ─── parseGetroUrl ────────────────────────────────────────────────────────────

describe('parseGetroUrl', () => {
  it('should parse Cherry VC company URL', () => {
    const result = parseGetroUrl('https://talent.cherry.vc/companies/afilio');
    expect(result).toEqual({ hostname: 'talent.cherry.vc', companySlug: 'afilio' });
  });

  it('should parse HV Capital company URL', () => {
    const result = parseGetroUrl('https://hv.getro.com/companies/accessus');
    expect(result).toEqual({ hostname: 'hv.getro.com', companySlug: 'accessus' });
  });

  it('should parse Earlybird company URL', () => {
    const result = parseGetroUrl('https://jobs.earlybird.com/companies/finmid');
    expect(result).toEqual({ hostname: 'jobs.earlybird.com', companySlug: 'finmid' });
  });

  it('should parse Play VC company URL', () => {
    const result = parseGetroUrl('https://careers.play.vc/companies/arya-2-7824848a-244e-4e51-acea-5f3f25c258e0');
    expect(result).toEqual({ hostname: 'careers.play.vc', companySlug: 'arya-2-7824848a-244e-4e51-acea-5f3f25c258e0' });
  });

  it('should parse Femtech Insider company URL', () => {
    const result = parseGetroUrl('https://jobs.femtechinsider.com/companies/tia');
    expect(result).toEqual({ hostname: 'jobs.femtechinsider.com', companySlug: 'tia' });
  });

  it('should parse Femtech Insider URL with slug containing dash', () => {
    const result = parseGetroUrl('https://jobs.femtechinsider.com/companies/twentyeight-health');
    expect(result).toEqual({ hostname: 'jobs.femtechinsider.com', companySlug: 'twentyeight-health' });
  });

  it('should parse Protocol.ai company URL', () => {
    const result = parseGetroUrl('https://jobs.protocol.ai/companies/pl-job-board');
    expect(result).toEqual({ hostname: 'jobs.protocol.ai', companySlug: 'pl-job-board' });
  });

  it('should extract slug from URL with job path', () => {
    const result = parseGetroUrl('https://hv.getro.com/companies/accessus/jobs/64706401-frontend-engineer');
    expect(result).toEqual({ hostname: 'hv.getro.com', companySlug: 'accessus' });
  });

  it('should handle URL with hash fragment', () => {
    const result = parseGetroUrl('https://careers.play.vc/companies/arya-2-7824848a-244e-4e51-acea-5f3f25c258e0#content');
    expect(result).toEqual({ hostname: 'careers.play.vc', companySlug: 'arya-2-7824848a-244e-4e51-acea-5f3f25c258e0' });
  });

  it('should return null for unknown domain', () => {
    expect(parseGetroUrl('https://example.com/companies/test')).toBeNull();
  });

  it('should return null for URL without /companies/ path', () => {
    expect(parseGetroUrl('https://hv.getro.com/jobs')).toBeNull();
  });

  it('should return null for invalid URL', () => {
    expect(parseGetroUrl('not-a-url')).toBeNull();
  });
});

// ─── extractNextData — Cherry VC (Afilio) ─────────────────────────────────────

describe('extractNextData — Cherry VC / Afilio', () => {
  let pageProps: ReturnType<typeof extractNextData>;

  beforeAll(() => {
    const html = loadFixture('getro', 'cherryvc-afilio.html');
    pageProps = extractNextData(html);
  });

  it('should extract pageProps from __NEXT_DATA__', () => {
    expect(pageProps).not.toBeNull();
  });

  it('should have Afilio company data', () => {
    expect(pageProps!.company).toBeDefined();
    expect(pageProps!.company!.name).toBe('Afilio');
    expect(pageProps!.company!.id).toBe(55849);
    expect(pageProps!.company!.slug).toBe('afilio');
    expect(pageProps!.company!.domain).toBe('afilio.de');
  });

  it('should have Cherry Ventures network ID', () => {
    expect(pageProps!.network!.id).toBe('44081');
  });

  it('should have industry tags', () => {
    expect(pageProps!.company!.industryTags).toContain('Internet Services');
  });

  it('should have approximate employee count', () => {
    expect(pageProps!.company!.approxEmployees).toBeGreaterThan(0);
  });
});

// ─── extractNextData — HV Capital (Accessus) ─────────────────────────────────

describe('extractNextData — HV Capital / Accessus', () => {
  let pageProps: ReturnType<typeof extractNextData>;

  beforeAll(() => {
    const html = loadFixture('getro', 'hvcapital-accessus.html');
    pageProps = extractNextData(html);
  });

  it('should extract pageProps', () => {
    expect(pageProps).not.toBeNull();
  });

  it('should have Accessus company data', () => {
    expect(pageProps!.company!.name).toBe('Accessus');
    expect(pageProps!.company!.id).toBe(1492961);
    expect(pageProps!.company!.slug).toBe('accessus');
    expect(pageProps!.company!.domain).toBe('accessus.science');
  });

  it('should have HV Capital network ID', () => {
    expect(pageProps!.network!.id).toBe('234');
  });

  it('should have active jobs count', () => {
    expect(pageProps!.company!.activeJobsCount).toBeGreaterThan(0);
  });
});

// ─── extractNextData — Earlybird (finmid) ────────────────────────────────────

describe('extractNextData — Earlybird / finmid', () => {
  let pageProps: ReturnType<typeof extractNextData>;

  beforeAll(() => {
    const html = loadFixture('getro', 'earlybird-finmid.html');
    pageProps = extractNextData(html);
  });

  it('should extract finmid company data', () => {
    expect(pageProps).not.toBeNull();
    expect(pageProps!.company!.name).toBe('finmid');
    expect(pageProps!.company!.slug).toBe('finmid');
    expect(pageProps!.company!.domain).toBe('finmid.com');
  });

  it('should have Earlybird network ID', () => {
    expect(pageProps!.network!.id).toBe('617');
  });

  it('should have industry tags', () => {
    expect(pageProps!.company!.industryTags).toContain('Finance');
  });
});

// ─── extractNextData — Play VC (Arya) ────────────────────────────────────────

describe('extractNextData — Play VC / Arya', () => {
  let pageProps: ReturnType<typeof extractNextData>;

  beforeAll(() => {
    const html = loadFixture('getro', 'playvc-arya.html');
    pageProps = extractNextData(html);
  });

  it('should extract pageProps', () => {
    expect(pageProps).not.toBeNull();
  });

  it('should have Arya company data', () => {
    expect(pageProps!.company).toBeDefined();
    expect(pageProps!.company!.name).toBe('Arya');
    expect(pageProps!.company!.slug).toMatch(/^arya/);
  });

  it('should have Play Ventures network ID', () => {
    expect(pageProps!.network!.id).toBe('1624');
  });
});

// ─── extractJobSlugsFromSitemap — Cherry VC ──────────────────────────────────

describe('extractJobSlugsFromSitemap — Cherry VC', () => {
  let sitemapXml: string;

  beforeAll(() => {
    sitemapXml = loadFixture('getro', 'cherryvc-sitemap.xml');
  });

  it('should extract Afilio job slugs', () => {
    const slugs = extractJobSlugsFromSitemap(sitemapXml, 'https://talent.cherry.vc', 'afilio');
    expect(slugs.length).toBe(3);
    expect(slugs).toContain('72644557-redakteur-in-m-w-d');
    expect(slugs).toContain('72434174-senior-software-engineer-f-m-d');
  });

  it('should return empty array for non-existent company', () => {
    const slugs = extractJobSlugsFromSitemap(sitemapXml, 'https://talent.cherry.vc', 'nonexistent');
    expect(slugs).toEqual([]);
  });

  it('should return empty array for empty sitemap', () => {
    const slugs = extractJobSlugsFromSitemap('', 'https://talent.cherry.vc', 'afilio');
    expect(slugs).toEqual([]);
  });

  it('slugs should not include path separators', () => {
    const slugs = extractJobSlugsFromSitemap(sitemapXml, 'https://talent.cherry.vc', 'afilio');
    expect(slugs.every(s => s.length > 0 && !s.includes('/'))).toBe(true);
  });
});

// ─── extractJobSlugsFromSitemap — HV Capital ────────────────────────────────

describe('extractJobSlugsFromSitemap — HV Capital', () => {
  let sitemapXml: string;

  beforeAll(() => {
    sitemapXml = loadFixture('getro', 'hvcapital-sitemap.xml');
  });

  it('should extract Accessus job slugs', () => {
    const slugs = extractJobSlugsFromSitemap(sitemapXml, 'https://hv.getro.com', 'accessus');
    expect(slugs.length).toBe(5);
    expect(slugs).toContain('64706401-frontend-engineer');
    expect(slugs).toContain('64706400-backend-developer-engineer');
    expect(slugs).toContain('64706398-ui-ux-designer');
  });
});

// ─── extractJobSlugsFromSitemap — Earlybird ─────────────────────────────────

describe('extractJobSlugsFromSitemap — Earlybird', () => {
  let sitemapXml: string;

  beforeAll(() => {
    sitemapXml = loadFixture('getro', 'earlybird-sitemap.xml');
  });

  it('should extract finmid job slugs', () => {
    const slugs = extractJobSlugsFromSitemap(sitemapXml, 'https://jobs.earlybird.com', 'finmid');
    expect(slugs.length).toBe(3);
    expect(slugs).toContain('70530489-senior-associate-operations-regulatory-infrastructure');
  });
});

// ─── extractJobSlugsFromSitemap — Play VC ───────────────────────────────────

describe('extractJobSlugsFromSitemap — Play VC', () => {
  let sitemapXml: string;

  beforeAll(() => {
    sitemapXml = loadFixture('getro', 'playvc-sitemap.xml');
  });

  it('should extract Arya job slugs', () => {
    const slugs = extractJobSlugsFromSitemap(
      sitemapXml,
      'https://careers.play.vc',
      'arya-2-7824848a-244e-4e51-acea-5f3f25c258e0',
    );
    expect(slugs.length).toBeGreaterThan(0);
  });
});

// ─── buildMetadataHeader ──────────────────────────────────────────────────────

describe('buildMetadataHeader', () => {
  it('should include salary when compensation data is present (Cherry VC fixture)', () => {
    const job = loadJsonFixture('getro', 'cherryvc-afilio-job-detail.json') as any;
    const header = buildMetadataHeader(job);
    expect(header).toContain('Salary:');
    expect(header).toContain('EUR');
    expect(header).toContain('80,000');
    expect(header).toContain('100,000');
    expect(header).toContain('/year');
  });

  it('should include location (HV Capital fixture)', () => {
    const job = loadJsonFixture('getro', 'hvcapital-job-detail.json') as any;
    const header = buildMetadataHeader(job);
    expect(header).toContain('Location:');
    expect(header).toContain('Berlin, Germany');
    expect(header).toContain('Munich, Germany');
  });

  it('should include department from job_functions (Cherry VC fixture)', () => {
    const job = loadJsonFixture('getro', 'cherryvc-afilio-job-detail.json') as any;
    const header = buildMetadataHeader(job);
    expect(header).toContain('Department:');
    expect(header).toContain('Software Engineering');
  });

  it('should filter out parenthesized job function duplicates', () => {
    const job = loadJsonFixture('getro', 'cherryvc-manual-job-detail.json') as any;
    const header = buildMetadataHeader(job);
    expect(header).toContain('Marketing & Communications');
    expect(header).not.toContain('(Marketing & Communications)');
  });

  it('should include company metadata when provided (Cherry VC)', () => {
    const job = loadJsonFixture('getro', 'cherryvc-afilio-job-detail.json') as any;
    const html = loadFixture('getro', 'cherryvc-afilio.html');
    const company = extractNextData(html)!.company!;
    const header = buildMetadataHeader(job, company);
    expect(header).toContain('Industry: Internet Services');
    expect(header).toContain('Founded: 2017');
  });

  it('should include company metadata when provided (Earlybird)', () => {
    const job = loadJsonFixture('getro', 'earlybird-finmid-job-detail.json') as any;
    const html = loadFixture('getro', 'earlybird-finmid.html');
    const company = extractNextData(html)!.company!;
    const header = buildMetadataHeader(job, company);
    expect(header).toContain('Industry: Finance');
    expect(header).toContain('Founded: 2021');
    expect(header).toContain('Company size:');
  });

  it('should omit salary when no compensation data', () => {
    const job = loadJsonFixture('getro', 'cherryvc-manual-job-detail.json') as any;
    const header = buildMetadataHeader(job);
    expect(header).not.toContain('Salary:');
  });

  it('should handle all fields present', () => {
    const header = buildMetadataHeader(
      {
        title: 'Test',
        slug: 'test',
        url: 'https://example.com',
        description: 'desc',
        id: 1,
        status: 'active',
        source: 'career_page',
        posted_at: '2026-01-01',
        locations: [{ id: 1, name: 'Berlin, Germany' }],
        organization: { id: 1, name: 'Test', slug: 'test' },
        job_functions: [{ id: 1, name: 'Engineering' }],
        employment_types: ['Full-time'],
        compensation_currency: 'EUR',
        compensation_period: 'year',
        compensation_amount_min_cents: 5000000,
        compensation_amount_max_cents: 7000000,
        compensation_offers_equity: true,
        compensation_public: true,
      } as any,
      {
        id: 1,
        name: 'TestCo',
        slug: 'testco',
        industryTags: ['SaaS'],
        stage: 'series_a',
        approxEmployees: 50,
        founded: '2020',
      },
    );

    expect(header).toContain('Salary: EUR 50,000 - EUR 70,000/year');
    expect(header).toContain('Equity: Yes');
    expect(header).toContain('Location: Berlin, Germany');
    expect(header).toContain('Department: Engineering');
    expect(header).toContain('Job type: Full-time');
    expect(header).toContain('Industry: SaaS');
    expect(header).toContain('Stage: series a');
    expect(header).toContain('Company size: ~50 employees');
    expect(header).toContain('Founded: 2020');
  });

  it('should return empty string when no data is present', () => {
    const header = buildMetadataHeader(
      {
        title: 'Test', slug: 'test', url: '', description: '', id: 1,
        status: 'active', source: '', posted_at: '',
        locations: [], organization: { id: 1, name: 'X', slug: 'x' },
        job_functions: [], employment_types: [],
        compensation_currency: null, compensation_period: null,
        compensation_amount_min_cents: null, compensation_amount_max_cents: null,
        compensation_offers_equity: null, compensation_public: false,
      } as any,
    );
    expect(header).toBe('');
  });
});

// ─── getroApiFetch — Cherry VC / Afilio ──────────────────────────────────────

describe('getroApiFetch — Cherry VC / Afilio', () => {
  afterEach(() => {
    mockFetchHtml.mockReset();
    mockFetchJson.mockReset();
    mockSleep.mockReset();
  });

  it('should fetch jobs for Afilio (3 jobs)', async () => {
    const companyHtml = loadFixture('getro', 'cherryvc-afilio.html');
    const sitemapXml = loadFixture('getro', 'cherryvc-sitemap.xml');
    const jobDetail = loadJsonFixture('getro', 'cherryvc-afilio-job-detail.json');

    mockFetchHtml
      .mockResolvedValueOnce({ html: companyHtml })
      .mockResolvedValueOnce({ html: sitemapXml });
    mockFetchJson.mockResolvedValue({ data: jobDetail });

    const result = await getroApiFetch('https://talent.cherry.vc/companies/afilio');
    expect(result.error).toBeUndefined();
    expect(result.jobs.length).toBe(3);
  });

  it('should have correct fields for each job', async () => {
    const companyHtml = loadFixture('getro', 'cherryvc-afilio.html');
    const sitemapXml = loadFixture('getro', 'cherryvc-sitemap.xml');
    const jobDetail = loadJsonFixture('getro', 'cherryvc-afilio-job-detail.json');

    mockFetchHtml
      .mockResolvedValueOnce({ html: companyHtml })
      .mockResolvedValueOnce({ html: sitemapXml });
    mockFetchJson.mockResolvedValue({ data: jobDetail });

    const result = await getroApiFetch('https://talent.cherry.vc/companies/afilio');

    for (const job of result.jobs) {
      expect(job.title).toBeTruthy();
      expect(job.url).toMatch(/^https:\/\/talent\.cherry\.vc\/companies\/afilio\/jobs\//);
      expect(job.description).toBeTruthy();
      expect(job.description!.length).toBeGreaterThan(100);
    }
  });

  it('should have metadata header in descriptions', async () => {
    const companyHtml = loadFixture('getro', 'cherryvc-afilio.html');
    const sitemapXml = loadFixture('getro', 'cherryvc-sitemap.xml');
    const jobDetail = loadJsonFixture('getro', 'cherryvc-afilio-job-detail.json');

    mockFetchHtml
      .mockResolvedValueOnce({ html: companyHtml })
      .mockResolvedValueOnce({ html: sitemapXml });
    mockFetchJson.mockResolvedValue({ data: jobDetail });

    const result = await getroApiFetch('https://talent.cherry.vc/companies/afilio');

    for (const job of result.jobs) {
      expect(job.description).toContain('Salary:');
      expect(job.description).toContain('EUR');
      expect(job.description).toContain('---');
      expect(job.description).toContain('Location:');
      expect(job.description).toContain('Department:');
      expect(job.description).toContain('Industry:');
      expect(job.description).toContain('Founded:');
    }
  });

  it('should include location and department', async () => {
    const companyHtml = loadFixture('getro', 'cherryvc-afilio.html');
    const sitemapXml = loadFixture('getro', 'cherryvc-sitemap.xml');
    const jobDetail = loadJsonFixture('getro', 'cherryvc-afilio-job-detail.json');

    mockFetchHtml
      .mockResolvedValueOnce({ html: companyHtml })
      .mockResolvedValueOnce({ html: sitemapXml });
    mockFetchJson.mockResolvedValue({ data: jobDetail });

    const result = await getroApiFetch('https://talent.cherry.vc/companies/afilio');
    const withLoc = result.jobs.filter(j => j.location);
    expect(withLoc.length).toBe(result.jobs.length);
    expect(withLoc[0].location).toContain('Berlin, Germany');

    const withDept = result.jobs.filter(j => j.department);
    expect(withDept.length).toBeGreaterThan(0);
    expect(withDept[0].department).toContain('Software Engineering');
  });

  it('should use sleep between API calls for throttling', async () => {
    const companyHtml = loadFixture('getro', 'cherryvc-afilio.html');
    const sitemapXml = loadFixture('getro', 'cherryvc-sitemap.xml');
    const jobDetail = loadJsonFixture('getro', 'cherryvc-afilio-job-detail.json');

    mockFetchHtml
      .mockResolvedValueOnce({ html: companyHtml })
      .mockResolvedValueOnce({ html: sitemapXml });
    mockFetchJson.mockResolvedValue({ data: jobDetail });

    await getroApiFetch('https://talent.cherry.vc/companies/afilio');

    expect(mockSleep).toHaveBeenCalledTimes(3);
    expect(mockSleep).toHaveBeenCalledWith(300);
  });

  it('should skip jobs when API returns error', async () => {
    const companyHtml = loadFixture('getro', 'cherryvc-afilio.html');
    const sitemapXml = loadFixture('getro', 'cherryvc-sitemap.xml');
    const jobDetail = loadJsonFixture('getro', 'cherryvc-afilio-job-detail.json');

    mockFetchHtml
      .mockResolvedValueOnce({ html: companyHtml })
      .mockResolvedValueOnce({ html: sitemapXml });

    mockFetchJson
      .mockResolvedValueOnce({ data: null, error: 'HTTP 404 Not Found' })
      .mockResolvedValue({ data: jobDetail });

    const result = await getroApiFetch('https://talent.cherry.vc/companies/afilio');
    expect(result.error).toBeUndefined();
    expect(result.jobs.length).toBe(2);
  });
});

// ─── getroApiFetch — HV Capital / Accessus ──────────────────────────────────

describe('getroApiFetch — HV Capital / Accessus', () => {
  afterEach(() => {
    mockFetchHtml.mockReset();
    mockFetchJson.mockReset();
    mockSleep.mockReset();
  });

  it('should fetch jobs for Accessus (5 jobs)', async () => {
    const companyHtml = loadFixture('getro', 'hvcapital-accessus.html');
    const sitemapXml = loadFixture('getro', 'hvcapital-sitemap.xml');
    const jobDetail = loadJsonFixture('getro', 'hvcapital-accessus-job-detail.json');

    mockFetchHtml
      .mockResolvedValueOnce({ html: companyHtml })
      .mockResolvedValueOnce({ html: sitemapXml });
    mockFetchJson.mockResolvedValue({ data: jobDetail });

    const result = await getroApiFetch('https://hv.getro.com/companies/accessus');
    expect(result.error).toBeUndefined();
    expect(result.jobs.length).toBe(5);
  });

  it('should produce URLs pointing to hv.getro.com', async () => {
    const companyHtml = loadFixture('getro', 'hvcapital-accessus.html');
    const sitemapXml = loadFixture('getro', 'hvcapital-sitemap.xml');
    const jobDetail = loadJsonFixture('getro', 'hvcapital-accessus-job-detail.json');

    mockFetchHtml
      .mockResolvedValueOnce({ html: companyHtml })
      .mockResolvedValueOnce({ html: sitemapXml });
    mockFetchJson.mockResolvedValue({ data: jobDetail });

    const result = await getroApiFetch('https://hv.getro.com/companies/accessus');

    for (const job of result.jobs) {
      expect(job.url).toMatch(/^https:\/\/hv\.getro\.com\/companies\/accessus\/jobs\//);
    }
  });
});

// ─── getroApiFetch — Earlybird / finmid ─────────────────────────────────────

describe('getroApiFetch — Earlybird / finmid', () => {
  afterEach(() => {
    mockFetchHtml.mockReset();
    mockFetchJson.mockReset();
    mockSleep.mockReset();
  });

  it('should fetch jobs for finmid (3 jobs)', async () => {
    const companyHtml = loadFixture('getro', 'earlybird-finmid.html');
    const sitemapXml = loadFixture('getro', 'earlybird-sitemap.xml');
    const jobDetail = loadJsonFixture('getro', 'earlybird-finmid-job-detail.json');

    mockFetchHtml
      .mockResolvedValueOnce({ html: companyHtml })
      .mockResolvedValueOnce({ html: sitemapXml });
    mockFetchJson.mockResolvedValue({ data: jobDetail });

    const result = await getroApiFetch('https://jobs.earlybird.com/companies/finmid');
    expect(result.error).toBeUndefined();
    expect(result.jobs.length).toBe(3);
  });

  it('should produce URLs pointing to jobs.earlybird.com', async () => {
    const companyHtml = loadFixture('getro', 'earlybird-finmid.html');
    const sitemapXml = loadFixture('getro', 'earlybird-sitemap.xml');
    const jobDetail = loadJsonFixture('getro', 'earlybird-finmid-job-detail.json');

    mockFetchHtml
      .mockResolvedValueOnce({ html: companyHtml })
      .mockResolvedValueOnce({ html: sitemapXml });
    mockFetchJson.mockResolvedValue({ data: jobDetail });

    const result = await getroApiFetch('https://jobs.earlybird.com/companies/finmid');

    for (const job of result.jobs) {
      expect(job.url).toMatch(/^https:\/\/jobs\.earlybird\.com\/companies\/finmid\/jobs\//);
    }
  });

  it('should have metadata header with Earlybird fixture data', async () => {
    const companyHtml = loadFixture('getro', 'earlybird-finmid.html');
    const sitemapXml = loadFixture('getro', 'earlybird-sitemap.xml');
    const jobDetail = loadJsonFixture('getro', 'earlybird-finmid-job-detail.json');

    mockFetchHtml
      .mockResolvedValueOnce({ html: companyHtml })
      .mockResolvedValueOnce({ html: sitemapXml });
    mockFetchJson.mockResolvedValue({ data: jobDetail });

    const result = await getroApiFetch('https://jobs.earlybird.com/companies/finmid');

    for (const job of result.jobs) {
      expect(job.description).toContain('Location:');
      expect(job.description).toContain('---');
      expect(job.description).toContain('Department:');
      expect(job.description).toContain('Industry:');
      expect(job.description).toContain('Founded:');
    }
  });

  it('should handle URL with hash fragment', async () => {
    const companyHtml = loadFixture('getro', 'earlybird-finmid.html');
    const sitemapXml = loadFixture('getro', 'earlybird-sitemap.xml');
    const jobDetail = loadJsonFixture('getro', 'earlybird-finmid-job-detail.json');

    mockFetchHtml
      .mockResolvedValueOnce({ html: companyHtml })
      .mockResolvedValueOnce({ html: sitemapXml });
    mockFetchJson.mockResolvedValue({ data: jobDetail });

    const result = await getroApiFetch('https://jobs.earlybird.com/companies/finmid#content');
    expect(result.error).toBeUndefined();
    expect(result.jobs.length).toBe(3);
  });
});

// ─── getroApiFetch — Play VC / Arya ─────────────────────────────────────────

describe('getroApiFetch — Play VC / Arya', () => {
  afterEach(() => {
    mockFetchHtml.mockReset();
    mockFetchJson.mockReset();
    mockSleep.mockReset();
  });

  it('should fetch jobs for Arya on Play VC', async () => {
    const companyHtml = loadFixture('getro', 'playvc-arya.html');
    const sitemapXml = loadFixture('getro', 'playvc-sitemap.xml');
    const jobDetail = loadJsonFixture('getro', 'playvc-arya-job-detail.json');

    mockFetchHtml
      .mockResolvedValueOnce({ html: companyHtml })
      .mockResolvedValueOnce({ html: sitemapXml });
    mockFetchJson.mockResolvedValue({ data: jobDetail });

    // Extract the actual company slug from the fixture
    const pageProps = extractNextData(companyHtml);
    const slug = pageProps!.company!.slug;
    const url = `https://careers.play.vc/companies/${slug}`;

    const result = await getroApiFetch(url);
    expect(result.error).toBeUndefined();
    expect(result.jobs.length).toBeGreaterThan(0);
  });

  it('should produce URLs pointing to careers.play.vc', async () => {
    const companyHtml = loadFixture('getro', 'playvc-arya.html');
    const sitemapXml = loadFixture('getro', 'playvc-sitemap.xml');
    const jobDetail = loadJsonFixture('getro', 'playvc-arya-job-detail.json');

    mockFetchHtml
      .mockResolvedValueOnce({ html: companyHtml })
      .mockResolvedValueOnce({ html: sitemapXml });
    mockFetchJson.mockResolvedValue({ data: jobDetail });

    const pageProps = extractNextData(companyHtml);
    const slug = pageProps!.company!.slug;

    const result = await getroApiFetch(`https://careers.play.vc/companies/${slug}`);

    for (const job of result.jobs) {
      expect(job.url).toMatch(/^https:\/\/careers\.play\.vc\/companies\//);
    }
  });
});

// ─── getroApiFetch — error handling ──────────────────────────────────────────

describe('getroApiFetch — error handling', () => {
  afterEach(() => {
    mockFetchHtml.mockReset();
    mockFetchJson.mockReset();
    mockSleep.mockReset();
  });

  it('should return error for invalid URL', async () => {
    const result = await getroApiFetch('https://example.com/invalid');
    expect(result.error).toBeDefined();
    expect(result.jobs).toEqual([]);
  });

  it('should return error when company page fetch fails', async () => {
    mockFetchHtml.mockResolvedValue({ html: '', error: 'HTTP 503 Service Unavailable' });

    const result = await getroApiFetch('https://hv.getro.com/companies/accessus');
    expect(result.error).toBeDefined();
    expect(result.jobs).toEqual([]);
  });

  it('should return error when sitemap fetch fails', async () => {
    const companyHtml = loadFixture('getro', 'cherryvc-afilio.html');

    mockFetchHtml
      .mockResolvedValueOnce({ html: companyHtml })
      .mockResolvedValueOnce({ html: '', error: 'HTTP 503 Service Unavailable' });

    const result = await getroApiFetch('https://talent.cherry.vc/companies/afilio');
    expect(result.error).toContain('sitemap');
    expect(result.jobs).toEqual([]);
  });

  it('should return error when no jobs in sitemap', async () => {
    const companyHtml = loadFixture('getro', 'cherryvc-afilio.html');
    const emptySitemap = '<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>';

    mockFetchHtml
      .mockResolvedValueOnce({ html: companyHtml })
      .mockResolvedValueOnce({ html: emptySitemap });

    const result = await getroApiFetch('https://talent.cherry.vc/companies/afilio');
    expect(result.error).toContain('No jobs found');
    expect(result.jobs).toEqual([]);
  });
});

// ─── getroDetect — across all boards ─────────────────────────────────────────

describe('getroDetect', () => {
  afterEach(() => mockFetchHtml.mockReset());

  it('should detect Afilio on Cherry VC', async () => {
    const html = loadFixture('getro', 'cherryvc-afilio.html');
    mockFetchHtml.mockResolvedValue({ html });

    const result = await getroDetect('https://talent.cherry.vc/companies/afilio');
    expect(result.company).toBe('Afilio');
    expect(result.error).toBeUndefined();
  });

  it('should detect Accessus on HV Capital', async () => {
    const html = loadFixture('getro', 'hvcapital-accessus.html');
    mockFetchHtml.mockResolvedValue({ html });

    const result = await getroDetect('https://hv.getro.com/companies/accessus');
    expect(result.company).toBe('Accessus');
    expect(result.error).toBeUndefined();
  });

  it('should detect finmid on Earlybird', async () => {
    const html = loadFixture('getro', 'earlybird-finmid.html');
    mockFetchHtml.mockResolvedValue({ html });

    const result = await getroDetect('https://jobs.earlybird.com/companies/finmid');
    expect(result.company).toBe('finmid');
    expect(result.error).toBeUndefined();
  });

  it('should detect Arya on Play VC', async () => {
    const html = loadFixture('getro', 'playvc-arya.html');
    mockFetchHtml.mockResolvedValue({ html });

    const result = await getroDetect('https://careers.play.vc/companies/arya-2-7824848a-244e-4e51-acea-5f3f25c258e0');
    expect(result.company).toBe('Arya');
    expect(result.error).toBeUndefined();
  });

  it('should return error for invalid URL', async () => {
    const result = await getroDetect('https://example.com/invalid');
    expect(result.error).toBeDefined();
    expect(result.company).toBe('');
  });

  it('should fallback to prettified slug when HTML has no __NEXT_DATA__', async () => {
    mockFetchHtml.mockResolvedValue({ html: '<html><body>No data</body></html>' });

    const result = await getroDetect('https://hv.getro.com/companies/my-startup');
    expect(result.company).toBe('My Startup');
  });
});

// ─── getroParser ──────────────────────────────────────────────────────────────

describe('getroParser — HTML parser', () => {
  it('should return empty array (jobs are SPA-loaded)', () => {
    const html = loadFixture('getro', 'cherryvc-afilio.html');
    const jobs = getroParser(html, 'https://talent.cherry.vc/companies/afilio');
    expect(jobs).toEqual([]);
  });

  it('should return empty array for empty HTML', () => {
    expect(getroParser('', 'https://hv.getro.com/companies/test')).toEqual([]);
  });
});

// ─── getKnownDomains ──────────────────────────────────────────────────────────

describe('getKnownDomains', () => {
  it('should return all known Getro domains including new boards', () => {
    const domains = getKnownDomains();
    expect(domains).toContain('talent.cherry.vc');
    expect(domains).toContain('hv.getro.com');
    expect(domains).toContain('jobs.earlybird.com');
    expect(domains).toContain('careers.play.vc');
    expect(domains).toContain('jobs.femtechinsider.com');
    expect(domains).toContain('jobs.protocol.ai');
    expect(domains).toContain('impactjobs.doen.nl');
    expect(domains).toContain('jobs.venturesplatform.com');
    expect(domains).toContain('jobs.sapphireventures.com');
    expect(domains.length).toBeGreaterThanOrEqual(9);
  });
});

// ─── extractNextData — Femtech Insider (Tia) ─────────────────────────────────

describe('extractNextData — Femtech Insider / Tia', () => {
  let pageProps: ReturnType<typeof extractNextData>;

  beforeAll(() => {
    const html = loadFixture('getro', 'femtechinsider-tia.html');
    pageProps = extractNextData(html);
  });

  it('should extract pageProps from __NEXT_DATA__', () => {
    expect(pageProps).not.toBeNull();
  });

  it('should have Tia company data', () => {
    expect(pageProps!.company!.name).toBe('Tia');
    expect(pageProps!.company!.id).toBe(2868);
    expect(pageProps!.company!.slug).toBe('tia');
  });

  it('should have Femtech Insider network ID', () => {
    expect(pageProps!.network!.id).toBe('14612');
  });
});

// ─── extractNextData — Protocol Labs (PL Job Board) ──────────────────────────

describe('extractNextData — Protocol Labs / PL Job Board', () => {
  let pageProps: ReturnType<typeof extractNextData>;

  beforeAll(() => {
    const html = loadFixture('getro', 'protocolai-pljobboard.html');
    pageProps = extractNextData(html);
  });

  it('should extract pageProps from __NEXT_DATA__', () => {
    expect(pageProps).not.toBeNull();
  });

  it('should have PL Job Board company data', () => {
    expect(pageProps!.company!.name).toBe('PL Job Board');
    expect(pageProps!.company!.id).toBe(5563);
    expect(pageProps!.company!.slug).toBe('pl-job-board');
  });

  it('should have Protocol Labs network ID', () => {
    expect(pageProps!.network!.id).toBe('1336');
  });
});

// ─── extractJobSlugsFromSitemap — Femtech Insider ────────────────────────────

describe('extractJobSlugsFromSitemap — Femtech Insider', () => {
  it('should extract Tia job slugs', () => {
    const sitemapXml = loadFixture('getro', 'femtechinsider-sitemap.xml');
    const slugs = extractJobSlugsFromSitemap(sitemapXml, 'https://jobs.femtechinsider.com', 'tia');
    expect(slugs.length).toBeGreaterThan(0);
    expect(slugs.every(s => s.length > 0 && !s.includes('/'))).toBe(true);
  });
});

// ─── extractJobSlugsFromSitemap — Protocol Labs ──────────────────────────────

describe('extractJobSlugsFromSitemap — Protocol Labs', () => {
  it('should extract PL Job Board job slugs', () => {
    const sitemapXml = loadFixture('getro', 'protocolai-sitemap.xml');
    const slugs = extractJobSlugsFromSitemap(sitemapXml, 'https://jobs.protocol.ai', 'pl-job-board');
    expect(slugs.length).toBeGreaterThan(0);
    expect(slugs.every(s => s.length > 0 && !s.includes('/'))).toBe(true);
  });
});

// ─── getroApiFetch — Femtech Insider / Tia ──────────────────────────────────

describe('getroApiFetch — Femtech Insider / Tia', () => {
  afterEach(() => {
    mockFetchHtml.mockReset();
    mockFetchJson.mockReset();
    mockSleep.mockReset();
  });

  it('should fetch jobs for Tia', async () => {
    const companyHtml = loadFixture('getro', 'femtechinsider-tia.html');
    const sitemapXml = loadFixture('getro', 'femtechinsider-sitemap.xml');
    const jobDetail = loadJsonFixture('getro', 'femtechinsider-tia-job-detail.json');

    mockFetchHtml
      .mockResolvedValueOnce({ html: companyHtml })
      .mockResolvedValueOnce({ html: sitemapXml });
    mockFetchJson.mockResolvedValue({ data: jobDetail });

    const result = await getroApiFetch('https://jobs.femtechinsider.com/companies/tia');
    expect(result.error).toBeUndefined();
    expect(result.jobs.length).toBeGreaterThan(0);
  });

  it('should produce URLs pointing to jobs.femtechinsider.com', async () => {
    const companyHtml = loadFixture('getro', 'femtechinsider-tia.html');
    const sitemapXml = loadFixture('getro', 'femtechinsider-sitemap.xml');
    const jobDetail = loadJsonFixture('getro', 'femtechinsider-tia-job-detail.json');

    mockFetchHtml
      .mockResolvedValueOnce({ html: companyHtml })
      .mockResolvedValueOnce({ html: sitemapXml });
    mockFetchJson.mockResolvedValue({ data: jobDetail });

    const result = await getroApiFetch('https://jobs.femtechinsider.com/companies/tia');
    for (const job of result.jobs) {
      expect(job.url).toMatch(/^https:\/\/jobs\.femtechinsider\.com\/companies\/tia\/jobs\//);
    }
  });
});

// ─── getroApiFetch — Protocol Labs / PL Job Board ───────────────────────────

describe('getroApiFetch — Protocol Labs / PL Job Board', () => {
  afterEach(() => {
    mockFetchHtml.mockReset();
    mockFetchJson.mockReset();
    mockSleep.mockReset();
  });

  it('should fetch jobs for PL Job Board', async () => {
    const companyHtml = loadFixture('getro', 'protocolai-pljobboard.html');
    const sitemapXml = loadFixture('getro', 'protocolai-sitemap.xml');
    const jobDetail = loadJsonFixture('getro', 'protocolai-pljobboard-job-detail.json');

    mockFetchHtml
      .mockResolvedValueOnce({ html: companyHtml })
      .mockResolvedValueOnce({ html: sitemapXml });
    mockFetchJson.mockResolvedValue({ data: jobDetail });

    const result = await getroApiFetch('https://jobs.protocol.ai/companies/pl-job-board');
    expect(result.error).toBeUndefined();
    expect(result.jobs.length).toBeGreaterThan(0);
  });

  it('should produce URLs pointing to jobs.protocol.ai', async () => {
    const companyHtml = loadFixture('getro', 'protocolai-pljobboard.html');
    const sitemapXml = loadFixture('getro', 'protocolai-sitemap.xml');
    const jobDetail = loadJsonFixture('getro', 'protocolai-pljobboard-job-detail.json');

    mockFetchHtml
      .mockResolvedValueOnce({ html: companyHtml })
      .mockResolvedValueOnce({ html: sitemapXml });
    mockFetchJson.mockResolvedValue({ data: jobDetail });

    const result = await getroApiFetch('https://jobs.protocol.ai/companies/pl-job-board');
    for (const job of result.jobs) {
      expect(job.url).toMatch(/^https:\/\/jobs\.protocol\.ai\/companies\/pl-job-board\/jobs\//);
    }
  });
});

// ─── detectParserFromUrl — Getro boards ──────────────────────────────────────

describe('detectParserFromUrl — Getro boards', () => {
  it('should detect talent.cherry.vc', () => {
    expect(detectParserFromUrl('https://talent.cherry.vc/companies/afilio')).toBe('getro');
  });

  it('should detect hv.getro.com', () => {
    expect(detectParserFromUrl('https://hv.getro.com/companies/accessus')).toBe('getro');
  });

  it('should detect jobs.femtechinsider.com', () => {
    expect(detectParserFromUrl('https://jobs.femtechinsider.com/companies/tia/')).toBe('getro');
  });

  it('should detect jobs.femtechinsider.com with dash slug', () => {
    expect(detectParserFromUrl('https://jobs.femtechinsider.com/companies/twentyeight-health/')).toBe('getro');
  });

  it('should detect jobs.protocol.ai', () => {
    expect(detectParserFromUrl('https://jobs.protocol.ai/companies/pl-job-board/')).toBe('getro');
  });

  it('should detect impactjobs.doen.nl', () => {
    expect(detectParserFromUrl('https://impactjobs.doen.nl/companies/some-company')).toBe('getro');
  });

  it('should detect jobs.venturesplatform.com', () => {
    expect(detectParserFromUrl('https://jobs.venturesplatform.com/companies/some-company')).toBe('getro');
  });

  it('should detect jobs.sapphireventures.com', () => {
    expect(detectParserFromUrl('https://jobs.sapphireventures.com/companies/some-company')).toBe('getro');
  });

  it('should return null for Getro board root (no company slug)', () => {
    expect(detectParserFromUrl('https://jobs.femtechinsider.com/companies')).toBeNull();
    expect(detectParserFromUrl('https://jobs.protocol.ai/')).toBeNull();
  });
});

// ─── Edge cases ───────────────────────────────────────────────────────────────

describe('extractNextData — Edge cases', () => {
  it('should return null for empty HTML', () => {
    expect(extractNextData('')).toBeNull();
  });

  it('should return null when no __NEXT_DATA__ script', () => {
    expect(extractNextData('<html><body>Hello</body></html>')).toBeNull();
  });

  it('should return null for malformed JSON', () => {
    expect(extractNextData('<script id="__NEXT_DATA__">{invalid json</script>')).toBeNull();
  });

  it('should return null when pageProps is missing', () => {
    expect(extractNextData('<script id="__NEXT_DATA__">{"props":{}}</script>')).toBeNull();
  });
});
