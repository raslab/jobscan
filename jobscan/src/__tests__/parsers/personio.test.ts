/**
 * Personio Parser — Full Test Suite
 *
 * Covers:
 *  1. personioParser() HTML fallback with cached fixture
 *  2. personioApiFetch() with cached XML (mocked fetchHtml)
 *  3. personioApiDetect() with cached XML (mocked fetchHtml)
 *  4. Deprecated board detection (*.jobs.personio.de redirect handling)
 *  5. Edge cases (empty HTML, empty XML, malformed input)
 *  6. Metadata verification (location, department, commitment, workplace_type)
 *  7. personioComApiFetch() — Personio corporate JSON API (mocked fetchJson)
 *  8. isPersonioComUrl() — URL detection for personio.com/careers
 */

import { loadFixture, loadJsonFixture } from '../helpers/fixture-loader';

// Mock fetch-utils so API functions use cached data instead of network
jest.mock('../../fetch-utils', () => ({
  fetchHtml: jest.fn(),
  fetchJson: jest.fn(),
}));

import {
  personioParser,
  personioApiFetch,
  personioComApiFetch,
  personioApiDetect,
  isPersonioComUrl,
} from '../../parsers/personio';
import { fetchHtml, fetchJson } from '../../fetch-utils';

const mockFetchHtml = fetchHtml as jest.MockedFunction<typeof fetchHtml>;
const mockFetchJson = fetchJson as jest.MockedFunction<typeof fetchJson>;

// Also mock global.fetch for the isPersonioBoardDeprecated() pre-flight check
// which uses raw fetch() with redirect: 'manual' (not fetchHtml)
const mockGlobalFetch = jest.fn() as jest.MockedFunction<typeof globalThis.fetch>;
const originalFetch = globalThis.fetch;

