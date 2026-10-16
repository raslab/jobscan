/**
 * Unit tests for the server-enforced per-source sync deadline and the
 * needs_backfill description-backfill pass in src/sync.ts.
 *
 * Deadline behaviour verified here:
 *   - no further detail fetches or job writes are started once the 5-minute
 *     server deadline expires,
 *   - already-inserted listing rows are preserved,
 *   - the source is recorded with status 'timed-out' (updateSourceSync),
 *   - the backfill pass is skipped entirely when the deadline already expired,
 *     and is itself deadline-bounded via the shared shouldStop closure
 *     (review comment rc:4283583004),
 * and that runSync computes the session new-job count from the DB
 * (countJobsBySyncId) instead of summing per-source responses.
 *
 * Backfill behaviour verified here (issue #2, owner comments 6188617637 and
 * 6195486910):
 *   - the backfill pass runs on the no-new-jobs path (no early return),
 *   - backfill detail fetches are issued BEFORE new-job listing commit and
 *     detail enrichment,
 *   - the needs_backfill flag is cleared on backfill success (via
 *     updateJobDetails) and on a definitive 4xx (JobGoneError →
 *     setJobNeedsBackfill(id, false)), and kept raised on 5xx/transient
 *     failures (setJobNeedsBackfill not called).
 */

