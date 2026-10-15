/**
 * SuccessFactors ATS Parser — Unit Test Suite
 *
 * Covers (issue #14 — missing metadata for SuccessFactors pages):
 *  1. successfactorsJobDetailFetch() — full metadata (description, location,
 *     company) from each retained detail fixture:
 *       - capgemini-net-developer-detail.html  (CSB custom domain, issue URL)
 *       - kaufland-career5-detail.html         (classic career5.successfactors.eu)
 *       - rwe-senior-software-engineer-detail.html (CSB custom domain, locality/region/country)
 *  2. parseDWRListings() — job stubs (id + title), totalCount and
 *     detailURLPrefix from the captured KAUFLAND DWR getInitialJobSearchData
 *     response (owner comment 6200099995).
 *  3. scrapeJobDetail() routing — a careerNN.sapsf.* job URL is enriched via
 *     successfactorsJobDetailFetch instead of falling through to generic
 *     extraction.
 *
 * All offline: fetch-utils is mocked with checked-in fixtures; tests never
 * download. The DWR fixture embeds no live session semantics.
 */

import { loadFixture } from '../helpers/fixture-loader';

// Mock fetch-utils so detail fetches use cached fixtures instead of network.
jest.mock('../../fetch-utils', () => ({
  fetchHtml: jest.fn(),
  fetchJson: jest.fn(),
  randomDelay: jest.fn().mockResolvedValue(undefined),
  sleep: jest.fn().mockResolvedValue(undefined),
}));

import {
  successfactorsJobDetailFetch,
  parseDWRListings,
} from '../../parsers/successfactors';
import { fetchHtml } from '../../fetch-utils';
import { scrapeJobDetail } from '../../scraper';

const mockFetchHtml = fetchHtml as jest.MockedFunction<typeof fetchHtml>;

// ─── successfactorsJobDetailFetch — CSB custom-domain detail (Capgemini) ──────

describe('successfactorsJobDetailFetch — Capgemini CSB detail (issue URL)', () => {
  let meta: Awaited<ReturnType<typeof successfactorsJobDetailFetch>>;

  beforeAll(async () => {
    const html = loadFixture('successfactors', 'capgemini-net-developer-detail.html');
    mockFetchHtml.mockResolvedValue({ html, error: undefined });
    meta = await successfactorsJobDetailFetch(
      'https://careers.capgemini.com/job/Aguascalientes--Net-Developer/1439136433/',
    );
  });

  it('returns no error', () => {
    expect(meta.error).toBeUndefined();
  });

  it('extracts a non-empty description', () => {
    expect(meta.description).toBeDefined();
    expect((meta.description ?? '').length).toBeGreaterThan(100);
  });

  it('extracts the location', () => {
    expect(meta.location).toBeDefined();
    expect(meta.location).toContain('Aguascalientes');
  });

  it('extracts the company', () => {
    expect(meta.company).toBe('Capgemini');
  });
});

// ─── successfactorsJobDetailFetch — classic career5.successfactors.eu detail ──

describe('successfactorsJobDetailFetch — KAUFLAND classic detail', () => {
  let meta: Awaited<ReturnType<typeof successfactorsJobDetailFetch>>;

  beforeAll(async () => {
    const html = loadFixture('successfactors', 'kaufland-career5-detail.html');
    mockFetchHtml.mockResolvedValue({ html, error: undefined });
    meta = await successfactorsJobDetailFetch(
      'https://career5.successfactors.eu/career?career%5fns=job%5flisting&company=KAUFLAND&navBarLevel=JOB%5fSEARCH&rcm%5fsite%5flocale=en%5fUS&career_job_req_id=410323',
    );
  });

  it('returns no error', () => {
    expect(meta.error).toBeUndefined();
  });

  it('extracts a non-empty description', () => {
    expect(meta.description).toBeDefined();
    expect((meta.description ?? '').length).toBeGreaterThan(100);
  });

  it('extracts the location', () => {
    expect(meta.location).toBeDefined();
    expect(meta.location).toContain('Lugoj');
  });

  it('extracts the company', () => {
    expect(meta.company).toBe('Kaufland');
  });
});

