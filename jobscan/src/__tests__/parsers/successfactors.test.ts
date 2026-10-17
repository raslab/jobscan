/**
 * SuccessFactors Parser — Test Suite (issue #14: missing metadata for CSB pages)
 *
 * Covers:
 *  1. successfactorsJobDetailFetch() over checked-in fixtures:
 *     - Capgemini CSB detail page (careers.capgemini.com, the issue case)
 *     - Kaufland classic career5.successfactors.eu detail page
 *     - VolvoGroup CSB detail page (career55.sapsf.eu backend)
 *     asserting location, company, posting date, requisition ID and the
 *     YAML frontmatter block prepended to the description (rc:4293010464).
 *  2. parseDWRListings() over the Kaufland DWR listing response, including
 *     per-job postingDate capture.
 *  3. sfExtractCSBInfo() via successfactorsApiFetch() on the RWE CSB search
 *     page (career5.successfactors.eu backend) — structural diversity check.
 *  4. scraper.ts routing: career*.sapsf.(eu|com) job URLs receive
 *     successfactorsJobDetailFetch (the Capgemini regression).
 *
 * Fixtures are checked-in snapshots (no live network calls).
 */

import { loadFixture } from '../helpers/fixture-loader';

jest.mock('../../fetch-utils', () => ({
  fetchHtml: jest.fn(),
  fetchJson: jest.fn(),
  sleep: jest.fn(() => Promise.resolve()),
  randomDelay: jest.fn(() => Promise.resolve()),
  isUrl404: jest.fn(() => Promise.resolve(false)),
}));

import {
  successfactorsJobDetailFetch,
  successfactorsApiFetch,
  parseDWRListings,
} from '../../parsers/successfactors';
import { scrapeJobDetail } from '../../scraper';
import { fetchHtml } from '../../fetch-utils';

const mockFetchHtml = fetchHtml as jest.MockedFunction<typeof fetchHtml>;

beforeEach(() => {
  mockFetchHtml.mockReset();
});

// ─── Capgemini CSB detail page (the issue case) ──────────────────────────────

describe('successfactorsJobDetailFetch — Capgemini CSB (issue case)', () => {
  const capgeminiUrl =
    'https://career5.successfactors.eu/careers?career_ns=job_details&company=capgemitecP3&jobid=1439136433';

  let result: Awaited<ReturnType<typeof successfactorsJobDetailFetch>>;

  beforeAll(async () => {
    const html = loadFixture('successfactors', 'capgemini-csb-detail.html');
    mockFetchHtml.mockResolvedValue({ html });
    result = await successfactorsJobDetailFetch(capgeminiUrl);
  });

  it('should parse the location', () => {
    expect(result.location).toBe('Aguascalientes, MX');
  });

  it('should parse the company', () => {
    expect(result.company).toBe('Capgemini');
  });

  it('should parse the posting date from the "Posted on:" token', () => {
    expect(result.metadata?.posted_on).toBe('Sep 18, 2026');
  });

  it('should parse the requisition ID from the "Ref. code:" token', () => {
    expect(result.metadata?.requisition_id).toBe('555594');
  });

  it('should parse the professional community as category', () => {
    expect(result.metadata?.category).toBe('Software Engineering');
  });

  it('should parse a non-empty description', () => {
    expect(result.description).toBeTruthy();
    expect(result.description!.length).toBeGreaterThan(200);
  });

  it('should prepend a YAML frontmatter block with the full metadata', () => {
    expect(result.description).toMatch(/^---\n/);
    expect(result.description).toContain('posted_on: "Sep 18, 2026"');
    expect(result.description).toContain('requisition_id: "555594"');
    expect(result.description).toContain('location: "Aguascalientes, MX"');
    expect(result.description).toContain('company: "Capgemini"');
    expect(result.description).toContain('category: "Software Engineering"');
    // frontmatter closes before the markdown body
    const fmEnd = result.description!.indexOf('\n---\n', 4);
    expect(fmEnd).toBeGreaterThan(0);
    expect(result.description!.slice(fmEnd + 5).trim().length).toBeGreaterThan(100);
  });
});

// ─── Kaufland classic career5.successfactors.eu detail page ──────────────────

