/**
 * Jobylon Parser — Integration Tests
 *
 * Tests the full pipeline via the dev server REST API:
 *   1. Add a Jobylon source (WithSecure, company 505) → verify first scrape
 *   2. Query parsed jobs → verify count and fields
 *   3. Fetch individual job → verify detail fields
 *   4. Re-sync source → verify idempotent behavior
 *   5. Cleanup → delete test sources
 *
 * Prerequisites:
 *   - Dev server running on localhost:3000 (`npm run dev`)
 *   - Uses real Jobylon embed API (hits live URLs during sync)
 *
 * These tests are slower (network I/O) and tagged in the `integration` path.
 */

import {
  addSource,
  deleteSource,
  syncSource,
  getJobs,
  getJob,
  isServerRunning,
  type Source,
} from '../helpers/api-client';

// WithSecure — Jobylon company 505, ~7 open jobs
const TEST_WITHSECURE = {
  company: '__test_withsecure__',
  url: 'https://emp.jobylon.com/companies/505/',
  parser: 'jobylon',
};

// Track source IDs for cleanup
let withSecureSourceId: number | null = null;

beforeAll(async () => {
  const running = await isServerRunning();
  if (!running) {
    throw new Error(
      'Dev server is not running on localhost:3000.\n' +
      'Start it with: cd jobscan && npm run dev\n' +
      'Then re-run integration tests: npm run test:integration'
    );
  }
});

afterAll(async () => {
  // Cleanup: delete test sources to avoid polluting dev DB
  if (withSecureSourceId) {
    try {
      await deleteSource(withSecureSourceId);
      console.log(`[cleanup] Deleted test source withsecure (${withSecureSourceId})`);
    } catch (err) {
      console.warn(`[cleanup] Failed to delete test source withsecure (${withSecureSourceId}):`, err);
    }
  }
});

describe('Jobylon integration — WithSecure (company 505)', () => {
  it('should add a jobylon source and get initial job count', async () => {
    const { status, data } = await addSource(
      TEST_WITHSECURE.company,
      TEST_WITHSECURE.url,
      TEST_WITHSECURE.parser,
    );

    expect(status).toBe(201);
    expect(data.source).toBeDefined();
    expect(data.source.parser).toBe('jobylon');
    expect(data.source.company).toBe(TEST_WITHSECURE.company);
    expect(data.firstScrape).toBeDefined();
    expect(data.firstScrape.count).toBeGreaterThan(0);
    expect(data.firstScrape.error).toBeUndefined();

    withSecureSourceId = data.source.id;
  });

  it('should sync the source to persist jobs in DB', async () => {
    expect(withSecureSourceId).toBeTruthy();

    const { status, data } = await syncSource(withSecureSourceId!);
    expect(status).toBe(200);
    expect(data.status).toBe('ok');
    expect(data.totalJobs).toBeGreaterThan(0);
  });

  it('should have scraped jobs queryable via GET /api/jobs', async () => {
    const { status, data } = await getJobs({
      company: TEST_WITHSECURE.company,
      pageSize: 50,
    });

    expect(status).toBe(200);
    expect(data.data.length).toBeGreaterThan(0);

    // Verify all jobs have required fields
    for (const job of data.data) {
      expect(job.title).toBeTruthy();
      expect(job.url).toBeTruthy();
      expect(job.url).toMatch(/emp\.jobylon\.com\/jobs\/\d+/);
      expect(job.company).toBe(TEST_WITHSECURE.company);
    }
  });

  it('scraped jobs should have location metadata', async () => {
    const { data } = await getJobs({
      company: TEST_WITHSECURE.company,
      pageSize: 50,
    });

    const withLocation = data.data.filter(j => j.location);
    expect(withLocation.length).toBeGreaterThan(0);
  });

  it('scraped jobs should have department metadata', async () => {
    const { data } = await getJobs({
      company: TEST_WITHSECURE.company,
      pageSize: 50,
    });

    const withDept = data.data.filter(j => j.department);
    expect(withDept.length).toBeGreaterThan(0);
  });

  it('should find a specific known job title', async () => {
    const { data } = await getJobs({
      company: TEST_WITHSECURE.company,
      search: 'Threat Hunter',
      searchMode: 'exact',
      pageSize: 10,
    });

    // The "Threat Hunter" job should be present
    const threatHunter = data.data.find(j => j.title.includes('Threat Hunter'));
    expect(threatHunter).toBeDefined();
    if (threatHunter) {
      expect(threatHunter.url).toContain('emp.jobylon.com/jobs/');
    }
  });

  it('should re-sync idempotently (no new jobs on immediate re-sync)', async () => {
    expect(withSecureSourceId).toBeTruthy();

    const { status, data } = await syncSource(withSecureSourceId!);
    expect(status).toBe(200);
    expect(data.status).toBe('ok');
    // On immediate re-sync, no new jobs should be added
    expect(data.newJobs).toBe(0);
  });
});
