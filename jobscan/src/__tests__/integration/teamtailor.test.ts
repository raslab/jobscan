/**
 * Teamtailor Parser — Integration Tests
 *
 * Tests the full pipeline via the dev server REST API:
 *   1. Add a teamtailor source (custom domain) → verify first scrape
 *   2. Query parsed jobs → verify count and fields
 *   3. Fetch individual job → verify detail fields
 *   4. Re-sync source → verify idempotent behavior
 *   5. Test the "root URL with no jobs" scenario (doccla)
 *   6. Cleanup → delete test sources
 *
 * Prerequisites:
 *   - Dev server running on localhost:3000 (`npm run dev`)
 *   - Uses real Teamtailor career sites (hits live URLs during sync)
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

// PayFit — custom domain Teamtailor site with ~10-15 jobs
const TEST_PAYFIT = {
  company: '__test_payfit__',
  url: 'https://careers.payfit.com/jobs',
  parser: 'teamtailor',
};

// Doccla — custom domain where root URL has no jobs, /jobs has them
const TEST_DOCCLA = {
  company: '__test_doccla__',
  url: 'https://careers.doccla.com/jobs',
  parser: 'teamtailor',
};

// Track source IDs for cleanup
let payFitSourceId: number | null = null;
let docclaSourceId: number | null = null;

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
  for (const [label, id] of [['payfit', payFitSourceId], ['doccla', docclaSourceId]] as const) {
    if (id) {
      try {
        await deleteSource(id);
        console.log(`[cleanup] Deleted test source ${label} (${id})`);
      } catch (err) {
        console.warn(`[cleanup] Failed to delete test source ${label} (${id}):`, err);
      }
    }
  }
});

describe('Teamtailor integration — PayFit (custom domain)', () => {
  it('should add a teamtailor source and get initial job count', async () => {
    const { status, data } = await addSource(
      TEST_PAYFIT.company,
      TEST_PAYFIT.url,
      TEST_PAYFIT.parser,
    );

    expect(status).toBe(201);
    expect(data.source).toBeDefined();
    expect(data.source.parser).toBe('teamtailor');
    expect(data.source.company).toBe(TEST_PAYFIT.company);
    expect(data.firstScrape).toBeDefined();
    expect(data.firstScrape.count).toBeGreaterThan(0);
    expect(data.firstScrape.error).toBeUndefined();

    payFitSourceId = data.source.id;
  });

  it('should sync the source to persist jobs in DB', async () => {
    expect(payFitSourceId).toBeTruthy();

    const { status, data } = await syncSource(payFitSourceId!);
    expect(status).toBe(200);
    expect(data.status).toBe('ok');
    expect(data.totalJobs).toBeGreaterThan(0);
  });

  it('should have scraped jobs queryable via GET /api/jobs', async () => {
    expect(payFitSourceId).toBeTruthy();

    const { status, data } = await getJobs({
      company: TEST_PAYFIT.company,
      page: 1,
      pageSize: 100,
    });

    expect(status).toBe(200);
    expect(data.data.length).toBeGreaterThan(0);
    expect(data.total).toBeGreaterThan(0);

    for (const job of data.data) {
      expect(job.title).toBeTruthy();
      expect(job.url).toBeTruthy();
      expect(job.company).toBe(TEST_PAYFIT.company);
      expect(job.source_id).toBe(payFitSourceId);
    }
  });

  it('job URLs should point to careers.payfit.com', async () => {
    const { data } = await getJobs({
      company: TEST_PAYFIT.company,
      page: 1,
      pageSize: 10,
    });

    for (const job of data.data) {
      expect(job.url).toContain('careers.payfit.com');
    }
  });

  it('most jobs should have location and department (from RSS)', async () => {
    const { data } = await getJobs({
      company: TEST_PAYFIT.company,
      page: 1,
      pageSize: 100,
    });

    const withLocation = data.data.filter(j => j.location);
    const withDepartment = data.data.filter(j => j.department);

    expect(withLocation.length).toBeGreaterThan(data.data.length * 0.5);
    expect(withDepartment.length).toBeGreaterThan(0);
  });

  it('should fetch individual job with description (RSS provides full content)', async () => {
    const { data: jobList } = await getJobs({
      company: TEST_PAYFIT.company,
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
    expect(job.description).toBeTruthy();
  });

  it('should re-sync source idempotently', async () => {
    expect(payFitSourceId).toBeTruthy();

    const { status, data } = await syncSource(payFitSourceId!);
    expect(status).toBe(200);
    expect(data.status).toBe('ok');
    expect(data.newJobs).toBe(0);
  });

  it('should clean up PayFit test source', async () => {
    expect(payFitSourceId).toBeTruthy();

    const { status } = await deleteSource(payFitSourceId!);
    expect(status).toBe(204);
    payFitSourceId = null;
  });
});

describe('Teamtailor integration — Doccla (custom domain, /jobs path)', () => {
  it('should add Doccla source with /jobs URL and get jobs', async () => {
    const { status, data } = await addSource(
      TEST_DOCCLA.company,
      TEST_DOCCLA.url,
      TEST_DOCCLA.parser,
    );

    expect(status).toBe(201);
    expect(data.source).toBeDefined();
    expect(data.source.parser).toBe('teamtailor');
    expect(data.firstScrape.count).toBeGreaterThan(0);

    docclaSourceId = data.source.id;
  });

  it('should sync and persist Doccla jobs', async () => {
    expect(docclaSourceId).toBeTruthy();

    const { status, data } = await syncSource(docclaSourceId!);
    expect(status).toBe(200);
    expect(data.status).toBe('ok');
    expect(data.totalJobs).toBeGreaterThan(0);
  });

  it('Doccla jobs should have correct URLs', async () => {
    const { data } = await getJobs({
      company: TEST_DOCCLA.company,
      page: 1,
      pageSize: 50,
    });

    expect(data.data.length).toBeGreaterThan(0);
    for (const job of data.data) {
      expect(job.url).toContain('careers.doccla.com');
    }
  });

  it('should clean up Doccla test source', async () => {
    expect(docclaSourceId).toBeTruthy();

    const { status } = await deleteSource(docclaSourceId!);
    expect(status).toBe(204);
    docclaSourceId = null;
  });
});
