/**
 * Greenhouse Parser — Full Test Suite
 *
 * Covers:
 *  1. greenhouseParser() with Remix SPA HTML (hightouch, nuitee)
 *  2. greenhouseParser() with legacy DOM HTML (.opening class)
 *  3. greenhouseParser() edge cases (empty HTML, malformed, no jobs)
 *  4. greenhouseApiFetch() with cached JSON (mocked fetchJson)
 *  5. greenhouseApiDetect() with mocked fetchJson
 *  6. Slug extraction (tested indirectly through API functions)
 */

import { loadFixture, loadJsonFixture } from '../helpers/fixture-loader';

// Mock fetch-utils so greenhouseApiFetch/Detect use our cached data
jest.mock('../../fetch-utils', () => ({
  fetchJson: jest.fn(),
  fetchHtml: jest.fn(),
}));

import { greenhouseParser, greenhouseApiFetch, greenhouseApiDetect } from '../../parsers/greenhouse';
import { fetchJson } from '../../fetch-utils';

const mockFetchJson = fetchJson as jest.MockedFunction<typeof fetchJson>;

// ─── Remix SPA Format ─────────────────────────────────────────────────────────

describe('greenhouseParser — Remix SPA format', () => {
  describe('Hightouch (job-boards.greenhouse.io)', () => {
    let jobs: ReturnType<typeof greenhouseParser>;

    beforeAll(() => {
      const html = loadFixture('greenhouse', 'hightouch.html');
      jobs = greenhouseParser(html, 'https://job-boards.greenhouse.io/hightouch');
    });

    it('should parse a non-zero number of jobs', () => {
      expect(jobs.length).toBeGreaterThan(0);
    });

    it('should parse approximately the expected job count', () => {
      // Hightouch has ~50-60 jobs — allow for flux over time since fixture is a snapshot
      expect(jobs.length).toBeGreaterThanOrEqual(30);
      expect(jobs.length).toBeLessThanOrEqual(100);
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

    it('urls should point to greenhouse.io job pages', () => {
      for (const job of jobs) {
        expect(job.url).toContain('greenhouse.io');
      }
    });

    it('should parse departments for most jobs', () => {
      const withDept = jobs.filter((j) => j.department);
      expect(withDept.length).toBeGreaterThan(jobs.length * 0.5);
    });

    it('should parse locations for most jobs', () => {
      const withLoc = jobs.filter((j) => j.location);
      expect(withLoc.length).toBeGreaterThan(jobs.length * 0.5);
    });

    it('should not include placeholder locations', () => {
      const placeholders = new Set(['n/a', 'na', 'location', 'tbd', 'tba', 'remote']);
      for (const job of jobs) {
        if (job.location) {
          expect(placeholders.has(job.location.toLowerCase())).toBe(false);
        }
      }
    });

    it('should find known jobs from the fixture', () => {
      const titles = jobs.map((j) => j.title);
      // These are real jobs from the Hightouch fixture
      expect(titles).toContain('AI Operations, GTM');
    });

    it('should find Engineering department jobs', () => {
      const engJobs = jobs.filter((j) => j.department === 'Engineering');
      expect(engJobs.length).toBeGreaterThan(0);
    });
  });

  describe('Nuitee (job-boards.eu.greenhouse.io — EU domain)', () => {
    let jobs: ReturnType<typeof greenhouseParser>;

    beforeAll(() => {
      const html = loadFixture('greenhouse', 'nuitee.html');
      jobs = greenhouseParser(html, 'https://job-boards.eu.greenhouse.io/nuitee');
    });

    it('should parse jobs from EU domain variant', () => {
      expect(jobs.length).toBeGreaterThan(0);
    });

    it('should parse approximately the expected job count', () => {
      expect(jobs.length).toBeGreaterThanOrEqual(15);
      expect(jobs.length).toBeLessThanOrEqual(80);
    });

    it('every job should have title and absolute url', () => {
      for (const job of jobs) {
        expect(job.title).toBeTruthy();
        expect(job.url).toMatch(/^https?:\/\//);
      }
    });

    it('urls should point to EU greenhouse domain', () => {
      for (const job of jobs) {
        expect(job.url).toContain('greenhouse.io');
      }
    });

    it('should parse departments', () => {
      const withDept = jobs.filter((j) => j.department);
      expect(withDept.length).toBeGreaterThan(0);
    });

    it('should find Customer Service department', () => {
      const csDept = jobs.filter((j) => j.department === 'Customer Service');
      expect(csDept.length).toBeGreaterThan(0);
    });
  });
});

// ─── Legacy DOM Format ────────────────────────────────────────────────────────

describe('greenhouseParser — Legacy DOM format (.opening)', () => {
  let jobs: ReturnType<typeof greenhouseParser>;

  beforeAll(() => {
    const html = loadFixture('greenhouse', 'legacy-synthetic.html');
    jobs = greenhouseParser(html, 'https://boards.greenhouse.io/testcorp');
  });

  it('should parse jobs from .opening elements', () => {
    // The fixture has 4 valid jobs (one with no URL, one with no title should be skipped)
    expect(jobs.length).toBe(4);
  });

  it('should extract titles from anchor tags', () => {
    const titles = jobs.map((j) => j.title);
    expect(titles).toContain('Senior Software Engineer');
    expect(titles).toContain('Backend Engineer');
    expect(titles).toContain('Product Manager');
    expect(titles).toContain('UX Designer');
  });

  it('should resolve relative URLs against baseUrl', () => {
    const seniorEng = jobs.find((j) => j.title === 'Senior Software Engineer');
    expect(seniorEng?.url).toBe('https://boards.greenhouse.io/jobs/1001-senior-software-engineer');
  });

  it('should keep absolute URLs as-is', () => {
    const pm = jobs.find((j) => j.title === 'Product Manager');
    expect(pm?.url).toBe('https://boards.greenhouse.io/testcorp/jobs/1003');
  });

  it('should extract location from .location span', () => {
    const seniorEng = jobs.find((j) => j.title === 'Senior Software Engineer');
    expect(seniorEng?.location).toBe('San Francisco, CA');

    const backend = jobs.find((j) => j.title === 'Backend Engineer');
    expect(backend?.location).toBe('Remote, US');
  });

  it('should handle jobs without location', () => {
    const designer = jobs.find((j) => j.title === 'UX Designer');
    expect(designer?.location).toBeUndefined();
  });

  it('should extract commitment from .job-type', () => {
    const backend = jobs.find((j) => j.title === 'Backend Engineer');
    expect(backend?.commitment).toBe('Full-time');
  });

  it('should extract workplace_type from [class*=workplace]', () => {
    const pm = jobs.find((j) => j.title === 'Product Manager');
    expect(pm?.workplace_type).toBe('Hybrid');
  });

  it('should skip entries with empty URL', () => {
    const titles = jobs.map((j) => j.title);
    expect(titles).not.toContain('Missing URL Engineer');
  });

  it('should skip entries with empty title', () => {
    // The fixture has a .opening with an empty <a> tag
    expect(jobs.length).toBe(4);
  });
});

// ─── Edge Cases ───────────────────────────────────────────────────────────────

describe('greenhouseParser — Edge cases', () => {
  it('should return empty array for empty HTML', () => {
    const jobs = greenhouseParser('', 'https://boards.greenhouse.io/test');
    expect(jobs).toEqual([]);
  });

  it('should return empty array for HTML with no job data', () => {
    const html = '<html><body><h1>Hello World</h1></body></html>';
    const jobs = greenhouseParser(html, 'https://boards.greenhouse.io/test');
    expect(jobs).toEqual([]);
  });

  it('should return empty array for malformed __remixContext', () => {
    const html = '<html><body><script>window.__remixContext = {invalid json!!!</script></body></html>';
    const jobs = greenhouseParser(html, 'https://job-boards.greenhouse.io/test');
    expect(jobs).toEqual([]);
  });

  it('should return empty array when __remixContext has no job posts', () => {
    const html = `<html><body><script>window.__remixContext = ${JSON.stringify({
      state: {
        loaderData: {
          'routes/$url_token': {
            jobPosts: { data: [] },
          },
        },
      },
    })}</script></body></html>`;
    const jobs = greenhouseParser(html, 'https://job-boards.greenhouse.io/test');
    expect(jobs).toEqual([]);
  });

  it('should fall through to legacy parser when __remixContext has empty posts', () => {
    // If remixContext posts are empty AND legacy .opening elements exist,
    // those should be picked up by the fallthrough
    const html = `<html><body>
      <script>window.__remixContext = ${JSON.stringify({
        state: {
          loaderData: {
            'routes/$url_token': {
              jobPosts: { data: [] },
            },
          },
        },
      })}</script>
      <div class="opening">
        <a href="/jobs/123">Fallthrough Job</a>
        <span class="location">Remote</span>
      </div>
    </body></html>`;
    const jobs = greenhouseParser(html, 'https://boards.greenhouse.io/test');
    expect(jobs.length).toBe(1);
    expect(jobs[0].title).toBe('Fallthrough Job');
  });

  it('should handle location as string in remix context', () => {
    const html = `<html><body><script>window.__remixContext = ${JSON.stringify({
      state: {
        loaderData: {
          'routes/$url_token': {
            jobPosts: {
              data: [
                {
                  id: 1,
                  title: 'String Location Job',
                  absolute_url: 'https://job-boards.greenhouse.io/test/jobs/1',
                  location: 'Berlin, Germany',
                  department: { name: 'Engineering' },
                },
              ],
            },
          },
        },
      },
    })}</script></body></html>`;
    const jobs = greenhouseParser(html, 'https://job-boards.greenhouse.io/test');
    expect(jobs.length).toBe(1);
    expect(jobs[0].location).toBe('Berlin, Germany');
  });

  it('should handle location as {name: string} object in remix context', () => {
    const html = `<html><body><script>window.__remixContext = ${JSON.stringify({
      state: {
        loaderData: {
          'routes/$url_token': {
            jobPosts: {
              data: [
                {
                  id: 2,
                  title: 'Object Location Job',
                  absolute_url: 'https://job-boards.greenhouse.io/test/jobs/2',
                  location: { name: 'London, UK' },
                  department: { name: 'Product' },
                },
              ],
            },
          },
        },
      },
    })}</script></body></html>`;
    const jobs = greenhouseParser(html, 'https://job-boards.greenhouse.io/test');
    expect(jobs.length).toBe(1);
    expect(jobs[0].location).toBe('London, UK');
  });

  it('should filter placeholder locations in remix context', () => {
    const placeholders = ['N/A', 'TBD', 'Remote', 'na', 'location'];
    for (const placeholder of placeholders) {
      const html = `<html><body><script>window.__remixContext = ${JSON.stringify({
        state: {
          loaderData: {
            'routes/$url_token': {
              jobPosts: {
                data: [
                  {
                    id: 99,
                    title: 'Placeholder Test',
                    absolute_url: 'https://job-boards.greenhouse.io/test/jobs/99',
                    location: placeholder,
                  },
                ],
              },
            },
          },
        },
      })}</script></body></html>`;
      const jobs = greenhouseParser(html, 'https://job-boards.greenhouse.io/test');
      expect(jobs[0].location).toBeUndefined();
    }
  });
});

// ─── API Fetch (greenhouseApiFetch) ───────────────────────────────────────────

describe('greenhouseApiFetch', () => {
  afterEach(() => {
    mockFetchJson.mockReset();
  });

  it('should parse jobs from cached API JSON response', async () => {
    const apiResponse = loadJsonFixture('greenhouse', 'hightouch-api.json');
    mockFetchJson.mockResolvedValue({ data: apiResponse });

    const result = await greenhouseApiFetch('https://job-boards.greenhouse.io/hightouch');
    expect(result.error).toBeUndefined();
    expect(result.jobs.length).toBeGreaterThan(0);
  });

  it('every API-parsed job should have title, url, and description', async () => {
    const apiResponse = loadJsonFixture('greenhouse', 'hightouch-api.json');
    mockFetchJson.mockResolvedValue({ data: apiResponse });

    const result = await greenhouseApiFetch('https://job-boards.greenhouse.io/hightouch');
    for (const job of result.jobs) {
      expect(job.title).toBeTruthy();
      expect(job.url).toMatch(/^https?:\/\//);
      // API with content=true should provide descriptions
      expect(job.description).toBeTruthy();
    }
  });

  it('should convert HTML descriptions to markdown (or at least strip most tags)', async () => {
    const apiResponse = loadJsonFixture('greenhouse', 'hightouch-api.json');
    mockFetchJson.mockResolvedValue({ data: apiResponse });

    const result = await greenhouseApiFetch('https://job-boards.greenhouse.io/hightouch');
    const job = result.jobs[0];
    expect(job.description).toBeDefined();
    // Description should have meaningful text content, not just tags
    expect(job.description!.length).toBeGreaterThan(100);
  });

  it('should extract departments from API response', async () => {
    const apiResponse = loadJsonFixture('greenhouse', 'hightouch-api.json');
    mockFetchJson.mockResolvedValue({ data: apiResponse });

    const result = await greenhouseApiFetch('https://job-boards.greenhouse.io/hightouch');
    const withDept = result.jobs.filter((j) => j.department);
    expect(withDept.length).toBeGreaterThan(0);
  });

  it('should filter placeholder locations', async () => {
    mockFetchJson.mockResolvedValue({
      data: {
        jobs: [
          { title: 'Job A', absolute_url: 'https://x.com/j/1', location: { name: 'N/A' }, departments: [] },
          { title: 'Job B', absolute_url: 'https://x.com/j/2', location: { name: 'TBD' }, departments: [] },
          { title: 'Job C', absolute_url: 'https://x.com/j/3', location: { name: 'Remote' }, departments: [] },
          { title: 'Job D', absolute_url: 'https://x.com/j/4', location: { name: 'Berlin, Germany' }, departments: [] },
        ],
      },
    });

    const result = await greenhouseApiFetch('https://job-boards.greenhouse.io/testco');
    expect(result.jobs.find((j) => j.title === 'Job A')?.location).toBeUndefined();
    expect(result.jobs.find((j) => j.title === 'Job B')?.location).toBeUndefined();
    expect(result.jobs.find((j) => j.title === 'Job C')?.location).toBeUndefined();
    expect(result.jobs.find((j) => j.title === 'Job D')?.location).toBe('Berlin, Germany');
  });

  it('should return error for invalid URL (no slug)', async () => {
    const result = await greenhouseApiFetch('https://example.com/not-greenhouse');
    expect(result.error).toBeDefined();
    expect(result.jobs).toEqual([]);
  });

  it('should handle EU domain slugs', async () => {
    mockFetchJson.mockResolvedValue({
      data: {
        jobs: [{
          title: 'Test Job',
          absolute_url: 'https://x.com/j/1',
          location: { name: 'Berlin' },
          departments: [{ name: 'Eng' }],
        }],
      },
    });

    const result = await greenhouseApiFetch('https://job-boards.eu.greenhouse.io/nuitee');
    expect(result.error).toBeUndefined();
    expect(result.jobs.length).toBe(1);
  });

  it('should truncate descriptions to 20k characters', async () => {
    const longContent = '<p>' + 'x'.repeat(25_000) + '</p>';
    mockFetchJson.mockResolvedValue({
      data: {
        jobs: [{
          title: 'Long Desc Job',
          absolute_url: 'https://x.com/j/1',
          location: { name: 'Somewhere' },
          departments: [],
          content: longContent,
        }],
      },
    });

    const result = await greenhouseApiFetch('https://job-boards.greenhouse.io/testco');
    expect(result.jobs[0].description!.length).toBeLessThanOrEqual(20_000);
  });

  it('should return error when fetchJson fails', async () => {
    mockFetchJson.mockResolvedValue({ data: null, error: 'HTTP 500 Internal Server Error' });

    const result = await greenhouseApiFetch('https://job-boards.greenhouse.io/testco');
    expect(result.error).toBeDefined();
    expect(result.jobs).toEqual([]);
  });

  it('should skip jobs without title or url', async () => {
    mockFetchJson.mockResolvedValue({
      data: {
        jobs: [
          { title: '', absolute_url: 'https://x.com/j/1' },
          { title: 'Valid Job', absolute_url: '' },
          { title: 'Good Job', absolute_url: 'https://x.com/j/3' },
        ],
      },
    });

    const result = await greenhouseApiFetch('https://job-boards.greenhouse.io/testco');
    expect(result.jobs.length).toBe(1);
    expect(result.jobs[0].title).toBe('Good Job');
  });
});

// ─── API Detect (greenhouseApiDetect) ─────────────────────────────────────────

describe('greenhouseApiDetect', () => {
  afterEach(() => {
    mockFetchJson.mockReset();
  });

  it('should return company name from API', async () => {
    mockFetchJson.mockResolvedValue({ data: { name: 'Hightouch' } });

    const result = await greenhouseApiDetect('https://job-boards.greenhouse.io/hightouch');
    expect(result.company).toBe('Hightouch');
    expect(result.error).toBeUndefined();
  });

  it('should fall back to prettified slug on API error', async () => {
    mockFetchJson.mockResolvedValue({ data: null, error: 'HTTP 500' });

    const result = await greenhouseApiDetect('https://job-boards.greenhouse.io/cool-company');
    // Slug "cool-company" prettified: "Cool Company"
    expect(result.company).toBe('Cool Company');
  });

  it('should return error for non-greenhouse URL', async () => {
    const result = await greenhouseApiDetect('https://example.com/not-greenhouse');
    expect(result.error).toBeDefined();
    expect(result.company).toBe('');
  });

  it('should handle EU domain', async () => {
    mockFetchJson.mockResolvedValue({ data: { name: 'Nuitée' } });

    const result = await greenhouseApiDetect('https://job-boards.eu.greenhouse.io/nuitee');
    expect(result.company).toBe('Nuitée');
  });

  it('should fall back to prettified slug when name is empty', async () => {
    mockFetchJson.mockResolvedValue({ data: { name: '' } });

    const result = await greenhouseApiDetect('https://job-boards.greenhouse.io/some-corp');
    expect(result.company).toBe('Some Corp');
  });
});

// ─── Slug Extraction (tested indirectly) ──────────────────────────────────────

describe('Slug extraction (via greenhouseApiFetch)', () => {
  afterEach(() => {
    mockFetchJson.mockReset();
  });

  // We test slug extraction indirectly: verify fetchJson was called
  // with the expected API URL containing the correct slug.

  it('should extract slug from boards.greenhouse.io/company', async () => {
    mockFetchJson.mockResolvedValue({ data: { jobs: [] } });

    await greenhouseApiFetch('https://boards.greenhouse.io/mycompany');
    expect(mockFetchJson).toHaveBeenCalledWith(
      'https://boards-api.greenhouse.io/v1/boards/mycompany/jobs?content=true',
    );
  });

  it('should extract slug from job-boards.greenhouse.io/company', async () => {
    mockFetchJson.mockResolvedValue({ data: { jobs: [] } });

    await greenhouseApiFetch('https://job-boards.greenhouse.io/anotherco');
    expect(mockFetchJson).toHaveBeenCalledWith(
      'https://boards-api.greenhouse.io/v1/boards/anotherco/jobs?content=true',
    );
  });

  it('should extract slug from EU domain', async () => {
    mockFetchJson.mockResolvedValue({ data: { jobs: [] } });

    await greenhouseApiFetch('https://job-boards.eu.greenhouse.io/eurocompany');
    expect(mockFetchJson).toHaveBeenCalledWith(
      'https://boards-api.greenhouse.io/v1/boards/eurocompany/jobs?content=true',
    );
  });

  it('should extract slug from boards.eu.greenhouse.io/company', async () => {
    mockFetchJson.mockResolvedValue({ data: { jobs: [] } });

    await greenhouseApiFetch('https://boards.eu.greenhouse.io/euboard');
    expect(mockFetchJson).toHaveBeenCalledWith(
      'https://boards-api.greenhouse.io/v1/boards/euboard/jobs?content=true',
    );
  });

  it('should return error for non-greenhouse URL (no slug extracted)', async () => {
    const result = await greenhouseApiFetch('https://careers.randomcompany.com');
    expect(result.error).toBeDefined();
    expect(mockFetchJson).not.toHaveBeenCalled();
  });
});