describe('successfactorsJobDetailFetch — Kaufland detail (career5.successfactors.eu)', () => {
  let result: Awaited<ReturnType<typeof successfactorsJobDetailFetch>>;

  beforeAll(async () => {
    const html = loadFixture('successfactors', 'kaufland-detail.html');
    mockFetchHtml.mockResolvedValue({ html });
    result = await successfactorsJobDetailFetch(
      'https://career5.successfactors.eu/career?career_ns=job_listing&company=KAUFLAND&career_job_req_id=412513',
    );
  });

  it('should parse the location', () => {
    expect(result.location).toContain('RO');
  });

  it('should parse the company', () => {
    expect(result.company).toBe('Kaufland');
  });

  it('should fall back to the schema.org datePosted meta for posted_on', () => {
    expect(result.metadata?.posted_on).toMatch(/2026/);
  });

  it('should prepend frontmatter containing company and location', () => {
    expect(result.description).toMatch(/^---\n/);
    expect(result.description).toContain('company: "Kaufland"');
    expect(result.description).toContain('location: "');
  });
});

// ─── VolvoGroup CSB detail page (career55.sapsf.eu backend) ──────────────────

describe('successfactorsJobDetailFetch — VolvoGroup CSB detail', () => {
  let result: Awaited<ReturnType<typeof successfactorsJobDetailFetch>>;

  beforeAll(async () => {
    const html = loadFixture('successfactors', 'volvo-csb-detail.html');
    mockFetchHtml.mockResolvedValue({ html });
    result = await successfactorsJobDetailFetch(
      'https://career55.sapsf.eu/careers?career_ns=job_details&company=volvoinfor&jobid=1349653055',
    );
  });

  it('should parse the location', () => {
    expect(result.location).toContain('Wroclaw');
  });

  it('should parse the company', () => {
    expect(result.company).toBe('Volvo Group');
  });

  it('should parse the requisition ID from the "Requisition ID:" token', () => {
    expect(result.metadata?.requisition_id).toBe('30937');
  });

  it('should parse the job category', () => {
    expect(result.metadata?.category).toBe('Information Technology');
  });

  it('should include the posted date in the frontmatter', () => {
    expect(result.metadata?.posted_on).toBeTruthy();
    expect(result.description).toMatch(/^---\n/);
    expect(result.description).toContain('posted_on: "');
    expect(result.description).toContain('requisition_id: "30937"');
  });
});

// ─── listing postingDate fallback ────────────────────────────────────────────

describe('successfactorsJobDetailFetch — DWR listing postingDate fallback', () => {
  it('should use the listing postingDate when the page has no posted_on source', async () => {
    // Minimal page with no datePosted meta and no Posted-on token
    const minimal =
      '<html><body><div itemscope itemtype="http://schema.org/JobPosting">' +
      '<meta itemprop="hiringOrganization" content="Acme Corp">' +
      '<span itemprop="description"><div class="jobdescription"><p>Job body text here.</p></div></span>' +
      '</div></body></html>';
    mockFetchHtml.mockResolvedValue({ html: minimal });
    const result = await successfactorsJobDetailFetch(
      'https://career5.successfactors.eu/career?career_ns=job_details&company=acme&career_job_req_id=1',
      { postingDate: '10/16/2026' },
    );
    expect(result.metadata?.posted_on).toBe('10/16/2026');
    expect(result.description).toContain('posted_on: "10/16/2026"');
  });
});

// ─── DWR listing parsing (KAUFLAND listing response) ─────────────────────────

describe('parseDWRListings — Kaufland DWR listing', () => {
  const dwr = loadFixture('successfactors', 'kaufland-dwr-listings.txt');
  const parsed = parseDWRListings(dwr);

  it('should parse job stubs with ids and titles', () => {
    expect(parsed.jobs.length).toBeGreaterThanOrEqual(5);
    for (const job of parsed.jobs) {
      expect(job.id).toMatch(/^\d+$/);
      expect(job.title).toBeTruthy();
    }
  });

  it('should capture postingDate per job', () => {
    const withDate = parsed.jobs.filter((j) => j.postingDate);
    expect(withDate.length).toBeGreaterThan(parsed.jobs.length * 0.5);
    expect(withDate[0].postingDate).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
  });

  it('should extract the detail URL prefix', () => {
    expect(parsed.detailURLPrefix).toContain('career_job_req_id=');
  });

  it('should extract the total count', () => {
    expect(parsed.totalCount).toBeGreaterThan(parsed.jobs.length);
  });
});

// ─── successfactorsApiFetch end-to-end over fixtures (native fetch stubbed) ──

