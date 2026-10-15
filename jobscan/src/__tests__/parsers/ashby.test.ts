/**
 * Ashby Parser — Markdown-preservation Test Suite (issue #16)
 *
 * Covers:
 *  1. ashbyApiFetch() with a checked-in fixture captured from the
 *     issue-listed board (https://jobs.ashbyhq.com/n8n/49e569f0-503e-4e42-a1ba-7e63684e90d3)
 *  2. Markdown contract: descriptionHtml is converted to Markdown — no raw
 *     HTML tags may be stored.
 *  3. Slug extraction / error handling edge cases.
 *
 * Fixture source: live capture of the Ashby posting API, trimmed to 3 jobs.
 * Tests never hit the network.
 */

import { loadJsonFixture } from '../helpers/fixture-loader';
import { expectMarkdownDescription } from '../helpers/markdown';

jest.mock('../../fetch-utils', () => ({
  fetchJson: jest.fn(),
  fetchHtml: jest.fn(),
}));

import { ashbyApiFetch } from '../../parsers/ashby';
import { fetchJson } from '../../fetch-utils';

const mockFetchJson = fetchJson as jest.MockedFunction<typeof fetchJson>;

// ─── ashbyApiFetch — Markdown preservation ───────────────────────────────────

describe('ashbyApiFetch — n8n (issue-listed board)', () => {
  afterEach(() => mockFetchJson.mockReset());

  it('should fetch jobs from the posting API fixture', async () => {
    const payload = loadJsonFixture('ashby', 'n8n-api.json');
    mockFetchJson.mockResolvedValue({ data: payload });

    const result = await ashbyApiFetch('https://jobs.ashbyhq.com/n8n');
    expect(result.error).toBeUndefined();
    expect(result.jobs.length).toBeGreaterThan(0);
  });

  it('should convert descriptionHtml to Markdown (no raw HTML stored)', async () => {
    const payload = loadJsonFixture('ashby', 'n8n-api.json') as any;

    // Sanity: the fixture descriptions really are HTML
    const withHtml = payload.jobs.filter((j: any) => /<p/.test(j.descriptionHtml || ''));
    expect(withHtml.length).toBeGreaterThan(0);

    mockFetchJson.mockResolvedValue({ data: payload });

    const result = await ashbyApiFetch('https://jobs.ashbyhq.com/n8n');
    expect(result.error).toBeUndefined();

    const withDesc = result.jobs.filter(j => j.description);
    expect(withDesc.length).toBeGreaterThan(0);

    for (const job of withDesc) {
      // Core contract: no HTML tags in the stored description
      expectMarkdownDescription(job.description, { sourceHadMarkdownMarkers: true });
    }

    // Spot-check the issue-listed posting keeps its content as Markdown
    const listed = result.jobs.find(j =>
      j.url.includes('49e569f0-503e-4e42-a1ba-7e63684e90d3'),
    );
    expect(listed).toBeDefined();
    expect(listed!.description).toContain('**');
  });

  it('should skip unlisted jobs', async () => {
    const payload = loadJsonFixture('ashby', 'n8n-api.json') as any;
    payload.jobs[0].isListed = false;
    mockFetchJson.mockResolvedValue({ data: payload });

    const result = await ashbyApiFetch('https://jobs.ashbyhq.com/n8n');
    expect(result.jobs.length).toBe(payload.jobs.length - 1);
  });
});

// ─── ashbyApiFetch — edge cases ──────────────────────────────────────────────

describe('ashbyApiFetch — edge cases', () => {
  afterEach(() => mockFetchJson.mockReset());

  it('should return error for non-ashby URL', async () => {
    const result = await ashbyApiFetch('https://example.com/jobs');
    expect(result.error).toBeDefined();
    expect(result.jobs).toEqual([]);
  });

  it('should return error for API failure', async () => {
    mockFetchJson.mockResolvedValue({ data: null, error: 'HTTP 404' });
    const result = await ashbyApiFetch('https://jobs.ashbyhq.com/nosuchboard');
    expect(result.error).toBe('HTTP 404');
  });

  it('should handle payload without jobs', async () => {
    mockFetchJson.mockResolvedValue({ data: {} });
    const result = await ashbyApiFetch('https://jobs.ashbyhq.com/emptyco');
    expect(result.jobs).toEqual([]);
  });
});
