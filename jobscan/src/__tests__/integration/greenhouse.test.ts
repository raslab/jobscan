/**
 * Greenhouse Parser — Integration Tests
 *
 * Tests the full pipeline via the dev server REST API:
 *   1. Add a greenhouse source → verify first scrape
 *   2. Query parsed jobs → verify count and fields
 *   3. Fetch individual job → verify detail fields
 *   4. Re-sync source → verify idempotent behavior
 *   5. Cleanup → delete test source
 *
 * Prerequisites:
 *   - Dev server running on localhost:3000 (`npm run dev`)
 *   - Uses real Greenhouse boards (hits live URLs during sync)
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

// Use a small greenhouse board to keep tests fast
// Hightouch has ~50 jobs — big enough to be meaningful, small enough to sync quickly
const TEST_BOARD = {
  company: '__test_hightouch__',
  url: 'https://job-boards.greenhouse.io/hightouch',
  parser: 'greenhouse',
};

// Track source ID for cleanup
let testSourceId: number | null = null;

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
  // Cleanup: delete test source to avoid polluting dev DB
  if (testSourceId) {
    try {
      await deleteSource(testSourceId);
      console.log(`[cleanup] Deleted test source ${testSourceId}`);
    } catch (err) {
      console.warn(`[cleanup] Failed to delete test source ${testSourceId}:`, err);
    }
  }
});

describe('Greenhouse integration — full pipeline', () => {
  it('should add a greenhouse source and get initial job count', async () => {
    const { status, data } = await addSource(
      TEST_BOARD.company,
      TEST_BOARD.url,
      TEST_BOARD.parser,
    );

    expect(status).toBe(201);
    expect(data.source).toBeDefined();
    expect(data.source.parser).toBe('greenhouse');
    expect(data.source.company).toBe(TEST_BOARD.company);
    expect(data.firstScrape).toBeDefined();
    // First scrape is listing-only (no DB insert), but should detect jobs
    expect(data.firstScrape.count).toBeGreaterThan(0);
    expect(data.firstScrape.error).toBeUndefined();

    // Save source ID for subsequent tests and cleanup
    testSourceId = data.source.id;
  });

  it('should sync the source to persist jobs in DB', async () => {
    expect(testSourceId).toBeTruthy();

    // First scrape is listing-only; sync actually inserts jobs into DB
    const { status, data } = await syncSource(testSourceId!);
    expect(status).toBe(200);
    expect(data.status).toBe('ok');
    expect(data.totalJobs).toBeGreaterThan(0);
  });

  it('should have scraped jobs queryable via GET /api/jobs', async () => {
    expect(testSourceId).toBeTruthy();

    const { status, data } = await getJobs({
      company: TEST_BOARD.company,
      page: 1,
      pageSize: 100,
    });

    expect(status).toBe(200);
    expect(data.data.length).toBeGreaterThan(0);
    expect(data.total).toBeGreaterThan(0);

    // Every job should have basic fields
    for (const job of data.data) {
      expect(job.title).toBeTruthy();
      expect(job.url).toBeTruthy();
      expect(job.company).toBe(TEST_BOARD.company);
      expect(job.source_id).toBe(testSourceId);
    }
  });

  it('job URLs should point to greenhouse.io', async () => {
    const { data } = await getJobs({
      company: TEST_BOARD.company,
      page: 1,
      pageSize: 10,
    });

    for (const job of data.data) {
      expect(job.url).toContain('greenhouse.io');
    }
  });

  it('most jobs should have location and department', async () => {
    const { data } = await getJobs({
      company: TEST_BOARD.company,
      page: 1,
      pageSize: 100,
    });

    const withLocation = data.data.filter((j) => j.location);
    const withDepartment = data.data.filter((j) => j.department);

    // Greenhouse API provides location and department for most jobs
    expect(withLocation.length).toBeGreaterThan(data.data.length * 0.5);
    expect(withDepartment.length).toBeGreaterThan(data.data.length * 0.5);
  });

  it('should fetch individual job with full details', async () => {
    const { data: jobList } = await getJobs({
      company: TEST_BOARD.company,
      page: 1,
      pageSize: 1,
    });

    expect(jobList.data.length).toBeGreaterThan(0);
    const jobId = jobList.data[0].id;

    const { status, data: job } = await getJob(jobId);
    expect(status).toBe(200);
    expect(job.id).toBe(jobId);
    expect(job.title).toBeTruthy();
    expect(job.url).toBeTruthy();
    expect(job.company).toBe(TEST_BOARD.company);
  });

  it('should re-sync source idempotently', async () => {
    expect(testSourceId).toBeTruthy();

    const { status, data } = await syncSource(testSourceId!);
    expect(status).toBe(200);
    expect(data.status).toBe('ok');
    // Re-sync should find 0 new jobs (all already exist)
    expect(data.newJobs).toBe(0);
  });

  it('should still have jobs after re-sync', async () => {
    const { data } = await getJobs({
      company: TEST_BOARD.company,
      page: 1,
      pageSize: 10,
    });

    expect(data.data.length).toBeGreaterThan(0);
  });

  it('should clean up test source', async () => {
    expect(testSourceId).toBeTruthy();

    const { status } = await deleteSource(testSourceId!);
    expect(status).toBe(204);

    testSourceId = null; // Prevent double-delete in afterAll
  });
});
