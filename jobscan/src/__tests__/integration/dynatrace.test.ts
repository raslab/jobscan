/**
 * Dynatrace Parser — Integration Tests
 *
 * Tests the full pipeline via the dev server REST API:
 *   1. Add the Dynatrace source → verify first scrape detects jobs
 *   2. Sync source → verify jobs are inserted into DB
 *   3. Query jobs → verify count, required fields, location, workplace_type
 *   4. Re-sync source → verify idempotent (no duplicate count explosion)
 *   5. Cleanup → delete test source
 *
 * Prerequisites:
 *   - Dev server running on localhost:3000 (`npm run dev`)
 *   - Hits real Dynatrace Coveo API during sync
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
  company: '__test_dynatrace__',
  url: 'https://careers.dynatrace.com/',
  parser: 'dynatrace',
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

describe('Dynatrace integration — full pipeline', () => {
  it('should add a Dynatrace source and detect jobs on first scrape', async () => {
    const { status, data } = await addSource(
      TEST_SOURCE.company,
      TEST_SOURCE.url,
      TEST_SOURCE.parser,
    );

    expect(status).toBe(201);
    expect(data.source).toBeDefined();
    expect(data.source.parser).toBe('dynatrace');
    expect(data.source.company).toBe(TEST_SOURCE.company);
    expect(data.firstScrape).toBeDefined();
    expect(data.firstScrape.count).toBeGreaterThan(50); // Dynatrace has 100+ roles
    expect(data.firstScrape.error).toBeUndefined();

    testSourceId = data.source.id;
  }, 60_000);

  it('should sync the source and persist jobs in DB', async () => {
    expect(testSourceId).toBeTruthy();

    const { status, data } = await syncSource(testSourceId!);
    expect(status).toBe(200);
    expect(data.status).toBe('ok');
    expect(data.totalJobs).toBeGreaterThan(50);
  }, 60_000);

  it('should have jobs queryable via GET /api/jobs with required fields', async () => {
    expect(testSourceId).toBeTruthy();

    // Server caps pageSize at 100 — use total to verify overall count
    const { status, data } = await getJobs({
      company: TEST_SOURCE.company,
      page: 1,
      pageSize: 100,
    });

    expect(status).toBe(200);
    // Total across all pages must be > 50 (Dynatrace has 100+ opened roles)
    expect(data.total).toBeGreaterThan(50);

    const jobs: Job[] = data.data;
    for (const job of jobs) {
      expect(job.title).toBeTruthy();
      expect(job.url).toBeTruthy();
      expect(job.url).toMatch(/^https:\/\/www\.dynatrace\.com\/careers\/jobs\//);
    }
  }, 30_000);

  it('should have location data for all jobs', async () => {
    const { data } = await getJobs({ company: TEST_SOURCE.company, page: 1, pageSize: 100 });
    const jobs: Job[] = data.data;

    const withLocation = jobs.filter((j) => j.location);
    expect(withLocation.length).toBe(jobs.length);
  }, 30_000);

  it('should have department data for all jobs', async () => {
    const { data } = await getJobs({ company: TEST_SOURCE.company, page: 1, pageSize: 100 });
    const jobs: Job[] = data.data;

    const withDept = jobs.filter((j) => j.department);
    expect(withDept.length).toBe(jobs.length);
  }, 30_000);

  it('should have valid workplace_type values (Remote / Hybrid / On-site)', async () => {
    const { data } = await getJobs({ company: TEST_SOURCE.company, page: 1, pageSize: 100 });
    const jobs: Job[] = data.data;

    const valid = new Set(['Remote', 'Hybrid', 'On-site']);
    for (const job of jobs) {
      if (job.workplace_type) {
        expect(valid.has(job.workplace_type)).toBe(true);
      }
    }
    const withType = jobs.filter((j) => j.workplace_type);
    expect(withType.length).toBe(jobs.length);
  }, 30_000);

  it('should have commitment (employment_type) set for all jobs', async () => {
    const { data } = await getJobs({ company: TEST_SOURCE.company, page: 1, pageSize: 100 });
    const jobs: Job[] = data.data;

    const withCommitment = jobs.filter((j) => j.commitment);
    expect(withCommitment.length).toBe(jobs.length);
  }, 30_000);

  it('re-sync should be idempotent (same total, zero new jobs)', async () => {
    expect(testSourceId).toBeTruthy();

    const first = await syncSource(testSourceId!);
    expect(first.status).toBe(200);
    const totalAfterFirst = first.data.totalJobs as number;

    const second = await syncSource(testSourceId!);
    expect(second.status).toBe(200);
    expect(second.data.newJobs).toBe(0);
    expect(second.data.totalJobs).toBe(totalAfterFirst);
  }, 60_000);
});
