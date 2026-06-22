/**
 * SmartRecruiters Parser — Integration Tests
 *
 * Tests the full pipeline via the dev server REST API:
 *   1. Add a smartrecruiters source → verify first scrape
 *   2. Sync source → persist jobs in DB
 *   3. Query parsed jobs → verify count and fields
 *   4. Fetch individual job → verify detail fields
 *   5. Re-sync → verify idempotent behavior
 *   6. Negative test: root URL should fail gracefully
 *   7. Cleanup → delete test sources
 *
 * Prerequisites:
 *   - Dev server running on localhost:3000 (`npm run dev`)
 *   - Uses real SmartRecruiters API (hits live URLs during sync)
 */

import {
  addSource,
  deleteSource,
  syncSource,
  getJobs,
  getJob,
  isServerRunning,
} from '../helpers/api-client';

// PolygonTechnology: small board (~4 jobs) — fast to sync
const TEST_BOARD = {
  company: '__test_polygon_sr__',
  url: 'https://careers.smartrecruiters.com/PolygonTechnology',
  parser: 'smartrecruiters',
};

// Root URL should not be accepted as a valid source
const ROOT_URL_BOARD = {
  company: '__test_sr_root__',
  url: 'https://jobs.smartrecruiters.com/',
  parser: 'smartrecruiters',
};

// Track source IDs for cleanup
let testSourceId: number | null = null;
let rootSourceId: number | null = null;

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
  // Cleanup: delete test sources to avoid polluting dev DB
  for (const id of [testSourceId, rootSourceId]) {
    if (id) {
      try {
        await deleteSource(id);
        console.log(`[cleanup] Deleted test source ${id}`);
      } catch (err) {
        console.warn(`[cleanup] Failed to delete test source ${id}:`, err);
      }
    }
  }
});

// ─── Valid company board: full pipeline ───────────────────────────────────────

describe('SmartRecruiters integration — PolygonTechnology', () => {
  it('should add a smartrecruiters source and get initial job count', async () => {
    const { status, data } = await addSource(
      TEST_BOARD.company,
      TEST_BOARD.url,
      TEST_BOARD.parser,
    );

    expect(status).toBe(201);
    expect(data.source).toBeDefined();
    expect(data.source.parser).toBe('smartrecruiters');
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

    for (const job of data.data) {
      expect(job.title).toBeTruthy();
      expect(job.url).toBeTruthy();
      expect(job.company).toBe(TEST_BOARD.company);
      expect(job.source_id).toBe(testSourceId);
    }
  });

  it('job URLs should point to smartrecruiters.com', async () => {
    const { data } = await getJobs({
      company: TEST_BOARD.company,
      page: 1,
      pageSize: 10,
    });

    for (const job of data.data) {
      expect(job.url).toContain('smartrecruiters.com');
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

    testSourceId = null;
  });
});

// ─── Root URL: should fail gracefully ─────────────────────────────────────────

describe('SmartRecruiters integration — root URL rejection', () => {
  it('should fail or return 0 jobs when adding root smartrecruiters.com URL', async () => {
    const { status, data } = await addSource(
      ROOT_URL_BOARD.company,
      ROOT_URL_BOARD.url,
      ROOT_URL_BOARD.parser,
    );

    if (status === 201) {
      // Source was created, but first scrape should have 0 jobs or an error
      rootSourceId = data.source.id;
      expect(
        data.firstScrape.count === 0 || data.firstScrape.error !== undefined,
      ).toBe(true);
    } else {
      // Server rejected the source outright — also acceptable
      expect(status).toBeGreaterThanOrEqual(400);
    }
  });

  it('should clean up root URL test source if created', async () => {
    if (rootSourceId) {
      const { status } = await deleteSource(rootSourceId);
      expect(status).toBe(204);
      rootSourceId = null;
    }
  });
});
