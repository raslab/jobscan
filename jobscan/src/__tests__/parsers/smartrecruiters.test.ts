/**
 * SmartRecruiters Parser — Full Test Suite
 *
 * Covers:
 *  1. smartrecruitersApiFetch() with cached API JSON (mocked fetchJson)
 *  2. smartrecruitersApiDetect() with mocked fetchJson
 *  3. smartrecruitersJobDetailApiFetch() with cached detail JSON
 *  4. smartrecruitersParser() HTML fallback (always returns [])
 *  5. URL identifier extraction (tested indirectly through API functions)
 *  6. Edge cases: root URL, invalid URLs, empty responses
 *  7. URL detection regression: root smartrecruiters.com should NOT match
 */

import { loadJsonFixture, loadFixture } from '../helpers/fixture-loader';
import { expectMarkdownDescription } from '../helpers/markdown';

// Mock fetch-utils so API functions use cached data instead of network
jest.mock('../../fetch-utils', () => ({
  fetchJson: jest.fn(),
  fetchHtml: jest.fn(),
}));

import {
  smartrecruitersApiFetch,
  smartrecruitersApiDetect,
  smartrecruitersJobDetailApiFetch,
  smartrecruitersParser,
} from '../../parsers/smartrecruiters';
import { detectParserFromUrl } from '../../parsers/registry';
import { fetchJson } from '../../fetch-utils';

const mockFetchJson = fetchJson as jest.MockedFunction<typeof fetchJson>;

// ─── API Fetch — PolygonTechnology ────────────────────────────────────────────