describe('successfactorsApiFetch — Kaufland DWR flow over fixtures', () => {
  it('should run the DWR session+listing flow and thread postingDate into stubs', async () => {
    const careerHtml = loadFixture('successfactors', 'kaufland-career.html');
    const dwrText = loadFixture('successfactors', 'kaufland-dwr-listings.txt');

    const nativeFetch = global.fetch;
    (global as { fetch: unknown }).fetch = jest.fn((url: string) => {
      if (String(url).endsWith('.dwr')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: { getSetCookie: () => ['JSESSIONID=TESTSESSION; Path=/'] },
          text: () => Promise.resolve(dwrText),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: { getSetCookie: () => ['JSESSIONID=TESTSESSION; Path=/'] },
        text: () => Promise.resolve(careerHtml),
      });
    });
    try {
      const result = await successfactorsApiFetch(
        'https://career5.successfactors.eu/career?company=KAUFLAND',
      );
      expect(result.error).toBeUndefined();
      expect(result.jobs.length).toBeGreaterThanOrEqual(5);
      for (const job of result.jobs) {
        expect(job.url).toContain('career5.successfactors.eu');
        expect(job.title).toBeTruthy();
      }
      // postingDate from the DWR response is threaded onto the stubs
      const withDate = result.jobs.filter(
        (j) => (j as { postingDate?: string }).postingDate,
      );
      expect(withDate.length).toBeGreaterThan(0);
    } finally {
      (global as { fetch: unknown }).fetch = nativeFetch;
    }
  });
});

// ─── CSB detection via successfactorsApiFetch (RWE search page) ──────────────

describe('successfactorsApiFetch — RWE CSB detection', () => {
  it('should recognise the RWE CSB page via ssoCompanyId/ssoUrl and fail gracefully on session fetch', async () => {
    // fetchHtml is used by sfExtractCSBInfo. The DWR session step uses the
    // native fetch() — stub it so the test makes NO live network call.
    // CSB detection must succeed (error is about the session, not
    // "Not a recognised SuccessFactors URL").
    const html = loadFixture('successfactors', 'rwe-csb-search.html');
    mockFetchHtml.mockResolvedValue({ html });
    const nativeFetch = global.fetch;
    (global as { fetch: unknown }).fetch = jest.fn(() =>
      Promise.reject(new Error('network disabled in tests')),
    );
    try {
      const result = await successfactorsApiFetch('https://jobs.rwe.com/en/search/');
      expect(result.error).toBeTruthy();
      expect(result.error).not.toContain('Not a recognised');
      expect(result.jobs).toEqual([]);
    } finally {
      (global as { fetch: unknown }).fetch = nativeFetch;
    }
  });
});

// ─── scraper.ts routing (the Capgemini regression) ───────────────────────────

describe('scrapeJobDetail — sapsf routing for CSB jobs', () => {
  it('should route career*.sapsf.eu job URLs through successfactorsJobDetailFetch', async () => {
    const html = loadFixture('successfactors', 'capgemini-csb-detail.html');
    mockFetchHtml.mockResolvedValue({ html });

    const enriched = await scrapeJobDetail({
      title: '.Net Developer',
      url: 'https://career5.sapsf.eu/careers?career_ns=job_details&company=capgemitecP3&jobid=1439136433',
    });

    // SF detail branch ran → description carries the YAML frontmatter block
    expect(enriched.description).toMatch(/^---\n/);
    expect(enriched.description).toContain('posted_on: "Sep 18, 2026"');
    expect(enriched.location).toBe('Aguascalientes, MX');
  });

  it('should route hcm*.sapsf.com job URLs through the SF branch too', async () => {
    const html = loadFixture('successfactors', 'volvo-csb-detail.html');
    mockFetchHtml.mockResolvedValue({ html });

    const enriched = await scrapeJobDetail({
      title: 'Digital Product Owner',
      url: 'https://hcm55.sapsf.com/careers?career_ns=job_details&company=volvoinfor&jobid=1349653055',
    });

    expect(enriched.description).toMatch(/^---\n/);
    expect(enriched.description).toContain('requisition_id: "30937"');
  });
});

// ─── fixture diversity guard (owner comment 6200099995) ──────────────────────

describe('successfactors fixtures', () => {
  it('should contain structurally diverse fixtures referenced by this suite', () => {
    const names = [
      'capgemini-csb-detail.html',
      'kaufland-career.html',
      'kaufland-detail.html',
      'kaufland-dwr-listings.txt',
      'rwe-csb-search.html',
      'volvo-csb-detail.html',
    ];
    for (const n of names) {
      expect(loadFixture('successfactors', n).length).toBeGreaterThan(1000);
    }
    // structural diversity: CSB pages differ from each other and from the
    // classic sapsf detail page
    const cap = loadFixture('successfactors', 'capgemini-csb-detail.html');
    const volvo = loadFixture('successfactors', 'volvo-csb-detail.html');
    const kaufland = loadFixture('successfactors', 'kaufland-detail.html');
    expect(cap).not.toContain('Requisition ID:');
    expect(volvo).toContain('Requisition ID:');
    expect(kaufland).not.toContain('Ref. code:');
  });
});
