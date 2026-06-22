/**
 * Jobylon ATS Parser — Unit Test Suite
 *
 * Covers:
 *  1. extractCompanyId() — URL pattern recognition
 *  2. extractEmbedHtml() — JS → HTML extraction from embed response
 *  3. jobylonParser() — HTML parsing of embed widget job listings
 *  4. jobylonApiFetch() — end-to-end with mocked fetchHtml
 *  5. Edge cases: empty HTML, no jobs, invalid URLs
 *  6. Known job verification against WithSecure fixture
 *  7. Second company (PwC Finland) fixture verification
 */

import { loadFixture } from '../helpers/fixture-loader';

// Mock fetch-utils so jobylonApiFetch uses cached data instead of network
jest.mock('../../fetch-utils', () => ({
  fetchHtml: jest.fn(),
  fetchJson: jest.fn(),
  randomDelay: jest.fn().mockResolvedValue(undefined),
  sleep: jest.fn().mockResolvedValue(undefined),
}));

import {
  jobylonParser,
  jobylonApiFetch,
  extractCompanyId,
  extractEmbedHtml,
} from '../../parsers/jobylon';
import { fetchHtml } from '../../fetch-utils';

const mockFetchHtml = fetchHtml as jest.MockedFunction<typeof fetchHtml>;

// ─── extractCompanyId ─────────────────────────────────────────────────────────

describe('extractCompanyId', () => {
  it('extracts ID from emp.jobylon.com/companies/{id}/', () => {
    expect(extractCompanyId('https://emp.jobylon.com/companies/505/')).toBe('505');
  });

  it('extracts ID from emp.jobylon.com/companies/{id}-{slug}/', () => {
    expect(extractCompanyId('https://emp.jobylon.com/companies/505-withsecure/')).toBe('505');
  });

  it('extracts ID from cdn.jobylon.com embed URL', () => {
    expect(extractCompanyId('https://cdn.jobylon.com/jobs/companies/505/embed/v1/?page_size=100')).toBe('505');
  });

  it('returns null for non-Jobylon URLs', () => {
    expect(extractCompanyId('https://example.com/')).toBeNull();
    expect(extractCompanyId('https://emp.jobylon.com/')).toBeNull();
    expect(extractCompanyId('https://emp.jobylon.com/jobs/12345/')).toBeNull();
  });

  it('returns null for invalid URLs', () => {
    expect(extractCompanyId('not-a-url')).toBeNull();
    expect(extractCompanyId('')).toBeNull();
  });
});

// ─── extractEmbedHtml ─────────────────────────────────────────────────────────

describe('extractEmbedHtml — WithSecure embed fixture', () => {
  let embedHtml: string;

  beforeAll(() => {
    const jsContent = loadFixture('jobylon', 'withsecure-embed.js');
    embedHtml = extractEmbedHtml(jsContent);
  });

  it('should extract non-empty HTML from embed JS', () => {
    expect(embedHtml.length).toBeGreaterThan(100);
  });

  it('should contain jobylon-job class markers', () => {
    expect(embedHtml).toContain('jobylon-job');
  });

  it('should contain job listing HTML structure', () => {
    expect(embedHtml).toContain('jobylon-job-list');
    expect(embedHtml).toContain('jobylon-job-title');
  });
});

describe('extractEmbedHtml — edge cases', () => {
  it('returns empty string for empty input', () => {
    expect(extractEmbedHtml('')).toBe('');
  });

  it('returns empty string for JS without html_embed', () => {
    expect(extractEmbedHtml('var x = 1; console.log(x);')).toBe('');
  });
});

// ─── jobylonParser — WithSecure fixture ────────────────────────────────────────

