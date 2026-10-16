/**
 * Company filter — Integration Tests (issue #11)
 *
 * The company filter must be a case-insensitive partial match in both DB
 * adapters, so any case variant or substring of a stored employer string
 * returns that employer's job records.
 *
 * Part 1: deterministic sqlite-adapter test — seeds jobs into the local
 *         sqlite db, then compares exact / lowercase / substring queries
 *         through getJobs, getJobsPaginated and getJobsCount.
 * Part 2: API test against the dev server (Postgres-backed) — seeds a
 *         source + jobs directly via the pg adapter, then asserts that
 *         GET /api/jobs?company=<variant> returns identical totals and IDs
 *         for the exact stored string, a lowercase variant, and a substring.
 */

import * as sqlite from '../../db/sqlite';
import * as pg from '../../db/pg';
import { getJobs, isServerRunning } from '../helpers/api-client';

// Unique marker so seeded rows never collide with pre-existing data and
// repeated runs stay deterministic.
const MARKER = `CfTest${Date.now()}${Math.floor(Math.random() * 1e6)}`;
const STORED_COMPANY = `${MARKER} Boardwise GmbH`;
const LOWER_COMPANY = STORED_COMPANY.toLowerCase();
const SUBSTRING_COMPANY = `${MARKER} Boardwise`; // substring, drops legal suffix
const FIRST_SEEN = new Date('2026-01-01T00:00:00.000Z').toISOString();

function seededJob(sourceId: number, syncId: number, url: string, title: string) {
  return {
    source_id: sourceId,
    sync_id: syncId,
    company: STORED_COMPANY,
    title,
    location: 'Berlin',
    workplace_type: null,
    commitment: null,
    department: null,
    team: null,
    description: null,
    url,
    first_seen: FIRST_SEEN,
  };
}

function idsOf(rows: { id: number }[]): number[] {
  return rows.map((r) => r.id).sort((a, b) => a - b);
}

// ─── Part 1: sqlite adapter (deterministic, no services needed) ─────────────

describe('Company filter — sqlite adapter parity', () => {
  let sourceId = 0;
  let syncId = 0;
  const expectedIds: number[] = [];

  beforeAll(async () => {
    sqlite.initDb();
    sourceId = await sqlite.insertSource(STORED_COMPANY, `https://example.invalid/${MARKER}`, 'default');
    syncId = await sqlite.startSyncLog();
    for (let i = 0; i < 3; i++) {
      const { id } = await sqlite.insertJobListingRow(
        seededJob(sourceId, syncId, `https://example.invalid/${MARKER}/job-${i}`, `Role ${i}`),
      );
      expectedIds.push(id);
    }
    expectedIds.sort((a, b) => a - b);
  });

  afterAll(async () => {
    if (sourceId) await sqlite.deleteSource(sourceId);
  });

  it('getJobs: exact, lowercase and substring company queries return the same rows', async () => {
    const exact = await sqlite.getJobs({ company: STORED_COMPANY });
    const lower = await sqlite.getJobs({ company: LOWER_COMPANY });
    const sub = await sqlite.getJobs({ company: SUBSTRING_COMPANY });

    expect(idsOf(exact)).toEqual(expectedIds);
    expect(idsOf(lower)).toEqual(expectedIds);
    expect(idsOf(sub)).toEqual(expectedIds);
  });

  it('getJobsPaginated + getJobsCount: same case-insensitive partial semantics', async () => {
    const variants = [STORED_COMPANY, LOWER_COMPANY, SUBSTRING_COMPANY];
    for (const company of variants) {
      const page = await sqlite.getJobsPaginated({ company, pageSize: 100 });
      const count = await sqlite.getJobsCount({ company });
      expect(idsOf(page.data)).toEqual(expectedIds);
      expect(page.total).toBe(expectedIds.length);
      expect(count).toBe(expectedIds.length);
    }
  });

  it('non-matching company still returns nothing', async () => {
    const none = await sqlite.getJobs({ company: `${MARKER}-nope` });
    expect(none).toEqual([]);
    expect(await sqlite.getJobsCount({ company: `${MARKER}-nope` })).toBe(0);
  });
});

// ─── Part 2: REST API against the dev server (Postgres-backed) ──────────────

describe('Company filter — GET /api/jobs API contract', () => {
  let sourceId = 0;

  beforeAll(async () => {
    const running = await isServerRunning();
    if (!running) {
      throw new Error(
        'Dev server is not running on localhost:3000.\n' +
          'Start it with: cd jobscan && npm run dev\n' +
          'Then re-run integration tests: npm run test:integration',
      );
    }
    await pg.initDb();
    sourceId = await pg.insertSource(STORED_COMPANY, `https://example.invalid/${MARKER}-pg`, 'default');
    const syncId = await pg.startSyncLog();
    for (let i = 0; i < 3; i++) {
      await pg.insertJobIfNew(
        seededJob(sourceId, syncId, `https://example.invalid/${MARKER}-pg/job-${i}`, `Pg Role ${i}`),
      );
    }
  });

  afterAll(async () => {
    if (sourceId) await pg.deleteSource(sourceId);
  });

  it('exact, lowercase and substring company queries return identical totals and IDs', async () => {
    const exact = await getJobs({ company: STORED_COMPANY, pageSize: 100 });
    const lower = await getJobs({ company: LOWER_COMPANY, pageSize: 100 });
    const sub = await getJobs({ company: SUBSTRING_COMPANY, pageSize: 100 });

    expect(exact.status).toBe(200);
    expect(lower.status).toBe(200);
    expect(sub.status).toBe(200);

    expect(exact.data.total).toBeGreaterThanOrEqual(3);
    expect(lower.data.total).toBe(exact.data.total);
    expect(sub.data.total).toBe(exact.data.total);
    expect(idsOf(lower.data.data)).toEqual(idsOf(exact.data.data));
    expect(idsOf(sub.data.data)).toEqual(idsOf(exact.data.data));
  });
});
