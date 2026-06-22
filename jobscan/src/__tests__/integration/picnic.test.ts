/**
 * Picnic Parser — Integration Tests
 *
 * Tests the full pipeline via the dev server REST API:
 *   1. Add the Picnic source → verify first scrape detects jobs
 *   2. Sync source → verify jobs are inserted into DB
 *   3. Query jobs → verify count, required fields, location, department
 *   4. Re-sync source → verify idempotent (no duplicate count explosion)
 *   5. Cleanup → delete test source
 *
 * Prerequisites:
 *   - Dev server running on localhost:3000 (`npm run dev`)
 *   - Hits the real jobs.picnic.app/en/jobs page during sync
 */

import {
  addSource,
  deleteSource,
  syncSource,
  getJobs,
  isServerRunning,
  type Job,
} from '../helpers/api-client';

const TEST_SOURCE = {
  company: '__test_picnic__',
  url: 'https://jobs.picnic.app/en/jobs',
  parser: 'picnic',
};

let testSourceId: number | null = null;

beforeAll(async () => {
  const running = await isServerRunning();
  if (!running) {
    throw new Error(
      'Dev server is not running on localhost:3000.\n' +
      'Start it with: cd jobscan && npm run dev\n' +
      'Then re-run: npm run test:integration'
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

describe('Picnic integration — full pipeline', () => {
  it('should add a Picnic source and detect jobs on first scrape', async () => {
    const { status, data } = await addSource(
      TEST_SOURCE.company,
      TEST_SOURCE.url,
      TEST_SOURCE.parser,
    );

    expect(status).toBe(201);
    expect(data.source).toBeDefined();
    expect(data.source.parser).toBe('picnic');
    expect(data.source.company).toBe(TEST_SOURCE.company);
    expect(data.firstScrape).toBeDefined();
    // Picnic has 250+ open positions reliably
    expect(data.firstScrape.count).toBeGreaterThan(100);
    expect(data.firstScrape.error).toBeUndefined();

    testSourceId = data.source.id;
  }, 60_000);

  it('should sync the source and persist jobs in DB', async () => {
    expect(testSourceId).toBeTruthy();

    const { status, data } = await syncSource(testSourceId!);
    expect(status).toBe(200);
    expect(data.status).toBe('ok');
    expect(data.totalJobs).toBeGreaterThan(100);
  }, 60_000);

  it('should have jobs queryable via GET /api/jobs with required fields', async () => {
    expect(testSourceId).toBeTruthy();

    const { status, data } = await getJobs({
      company: TEST_SOURCE.company,
      page: 1,
      pageSize: 100,
    });

    expect(status).toBe(200);
    // Picnic has 250+ open positions
    expect(data.total).toBeGreaterThan(100);

    const jobs: Job[] = data.data;
    for (const job of jobs) {
      expect(job.title).toBeTruthy();
      expect(job.url).toBeTruthy();
      expect(job.url).toMatch(/^https:\/\/jobs\.picnic\.app\//);
    }
  }, 30_000);

  it('should have location data for all jobs', async () => {
    expect(testSourceId).toBeTruthy();

    const { data } = await getJobs({
      company: TEST_SOURCE.company,
      page: 1,
      pageSize: 100,
    });
    const jobs: Job[] = data.data;

    const withLocation = jobs.filter((j) => j.location);
    expect(withLocation.length).toBe(jobs.length);
  }, 30_000);

  it('should have department data for all jobs', async () => {
    expect(testSourceId).toBeTruthy();

    const { data } = await getJobs({
      company: TEST_SOURCE.company,
      page: 1,
      pageSize: 100,
    });
    const jobs: Job[] = data.data;

    const withDept = jobs.filter((j) => j.department);
    expect(withDept.length).toBe(jobs.length);
  }, 30_000);

  it('should re-sync without duplicating jobs', async () => {
    expect(testSourceId).toBeTruthy();

    // First sync count
    const { data: before } = await getJobs({
      company: TEST_SOURCE.company,
      page: 1,
      pageSize: 1,
    });
    const countBefore = before.total;

    // Re-sync
    const { status: syncStatus, data: syncData } = await syncSource(testSourceId!);
    expect(syncStatus).toBe(200);
    expect(syncData.status).toBe('ok');

    // Total should not have grown significantly (deduplication by URL)
    const { data: after } = await getJobs({
      company: TEST_SOURCE.company,
      page: 1,
      pageSize: 1,
    });
    const countAfter = after.total;

    // Allow up to 20 new jobs (real jobs may be posted between syncs)
    expect(countAfter).toBeLessThanOrEqual(countBefore + 20);
  }, 60_000);
});
