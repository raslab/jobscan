/**
 * Workable Parser — Markdown-preservation Test Suite (issue #16)
 *
 * Covers:
 *  1. workableApiFetch() with a checked-in fixture captured from the
 *     issue-listed board (https://apply.workable.com/circonomit/j/02CBDBBF40)
 *  2. Markdown contract: HTML descriptions from ?details=true are converted
 *     to Markdown — no raw HTML tags may be stored.
 *  3. Slug extraction / error handling edge cases.
 *
 * Fixture source: live capture of the Workable widget API
 * (?details=true), trimmed to 3 jobs. Tests never hit the network.
 */

import { loadJsonFixture } from '../helpers/fixture-loader';
import { expectMarkdownDescription } from '../helpers/markdown';

jest.mock('../../fetch-utils', () => ({
  fetchJson: jest.fn(),
  fetchHtml: jest.fn(),
}));

import { workableApiFetch, workableApiDetect } from '../../parsers/workable';
import { fetchJson } from '../../fetch-utils';

const mockFetchJson = fetchJson as jest.MockedFunction<typeof fetchJson>;

// ─── workableApiFetch — Markdown preservation ────────────────────────────────

describe('workableApiFetch — Circonomit (issue-listed board)', () => {
  afterEach(() => mockFetchJson.mockReset());

  it('should fetch jobs from the widget API fixture', async () => {
    const payload = loadJsonFixture('workable', 'circonomit-api.json');
    mockFetchJson.mockResolvedValue({ data: payload });

    const result = await workableApiFetch('https://apply.workable.com/circonomit');
    expect(result.error).toBeUndefined();
    expect(result.jobs.length).toBeGreaterThan(0);
  });

  it('should convert HTML descriptions to Markdown (no raw HTML stored)', async () => {
    const payload = loadJsonFixture('workable', 'circonomit-api.json') as any;

    // Sanity: the fixture descriptions really are HTML with lists/bold
    const withHtml = payload.jobs.filter((j: any) => /<p>/.test(j.description || ''));
    expect(withHtml.length).toBeGreaterThan(0);

    mockFetchJson.mockResolvedValue({ data: payload });

    const result = await workableApiFetch('https://apply.workable.com/circonomit');
    expect(result.error).toBeUndefined();

    const withDesc = result.jobs.filter(j => j.description);
    expect(withDesc.length).toBeGreaterThan(0);

    for (const job of withDesc) {
      // Core contract: no HTML tags in the stored description
      expectMarkdownDescription(job.description, { sourceHadMarkdownMarkers: true });
    }

    // Spot-check the issue-listed job keeps its content as Markdown
    const listed = result.jobs.find(j => j.url.endsWith('/j/02CBDBBF40'));
    expect(listed).toBeDefined();
    expect(listed!.description).toBeTruthy();
  });

  it('should deduplicate jobs posted to multiple locations', async () => {
    const payload = loadJsonFixture('workable', 'circonomit-api.json') as any;
    // Duplicate one job entry to simulate multi-location posting
    payload.jobs.push({ ...payload.jobs[0] });
    mockFetchJson.mockResolvedValue({ data: payload });

    const result = await workableApiFetch('https://apply.workable.com/circonomit');
    const shortcodes = result.jobs.map(j => j.url.split('/').pop());
    expect(new Set(shortcodes).size).toBe(shortcodes.length);
  });
});

// ─── workableApiFetch — edge cases ───────────────────────────────────────────

describe('workableApiFetch — edge cases', () => {
  afterEach(() => mockFetchJson.mockReset());

  it('should return error for non-workable URL', async () => {
    const result = await workableApiFetch('https://example.com/jobs');
    expect(result.error).toBeDefined();
    expect(result.jobs).toEqual([]);
  });

  it('should return error for API failure', async () => {
    mockFetchJson.mockResolvedValue({ data: null, error: 'HTTP 404' });
    const result = await workableApiFetch('https://apply.workable.com/nosuchcompany');
    expect(result.error).toBe('HTTP 404');
  });

  it('should handle payload without jobs', async () => {
    mockFetchJson.mockResolvedValue({ data: {} });
    const result = await workableApiFetch('https://apply.workable.com/emptyco');
    expect(result.jobs).toEqual([]);
  });
});

// ─── workableApiDetect ───────────────────────────────────────────────────────

describe('workableApiDetect', () => {
  afterEach(() => mockFetchJson.mockReset());

  it('should return company name from API', async () => {
    mockFetchJson.mockResolvedValue({ data: { name: 'Circonomit' } });
    const result = await workableApiDetect('https://apply.workable.com/circonomit');
    expect(result.company).toBe('Circonomit');
  });

  it('should fall back to prettified slug on API error', async () => {
    mockFetchJson.mockResolvedValue({ data: null, error: 'HTTP 500' });
    const result = await workableApiDetect('https://apply.workable.com/my-co');
    expect(result.company).toBe('My Co');
  });
});
