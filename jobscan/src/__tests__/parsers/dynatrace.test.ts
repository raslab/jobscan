/**
 * Dynatrace Parser — Unit Test Suite
 *
 * Covers:
 *  1. dynatraceApiFetch() with cached Coveo API JSON response (mocked fetchJson)
 *  2. dynatraceParser() edge cases (HTML stub returns empty array)
 *  3. isDynatraceUrl() URL recognition
 *  4. Field mapping: title, url, location, workplace_type, department, commitment, team
 *  5. Workplace type normalisation ("Office Based" → "On-site")
 *  6. Multi-location jobs (office_locations array)
 *  7. Error handling
 */

import { loadJsonFixture } from '../helpers/fixture-loader';

// Mock fetch-utils so dynatraceApiFetch uses cached data instead of network
jest.mock('../../fetch-utils', () => ({
  fetchJson: jest.fn(),
  fetchHtml: jest.fn(),
}));

import { dynatraceApiFetch, dynatraceParser, isDynatraceUrl, dynatraceDetect } from '../../parsers/dynatrace';
import { fetchJson } from '../../fetch-utils';

const mockFetchJson = fetchJson as jest.MockedFunction<typeof fetchJson>;

// ─── isDynatraceUrl ───────────────────────────────────────────────────────────

describe('isDynatraceUrl', () => {
  it('recognises careers.dynatrace.com', () => {
    expect(isDynatraceUrl('https://careers.dynatrace.com/')).toBe(true);
    expect(isDynatraceUrl('https://careers.dynatrace.com/jobs')).toBe(true);
  });

  it('recognises www.dynatrace.com/careers paths', () => {
    expect(isDynatraceUrl('https://www.dynatrace.com/careers/')).toBe(true);
    expect(isDynatraceUrl('https://www.dynatrace.com/careers/jobs/')).toBe(true);
  });

  it('rejects unrelated URLs', () => {
    expect(isDynatraceUrl('https://www.dynatrace.com/')).toBe(false);
    expect(isDynatraceUrl('https://www.dynatrace.com/company/')).toBe(false);
    expect(isDynatraceUrl('https://example.com/careers')).toBe(false);
    expect(isDynatraceUrl('not-a-url')).toBe(false);
  });
});

// ─── dynatraceParser (HTML stub) ──────────────────────────────────────────────

describe('dynatraceParser — HTML stub', () => {
  it('returns empty array for any HTML input', () => {
    expect(dynatraceParser('', 'https://careers.dynatrace.com/')).toEqual([]);
    expect(dynatraceParser('<html><body>Hello</body></html>', 'https://careers.dynatrace.com/')).toEqual([]);
  });
});

// ─── dynatraceApiFetch ────────────────────────────────────────────────────────

