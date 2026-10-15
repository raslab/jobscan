/**
 * Unit tests for the server-enforced per-source sync deadline in src/sync.ts.
 *
 * Verifies that when the 5-minute server deadline expires:
 *   - no further detail fetches or job writes are started,
 *   - already-inserted listing rows are preserved,
 *   - the source is recorded with status 'timed-out' (updateSourceSync),
 *   - the description-backfill pass is skipped,
 * and that runSync computes the session new-job count from the DB
 * (countJobsBySyncId) instead of summing per-source responses.
 */

jest.mock('../../db/index', () => ({
  insertHtmlBackup: jest.fn(),
  getExistingJobUrls: jest.fn(),
  insertJobListingRow: jest.fn(),
  updateJobDetails: jest.fn(),
  updateSourceSync: jest.fn(),
  getJobsWithEmptyDescription: jest.fn(),
  getSourcesForSync: jest.fn(),
  startSyncLog: jest.fn(),
  completeSyncLog: jest.fn(),
  countJobsBySyncId: jest.fn(),
  getSourceById: jest.fn(),
}));

jest.mock('../../scraper', () => {
  const actual = jest.requireActual('../../scraper');
  return {
    ...actual,
    scrapeSource: jest.fn(),
    scrapeJobDetail: jest.fn(),
  };
});

jest.mock('../../fetch-utils', () => ({
  randomDelay: jest.fn(async () => undefined),
}));

import * as db from '../../db/index';
import { scrapeSource, scrapeJobDetail } from '../../scraper';
import { syncOneSource, runSync, SOURCE_SYNC_DEADLINE_MS } from '../../sync';

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
  jest.useFakeTimers();
  mockedDb.insertHtmlBackup.mockResolvedValue(undefined);
  mockedDb.getExistingJobUrls.mockResolvedValue(new Set<string>());
  mockedDb.insertJobListingRow.mockImplementation(async (job) => ({ id: 100, inserted: true }));
  mockedDb.updateJobDetails.mockResolvedValue(undefined);
  mockedDb.updateSourceSync.mockResolvedValue(undefined);
  mockedDb.getJobsWithEmptyDescription.mockResolvedValue([]);
});

afterEach(() => {
  jest.useRealTimers();
});

describe('syncOneSource server deadline', () => {
  it('stops detail fetches once the deadline expires and records the source as timed-out', async () => {
    const jobs = makeJobs(5);
    mockedScrapeSource.mockResolvedValue({ jobs, html: '' });

    // The first detail fetch blows past the server deadline; every later
    // fetch/write must be skipped.
    mockedScrapeJobDetail.mockImplementation(async (job) => {
      jest.advanceTimersByTime(SOURCE_SYNC_DEADLINE_MS + 1);
      return { ...job, description: 'enriched' };
    });

    const result = await syncOneSource(SOURCE, 7);

    // All 5 listing rows were committed before the deadline → preserved.
    expect(mockedDb.insertJobListingRow).toHaveBeenCalledTimes(5);
    // Detail fetching stopped early: far fewer than the 5 pending detail tasks ran.
    expect(mockedScrapeJobDetail.mock.calls.length).toBeGreaterThan(0);
    expect(mockedScrapeJobDetail.mock.calls.length).toBeLessThan(5);
    // Source recorded as timed-out with the jobs count.
    expect(mockedDb.updateSourceSync).toHaveBeenCalledWith(1, 'timed-out', 5);
    // Backfill pass skipped entirely.
    expect(mockedDb.getJobsWithEmptyDescription).not.toHaveBeenCalled();
    // Client-visible status is 'timed-out'.
    expect(result.status).toBe('timed-out');
    expect(result.newJobs).toBe(5);
  });

  it('skips listing writes and detail fetches entirely when the deadline already expired', async () => {
    const jobs = makeJobs(4);
    // Listing scrape itself consumes the whole budget.
    mockedScrapeSource.mockImplementation(async () => {
      jest.advanceTimersByTime(SOURCE_SYNC_DEADLINE_MS + 1);
      return { jobs, html: '' };
    });

    const result = await syncOneSource(SOURCE, 8);

    expect(mockedDb.insertJobListingRow).not.toHaveBeenCalled();
    expect(mockedScrapeJobDetail).not.toHaveBeenCalled();
    expect(mockedDb.updateSourceSync).toHaveBeenCalledWith(1, 'timed-out', 4);
    expect(result.status).toBe('timed-out');
    expect(result.newJobs).toBe(0);
  });

  it('completes normally (status ok) when the deadline is not exceeded', async () => {
    const jobs = makeJobs(3);
    mockedScrapeSource.mockResolvedValue({ jobs, html: '' });
    mockedScrapeJobDetail.mockImplementation(async (job) => ({ ...job, description: 'd' }));

    const result = await syncOneSource(SOURCE, 9);

    expect(mockedScrapeJobDetail).toHaveBeenCalledTimes(3);
    expect(mockedDb.updateSourceSync).toHaveBeenCalledWith(1, 'ok', 3);
    expect(result.status).toBe('ok');
    expect(result.newJobs).toBe(3);
  });
});

describe('runSync server-side new-job count', () => {
  it('stores the DB count for the sync instead of summing per-source newJobs', async () => {
    jest.useRealTimers();
    const src = (id: number, company: string) => ({
      id, company, url: `https://${company}.example`, parser: 'generic',
      added_at: '2026-01-01T00:00:00.000Z', last_synced: null, last_status: null,
      last_error: null, last_count: null,
    });
    mockedDb.getSourcesForSync.mockResolvedValue([src(1, 'a'), src(2, 'b')]);
    mockedDb.startSyncLog.mockResolvedValue(11);
    // Per-source responses undercount (e.g. one source aborted); the DB says 42.
    mockedScrapeSource.mockImplementation(async (src) => ({ jobs: makeJobs(src.id === 1 ? 1 : 1), html: '' }));
    mockedScrapeJobDetail.mockImplementation(async (job) => job);
    mockedDb.countJobsBySyncId.mockResolvedValue(42);
    mockedDb.completeSyncLog.mockResolvedValue(undefined);

    const summary = await runSync();

    expect(mockedDb.countJobsBySyncId).toHaveBeenCalledWith(11);
    expect(mockedDb.completeSyncLog).toHaveBeenCalledWith(11, 2, 42);
    expect(summary.newJobsTotal).toBe(42);
  });
});
