/**
 * YCombinator Parser — Full Test Suite
 *
 * Covers:
 *  1. ycombinatorParser() with listing HTML (taktile, doordash)
 *  2. ycombinatorParser() with job detail HTML (single job with description)
 *  3. ycombinatorParser() edge cases (empty HTML, malformed, no jobs)
 *  4. ycombinatorApiFetch() with mocked fetchHtml
 *  5. ycombinatorDetect() with mocked fetchHtml
 *  6. Metadata field coverage (location, commitment, department, salary mapping)
 */

import { loadFixture, loadJsonFixture } from '../helpers/fixture-loader';

// Mock fetch-utils so ycombinatorApiFetch/Detect use our cached data
jest.mock('../../fetch-utils', () => ({
  fetchHtml: jest.fn(),
  fetchJson: jest.fn(),
  sleep: jest.fn().mockResolvedValue(undefined),
  randomDelay: jest.fn().mockResolvedValue(undefined),
}));

import { ycombinatorParser, ycombinatorApiFetch, ycombinatorDetect, buildMetadataHeader } from '../../parsers/ycombinator';
import { fetchHtml, sleep } from '../../fetch-utils';

const mockFetchHtml = fetchHtml as jest.MockedFunction<typeof fetchHtml>;
const mockSleep = sleep as jest.MockedFunction<typeof sleep>;

// ─── Listing Page: Taktile ────────────────────────────────────────────────────