describe('dynatraceApiFetch — cached Coveo API response', () => {
  let jobs: Awaited<ReturnType<typeof dynatraceApiFetch>>['jobs'];

  beforeAll(async () => {
    const apiResponse = loadJsonFixture('dynatrace', 'dynatrace-api.json');
    mockFetchJson.mockResolvedValue({ data: apiResponse });

    const result = await dynatraceApiFetch('https://careers.dynatrace.com/');
    expect(result.error).toBeUndefined();
    jobs = result.jobs;
  });

  afterEach(() => mockFetchJson.mockReset());

  // ── Basic counts and required fields ────────────────────────────────────────

  it('should parse a non-zero number of jobs', () => {
    expect(jobs.length).toBeGreaterThan(0);
  });

  it('should parse approximately the expected total (100–200 range)', () => {
    // Fixture captured ~135 jobs; allow for minor drift
    expect(jobs.length).toBeGreaterThanOrEqual(100);
    expect(jobs.length).toBeLessThanOrEqual(200);
  });

  it('every job should have title and url', () => {
    for (const job of jobs) {
      expect(job.title).toBeTruthy();
      expect(job.url).toBeTruthy();
    }
  });

  it('every url should be an absolute URL pointing to dynatrace.com/careers/jobs/', () => {
    for (const job of jobs) {
      expect(job.url).toMatch(/^https:\/\/www\.dynatrace\.com\/careers\/jobs\//);
    }
  });

  // ── Location ────────────────────────────────────────────────────────────────

  it('every job should have a location', () => {
    for (const job of jobs) {
      expect(job.location).toBeTruthy();
    }
  });

  it('location should combine city and country (e.g. "Boston, United States")', () => {
    // Find the marketing job from Boston in the fixture
    const bostonJobs = jobs.filter((j) => j.location?.includes('Boston'));
    expect(bostonJobs.length).toBeGreaterThan(0);
    // Boston job should also include the country
    expect(bostonJobs[0].location).toContain('United States');
  });

  it('multi-location jobs should join cities and include country', () => {
    // The fixture has jobs with multiple office_locations (e.g. Vienna + Linz)
    const multiLocJobs = jobs.filter((j) => j.location && j.location.includes(', '));
    expect(multiLocJobs.length).toBeGreaterThan(0);
    // Verify one of the multi-location jobs from the fixture
    const viennaLinz = jobs.find((j) => j.location?.includes('Vienna') && j.location?.includes('Linz'));
    expect(viennaLinz).toBeDefined();
    expect(viennaLinz!.location).toContain('Austria');
  });

  // ── Workplace type ───────────────────────────────────────────────────────────

  it('workplace_type should be one of Hybrid / Remote / On-site (no raw "Office Based")', () => {
    const valid = new Set(['Hybrid', 'Remote', 'On-site']);
    for (const job of jobs) {
      if (job.workplace_type) {
        expect(valid.has(job.workplace_type)).toBe(true);
      }
    }
  });

  it('should normalise "Office Based" to "On-site"', () => {
    // The fixture has 6 "Office Based" jobs — they must not appear as-is
    const officeBased = jobs.filter((j) => j.workplace_type === 'Office Based');
    expect(officeBased).toHaveLength(0);
  });

  it('should parse Remote jobs', () => {
    const remoteJobs = jobs.filter((j) => j.workplace_type === 'Remote');
    expect(remoteJobs.length).toBeGreaterThan(0);
  });

  it('should parse Hybrid jobs', () => {
    const hybridJobs = jobs.filter((j) => j.workplace_type === 'Hybrid');
    expect(hybridJobs.length).toBeGreaterThan(0);
  });

  it('should parse On-site jobs (from "Office Based" source)', () => {
    const onsiteJobs = jobs.filter((j) => j.workplace_type === 'On-site');
    expect(onsiteJobs.length).toBeGreaterThan(0);
  });

  // ── Department ──────────────────────────────────────────────────────────────

  it('every job should have a department (team)', () => {
    for (const job of jobs) {
      expect(job.department).toBeTruthy();
    }
  });

  it('should parse Engineering department jobs', () => {
    const engJobs = jobs.filter((j) => j.department === 'Engineering');
    expect(engJobs.length).toBeGreaterThan(0);
  });

  it('should parse Sales department jobs', () => {
    const salesJobs = jobs.filter((j) => j.department?.includes('Sales'));
    expect(salesJobs.length).toBeGreaterThan(0);
  });

  // ── Commitment ──────────────────────────────────────────────────────────────

  it('every job should have a commitment (employment_type)', () => {
    for (const job of jobs) {
      expect(job.commitment).toBeTruthy();
    }
  });

  it('most jobs should be Full-time', () => {
    const fullTime = jobs.filter((j) => j.commitment === 'Full-time');
    expect(fullTime.length).toBeGreaterThan(jobs.length * 0.9);
  });

  // ── Team (capability sub-field) ──────────────────────────────────────────────

  it('some jobs should have a team (capability) set', () => {
    const withTeam = jobs.filter((j) => j.team);
    expect(withTeam.length).toBeGreaterThan(0);
  });

  // ── Known job verification ────────────────────────────────────────────────────

  it('should find the known Lead Partner Marketing Manager job from the fixture', () => {
    const found = jobs.find((j) => j.title === "Lead Partner Marketing Manager - GSI's");
    expect(found).toBeDefined();
    expect(found!.url).toBe('https://www.dynatrace.com/careers/jobs/1351432900');
    expect(found!.location).toBe('Boston, United States');
    expect(found!.workplace_type).toBe('Remote');
    expect(found!.department).toBe('Marketing and Communication');
    expect(found!.commitment).toBe('Full-time');
  });

  it('should find the known Principal Product Manager job and verify multi-location', () => {
    const found = jobs.find((j) => j.title === 'Principal Product Manager - Cloud Integration (m/f/x)');
    expect(found).toBeDefined();
    expect(found!.location).toBe('Vienna, Linz, Austria');
    expect(found!.workplace_type).toBe('Hybrid');
    expect(found!.team).toBe('Data Acquisition');
  });
});

// ─── Error handling ───────────────────────────────────────────────────────────

describe('dynatraceApiFetch — error handling', () => {
  afterEach(() => mockFetchJson.mockReset());

  it('returns error and empty jobs array when fetchJson fails', async () => {
    mockFetchJson.mockResolvedValue({ data: null, error: 'Network error' });

    const result = await dynatraceApiFetch('https://careers.dynatrace.com/');
    expect(result.error).toBe('Network error');
    expect(result.jobs).toEqual([]);
  });

  it('returns empty jobs array for unexpected API response shape', async () => {
    mockFetchJson.mockResolvedValue({ data: { message: 'unexpected' } });

    const result = await dynatraceApiFetch('https://careers.dynatrace.com/');
    expect(result.error).toBeUndefined();
    expect(result.jobs).toEqual([]);
  });

  it('skips results missing title or url', async () => {
    mockFetchJson.mockResolvedValue({
      data: {
        totalCount: 2,
        results: [
          { title: '', clickUri: 'https://www.dynatrace.com/careers/jobs/1', raw: {} },
          { title: 'Valid Job', clickUri: '', raw: {} },
          { title: 'Real Job', clickUri: 'https://www.dynatrace.com/careers/jobs/2', raw: { team: ['Engineering'], employment_type: ['Full-time'], office_locations: ['Vienna'], country: ['Austria'], flex_option: ['Hybrid'] } },
        ],
      },
    });

    const result = await dynatraceApiFetch('https://careers.dynatrace.com/');
    expect(result.error).toBeUndefined();
    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0].title).toBe('Real Job');
  });
});

// ─── dynatraceDetect ───────────────────────────────────────────────────────────────

describe('dynatraceDetect', () => {
  it('returns company name Dynatrace for any URL', async () => {
    const result = await dynatraceDetect('https://careers.dynatrace.com/');
    expect(result.company).toBe('Dynatrace');
    expect(result.error).toBeUndefined();
  });

  it('returns company name Dynatrace for www.dynatrace.com/careers URL', async () => {
    const result = await dynatraceDetect('https://www.dynatrace.com/careers/jobs/software-engineer/');
    expect(result.company).toBe('Dynatrace');
    expect(result.error).toBeUndefined();
  });
});