describe('smartrecruitersApiFetch — PolygonTechnology', () => {
  afterEach(() => mockFetchJson.mockReset());

  it('should parse jobs from cached API response', async () => {
    const apiData = loadJsonFixture('smartrecruiters', 'polygon-api.json');
    mockFetchJson.mockResolvedValue({ data: apiData });

    const result = await smartrecruitersApiFetch(
      'https://careers.smartrecruiters.com/PolygonTechnology',
    );
    expect(result.error).toBeUndefined();
    expect(result.jobs.length).toBeGreaterThan(0);
  });

  it('should parse approximately the expected job count', async () => {
    const apiData = loadJsonFixture('smartrecruiters', 'polygon-api.json');
    mockFetchJson.mockResolvedValue({ data: apiData });

    const { jobs } = await smartrecruitersApiFetch(
      'https://careers.smartrecruiters.com/PolygonTechnology',
    );
    // PolygonTechnology has ~4 jobs
    expect(jobs.length).toBeGreaterThanOrEqual(2);
    expect(jobs.length).toBeLessThanOrEqual(20);
  });

  it('every job should have required fields: title and url', async () => {
    const apiData = loadJsonFixture('smartrecruiters', 'polygon-api.json');
    mockFetchJson.mockResolvedValue({ data: apiData });

    const { jobs } = await smartrecruitersApiFetch(
      'https://careers.smartrecruiters.com/PolygonTechnology',
    );
    for (const job of jobs) {
      expect(job.title).toBeTruthy();
      expect(job.url).toBeTruthy();
    }
  });

  it('every url should be an absolute URL pointing to smartrecruiters.com', async () => {
    const apiData = loadJsonFixture('smartrecruiters', 'polygon-api.json');
    mockFetchJson.mockResolvedValue({ data: apiData });

    const { jobs } = await smartrecruitersApiFetch(
      'https://careers.smartrecruiters.com/PolygonTechnology',
    );
    for (const job of jobs) {
      expect(job.url).toMatch(/^https:\/\/jobs\.smartrecruiters\.com\/PolygonTechnology\//);
    }
  });

  it('should parse locations for jobs', async () => {
    const apiData = loadJsonFixture('smartrecruiters', 'polygon-api.json');
    mockFetchJson.mockResolvedValue({ data: apiData });

    const { jobs } = await smartrecruitersApiFetch(
      'https://careers.smartrecruiters.com/PolygonTechnology',
    );
    const withLoc = jobs.filter((j) => j.location);
    expect(withLoc.length).toBeGreaterThan(0);
  });

  it('should parse commitment (employment type) for jobs', async () => {
    const apiData = loadJsonFixture('smartrecruiters', 'polygon-api.json');
    mockFetchJson.mockResolvedValue({ data: apiData });

    const { jobs } = await smartrecruitersApiFetch(
      'https://careers.smartrecruiters.com/PolygonTechnology',
    );
    const withCommitment = jobs.filter((j) => j.commitment);
    expect(withCommitment.length).toBeGreaterThan(0);
    // "permanent" maps to "Full-time"
    for (const job of withCommitment) {
      expect(['Full-time', 'Contract', 'Internship', 'Part-time', 'Temporary', 'Volunteer', 'Freelance']).toContain(
        job.commitment,
      );
    }
  });

  it('should find known job titles from the fixture', async () => {
    const apiData = loadJsonFixture('smartrecruiters', 'polygon-api.json');
    mockFetchJson.mockResolvedValue({ data: apiData });

    const { jobs } = await smartrecruitersApiFetch(
      'https://careers.smartrecruiters.com/PolygonTechnology',
    );
    const titles = jobs.map((j) => j.title);
    expect(titles).toContain('Software Engineer (Golang)');
    expect(titles).toContain('Software Quality Assurance Engineer (SQA)');
  });

  it('should not have duplicate URLs', async () => {
    const apiData = loadJsonFixture('smartrecruiters', 'polygon-api.json');
    mockFetchJson.mockResolvedValue({ data: apiData });

    const { jobs } = await smartrecruitersApiFetch(
      'https://careers.smartrecruiters.com/PolygonTechnology',
    );
    const urls = jobs.map((j) => j.url);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it('should work with jobs.smartrecruiters.com domain too', async () => {
    const apiData = loadJsonFixture('smartrecruiters', 'polygon-api.json');
    mockFetchJson.mockResolvedValue({ data: apiData });

    const result = await smartrecruitersApiFetch(
      'https://jobs.smartrecruiters.com/PolygonTechnology',
    );
    expect(result.error).toBeUndefined();
    expect(result.jobs.length).toBeGreaterThan(0);
  });
});

// ─── API Fetch — Error handling ───────────────────────────────────────────────

describe('smartrecruitersApiFetch — error handling', () => {
  afterEach(() => mockFetchJson.mockReset());

  it('should return error for root URL (no company identifier)', async () => {
    const result = await smartrecruitersApiFetch('https://jobs.smartrecruiters.com/');
    expect(result.error).toBeDefined();
    expect(result.jobs).toEqual([]);
    // fetchJson should NOT have been called — identifier extraction fails first
    expect(mockFetchJson).not.toHaveBeenCalled();
  });

  it('should return error for root URL without trailing slash', async () => {
    const result = await smartrecruitersApiFetch('https://jobs.smartrecruiters.com');
    expect(result.error).toBeDefined();
    expect(result.jobs).toEqual([]);
  });

  it('should return error for non-smartrecruiters URL', async () => {
    const result = await smartrecruitersApiFetch('https://example.com/jobs');
    expect(result.error).toBeDefined();
    expect(result.jobs).toEqual([]);
  });

  it('should return error when API returns error on first page', async () => {
    mockFetchJson.mockResolvedValue({ data: null, error: 'Not Found' });

    const result = await smartrecruitersApiFetch(
      'https://jobs.smartrecruiters.com/NonExistentCompany123',
    );
    expect(result.error).toBeDefined();
    expect(result.jobs).toEqual([]);
  });

  it('should handle empty content array from API', async () => {
    mockFetchJson.mockResolvedValue({
      data: { offset: 0, limit: 100, totalFound: 0, content: [] },
    });

    const result = await smartrecruitersApiFetch(
      'https://jobs.smartrecruiters.com/SomeCompany',
    );
    expect(result.error).toBeUndefined();
    expect(result.jobs).toEqual([]);
  });
});

// ─── API Detect — Company name ────────────────────────────────────────────────

describe('smartrecruitersApiDetect', () => {
  afterEach(() => mockFetchJson.mockReset());

  it('should extract company name from API response', async () => {
    const apiData = loadJsonFixture('smartrecruiters', 'polygon-api.json');
    mockFetchJson.mockResolvedValue({ data: apiData });

    const result = await smartrecruitersApiDetect(
      'https://careers.smartrecruiters.com/PolygonTechnology',
    );
    expect(result.company).toBe('Polygon Technology');
    expect(result.error).toBeUndefined();
  });

  it('should fallback to prettified identifier when API fails', async () => {
    mockFetchJson.mockResolvedValue({ data: null, error: 'Network error' });

    const result = await smartrecruitersApiDetect(
      'https://jobs.smartrecruiters.com/PolygonTechnology',
    );
    // CamelCase splitting: "PolygonTechnology" → "Polygon Technology"
    expect(result.company).toBe('Polygon Technology');
  });

  it('should return error for root URL (no identifier)', async () => {
    const result = await smartrecruitersApiDetect('https://jobs.smartrecruiters.com/');
    expect(result.error).toBeDefined();
    expect(result.company).toBe('');
  });

  it('should return error for non-smartrecruiters URL', async () => {
    const result = await smartrecruitersApiDetect('https://example.com/careers');
    expect(result.error).toBeDefined();
    expect(result.company).toBe('');
  });
});

// ─── Job Detail API Fetch ─────────────────────────────────────────────────────

describe('smartrecruitersJobDetailApiFetch', () => {
  afterEach(() => mockFetchJson.mockReset());

  it('should fetch and format job description from detail API', async () => {
    const detailData = loadJsonFixture('smartrecruiters', 'polygon-job-detail.json');
    mockFetchJson.mockResolvedValue({ data: detailData });

    const result = await smartrecruitersJobDetailApiFetch(
      'https://jobs.smartrecruiters.com/PolygonTechnology/744000112031467-software-engineer-golang',
    );
    expect(result.error).toBeUndefined();
    expect(result.description).toBeTruthy();
    // Description should contain content from the sections
    expect(result.description).toContain('Polygon Technology');
    // Markdown contract: no raw HTML tags in the stored description
    expectMarkdownDescription(result.description, { sourceHadMarkdownMarkers: true });
  });

  it('should include multiple sections in description', async () => {
    const detailData = loadJsonFixture('smartrecruiters', 'polygon-job-detail.json');
    mockFetchJson.mockResolvedValue({ data: detailData });

    const result = await smartrecruitersJobDetailApiFetch(
      'https://jobs.smartrecruiters.com/PolygonTechnology/744000112031467',
    );
    // Should have content from multiple sections with markdown headers
    expect(result.description).toMatch(/##/);
  });

  it('should return error for non-smartrecruiters URL', async () => {
    const result = await smartrecruitersJobDetailApiFetch('https://example.com/jobs/123');
    expect(result.error).toBeDefined();
  });

  it('should return error for URL without job ID', async () => {
    const result = await smartrecruitersJobDetailApiFetch(
      'https://jobs.smartrecruiters.com/PolygonTechnology',
    );
    expect(result.error).toBeDefined();
  });

  it('should handle API error gracefully', async () => {
    mockFetchJson.mockResolvedValue({ data: null, error: 'Not Found' });

    const result = await smartrecruitersJobDetailApiFetch(
      'https://jobs.smartrecruiters.com/PolygonTechnology/999999-nonexistent',
    );
    expect(result.error).toBe('Not Found');
  });

  it('should handle response without jobAd sections', async () => {
    mockFetchJson.mockResolvedValue({ data: { id: '123', name: 'Test Job' } });

    const result = await smartrecruitersJobDetailApiFetch(
      'https://jobs.smartrecruiters.com/PolygonTechnology/123-test',
    );
    // No sections means no description (but no error either)
    expect(result.error).toBeUndefined();
  });
});

// ─── HTML Parser (fallback — always returns []) ──────────────────────────────

describe('smartrecruitersParser — HTML fallback', () => {
  it('should return empty array (SmartRecruiters is React SPA, API-only)', () => {
    const html = loadFixture('smartrecruiters', 'polygon.html');
    const jobs = smartrecruitersParser(html, 'https://careers.smartrecruiters.com/PolygonTechnology');
    expect(jobs).toEqual([]);
  });

  it('should return empty array for empty HTML', () => {
    expect(smartrecruitersParser('', 'https://example.com')).toEqual([]);
  });

  it('should return empty array for arbitrary HTML', () => {
    expect(
      smartrecruitersParser('<html><body>Hello</body></html>', 'https://example.com'),
    ).toEqual([]);
  });
});

// ─── URL Detection — Registry ─────────────────────────────────────────────────

describe('SmartRecruiters URL detection (registry)', () => {
  it('should detect careers.smartrecruiters.com/Company as smartrecruiters', () => {
    expect(detectParserFromUrl('https://careers.smartrecruiters.com/PolygonTechnology')).toBe('smartrecruiters');
  });

  it('should detect jobs.smartrecruiters.com/Company as smartrecruiters', () => {
    expect(detectParserFromUrl('https://jobs.smartrecruiters.com/PolygonTechnology')).toBe('smartrecruiters');
  });

  it('should detect URL with job path as smartrecruiters', () => {
    expect(
      detectParserFromUrl('https://jobs.smartrecruiters.com/PolygonTechnology/744000112031467-software-engineer'),
    ).toBe('smartrecruiters');
  });

  it('should NOT detect root jobs.smartrecruiters.com/ as smartrecruiters', () => {
    // Root URL has no company identifier — should not be detected
    expect(detectParserFromUrl('https://jobs.smartrecruiters.com/')).toBeNull();
  });

  it('should NOT detect root careers.smartrecruiters.com/ as smartrecruiters', () => {
    expect(detectParserFromUrl('https://careers.smartrecruiters.com/')).toBeNull();
  });

  it('should NOT detect root without trailing slash', () => {
    expect(detectParserFromUrl('https://jobs.smartrecruiters.com')).toBeNull();
  });

  it('should NOT detect unrelated domains', () => {
    expect(detectParserFromUrl('https://example.com/smartrecruiters')).toBeNull();
  });
});