describe('ycombinatorParser — Taktile listing page', () => {
  let jobs: ReturnType<typeof ycombinatorParser>;

  beforeAll(() => {
    const html = loadFixture('ycombinator', 'taktile.html');
    jobs = ycombinatorParser(html, 'https://www.ycombinator.com/companies/taktile/jobs');
  });

  it('should parse a non-zero number of jobs', () => {
    expect(jobs.length).toBeGreaterThan(0);
  });

  it('should parse approximately the expected job count', () => {
    expect(jobs.length).toBeGreaterThanOrEqual(3);
    expect(jobs.length).toBeLessThanOrEqual(30);
  });

  it('every job should have required fields: title and url', () => {
    for (const job of jobs) {
      expect(job.title).toBeTruthy();
      expect(job.url).toBeTruthy();
    }
  });

  it('every url should be an absolute URL pointing to ycombinator.com', () => {
    for (const job of jobs) {
      expect(job.url).toMatch(/^https:\/\/www\.ycombinator\.com\/companies\//);
    }
  });

  it('should parse locations for most jobs', () => {
    const withLoc = jobs.filter(j => j.location);
    expect(withLoc.length).toBeGreaterThan(jobs.length * 0.5);
  });

  it('should parse commitment (job type) for most jobs', () => {
    const withCommitment = jobs.filter(j => j.commitment);
    expect(withCommitment.length).toBeGreaterThan(jobs.length * 0.5);
  });

  it('should parse departments (prettyRole) for most jobs', () => {
    const withDept = jobs.filter(j => j.department);
    expect(withDept.length).toBeGreaterThan(0);
  });

  it('should find known jobs from the fixture', () => {
    const titles = jobs.map(j => j.title);
    expect(titles).toContain('Senior Product Marketing Manager');
  });

  it('should find Engineering department jobs', () => {
    const engJobs = jobs.filter(j => j.department === 'Engineering');
    expect(engJobs.length).toBeGreaterThan(0);
  });

  it('listing page should NOT have descriptions (only available on detail pages)', () => {
    // Descriptions are fetched from individual job pages, not the listing
    for (const job of jobs) {
      expect(job.description).toBeUndefined();
    }
  });
});

// ─── Listing Page: DoorDash ───────────────────────────────────────────────────

describe('ycombinatorParser — DoorDash listing page', () => {
  let jobs: ReturnType<typeof ycombinatorParser>;

  beforeAll(() => {
    const html = loadFixture('ycombinator', 'doordash.html');
    jobs = ycombinatorParser(html, 'https://www.ycombinator.com/companies/doordash/jobs');
  });

  it('should parse a non-zero number of jobs', () => {
    expect(jobs.length).toBeGreaterThan(0);
  });

  it('every job should have title and absolute url', () => {
    for (const job of jobs) {
      expect(job.title).toBeTruthy();
      expect(job.url).toMatch(/^https:\/\/www\.ycombinator\.com\/companies\/doordash\/jobs\//);
    }
  });

  it('should parse locations', () => {
    const withLoc = jobs.filter(j => j.location);
    expect(withLoc.length).toBeGreaterThan(0);
  });

  it('should have multi-location entries', () => {
    // DoorDash has some jobs with "San Francisco, CA, US / Seattle, WA, US"
    const multiLoc = jobs.filter(j => j.location && j.location.includes('/'));
    expect(multiLoc.length).toBeGreaterThan(0);
  });
});

// ─── Job Detail Page ──────────────────────────────────────────────────────────

describe('ycombinatorParser — Job detail page (single job)', () => {
  let jobs: ReturnType<typeof ycombinatorParser>;

  beforeAll(() => {
    const html = loadFixture('ycombinator', 'taktile-job-detail.html');
    jobs = ycombinatorParser(html, 'https://www.ycombinator.com/companies/taktile/jobs/g2XSHHS-senior-product-marketing-manager');
  });

  it('should parse exactly one job', () => {
    expect(jobs.length).toBe(1);
  });

  it('should have the correct title', () => {
    expect(jobs[0].title).toBe('Senior Product Marketing Manager');
  });

  it('should have an absolute URL', () => {
    expect(jobs[0].url).toMatch(/^https:\/\/www\.ycombinator\.com\/companies\/taktile\/jobs\//);
  });

  it('should have a description with metadata header', () => {
    expect(jobs[0].description).toBeTruthy();
    expect(jobs[0].description!.length).toBeGreaterThan(100);
  });

  it('description should contain metadata header fields', () => {
    const desc = jobs[0].description!;
    expect(desc).toContain('Salary: $150K - $190K');
    expect(desc).toContain('Location:');
    expect(desc).toContain('Job type: Full-time');
    expect(desc).toContain('Role: Marketing');
    expect(desc).toContain('Experience: 6+ years');
    expect(desc).toContain('Visa:');
  });

  it('description should contain the original JD after separator', () => {
    const desc = jobs[0].description!;
    expect(desc).toContain('---');
    expect(desc).toContain('Taktile');
  });

  it('description metadata header should include contact when hiringManager present', () => {
    const desc = jobs[0].description!;
    // The taktile detail fixture has hiringManager: Kathleen Kelejian
    expect(desc).toContain('Contact: Kathleen Kelejian');
  });

  it('should have location', () => {
    expect(jobs[0].location).toBeTruthy();
  });

  it('should have commitment type', () => {
    expect(jobs[0].commitment).toBe('Full-time');
  });

  it('should have department', () => {
    expect(jobs[0].department).toBe('Marketing');
  });
});

// ─── Edge Cases ───────────────────────────────────────────────────────────────

describe('ycombinatorParser — Edge cases', () => {
  it('should return empty array for empty HTML', () => {
    expect(ycombinatorParser('', 'https://www.ycombinator.com/companies/test/jobs')).toEqual([]);
  });

  it('should return empty array for HTML with no job data', () => {
    expect(ycombinatorParser('<html><body>Hello</body></html>', 'https://www.ycombinator.com/companies/test/jobs')).toEqual([]);
  });

  it('should return empty array when data-page has no jobs', () => {
    const html = '<div data-page=\'{"props":{"jobPostings":[]}}\'></div>';
    expect(ycombinatorParser(html, 'https://www.ycombinator.com/companies/test/jobs')).toEqual([]);
  });

  it('should return empty array for malformed JSON in data-page', () => {
    const html = '<div data-page="{invalid json}"></div>';
    expect(ycombinatorParser(html, 'https://www.ycombinator.com/companies/test/jobs')).toEqual([]);
  });

  it('should skip jobs without title', () => {
    const html = '<div data-page=\'{"props":{"jobPostings":[{"url":"/companies/x/jobs/1"}]}}\'></div>';
    const jobs = ycombinatorParser(html, 'https://www.ycombinator.com/companies/x/jobs');
    expect(jobs).toEqual([]);
  });

  it('should skip jobs without url', () => {
    const html = '<div data-page=\'{"props":{"jobPostings":[{"title":"Test"}]}}\'></div>';
    const jobs = ycombinatorParser(html, 'https://www.ycombinator.com/companies/x/jobs');
    expect(jobs).toEqual([]);
  });
});

// ─── ycombinatorApiFetch ──────────────────────────────────────────────────────

describe('ycombinatorApiFetch', () => {
  afterEach(() => {
    mockFetchHtml.mockReset();
    mockSleep.mockReset();
  });

  it('should parse jobs from cached listing HTML', async () => {
    const listingHtml = loadFixture('ycombinator', 'taktile.html');
    const detailHtml = loadFixture('ycombinator', 'taktile-job-detail.html');

    // First call: listing page
    mockFetchHtml.mockResolvedValueOnce({ html: listingHtml });
    // Subsequent calls: detail pages (return same detail for simplicity)
    mockFetchHtml.mockResolvedValue({ html: detailHtml });

    const result = await ycombinatorApiFetch('https://www.ycombinator.com/companies/taktile/jobs');
    expect(result.error).toBeUndefined();
    expect(result.jobs.length).toBeGreaterThan(0);

    // Should have titles
    for (const job of result.jobs) {
      expect(job.title).toBeTruthy();
      expect(job.url).toMatch(/^https:\/\/www\.ycombinator\.com/);
    }

    // Should have descriptions with metadata headers
    const withDesc = result.jobs.filter(j => j.description);
    expect(withDesc.length).toBeGreaterThan(0);

    // Metadata header should be present in descriptions
    for (const job of withDesc) {
      expect(job.description).toContain('Salary:');
      expect(job.description).toContain('---');
    }
  });

  it('should return error for invalid URL', async () => {
    const result = await ycombinatorApiFetch('https://example.com/invalid');
    expect(result.error).toBeDefined();
    expect(result.jobs).toEqual([]);
  });

  it('should return error when fetch fails', async () => {
    mockFetchHtml.mockResolvedValue({ html: '', error: 'HTTP 503 Service Unavailable' });

    const result = await ycombinatorApiFetch('https://www.ycombinator.com/companies/taktile/jobs');
    expect(result.error).toBeDefined();
    expect(result.jobs).toEqual([]);
  });

  it('should return error when HTML has no data-page', async () => {
    mockFetchHtml.mockResolvedValue({ html: '<html><body>No data here</body></html>' });

    const result = await ycombinatorApiFetch('https://www.ycombinator.com/companies/taktile/jobs');
    expect(result.error).toContain('Could not extract page data');
    expect(result.jobs).toEqual([]);
  });

  it('should use sleep between detail page fetches', async () => {
    const listingHtml = loadFixture('ycombinator', 'taktile.html');
    mockFetchHtml.mockResolvedValueOnce({ html: listingHtml });
    mockFetchHtml.mockResolvedValue({ html: '<html></html>' }); // empty details

    await ycombinatorApiFetch('https://www.ycombinator.com/companies/taktile/jobs');

    // sleep should be called once per job (for throttling)
    expect(mockSleep).toHaveBeenCalled();
  });
});

// ─── ycombinatorDetect ────────────────────────────────────────────────────────

describe('ycombinatorDetect', () => {
  afterEach(() => mockFetchHtml.mockReset());

  it('should detect company name from HTML', async () => {
    const html = loadFixture('ycombinator', 'taktile.html');
    mockFetchHtml.mockResolvedValue({ html });

    const result = await ycombinatorDetect('https://www.ycombinator.com/companies/taktile/jobs');
    expect(result.company).toBe('Taktile');
    expect(result.error).toBeUndefined();
  });

  it('should detect company name for DoorDash', async () => {
    const html = loadFixture('ycombinator', 'doordash.html');
    mockFetchHtml.mockResolvedValue({ html });

    const result = await ycombinatorDetect('https://www.ycombinator.com/companies/doordash/jobs');
    expect(result.company).toBe('DoorDash');
    expect(result.error).toBeUndefined();
  });

  it('should return error for invalid URL', async () => {
    const result = await ycombinatorDetect('https://example.com/invalid');
    expect(result.error).toBeDefined();
    expect(result.company).toBe('');
  });

  it('should fallback to prettified slug when HTML has no data', async () => {
    mockFetchHtml.mockResolvedValue({ html: '<html><body>No data</body></html>' });

    const result = await ycombinatorDetect('https://www.ycombinator.com/companies/my-startup/jobs');
    expect(result.company).toBe('My Startup');
  });
});

// ─── Metadata field coverage ──────────────────────────────────────────────────

describe('buildMetadataHeader', () => {
  it('should include all fields when present', () => {
    const header = buildMetadataHeader({
      salaryRange: '$160K - $220K',
      equityRange: '0.50% - 2.00%',
      location: 'New York City',
      type: 'Full-time',
      prettyRole: 'Engineering',
      roleSpecificType: 'Full stack',
      minExperience: '3+ years',
      visa: 'US citizen/visa only',
      skills: ['Go', 'React', 'TypeScript'],
      hiringManager: { first_name: 'Albert', last_name: 'Lam' },
    });

    expect(header).toContain('Salary: $160K - $220K');
    expect(header).toContain('Equity: 0.50% - 2.00%');
    expect(header).toContain('Location: New York City');
    expect(header).toContain('Job type: Full-time');
    expect(header).toContain('Role: Engineering, Full stack');
    expect(header).toContain('Experience: 3+ years');
    expect(header).toContain('Visa: US citizen/visa only');
    expect(header).toContain('Skills: Go, React, TypeScript');
    expect(header).toContain('Contact: Albert Lam');
  });

  it('should omit fields that are empty or missing', () => {
    const header = buildMetadataHeader({
      salaryRange: '',
      equityRange: '',
      location: '',
      type: 'Contract',
      prettyRole: 'Design',
      roleSpecificType: null,
      minExperience: null,
      visa: null,
      skills: [],
      hiringManager: null,
    });

    expect(header).not.toContain('Salary:');
    expect(header).not.toContain('Equity:');
    expect(header).not.toContain('Location:');
    expect(header).not.toContain('Experience:');
    expect(header).not.toContain('Visa:');
    expect(header).not.toContain('Skills:');
    expect(header).not.toContain('Contact:');
    expect(header).toContain('Job type: Contract');
    expect(header).toContain('Role: Design');
  });

  it('should handle role with only prettyRole (no specific type)', () => {
    const header = buildMetadataHeader({
      prettyRole: 'Sales',
      roleSpecificType: null,
    });
    expect(header).toContain('Role: Sales');
    expect(header).not.toContain(',');
  });

  it('should return empty string when no fields present', () => {
    const header = buildMetadataHeader({});
    expect(header).toBe('');
  });

  it('should handle hiring manager with only first name', () => {
    const header = buildMetadataHeader({
      hiringManager: { first_name: 'Jane', last_name: '' },
    });
    expect(header).toContain('Contact: Jane');
  });
});

describe('ycombinatorParser — Metadata field mapping', () => {
  it('should map all available metadata fields correctly', () => {
    // Craft a minimal HTML with known job data
    const jobData = {
      props: {
        jobPostings: [{
          id: 1,
          title: 'Senior Engineer',
          url: '/companies/test-co/jobs/abc123-senior-engineer',
          location: 'San Francisco, CA',
          type: 'Full-time',
          prettyRole: 'Engineering',
          role: 'eng',
          roleSpecificType: 'Backend',
          salaryRange: '$150K - $200K',
          visa: 'Any (Visa Sponsorship)',
          skills: ['Python', 'Go'],
          minExperience: '3+ years',
        }],
      },
    };
    const html = `<div data-page='${JSON.stringify(jobData)}'></div>`;
    const jobs = ycombinatorParser(html, 'https://www.ycombinator.com/companies/test-co/jobs');

    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toEqual({
      title: 'Senior Engineer',
      url: 'https://www.ycombinator.com/companies/test-co/jobs/abc123-senior-engineer',
      location: 'San Francisco, CA',
      commitment: 'Full-time',
      department: 'Engineering',
    });
  });

  it('should handle jobs with empty/missing optional fields', () => {
    const jobData = {
      props: {
        jobPostings: [{
          id: 2,
          title: 'Intern',
          url: '/companies/test-co/jobs/xyz-intern',
          location: '',
          type: null,
          prettyRole: null,
        }],
      },
    };
    const html = `<div data-page='${JSON.stringify(jobData)}'></div>`;
    const jobs = ycombinatorParser(html, 'https://www.ycombinator.com/companies/test-co/jobs');

    expect(jobs).toHaveLength(1);
    expect(jobs[0].location).toBeUndefined();
    expect(jobs[0].commitment).toBeUndefined();
    expect(jobs[0].department).toBeUndefined();
  });

  it('should build metadata header in description for detail page', () => {
    const jobData = {
      props: {
        job: {
          id: 999,
          title: 'Founding Engineer',
          url: '/companies/test-co/jobs/abc-founding-engineer',
          salaryRange: '$160K - $220K',
          equityRange: '0.50% - 2.00%',
          location: 'New York City',
          type: 'Full-time',
          prettyRole: 'Engineering',
          roleSpecificType: 'Full stack',
          minExperience: '3+ years',
          visa: 'US citizen/visa only',
          skills: ['Go', 'React', 'TypeScript', 'AWS'],
          hiringManager: { first_name: 'Albert', last_name: 'Lam' },
          description: 'We are building the future of X.',
        },
      },
    };
    const html = `<div data-page='${JSON.stringify(jobData)}'></div>`;
    const jobs = ycombinatorParser(html, 'https://www.ycombinator.com/companies/test-co/jobs/abc-founding-engineer');

    expect(jobs).toHaveLength(1);
    const desc = jobs[0].description!;
    expect(desc).toContain('Salary: $160K - $220K');
    expect(desc).toContain('Equity: 0.50% - 2.00%');
    expect(desc).toContain('Skills: Go, React, TypeScript, AWS');
    expect(desc).toContain('Contact: Albert Lam');
    expect(desc).toContain('---');
    expect(desc).toContain('We are building the future of X.');
  });
});
