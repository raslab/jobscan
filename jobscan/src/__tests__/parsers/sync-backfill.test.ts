/**
 * Unit tests for the description-backfill pass in src/sync.ts (issue #2).
 *
 * Verifies that:
 *   - a sync where every scraped URL already exists still backfills empty
 *     descriptions for that source's jobs and records status 'ok' with the
 *     listing count (no early return),
 *   - backfill fetches for pre-existing empty-description rows are issued
 *     BEFORE new-job detail-enrichment fetches within the same source sync,
 *   - backfill only issues targeted UPDATEs by existing row id: no duplicate
 *     job rows are inserted, and the empty-description snapshot is taken
 *     before this sync's listing rows are inserted (so new rows are never
 *     fetched twice and original sync_id/first_seen stay untouched —
 *     updateJobDetails only ever writes description/optional detail fields).
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
import { syncOneSource } from '../../sync';

const mockedDb = db as jest.Mocked<typeof db>;
const mockedScrapeSource = scrapeSource as jest.MockedFunction<typeof scrapeSource>;
const mockedScrapeJobDetail = scrapeJobDetail as jest.MockedFunction<typeof scrapeJobDetail>;

const SOURCE = { id: 1, company: 'Acme', url: 'https://acme.example/jobs', parser: 'generic', last_count: null };

function makeJobs(n: number, prefix = 'https://acme.example/jobs/') {
  return Array.from({ length: n }, (_, i) => ({
    title: `Job ${i}`,
    url: `${prefix}${i}`,
  }));
}

beforeEach(() => {
  jest.resetAllMocks();
  mockedDb.insertHtmlBackup.mockResolvedValue(undefined);
  mockedDb.getExistingJobUrls.mockResolvedValue(new Set<string>());
  mockedDb.insertJobListingRow.mockImplementation(async () => ({ id: 100, inserted: true }));
  mockedDb.updateJobDetails.mockResolvedValue(undefined);
  mockedDb.updateSourceSync.mockResolvedValue(undefined);
  mockedDb.getJobsWithEmptyDescription.mockResolvedValue([]);
  mockedScrapeJobDetail.mockImplementation(async (job) => ({ ...job, description: 'enriched' }));
});

describe('syncOneSource description backfill (issue #2)', () => {
  it('backfills empty descriptions when every scraped URL already exists', async () => {
    const jobs = makeJobs(3);
    mockedScrapeSource.mockResolvedValue({ jobs, html: '' });
    // All three listing URLs are already in the DB → zero unseen jobs.
    mockedDb.getExistingJobUrls.mockResolvedValue(
      new Set(jobs.map((j) => j.url)),
    );
    // Two pre-existing rows for this source have empty descriptions.
    mockedDb.getJobsWithEmptyDescription.mockResolvedValue([
      { id: 41, url: 'https://acme.example/jobs/old-1', title: 'Old 1', location: null, department: null, workplace_type: null, commitment: null },
      { id: 42, url: 'https://acme.example/jobs/old-2', title: 'Old 2', location: 'Amsterdam', department: null, workplace_type: null, commitment: null },
    ]);

    const result = await syncOneSource(SOURCE, 7);

    // Details were fetched for the empty-description rows...
    expect(mockedScrapeJobDetail).toHaveBeenCalledTimes(2);
    const fetchedUrls = mockedScrapeJobDetail.mock.calls.map((c) => c[0].url).sort();
    expect(fetchedUrls).toEqual(['https://acme.example/jobs/old-1', 'https://acme.example/jobs/old-2']);

    // ...and written back as targeted UPDATEs by existing row id.
    expect(mockedDb.updateJobDetails).toHaveBeenCalledTimes(2);
    const updatedIds = mockedDb.updateJobDetails.mock.calls.map((c) => c[0]).sort();
    expect(updatedIds).toEqual([41, 42]);
    for (const [, fields] of mockedDb.updateJobDetails.mock.calls) {
      expect(fields.description).toBe('enriched');
    }

    // No duplicate rows: nothing was inserted for the known URLs.
    expect(mockedDb.insertJobListingRow).not.toHaveBeenCalled();

    // Source recorded 'ok' with the listing count despite zero new jobs.
    expect(mockedDb.updateSourceSync).toHaveBeenCalledWith(1, 'ok', 3);
    expect(result.status).toBe('ok');
    expect(result.newJobs).toBe(0);
    expect(result.totalJobs).toBe(3);
  });

  it('issues backfill fetches before new-job enrichment fetches in the same sync', async () => {
    // Two URLs already known (one of them an empty-description row), one new.
    const jobs = makeJobs(3);
    mockedScrapeSource.mockResolvedValue({ jobs, html: '' });
    mockedDb.getExistingJobUrls.mockResolvedValue(new Set([jobs[0].url, jobs[1].url]));
    mockedDb.getJobsWithEmptyDescription.mockResolvedValue([
      { id: 41, url: jobs[0].url, title: 'Job 0', location: null, department: null, workplace_type: null, commitment: null },
    ]);

    // Record which URLs were fetched, in call order.
    const fetchOrder: string[] = [];
    mockedScrapeJobDetail.mockImplementation(async (job) => {
      fetchOrder.push(job.url);
      return { ...job, description: 'enriched' };
    });

    const result = await syncOneSource(SOURCE, 8);

    // Backfill fetch (existing row) precedes the new-job enrichment fetches.
    expect(fetchOrder[0]).toBe(jobs[0].url);
    expect(fetchOrder.slice(1)).toEqual([jobs[2].url]);

    // The empty-description snapshot is taken BEFORE this sync's listing rows
    // are inserted, so the newly inserted row (jobs[2]) is not double-fetched.
    const emptySnapshotCall = mockedDb.getJobsWithEmptyDescription.mock.invocationCallOrder[0];
    const firstInsertCall = mockedDb.insertJobListingRow.mock.invocationCallOrder[0];
    expect(emptySnapshotCall).toBeLessThan(firstInsertCall);

    // Only the pre-existing row id is updated by backfill; the new row is
    // enriched via its insert-returned id — no duplicate inserts.
    expect(mockedDb.insertJobListingRow).toHaveBeenCalledTimes(1);
    expect(mockedDb.updateJobDetails).toHaveBeenCalledTimes(2);
    const updatedIds = mockedDb.updateJobDetails.mock.calls.map((c) => c[0]).sort((a, b) => a - b);
    expect(updatedIds).toEqual([41, 100]);

    expect(mockedDb.updateSourceSync).toHaveBeenCalledWith(1, 'ok', 3);
    expect(result.status).toBe('ok');
    expect(result.newJobs).toBe(1);
  });

  it('records ok with no fetches when all URLs are known and no descriptions are missing', async () => {
    const jobs = makeJobs(2);
    mockedScrapeSource.mockResolvedValue({ jobs, html: '' });
    mockedDb.getExistingJobUrls.mockResolvedValue(new Set(jobs.map((j) => j.url)));
    mockedDb.getJobsWithEmptyDescription.mockResolvedValue([]);

    const result = await syncOneSource(SOURCE, 9);

    expect(mockedScrapeJobDetail).not.toHaveBeenCalled();
    expect(mockedDb.insertJobListingRow).not.toHaveBeenCalled();
    expect(mockedDb.updateJobDetails).not.toHaveBeenCalled();
    expect(mockedDb.updateSourceSync).toHaveBeenCalledWith(1, 'ok', 2);
    expect(result.status).toBe('ok');
    expect(result.newJobs).toBe(0);
  });
});
