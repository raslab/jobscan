/**
 * Unit tests for server-enforced per-source sync deadline and
 * server-side new-job counting (issue #1).
 *
 * Lives under __tests__/parsers so it is picked up by `npm run test:unit`.
 */
import * as db from '../../db/index';
import { scrapeSource, scrapeJobDetail } from '../../scraper';
import { syncOneSource, runSync, runSyncOneSource } from '../../sync';

jest.mock('../../db/index', () => ({
  updateSourceSync: jest.fn(),
  insertHtmlBackup: jest.fn(),
  getExistingJobUrls: jest.fn(),
  insertJobListingRow: jest.fn(),
  updateJobDetails: jest.fn(),
  getJobsWithEmptyDescription: jest.fn(),
  countJobsBySyncId: jest.fn(),
  startSyncLog: jest.fn(),
  completeSyncLog: jest.fn(),
  getSourceById: jest.fn(),
  getSourcesForSync: jest.fn(),
}));

jest.mock('../../scraper', () => {
  class RateLimitError extends Error {}
  return {
    RateLimitError,
    scrapeSource: jest.fn(),
    scrapeJobDetail: jest.fn(),
  };
});

jest.mock('../../fetch-utils', () => ({
  randomDelay: jest.fn(async () => undefined),
}));

const mockedDb = db as jest.Mocked<typeof db>;
const mockedScrapeSource = scrapeSource as jest.MockedFunction<typeof scrapeSource>;
const mockedScrapeJobDetail = scrapeJobDetail as jest.MockedFunction<typeof scrapeJobDetail>;

const SOURCE = { id: 1, company: 'Acme', url: 'https://acme.example/jobs', parser: 'generic', last_count: null };

function makeJobs(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    title: `Job ${i}`,
    url: `https://acme.example/jobs/${i}`,
  }));
}

beforeEach(() => {
  jest.resetAllMocks();
  jest.useFakeTimers({ now: new Date('2026-01-01T00:00:00Z') });
  mockedDb.insertHtmlBackup.mockResolvedValue(undefined);
  mockedDb.updateSourceSync.mockResolvedValue(undefined);
  mockedDb.getExistingJobUrls.mockResolvedValue(new Set());
  mockedDb.insertJobListingRow.mockImplementation(async (job) => ({
    id: 1000 + (job as { url: string }).url.length,
    inserted: true,
  }));
  mockedDb.updateJobDetails.mockResolvedValue(undefined);
  mockedDb.getJobsWithEmptyDescription.mockResolvedValue([]);
});

afterEach(() => {
  jest.useRealTimers();
});

describe('syncOneSource server deadline', () => {
  it('stops detail fetches and writes once the deadline expires and records timed-out', async () => {
    const jobs = makeJobs(20);
    mockedScrapeSource.mockResolvedValue({ jobs, html: null, error: null } as never);

    // Each detail fetch burns 2s of (fake) wall-clock. With a 3s deadline and
    // concurrency 3 (generic parser), only the first batch may start.
    mockedScrapeJobDetail.mockImplementation(async (job) => {
      jest.advanceTimersByTime(2000);
      return job;
    });

    const result = await syncOneSource(SOURCE, 7, 3000);

    expect(result.status).toBe('timed-out');
    // All 20 listing rows were committed before the detail pass (preserved).
    expect(mockedDb.insertJobListingRow).toHaveBeenCalledTimes(20);
    // No more than the initial concurrent batch started detail fetches.
    expect(mockedScrapeJobDetail.mock.calls.length).toBeLessThanOrEqual(3);
    // No detail writes happened after the deadline expired.
    expect(mockedDb.updateJobDetails.mock.calls.length).toBeLessThanOrEqual(
      mockedScrapeJobDetail.mock.calls.length,
    );
    // Source recorded as timed-out with the jobs count, not 'ok'.
    expect(mockedDb.updateSourceSync).toHaveBeenCalledWith(1, 'timed-out', 20);
    // Backfill pass skipped entirely on timeout.
    expect(mockedDb.getJobsWithEmptyDescription).not.toHaveBeenCalled();
  });

  it('completes normally with status ok when the deadline has not expired', async () => {
    const jobs = makeJobs(4);
    mockedScrapeSource.mockResolvedValue({ jobs, html: null, error: null } as never);
    mockedScrapeJobDetail.mockImplementation(async (job) => job);

    const result = await syncOneSource(SOURCE, 7, 60_000);

    expect(result.status).toBe('ok');
    expect(result.newJobs).toBe(4);
    expect(mockedScrapeJobDetail).toHaveBeenCalledTimes(4);
    expect(mockedDb.updateSourceSync).toHaveBeenCalledWith(1, 'ok', 4);
  });
});

describe('server-side new-job counts', () => {
  it('runSync completes the sync log with the DB count for the sync, not the summed per-source counts', async () => {
    mockedDb.getSourcesForSync.mockResolvedValue([SOURCE, { ...SOURCE, id: 2, company: 'Other' }] as never);
    mockedDb.startSyncLog.mockResolvedValue(42);
    // Both sources report zero-jobs (0 newJobs each) but the DB has rows for the sync.
    mockedScrapeSource.mockResolvedValue({ jobs: [], html: null, error: null } as never);
    mockedDb.countJobsBySyncId.mockResolvedValue(404461);

    const summary = await runSync();

    expect(mockedDb.countJobsBySyncId).toHaveBeenCalledWith(42);
    expect(mockedDb.completeSyncLog).toHaveBeenCalledWith(42, 2, 404461);
    expect(summary.newJobsTotal).toBe(404461);
  });

  it('runSyncOneSource (own session) completes with the DB count for the sync', async () => {
    mockedDb.getSourceById.mockResolvedValue(SOURCE as never);
    mockedDb.startSyncLog.mockResolvedValue(9);
    mockedScrapeSource.mockResolvedValue({ jobs: makeJobs(3), html: null, error: null } as never);
    mockedScrapeJobDetail.mockImplementation(async (job) => job);
    mockedDb.countJobsBySyncId.mockResolvedValue(3);

    const result = await runSyncOneSource(1);

    expect(result.syncId).toBe(9);
    expect(mockedDb.completeSyncLog).toHaveBeenCalledWith(9, 1, 3);
  });
});
