/**
 * YCombinator Parser — Integration Tests
 *
 * Tests the full pipeline via the dev server REST API:
 *   1. Add a ycombinator source → verify first scrape
 *   2. Sync source → persist jobs in DB
 *   3. Query parsed jobs → verify count and fields
 *   4. Verify metadata (location, department, commitment)
 *   5. Fetch individual job → verify description
 *   6. Re-sync source → verify idempotent behavior
 *   7. Cleanup → delete test source
 *
 * Prerequisites:
 *   - Dev server running on localhost:3000 (`npm run dev`)
 *   - Uses real YCombinator company pages (hits live URLs during sync)
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
} from '../helpers/api-client';

// Use Taktile: small YC board (~5 jobs), fast to sync
const TEST_BOARD = {
  company: '__test_taktile_yc__',
  url: 'https://www.ycombinator.com/companies/taktile/jobs',
  parser: 'ycombinator',
};

let testSourceId: number | null = null;

beforeAll(async () => {
  const running = await isServerRunning();
  if (!running) {
    throw new Error(
      'Dev server is not running on localhost:3000.\n' +
        'Start it with: cd jobscan && npm run dev\n' +
        'Then re-run integration tests: npm run test:integration',
    );
  }
});

afterAll(async () => {
  if (testSourceId) {
    try {
      await deleteSource(testSourceId);
      console.log(`[cleanup] Deleted test source ${testSourceId}`);
    } catch (err) {
      console.warn(`[cleanup] Failed to delete test source ${testSourceId}:`, err);
    }
  }
});

describe('YCombinator integration — full pipeline', () => {
  it('should add a ycombinator source and get initial job count', async () => {
    const { status, data } = await addSource(
      TEST_BOARD.company,
      TEST_BOARD.url,
      TEST_BOARD.parser,
    );

    expect(status).toBe(201);
    expect(data.source).toBeDefined();
    expect(data.source.parser).toBe('ycombinator');
    expect(data.source.company).toBe(TEST_BOARD.company);
    expect(data.firstScrape).toBeDefined();
    expect(data.firstScrape.count).toBeGreaterThan(0);
    expect(data.firstScrape.error).toBeUndefined();

    testSourceId = data.source.id;
  });

  it('should sync the source to persist jobs in DB', async () => {
    expect(testSourceId).toBeTruthy();

    const { status, data } = await syncSource(testSourceId!);
    expect(status).toBe(200);
    expect(data.status).toBe('ok');
    expect(data.totalJobs).toBeGreaterThan(0);
  }, 60_000); // Allow extra time for description fetches with throttling

  it('should have scraped jobs queryable via GET /api/jobs', async () => {
    expect(testSourceId).toBeTruthy();

    const { data } = await getJobs({
      company: TEST_BOARD.company,
      page: 1,
      pageSize: 100,
    });

    expect(data.data.length).toBeGreaterThan(0);
    expect(data.total).toBeGreaterThan(0);

    for (const job of data.data) {
      expect(job.title).toBeTruthy();
      expect(job.url).toBeTruthy();
      expect(job.company).toBe(TEST_BOARD.company);
      expect(job.source_id).toBe(testSourceId);
    }
  });

  it('job URLs should point to ycombinator.com', async () => {
    const { data } = await getJobs({
      company: TEST_BOARD.company,
      page: 1,
      pageSize: 10,
    });

    for (const job of data.data) {
      expect(job.url).toContain('ycombinator.com/companies/');
    }
  });

  it('most jobs should have location', async () => {
    const { data } = await getJobs({
      company: TEST_BOARD.company,
      page: 1,
      pageSize: 100,
    });

    const withLocation = data.data.filter((j) => j.location);
    expect(withLocation.length).toBeGreaterThan(data.data.length * 0.5);
  });

  it('most jobs should have department (prettyRole)', async () => {
    const { data } = await getJobs({
      company: TEST_BOARD.company,
      page: 1,
      pageSize: 100,
    });

    const withDepartment = data.data.filter((j) => j.department);
    expect(withDepartment.length).toBeGreaterThan(0);
  });

  it('most jobs should have commitment (job type)', async () => {
    const { data } = await getJobs({
      company: TEST_BOARD.company,
      page: 1,
      pageSize: 100,
    });

    const withCommitment = data.data.filter((j) => j.commitment);
    expect(withCommitment.length).toBeGreaterThan(data.data.length * 0.5);
  });

  it('should fetch individual job with description', async () => {
    const { data: jobList } = await getJobs({
      company: TEST_BOARD.company,
      page: 1,
      pageSize: 1,
    });

    expect(jobList.data.length).toBeGreaterThan(0);
    const jobId = jobList.data[0].id;

    const { status, data: jobDetail } = await getJob(jobId);
    expect(status).toBe(200);
    expect(jobDetail.title).toBeTruthy();
    expect(jobDetail.url).toBeTruthy();
    // Description should have been fetched from the detail page
    expect(jobDetail.description).toBeTruthy();
    expect(jobDetail.description!.length).toBeGreaterThan(50);
  });

  it('description should contain metadata header with salary and role', async () => {
    const { data: jobList } = await getJobs({
      company: TEST_BOARD.company,
      page: 1,
      pageSize: 5,
    });

    // At least one job should have salary in the metadata header
    const jobsWithSalary = [];
    for (const j of jobList.data) {
      const { data: detail } = await getJob(j.id);
      if (detail.description && detail.description.includes('Salary:')) {
        jobsWithSalary.push(detail);
      }
    }
    expect(jobsWithSalary.length).toBeGreaterThan(0);

    // Verify metadata header structure for a job with salary
    const desc = jobsWithSalary[0].description!;
    expect(desc).toContain('Job type:');
    expect(desc).toContain('Role:');
    expect(desc).toContain('---'); // separator between header and JD body
  });

  it('should re-sync idempotently (0 new jobs)', async () => {
    expect(testSourceId).toBeTruthy();

    const { status, data } = await syncSource(testSourceId!);
    expect(status).toBe(200);
    expect(data.status).toBe('ok');
    expect(data.newJobs).toBe(0);
  }, 60_000);

  it('should clean up test source', async () => {
    expect(testSourceId).toBeTruthy();

    const { status } = await deleteSource(testSourceId!);
    expect([200, 204]).toContain(status);
    testSourceId = null; // Prevent double-delete in afterAll
  });
});