// ─── successfactorsJobDetailFetch — CSB custom domain with full postal address ─

describe('successfactorsJobDetailFetch — RWE detail (locality/region/country)', () => {
  let meta: Awaited<ReturnType<typeof successfactorsJobDetailFetch>>;

  beforeAll(async () => {
    const html = loadFixture('successfactors', 'rwe-senior-software-engineer-detail.html');
    mockFetchHtml.mockResolvedValue({ html, error: undefined });
    meta = await successfactorsJobDetailFetch(
      'https://jobs.rwe.com/RWE/job/Austin-Senior-Software-Engineer-II-TX-78701/1413948233/',
    );
  });

  it('returns no error', () => {
    expect(meta.error).toBeUndefined();
  });

  it('extracts a non-empty description', () => {
    expect(meta.description).toBeDefined();
    expect((meta.description ?? '').length).toBeGreaterThan(100);
  });

  it('joins addressLocality/addressRegion/addressCountry into the location', () => {
    expect(meta.location).toBe('Austin, TX, US');
  });

  it('extracts the company', () => {
    expect(meta.company).toBe('RWE');
  });
});

// ─── parseDWRListings — captured KAUFLAND DWR listing response ────────────────

describe('parseDWRListings — KAUFLAND DWR getInitialJobSearchData fixture', () => {
  const dwr = loadFixture('successfactors', 'kaufland-dwr-initial.txt');
  const parsed = parseDWRListings(dwr);

  it('returns job stubs with ids and non-empty titles', () => {
    expect(parsed.jobs.length).toBeGreaterThan(0);
    for (const job of parsed.jobs) {
      expect(job.id).toMatch(/^\d+$/);
      expect(job.title.length).toBeGreaterThan(0);
    }
  });

  it('reports the correct totalCount (max across DWR assignments)', () => {
    expect(parsed.totalCount).toBe(6019);
  });

  it('extracts a usable detailURLPrefix ending with the req-id param', () => {
    expect(parsed.detailURLPrefix).toContain('/career?');
    expect(parsed.detailURLPrefix).toContain('career_job_req_id=');
  });
});

// ─── scrapeJobDetail routing — CSB backend hosts (careerNN.sapsf.*) ───────────

describe('scrapeJobDetail — routes careerNN.sapsf.* job URLs to the SF detail fetch', () => {
  it('enriches a career55.sapsf.eu job URL via successfactorsJobDetailFetch', async () => {
    const html = loadFixture('successfactors', 'capgemini-net-developer-detail.html');
    mockFetchHtml.mockResolvedValue({ html, error: undefined });

    const job = {
      title: '.Net Developer',
      url: 'https://career55.sapsf.eu/career?career%5fns=job%5flisting&company=capgemini&career_job_req_id=1439136433',
    };
    const enriched = await scrapeJobDetail(job);

    expect(enriched.description).toBeDefined();
    expect((enriched.description ?? '').length).toBeGreaterThan(100);
    expect(enriched.location).toContain('Aguascalientes');
    // fetchHtml must have been called with the sapsf URL (routing proof)
    expect(mockFetchHtml).toHaveBeenCalledWith(job.url);
  });

  it('still routes classic careerNN.successfactors.* URLs', async () => {
    const html = loadFixture('successfactors', 'kaufland-career5-detail.html');
    mockFetchHtml.mockResolvedValue({ html, error: undefined });

    const job = {
      title: 'Lucrător Comercial Lugoj (f/m)',
      url: 'https://career5.successfactors.eu/career?career%5fns=job%5flisting&company=KAUFLAND&career_job_req_id=410323',
    };
    const enriched = await scrapeJobDetail(job);

    expect(enriched.location).toContain('Lugoj');
    expect((enriched.description ?? '').length).toBeGreaterThan(100);
  });
});