beforeAll(() => {
  globalThis.fetch = mockGlobalFetch;
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

// Default: pre-flight returns 200 (board is alive) so XML fetch proceeds
beforeEach(() => {
  mockGlobalFetch.mockResolvedValue(
    new Response(null, { status: 200 }) as Response,
  );
});

// ─── HTML Fallback Parser ─────────────────────────────────────────────────────

describe('personioParser — HTML fallback', () => {
  const baseUrl = 'https://acmecorp.jobs.personio.de';

  describe('Sample board fixture', () => {
    let jobs: ReturnType<typeof personioParser>;

    beforeAll(() => {
      const html = loadFixture('personio', 'sample-board.html');
      jobs = personioParser(html, baseUrl);
    });

    it('should parse a non-zero number of jobs', () => {
      expect(jobs.length).toBeGreaterThan(0);
    });

    it('should parse all 4 jobs from the fixture', () => {
      expect(jobs.length).toBe(4);
    });

    it('every job should have required fields: title and url', () => {
      for (const job of jobs) {
        expect(job.title).toBeTruthy();
        expect(job.url).toBeTruthy();
      }
    });

    it('every url should be an absolute URL', () => {
      for (const job of jobs) {
        expect(job.url).toMatch(/^https?:\/\//);
      }
    });

    it('should build correct absolute URLs from relative /job/{id} hrefs', () => {
      expect(jobs[0].url).toBe('https://acmecorp.jobs.personio.de/job/12345');
      expect(jobs[1].url).toBe('https://acmecorp.jobs.personio.de/job/12346');
    });

    it('should parse locations', () => {
      const withLoc = jobs.filter((j) => j.location);
      expect(withLoc.length).toBeGreaterThan(0);
      expect(jobs[0].location).toBe('Berlin');
    });

    it('should parse departments', () => {
      const withDept = jobs.filter((j) => j.department);
      expect(withDept.length).toBeGreaterThan(0);
      expect(jobs[0].department).toBe('Engineering');
    });

    it('should parse commitment/schedule', () => {
      const withCommitment = jobs.filter((j) => j.commitment);
      expect(withCommitment.length).toBeGreaterThan(0);
    });

    it('should find a known job by title', () => {
      const em = jobs.find((j) => j.title.includes('Engineering Manager'));
      expect(em).toBeDefined();
      expect(em!.url).toContain('/job/12348');
    });
  });

  describe('Edge cases', () => {
    it('should return empty array for empty HTML', () => {
      expect(personioParser('', baseUrl)).toEqual([]);
    });

    it('should return empty array for HTML with no job data', () => {
      expect(personioParser('<html><body>Hello</body></html>', baseUrl)).toEqual([]);
    });

    it('should return empty array for HTML with non-job links', () => {
      const html = '<html><body><a href="/about">About</a></body></html>';
      expect(personioParser(html, baseUrl)).toEqual([]);
    });
  });
});

// ─── XML API Fetch ────────────────────────────────────────────────────────────

describe('personioApiFetch — XML feed', () => {
  afterEach(() => {
    mockFetchHtml.mockReset();
    mockGlobalFetch.mockReset();
    // Restore default: board is alive
    mockGlobalFetch.mockResolvedValue(new Response(null, { status: 200 }));
  });

  it('should parse jobs from cached XML fixture', async () => {
    const xmlContent = loadFixture('personio', 'sample-board.xml');
    mockFetchHtml.mockResolvedValue({ html: xmlContent });

    const result = await personioApiFetch('https://acmecorp.jobs.personio.de');
    expect(result.error).toBeUndefined();
    expect(result.jobs.length).toBe(4);
  });

  it('every job should have title and absolute URL', async () => {
    const xmlContent = loadFixture('personio', 'sample-board.xml');
    mockFetchHtml.mockResolvedValue({ html: xmlContent });

    const { jobs } = await personioApiFetch('https://acmecorp.jobs.personio.de');
    for (const job of jobs) {
      expect(job.title).toBeTruthy();
      expect(job.url).toMatch(/^https:\/\/acmecorp\.jobs\.personio\.de\/job\/\d+/);
    }
  });

  it('should parse location with primary + additional offices', async () => {
    const xmlContent = loadFixture('personio', 'sample-board.xml');
    mockFetchHtml.mockResolvedValue({ html: xmlContent });

    const { jobs } = await personioApiFetch('https://acmecorp.jobs.personio.de');
    // Job 12346: Munich + Remote additional office
    const pm = jobs.find((j) => j.title.includes('Product Manager'));
    expect(pm).toBeDefined();
    expect(pm!.location).toContain('Munich');
    expect(pm!.location).toContain('Remote');

    // Job 12348: Berlin + Munich + Hamburg additional offices
    const em = jobs.find((j) => j.title.includes('Engineering Manager'));
    expect(em).toBeDefined();
    expect(em!.location).toContain('Berlin');
    expect(em!.location).toContain('Munich');
    expect(em!.location).toContain('Hamburg');
  });

  it('should parse departments correctly', async () => {
    const xmlContent = loadFixture('personio', 'sample-board.xml');
    mockFetchHtml.mockResolvedValue({ html: xmlContent });

    const { jobs } = await personioApiFetch('https://acmecorp.jobs.personio.de');
    const eng = jobs.find((j) => j.title.includes('Senior Software'));
    expect(eng!.department).toBe('Engineering');

    const hr = jobs.find((j) => j.title.includes('Working Student'));
    expect(hr!.department).toBe('People & Culture');
  });

  it('should parse team (subcompany) correctly', async () => {
    const xmlContent = loadFixture('personio', 'sample-board.xml');
    mockFetchHtml.mockResolvedValue({ html: xmlContent });

    const { jobs } = await personioApiFetch('https://acmecorp.jobs.personio.de');
    for (const job of jobs) {
      expect(job.team).toBe('Acme Corp');
    }
  });

  it('should build commitment from employmentType + schedule', async () => {
    const xmlContent = loadFixture('personio', 'sample-board.xml');
    mockFetchHtml.mockResolvedValue({ html: xmlContent });

    const { jobs } = await personioApiFetch('https://acmecorp.jobs.personio.de');
    const eng = jobs.find((j) => j.title.includes('Senior Software'));
    expect(eng!.commitment).toBe('permanent, full-time');

    const student = jobs.find((j) => j.title.includes('Working Student'));
    expect(student!.commitment).toBe('intern, part-time');
  });

  it('should detect workplace_type as remote when location contains Remote', async () => {
    const xmlContent = loadFixture('personio', 'sample-board.xml');
    mockFetchHtml.mockResolvedValue({ html: xmlContent });

    const { jobs } = await personioApiFetch('https://acmecorp.jobs.personio.de');
    const pm = jobs.find((j) => j.title.includes('Product Manager'));
    expect(pm!.workplace_type).toBe('remote');
  });

  it('should parse job descriptions as markdown', async () => {
    const xmlContent = loadFixture('personio', 'sample-board.xml');
    mockFetchHtml.mockResolvedValue({ html: xmlContent });

    const { jobs } = await personioApiFetch('https://acmecorp.jobs.personio.de');
    const eng = jobs.find((j) => j.title.includes('Senior Software'));
    expect(eng!.description).toBeDefined();
    expect(eng!.description).toContain('About the role');
    expect(eng!.description).toContain('Requirements');
    expect(eng!.description).toContain('scalable systems');
  });

  it('should handle jobs with empty descriptions (queues fallback fetch)', async () => {
    const xmlContent = loadFixture('personio', 'sample-board.xml');
    // First call: XML feed. Subsequent calls: individual job pages (return empty)
    mockFetchHtml
      .mockResolvedValueOnce({ html: xmlContent })
      .mockResolvedValue({ html: '', error: 'Not found' });

    const { jobs } = await personioApiFetch('https://acmecorp.jobs.personio.de');
    // Engineering Manager has empty jobDescriptions in the fixture
    const em = jobs.find((j) => j.title.includes('Engineering Manager'));
    expect(em).toBeDefined();
    // Description may be undefined if fallback also failed
    // The important thing is the job is still parsed
    expect(em!.title).toBe('Engineering Manager');
    expect(em!.url).toContain('/job/12348');
  });

  it('should return error for fetch failure', async () => {
    mockFetchHtml.mockResolvedValue({ html: '', error: 'Network error' });

    const result = await personioApiFetch('https://acmecorp.jobs.personio.de');
    expect(result.error).toBeDefined();
    expect(result.jobs).toEqual([]);
  });

  it('should return error for non-XML response (e.g. marketing page redirect)', async () => {
    const marketingPageHtml = `<!DOCTYPE html><html><head><title>Personio</title></head>
      <body><h1>Personio - HR Software</h1></body></html>`;
    mockFetchHtml.mockResolvedValue({ html: marketingPageHtml });

    const result = await personioApiFetch('https://statista.jobs.personio.de');
    expect(result.error).toBeDefined();
    expect(result.error).toContain('not a valid Personio XML feed');
    expect(result.jobs).toEqual([]);
  });

  it('should return error for XML with no positions', async () => {
    const emptyXml = '<?xml version="1.0"?><workzag-jobs></workzag-jobs>';
    mockFetchHtml.mockResolvedValue({ html: emptyXml });

    const result = await personioApiFetch('https://empty.jobs.personio.de');
    expect(result.error).toContain('No <position> elements');
    expect(result.jobs).toEqual([]);
  });

  it('should return error for deprecated board that redirects', async () => {
    // Simulate what happens when *.jobs.personio.de redirects to personio.de:
    // fetchHtml follows the redirect and returns the marketing/Vercel checkpoint page
    const vercelCheckpoint = `<!DOCTYPE html><html lang="en" data-astro-cid-nbv56vs3>
      <head><title>Vercel Security Checkpoint</title></head>
      <body>We're verifying your browser</body></html>`;
    mockFetchHtml.mockResolvedValue({ html: vercelCheckpoint });

    const result = await personioApiFetch('https://statista.jobs.personio.de');
    expect(result.error).toBeDefined();
    expect(result.jobs).toEqual([]);
  });
});

// ─── Company Detection ────────────────────────────────────────────────────────

describe('personioApiDetect — company name detection', () => {
  afterEach(() => {
    mockFetchHtml.mockReset();
    mockGlobalFetch.mockReset();
    // Restore default: board is alive
    mockGlobalFetch.mockResolvedValue(new Response(null, { status: 200 }));
  });

  it('should detect company name from XML subcompany field', async () => {
    const xmlContent = loadFixture('personio', 'sample-board.xml');
    mockFetchHtml.mockResolvedValue({ html: xmlContent });

    const result = await personioApiDetect('https://acmecorp.jobs.personio.de');
    expect(result.company).toBe('Acme Corp');
    expect(result.error).toBeUndefined();
  });

  it('should fall back to prettified slug when XML fetch fails', async () => {
    mockFetchHtml.mockResolvedValue({ html: '', error: 'Network error' });

    const result = await personioApiDetect('https://my-company.jobs.personio.de');
    expect(result.company).toBe('My Company');
  });

  it('should fall back to prettified slug when XML has no subcompany', async () => {
    const xmlNoSubcompany = `<?xml version="1.0"?><workzag-jobs>
      <position><id>1</id><name>Dev</name></position></workzag-jobs>`;
    mockFetchHtml.mockResolvedValue({ html: xmlNoSubcompany });

    const result = await personioApiDetect('https://acmecorp.jobs.personio.de');
    expect(result.company).toBe('Acmecorp');
  });

  it('should return error for non-Personio URL', async () => {
    const result = await personioApiDetect('https://example.com/careers');
    expect(result.error).toBeDefined();
    expect(result.company).toBe('');
  });

  it('should handle .com domain variant', async () => {
    const xmlContent = loadFixture('personio', 'sample-board.xml');
    mockFetchHtml.mockResolvedValue({ html: xmlContent });

    const result = await personioApiDetect('https://acmecorp.jobs.personio.com');
    expect(result.company).toBe('Acme Corp');
  });
});

// ─── Deprecated Board Detection (redirect pre-flight) ────────────────────────

describe('Deprecated board detection — *.jobs.personio.de redirect', () => {
  afterEach(() => {
    mockFetchHtml.mockReset();
    mockGlobalFetch.mockReset();
  });

  it('personioApiFetch should fail fast when board redirects to personio.de', async () => {
    // Simulate: HEAD request returns 301 → https://personio.de
    mockGlobalFetch.mockResolvedValue(
      new Response(null, {
        status: 301,
        headers: { Location: 'https://personio.de' },
      }),
    );

    const result = await personioApiFetch('https://statista.jobs.personio.de');
    expect(result.error).toBeDefined();
    expect(result.error).toContain('no longer available');
    expect(result.error).toContain('deprecated');
    expect(result.jobs).toEqual([]);
    // fetchHtml should NOT have been called (pre-flight caught the redirect)
    expect(mockFetchHtml).not.toHaveBeenCalled();
  });

  it('personioApiDetect should fail fast with prettified slug when board is deprecated', async () => {
    mockGlobalFetch.mockResolvedValue(
      new Response(null, {
        status: 301,
        headers: { Location: 'https://personio.de' },
      }),
    );

    const result = await personioApiDetect('https://statista.jobs.personio.de');
    expect(result.company).toBe('Statista');
    expect(result.error).toBeDefined();
    expect(result.error).toContain('no longer available');
    // fetchHtml should NOT have been called
    expect(mockFetchHtml).not.toHaveBeenCalled();
  });

  it('should NOT flag as deprecated when HEAD returns 200 (board is alive)', async () => {
    mockGlobalFetch.mockResolvedValue(
      new Response(null, { status: 200 }),
    );
    const xmlContent = loadFixture('personio', 'sample-board.xml');
    mockFetchHtml.mockResolvedValue({ html: xmlContent });

    const result = await personioApiFetch('https://acmecorp.jobs.personio.de');
    expect(result.error).toBeUndefined();
    expect(result.jobs.length).toBe(4);
  });

  it('should NOT flag as deprecated when redirect stays on same domain', async () => {
    // Redirect from /xml to /xml?lang=en (same domain) is fine
    mockGlobalFetch.mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { Location: 'https://acmecorp.jobs.personio.de/xml?lang=en' },
      }),
    );
    const xmlContent = loadFixture('personio', 'sample-board.xml');
    mockFetchHtml.mockResolvedValue({ html: xmlContent });

    const result = await personioApiFetch('https://acmecorp.jobs.personio.de');
    expect(result.error).toBeUndefined();
    expect(result.jobs.length).toBe(4);
  });

  it('should fall through to normal fetch when pre-flight HEAD fails (network error)', async () => {
    // If HEAD request fails entirely, don't block — let fetchHtml try
    mockGlobalFetch.mockRejectedValue(new Error('Network error'));
    const xmlContent = loadFixture('personio', 'sample-board.xml');
    mockFetchHtml.mockResolvedValue({ html: xmlContent });

    const result = await personioApiFetch('https://acmecorp.jobs.personio.de');
    expect(result.error).toBeUndefined();
    expect(result.jobs.length).toBe(4);
  });

  it('should detect 302 redirect to external domain as deprecated', async () => {
    mockGlobalFetch.mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { Location: 'https://www.example.com/careers' },
      }),
    );

    const result = await personioApiFetch('https://mycompany.jobs.personio.de');
    expect(result.error).toBeDefined();
    expect(result.error).toContain('no longer available');
    expect(result.jobs).toEqual([]);
  });
});

