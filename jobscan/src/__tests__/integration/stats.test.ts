/**
 * Stats endpoint — Integration Tests
 *
 * Verifies the live REST API contract for `/api/jobs/stats`:
 *   1. Default response is summary-only
 *   2. `includeFilters=true` returns distinct filter arrays
 *
 * Prerequisites:
 *   - Dev server running on localhost:3000 (`npm run dev`)
 */

import {
  getStats,
  isServerRunning,
} from '../helpers/api-client';

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

describe('Stats integration — API contract', () => {
  it('should return summary-only stats by default', async () => {
    const { status, data } = await getStats();

    expect(status).toBe(200);
    expect(typeof data.totalJobs).toBe('number');
    expect(typeof data.totalSources).toBe('number');
    expect(data.totalJobs).toBeGreaterThanOrEqual(0);
    expect(data.totalSources).toBeGreaterThanOrEqual(0);
    expect(data.companies).toBeUndefined();
    expect(data.locations).toBeUndefined();
    expect(data.departments).toBeUndefined();
    expect(data.workplaceTypes).toBeUndefined();
    expect(data.commitmentTypes).toBeUndefined();
  });

  it('should include filter arrays when explicitly requested', async () => {
    const { status, data } = await getStats({ includeFilters: true });

    expect(status).toBe(200);
    expect(typeof data.totalJobs).toBe('number');
    expect(typeof data.totalSources).toBe('number');
    expect(Array.isArray(data.companies)).toBe(true);
    expect(Array.isArray(data.locations)).toBe(true);
    expect(Array.isArray(data.departments)).toBe(true);
    expect(Array.isArray(data.workplaceTypes)).toBe(true);
    expect(Array.isArray(data.commitmentTypes)).toBe(true);
  });
});