jest.mock('../../db/index', () => ({
  insertHtmlBackup: jest.fn(),
  getExistingJobUrls: jest.fn(),
  insertJobListingRow: jest.fn(),
  updateJobDetails: jest.fn(),
  updateSourceSync: jest.fn(),
  getJobsWithEmptyDescription: jest.fn(),
  setJobNeedsBackfill: jest.fn(),
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
import { scrapeSource, scrapeJobDetail, JobGoneError, RateLimitError } from '../../scraper';
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

/** DB rows returned by getJobsWithEmptyDescription (needs_backfill candidates). */
function makeBackfillRows(n: number, idOffset = 500) {
  return Array.from({ length: n }, (_, i) => ({
    id: idOffset + i,
    url: `https://acme.example/jobs/old-${i}`,
    title: `Old Job ${i}`,
    location: null,
    department: null,
    workplace_type: null,
    commitment: null,
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
  mockedDb.setJobNeedsBackfill.mockResolvedValue(undefined);
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
    // The backfill candidate query now runs BEFORE enrichment (the deadline had
    // not expired when it ran); it returned no candidates here, so no backfill
    // fetches were issued.
    expect(mockedDb.getJobsWithEmptyDescription).toHaveBeenCalledWith(1);
    // Client-visible status is 'timed-out'.
    expect(result.status).toBe('timed-out');
    expect(result.newJobs).toBe(5);
  });

  it('skips listing writes, backfill and detail fetches entirely when the deadline already expired', async () => {
    const jobs = makeJobs(4);
    // Listing scrape itself consumes the whole budget.
    mockedScrapeSource.mockImplementation(async () => {
      jest.advanceTimersByTime(SOURCE_SYNC_DEADLINE_MS + 1);
      return { jobs, html: '' };
    });
    mockedDb.getJobsWithEmptyDescription.mockResolvedValue(makeBackfillRows(3));

    const result = await syncOneSource(SOURCE, 8);

    expect(mockedDb.insertJobListingRow).not.toHaveBeenCalled();
    expect(mockedScrapeJobDetail).not.toHaveBeenCalled();
    // Backfill pass skipped entirely when the deadline already expired.
    expect(mockedDb.getJobsWithEmptyDescription).not.toHaveBeenCalled();
    expect(mockedDb.updateSourceSync).toHaveBeenCalledWith(1, 'timed-out', 4);
    expect(result.status).toBe('timed-out');
    expect(result.newJobs).toBe(0);
  });

  it('stops the backfill pass at the deadline via shouldStop and records timed-out', async () => {
    const jobs = makeJobs(2);
    mockedScrapeSource.mockResolvedValue({ jobs, html: '' });
    mockedDb.getJobsWithEmptyDescription.mockResolvedValue(makeBackfillRows(10));

    // The first backfill fetch blows past the deadline → remaining backfill
    // tasks must not start, and the new-job listing/enrichment must be skipped.
    mockedScrapeJobDetail.mockImplementation(async (job) => {
      jest.advanceTimersByTime(SOURCE_SYNC_DEADLINE_MS + 1);
      return { ...job, description: 'backfilled' };
    });

    const result = await syncOneSource(SOURCE, 12);

    expect(mockedScrapeJobDetail.mock.calls.length).toBeGreaterThan(0);
    expect(mockedScrapeJobDetail.mock.calls.length).toBeLessThan(10);
    // Deadline hit during backfill → no listing rows committed, timed-out.
    expect(mockedDb.insertJobListingRow).not.toHaveBeenCalled();
    expect(mockedDb.updateSourceSync).toHaveBeenCalledWith(1, 'timed-out', 2);
    expect(result.status).toBe('timed-out');
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

describe('syncOneSource description backfill (issue #2)', () => {
  it('runs the backfill pass when every scraped URL already exists (no early return)', async () => {
    const jobs = makeJobs(3);
    mockedScrapeSource.mockResolvedValue({ jobs, html: '' });
    // Every URL is already stored → unseenJobs is empty.
    mockedDb.getExistingJobUrls.mockResolvedValue(new Set(jobs.map((j) => j.url)));
    const rows = makeBackfillRows(2);
    mockedDb.getJobsWithEmptyDescription.mockResolvedValue(rows);
    mockedScrapeJobDetail.mockImplementation(async (job) => ({ ...job, description: 'backfilled' }));

    const result = await syncOneSource(SOURCE, 20);

    // Backfill ran and updated existing rows in place…
    expect(mockedDb.getJobsWithEmptyDescription).toHaveBeenCalledWith(1);
    expect(mockedScrapeJobDetail).toHaveBeenCalledTimes(2);
    expect(mockedDb.updateJobDetails).toHaveBeenCalledTimes(2);
    expect(mockedDb.updateJobDetails).toHaveBeenCalledWith(500, expect.objectContaining({ description: 'backfilled' }));
    expect(mockedDb.updateJobDetails).toHaveBeenCalledWith(501, expect.objectContaining({ description: 'backfilled' }));
    // …with no inserts (no duplicates) and the source recorded 'ok'.
    expect(mockedDb.insertJobListingRow).not.toHaveBeenCalled();
    expect(mockedDb.updateSourceSync).toHaveBeenCalledWith(1, 'ok', 3);
    expect(result.status).toBe('ok');
    expect(result.newJobs).toBe(0);
  });

  it('issues backfill detail fetches before new-job listing commit and enrichment', async () => {
    const jobs = makeJobs(2);
    mockedScrapeSource.mockResolvedValue({ jobs, html: '' });
    const rows = makeBackfillRows(2);
    mockedDb.getJobsWithEmptyDescription.mockResolvedValue(rows);

    const order: string[] = [];
    mockedDb.insertJobListingRow.mockImplementation(async (job) => {
      order.push(`insert:${job.url}`);
      return { id: 100, inserted: true };
    });
    mockedScrapeJobDetail.mockImplementation(async (job) => {
      order.push(`fetch:${job.url}`);
      return { ...job, description: 'd' };
    });

    await syncOneSource(SOURCE, 21);

    const fetchUrls = mockedScrapeJobDetail.mock.calls.map((c) => c[0].url);
    const backfillFetchIdx = fetchUrls.findIndex((u) => u.includes('/old-'));
    const newFetchIdx = fetchUrls.findIndex((u) => !u.includes('/old-'));
    expect(backfillFetchIdx).toBeGreaterThanOrEqual(0);
    expect(newFetchIdx).toBeGreaterThanOrEqual(0);
    // All backfill fetches precede every new-job fetch…
    expect(backfillFetchIdx).toBeLessThan(newFetchIdx);
    // …and precede the new-job listing commit.
    const firstInsertIdx = order.findIndex((e) => e.startsWith('insert:'));
    const lastBackfillFetchIdx = order.map((e) => e.startsWith('fetch:') && e.includes('/old-')).lastIndexOf(true);
    expect(lastBackfillFetchIdx).toBeGreaterThanOrEqual(0);
    expect(lastBackfillFetchIdx).toBeLessThan(firstInsertIdx);
  });

  it('clears the flag on backfill success (updateJobDetails writes a non-empty description)', async () => {
    const jobs = makeJobs(1);
    mockedScrapeSource.mockResolvedValue({ jobs, html: '' });
    mockedDb.getJobsWithEmptyDescription.mockResolvedValue(makeBackfillRows(1));
    mockedScrapeJobDetail.mockImplementation(async (job) => ({ ...job, description: 'now filled' }));

    await syncOneSource(SOURCE, 22);

    // Success path: the row is repaired via updateJobDetails (which clears
    // needs_backfill in the DB layer); no explicit clear is needed.
    expect(mockedDb.updateJobDetails).toHaveBeenCalledWith(500, expect.objectContaining({ description: 'now filled' }));
    expect(mockedDb.setJobNeedsBackfill).not.toHaveBeenCalled();
  });

  it('clears the flag when the detail fetch reports the job is gone (4xx)', async () => {
    const jobs = makeJobs(1);
    mockedScrapeSource.mockResolvedValue({ jobs, html: '' });
    mockedDb.getJobsWithEmptyDescription.mockResolvedValue(makeBackfillRows(1));
    mockedScrapeJobDetail.mockImplementation(async (job) => {
      throw new JobGoneError(job.url, 'HTTP 404 Not Found');
    });

    const result = await syncOneSource(SOURCE, 23);

    // Dead record retired permanently from the backlog.
    expect(mockedDb.setJobNeedsBackfill).toHaveBeenCalledWith(500, false);
    expect(mockedDb.updateJobDetails).not.toHaveBeenCalled();
    expect(result.status).toBe('ok');
  });

  it('keeps the flag raised on 5xx/transient failures so the row is retried next sync', async () => {
    const jobs = makeJobs(1);
    mockedScrapeSource.mockResolvedValue({ jobs, html: '' });
    mockedDb.getJobsWithEmptyDescription.mockResolvedValue(makeBackfillRows(1));
    mockedScrapeJobDetail.mockImplementation(async (job) => {
      throw new Error('HTTP 503 Service Unavailable');
    });

    // A transient (non-RateLimit, non-JobGone) failure inside a backfill task
    // propagates out of pLimitAbortable; the sync must not clear the flag.
    await expect(syncOneSource(SOURCE, 24)).rejects.toThrow('HTTP 503');

    expect(mockedDb.setJobNeedsBackfill).not.toHaveBeenCalled();
    expect(mockedDb.updateJobDetails).not.toHaveBeenCalled();
  });

  it('skips new-job enrichment when the backfill pass was rate-limited, still recording ok', async () => {
    const jobs = makeJobs(2);
    mockedScrapeSource.mockResolvedValue({ jobs, html: '' });
    mockedDb.getJobsWithEmptyDescription.mockResolvedValue(makeBackfillRows(1));
    mockedScrapeJobDetail.mockImplementation(async (job) => {
      throw new RateLimitError(job.url, 'HTTP 429 Too Many Requests');
    });

    const result = await syncOneSource(SOURCE, 25);

    // Backfill aborted on rate limit → enrichment skipped, listing rows still
    // committed, source recorded 'ok' (anti-hammering).
    expect(mockedDb.insertJobListingRow).toHaveBeenCalledTimes(2);
    expect(mockedScrapeJobDetail).toHaveBeenCalledTimes(1);
    expect(mockedDb.updateSourceSync).toHaveBeenCalledWith(1, 'ok', 2);
    expect(result.status).toBe('ok');
  });

  it('continues enrichment tasks when a new-job detail fetch reports the job is gone', async () => {
    const jobs = makeJobs(2);
    mockedScrapeSource.mockResolvedValue({ jobs, html: '' });
    mockedScrapeJobDetail.mockImplementation(async (job) => {
      if (job.url.endsWith('/0')) throw new JobGoneError(job.url, 'HTTP 404 Not Found');
      return { ...job, description: 'd' };
    });

    const result = await syncOneSource(SOURCE, 26);

    // Gone row keeps its raised flag (retired by a later backfill); the batch
    // continues and the other row is enriched.
    expect(mockedDb.setJobNeedsBackfill).not.toHaveBeenCalled();
    expect(mockedDb.updateJobDetails).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('ok');
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