// ─── isPersonioComUrl — URL detection ─────────────────────────────────────────

describe('isPersonioComUrl — corporate careers URL detection', () => {
  it('should match personio.com/about-personio/careers/', () => {
    expect(isPersonioComUrl('https://www.personio.com/about-personio/careers/')).toBe(true);
  });

  it('should match personio.com/about-personio/careers (no trailing slash)', () => {
    expect(isPersonioComUrl('https://www.personio.com/about-personio/careers')).toBe(true);
  });

  it('should match personio.com/careers/ (direct path)', () => {
    expect(isPersonioComUrl('https://www.personio.com/careers/')).toBe(true);
  });

  it('should match without www prefix', () => {
    expect(isPersonioComUrl('https://personio.com/about-personio/careers/')).toBe(true);
  });

  it('should NOT match *.jobs.personio.de URLs', () => {
    expect(isPersonioComUrl('https://acmecorp.jobs.personio.de')).toBe(false);
  });

  it('should NOT match personio.com root or other pages', () => {
    expect(isPersonioComUrl('https://www.personio.com/')).toBe(false);
    expect(isPersonioComUrl('https://www.personio.com/about-personio/')).toBe(false);
  });

  it('should NOT match non-personio domains', () => {
    expect(isPersonioComUrl('https://example.com/careers/')).toBe(false);
  });
});

