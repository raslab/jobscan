/**
 * NEWWORK Software Careers Parser — Integration Tests
 *
 * Tests the full pipeline via the dev server REST API:
 *   1. Add the NEWWORK source → verify first scrape completes (zero-jobs is OK)
 *   2. Sync source → verify sync runs without error
 *   3. Verify proper zero-jobs status when board is empty
 *   4. Cleanup → delete test source
 *
 * Prerequisites:
 *   - Dev server running on localhost:3000 (`npm run dev`)
 *   - Hits the real www.newwork.com WordPress REST API during sync
 *
 * Notes:
 *   - www.newwork.com currently has 0 published jobs (custom WordPress CPT)
 *   - The source is expected to sync with status 'zero-jobs' or 'ok'
 *   - When NEWWORK publishes jobs, the sync will return 'ok' with job counts
 */

import {
  addSource,
  deleteSource,
  syncSource,
  isServerRunning,
} from '../helpers/api-client';

const TEST_SOURCE = {
  company: '__test_newwork__',
  url: 'https://www.newwork.com/careers',
  parser: 'newwork',
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

describe('NEWWORK integration — full pipeline', () => {
  it('should add a NEWWORK source without crashing', async () => {
    const { status, data } = await addSource(
      TEST_SOURCE.company,
      TEST_SOURCE.url,
      TEST_SOURCE.parser,
    );

    expect(status).toBe(201);
    expect(data.source).toBeDefined();
    expect(data.source.parser).toBe('newwork');
    expect(data.source.company).toBe(TEST_SOURCE.company);
    expect(data.firstScrape).toBeDefined();
    // No crash means the API call succeeded; count may be 0 (no live jobs yet)
    expect(data.firstScrape.error).toBeUndefined();

    testSourceId = data.source.id;
  }, 30_000);

  it('should sync the source and return ok or zero-jobs status', async () => {
    expect(testSourceId).toBeTruthy();

    const { status, data } = await syncSource(testSourceId!);
    expect(status).toBe(200);
    // Either 'ok' (jobs found) or 'zero-jobs' (board is empty) are valid
    expect(['ok', 'zero-jobs']).toContain(data.status);
    // No error message on a clean sync
    expect(data.error).toBeUndefined();
  }, 30_000);
});