describe('jobylonParser — WithSecure (company 505)', () => {
  let jobs: ReturnType<typeof jobylonParser>;

  beforeAll(() => {
    const jsContent = loadFixture('jobylon', 'withsecure-embed.js');
    const embedHtml = extractEmbedHtml(jsContent);
    jobs = jobylonParser(embedHtml, 'https://emp.jobylon.com/companies/505/');
  });

  // ── Basic counts ─────────────────────────────────────────────────────────

  it('should parse a non-zero number of jobs', () => {
    expect(jobs.length).toBeGreaterThan(0);
  });

  it('should parse expected number of jobs (5-15 range)', () => {
    // WithSecure typically has ~7 jobs
    expect(jobs.length).toBeGreaterThanOrEqual(5);
    expect(jobs.length).toBeLessThanOrEqual(15);
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

  it('every url should be an absolute URL on emp.jobylon.com', () => {
    for (const job of jobs) {
      expect(job.url).toMatch(/^https:\/\/emp\.jobylon\.com\/jobs\/\d+/);
    }
  });

  // ── Location ─────────────────────────────────────────────────────────────

  it('most jobs should have a location', () => {
    const withLoc = jobs.filter(j => j.location);
    expect(withLoc.length).toBeGreaterThan(jobs.length * 0.5);
  });

  it('locations should not contain the "Location:" prefix', () => {
    for (const job of jobs) {
      if (job.location) {
        expect(job.location).not.toMatch(/^Location:/i);
      }
    }
  });

  // ── Department ───────────────────────────────────────────────────────────

  it('most jobs should have a department', () => {
    const withDept = jobs.filter(j => j.department);
    expect(withDept.length).toBeGreaterThan(0);
  });

  it('departments should not contain the "Function:" prefix', () => {
    for (const job of jobs) {
      if (job.department) {
        expect(job.department).not.toMatch(/^Function:/i);
      }
    }
  });

  it('should parse multiple distinct departments', () => {
    const depts = new Set(jobs.filter(j => j.department).map(j => j.department));
    expect(depts.size).toBeGreaterThanOrEqual(2);
  });

  // ── Commitment / Experience ──────────────────────────────────────────────

  it('most jobs should have a commitment (experience level)', () => {
    const withCommitment = jobs.filter(j => j.commitment);
    expect(withCommitment.length).toBeGreaterThan(0);
  });

  it('commitments should not contain the "Experience:" prefix', () => {
    for (const job of jobs) {
      if (job.commitment) {
        expect(job.commitment).not.toMatch(/^Experience:/i);
      }
    }
  });

  // ── No duplicates ───────────────────────────────────────────────────────

  it('should not produce duplicate URLs', () => {
    const urls = jobs.map(j => j.url);
    const unique = new Set(urls);
    expect(unique.size).toBe(urls.length);
  });

  // ── Known job verification ──────────────────────────────────────────────

  it('should include "Senior SW Security Architect" with correct metadata', () => {
    const job = jobs.find(j => j.title === 'Senior SW Security Architect');
    expect(job).toBeDefined();
    expect(job!.url).toContain('/jobs/328902');
    expect(job!.location).toContain('Pozna');
    expect(job!.department).toBe('Research & Development');
    expect(job!.commitment).toBe('Experienced');
  });

  it('should include "Threat Hunter" with correct metadata', () => {
    const job = jobs.find(j => j.title === 'Threat Hunter');
    expect(job).toBeDefined();
    expect(job!.url).toContain('/jobs/311288');
    expect(job!.department).toBe('Security & Protection');
  });
});

// ─── jobylonParser — PwC Finland fixture ───────────────────────────────────────

describe('jobylonParser — PwC Finland (company 502)', () => {
  let jobs: ReturnType<typeof jobylonParser>;

  beforeAll(() => {
    const jsContent = loadFixture('jobylon', 'pwc-embed.js');
    const embedHtml = extractEmbedHtml(jsContent);
    jobs = jobylonParser(embedHtml, 'https://emp.jobylon.com/companies/502/');
  });

  it('should parse a non-zero number of jobs', () => {
    expect(jobs.length).toBeGreaterThan(0);
  });

  it('every job should have title and url', () => {
    for (const job of jobs) {
      expect(job.title).toBeTruthy();
      expect(job.url).toMatch(/^https:\/\/emp\.jobylon\.com\/jobs\/\d+/);
    }
  });

  it('URLs should contain "pwc" slug', () => {
    for (const job of jobs) {
      expect(job.url.toLowerCase()).toContain('pwc');
    }
  });
});

// ─── jobylonParser — edge cases ───────────────────────────────────────────────

describe('jobylonParser — edge cases', () => {
  it('returns empty array for empty HTML', () => {
    expect(jobylonParser('', 'https://emp.jobylon.com/companies/505/')).toEqual([]);
  });

  it('returns empty array for HTML without job data', () => {
    expect(jobylonParser('<html><body>Hello</body></html>', 'https://emp.jobylon.com/companies/505/')).toEqual([]);
  });

  it('returns empty array for HTML with empty job list', () => {
    const html = '<div class="jobylon-job-list"><small class="jobylon-no-jobs">No jobs found</small></div>';
    expect(jobylonParser(html, 'https://emp.jobylon.com/companies/505/')).toEqual([]);
  });
});

// ─── jobylonApiFetch — mocked fetchHtml ───────────────────────────────────────

describe('jobylonApiFetch — mocked embed fetch', () => {
  afterEach(() => mockFetchHtml.mockReset());

  it('should parse jobs from cached embed JS (WithSecure)', async () => {
    const jsContent = loadFixture('jobylon', 'withsecure-embed.js');
    mockFetchHtml.mockResolvedValue({ html: jsContent, error: undefined });

    const result = await jobylonApiFetch('https://emp.jobylon.com/companies/505/');

    expect(result.error).toBeUndefined();
    expect(result.jobs.length).toBeGreaterThan(5);
    for (const job of result.jobs) {
      expect(job.title).toBeTruthy();
      expect(job.url).toMatch(/^https:\/\/emp\.jobylon\.com\/jobs\/\d+/);
    }
  });

  it('should parse jobs from PwC Finland embed', async () => {
    const jsContent = loadFixture('jobylon', 'pwc-embed.js');
    mockFetchHtml.mockResolvedValue({ html: jsContent, error: undefined });

    const result = await jobylonApiFetch('https://emp.jobylon.com/companies/502/');

    expect(result.error).toBeUndefined();
    expect(result.jobs.length).toBeGreaterThan(0);
  });

  it('should return error for invalid URL (no company ID)', async () => {
    const result = await jobylonApiFetch('https://example.com/invalid');
    expect(result.error).toBeDefined();
    expect(result.jobs).toEqual([]);
  });

  it('should return error when fetch fails', async () => {
    mockFetchHtml.mockResolvedValue({ html: '', error: 'Network error' });

    const result = await jobylonApiFetch('https://emp.jobylon.com/companies/505/');
    expect(result.error).toBeDefined();
    expect(result.jobs).toEqual([]);
  });

  it('should handle company with no published jobs (no-jobs marker)', async () => {
    // Simulated response from a company with no published jobs
    const jsContent = `(function(){
var html_embed = '<div class="jobylon-job-list"><small class="jobylon-no-jobs">No jobs found</small></div>';
})();`;
    mockFetchHtml.mockResolvedValue({ html: jsContent, error: undefined });

    const result = await jobylonApiFetch('https://emp.jobylon.com/companies/999/');
    expect(result.error).toBeUndefined(); // zero jobs is valid
    expect(result.jobs).toEqual([]);
  });
});