// ─── Personio.com Corporate API ───────────────────────────────────────────────

describe('personioComApiFetch — corporate JSON API', () => {
  afterEach(() => {
    mockFetchJson.mockReset();
    mockGlobalFetch.mockReset();
    mockGlobalFetch.mockResolvedValue(new Response(null, { status: 200 }));
  });

  it('should parse jobs from cached API fixture', async () => {
    const apiData = loadJsonFixture('personio', 'personio-com-api.json');
    mockFetchJson.mockResolvedValue({ data: apiData });

    const result = await personioComApiFetch('https://www.personio.com/about-personio/careers/');
    expect(result.error).toBeUndefined();
    expect(result.jobs.length).toBe(8);
  });

  it('every job should have title and absolute URL', async () => {
    const apiData = loadJsonFixture('personio', 'personio-com-api.json');
    mockFetchJson.mockResolvedValue({ data: apiData });

    const { jobs } = await personioComApiFetch('https://www.personio.com/about-personio/careers/');
    for (const job of jobs) {
      expect(job.title).toBeTruthy();
      expect(job.url).toMatch(/^https:\/\/www\.personio\.com\/careers\/[a-f0-9-]+\/$/);
    }
  });

  it('should build location from office + otherOffices', async () => {
    const apiData = loadJsonFixture('personio', 'personio-com-api.json');
    mockFetchJson.mockResolvedValue({ data: apiData });

    const { jobs } = await personioComApiFetch('https://www.personio.com/about-personio/careers/');

    // Single office job
    const singleOffice = jobs.find(j => j.title.includes('New Logo - Medium Business'));
    expect(singleOffice).toBeDefined();
    expect(singleOffice!.location).toBe('Berlin');

    // Multi-office job
    const multiOffice = jobs.find(j => j.title.includes('Existing Business'));
    expect(multiOffice).toBeDefined();
    expect(multiOffice!.location).toContain('Munich');
    expect(multiOffice!.location).toContain('Berlin');
  });

  it('should detect remote workplace_type from office name', async () => {
    const apiData = loadJsonFixture('personio', 'personio-com-api.json');
    mockFetchJson.mockResolvedValue({ data: apiData });

    const { jobs } = await personioComApiFetch('https://www.personio.com/about-personio/careers/');

    // Remote Germany job
    const remoteJob = jobs.find(j => j.title.includes('Compliance Expert'));
    expect(remoteJob).toBeDefined();
    expect(remoteJob!.workplace_type).toBe('remote');
  });

  it('should parse department correctly', async () => {
    const apiData = loadJsonFixture('personio', 'personio-com-api.json');
    mockFetchJson.mockResolvedValue({ data: apiData });

    const { jobs } = await personioComApiFetch('https://www.personio.com/about-personio/careers/');

    const techJob = jobs.find(j => j.title.includes('API Integration Engineer'));
    expect(techJob).toBeDefined();
    expect(techJob!.department).toBe('Customer Experience');
  });

  it('should parse commitment/employmentType', async () => {
    const apiData = loadJsonFixture('personio', 'personio-com-api.json');
    mockFetchJson.mockResolvedValue({ data: apiData });

    const { jobs } = await personioComApiFetch('https://www.personio.com/about-personio/careers/');
    for (const job of jobs) {
      expect(job.commitment).toBe('Full Time');
    }
  });

  it('should return error for API fetch failure', async () => {
    mockFetchJson.mockResolvedValue({ data: null, error: 'Network error' });

    const result = await personioComApiFetch('https://www.personio.com/about-personio/careers/');
    expect(result.error).toBeDefined();
    expect(result.jobs).toEqual([]);
  });

  it('should return error for non-array API response', async () => {
    mockFetchJson.mockResolvedValue({ data: { error: 'not found' } });

    const result = await personioComApiFetch('https://www.personio.com/about-personio/careers/');
    expect(result.error).toContain('Unexpected response');
    expect(result.jobs).toEqual([]);
  });

  it('should handle empty jobs array', async () => {
    mockFetchJson.mockResolvedValue({ data: [] });

    const result = await personioComApiFetch('https://www.personio.com/about-personio/careers/');
    expect(result.error).toBeUndefined();
    expect(result.jobs).toEqual([]);
  });
});

