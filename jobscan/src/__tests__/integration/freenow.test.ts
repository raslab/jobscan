/**
 * FREE NOW Parser — Integration Tests
 *
 * Tests the full pipeline via the dev server REST API:
 *   1. Add the FREE NOW source → verify first scrape detects jobs
 *   2. Sync source → verify jobs are inserted into DB
 *   3. Query jobs → verify count, required fields, location, department
 *   4. Verify description content is populated (Greenhouse API with content=true)
 *   5. Re-sync source → verify idempotent (no duplicate count explosion)
 *   6. Cleanup → delete test source
 *
 * Prerequisites:
 *   - Dev server running on localhost:3000 (`npm run dev`)
 *   - Hits the real Greenhouse API for freenow board during sync
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
  company: '__test_freenow__',
  url: 'https://www.free-now.com/career/jobs/',
  parser: 'freenow',
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

describe('FREE NOW integration — full pipeline', () => {
  it('should add a FREE NOW source and detect jobs on first scrape', async () => {
    const { status, data } = await addSource(
      TEST_SOURCE.company,
      TEST_SOURCE.url,
      TEST_SOURCE.parser,
    );

    expect(status).toBe(201);
    expect(data.source).toBeDefined();
    expect(data.source.parser).toBe('freenow');
    expect(data.source.company).toBe(TEST_SOURCE.company);
    expect(data.firstScrape).toBeDefined();
    // FREE NOW board has ~60-70 open positions
    expect(data.firstScrape.count).toBeGreaterThan(30);
    expect(data.firstScrape.error).toBeUndefined();

    testSourceId = data.source.id;
  }, 60_000);

  it('should sync the source and persist jobs in DB', async () => {
    expect(testSourceId).toBeTruthy();

    const { status, data } = await syncSource(testSourceId!);
    expect(status).toBe(200);
    expect(data.status).toBe('ok');
    expect(data.totalJobs).toBeGreaterThan(30);
  }, 60_000);

  it('should have jobs queryable via GET /api/jobs with required fields', async () => {
    expect(testSourceId).toBeTruthy();

    const { status, data } = await getJobs({
      company: TEST_SOURCE.company,
      page: 1,
      pageSize: 100,
    });

    expect(status).toBe(200);
    expect(data.total).toBeGreaterThan(30);

    const jobs: Job[] = data.data;
    for (const job of jobs) {
      expect(job.title).toBeTruthy();
      expect(job.url).toBeTruthy();
      // Job URLs should point to Greenhouse board for freenow
      expect(job.url).toMatch(/^https:\/\/job-boards\.greenhouse\.io\/freenow\/jobs\/\d+/);
    }
  }, 30_000);

  it('should have location data for most jobs', async () => {
    expect(testSourceId).toBeTruthy();

    const { data } = await getJobs({
      company: TEST_SOURCE.company,
      page: 1,
      pageSize: 100,
    });
    const jobs: Job[] = data.data;

    const withLocation = jobs.filter((j) => j.location);
    expect(withLocation.length).toBeGreaterThan(jobs.length * 0.8);
  }, 30_000);

  it('should have department data for most jobs', async () => {
    expect(testSourceId).toBeTruthy();

    const { data } = await getJobs({
      company: TEST_SOURCE.company,
      page: 1,
      pageSize: 100,
    });
    const jobs: Job[] = data.data;

    const withDept = jobs.filter((j) => j.department);
    expect(withDept.length).toBeGreaterThan(jobs.length * 0.8);
  }, 30_000);

  it('should have description content (Greenhouse API with content=true)', async () => {
    expect(testSourceId).toBeTruthy();

    const { data } = await getJobs({
      company: TEST_SOURCE.company,
      page: 1,
      pageSize: 100,
    });
    const jobs = data.data as unknown as Array<Record<string, unknown>>;

    // The paginated endpoint returns description_short (truncated preview).
    // A non-null description_short means description was persisted by the API fetch.
    const withDesc = jobs.filter((j) => j['description_short']);
    expect(withDesc.length).toBeGreaterThan(jobs.length * 0.8);

    // Previews should be clean Markdown (no HTML entities)
    for (const job of withDesc) {
      expect(job['description_short'] as string).not.toMatch(/&lt;|&gt;|&amp;/);
    }
  }, 30_000);

  it('should re-sync without duplicating jobs', async () => {
    expect(testSourceId).toBeTruthy();

    const { data: before } = await getJobs({
      company: TEST_SOURCE.company,
      page: 1,
      pageSize: 1,
    });
    const countBefore = before.total;

    const { status: syncStatus, data: syncData } = await syncSource(testSourceId!);
    expect(syncStatus).toBe(200);
    expect(syncData.status).toBe('ok');

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