// ─── personioApiFetch dispatch ────────────────────────────────────────────────

describe('personioApiFetch — dispatch to corporate API for personio.com', () => {
  afterEach(() => {
    mockFetchHtml.mockReset();
    mockFetchJson.mockReset();
    mockGlobalFetch.mockReset();
    mockGlobalFetch.mockResolvedValue(new Response(null, { status: 200 }));
  });

  it('should use corporate JSON API for personio.com/about-personio/careers/', async () => {
    const apiData = loadJsonFixture('personio', 'personio-com-api.json');
    mockFetchJson.mockResolvedValue({ data: apiData });

    const result = await personioApiFetch('https://www.personio.com/about-personio/careers/');
    expect(result.error).toBeUndefined();
    expect(result.jobs.length).toBe(8);
    // Should have called fetchJson, NOT fetchHtml
    expect(mockFetchJson).toHaveBeenCalled();
    expect(mockFetchHtml).not.toHaveBeenCalled();
  });

  it('should use XML feed for *.jobs.personio.de URLs', async () => {
    const xmlContent = loadFixture('personio', 'sample-board.xml');
    mockFetchHtml.mockResolvedValue({ html: xmlContent });

    const result = await personioApiFetch('https://acmecorp.jobs.personio.de');
    expect(result.error).toBeUndefined();
    expect(result.jobs.length).toBe(4);
    // Should have called fetchHtml (XML), NOT fetchJson
    expect(mockFetchHtml).toHaveBeenCalled();
    expect(mockFetchJson).not.toHaveBeenCalled();
  });
});

// ─── personioApiDetect — corporate URL ────────────────────────────────────────

describe('personioApiDetect — corporate URL detection', () => {
  afterEach(() => {
    mockFetchHtml.mockReset();
    mockGlobalFetch.mockReset();
    mockGlobalFetch.mockResolvedValue(new Response(null, { status: 200 }));
  });

  it('should return "Personio" for personio.com/about-personio/careers/', async () => {
    const result = await personioApiDetect('https://www.personio.com/about-personio/careers/');
    expect(result.company).toBe('Personio');
    expect(result.error).toBeUndefined();
    // Should NOT call any fetch (hardcoded company name)
    expect(mockFetchHtml).not.toHaveBeenCalled();
  });
});
