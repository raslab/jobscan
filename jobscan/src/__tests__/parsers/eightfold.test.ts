import { loadFixture, loadJsonFixture } from '../helpers/fixture-loader';

jest.mock('../../fetch-utils', () => ({
  fetchHtml: jest.fn(),
  fetchJson: jest.fn(),
  sleep: jest.fn().mockResolvedValue(undefined),
}));

import { eightfoldApiFetch, eightfoldDetect } from '../../parsers/eightfold';
import { detectParserFromUrl } from '../../parsers/registry';
import { fetchHtml, fetchJson } from '../../fetch-utils';

const mockFetchHtml = fetchHtml as jest.MockedFunction<typeof fetchHtml>;
const mockFetchJson = fetchJson as jest.MockedFunction<typeof fetchJson>;

const INLINE_JSON_CASES = [
  {
    label: 'PTC',
    url: 'https://ptc.eightfold.ai/careers',
    company: 'PTC',
    htmlFixture: 'ptc-careers.html',
    apiFixture: 'ptc-pcsx-page1.json',
    knownTitle: 'Sr. Full-stack Engineer',
    knownLocation: 'Budapest, Hungary',
  },
  {
    label: 'Morgan Stanley',
    url: 'https://morganstanley.eightfold.ai/careers',
    company: 'Morgan Stanley',
    htmlFixture: 'morganstanley-careers.html',
    apiFixture: 'morganstanley-pcsx-page1.json',
    knownTitle: 'Executive Director & ETF Product Specialist, UK',
    knownLocation: 'London, United Kingdom',
  },
  {
    label: 'Deutsche Telekom',
    url: 'https://telekom-growthhub.eightfold.ai/careers',
    company: 'Deutsche Telekom',
    htmlFixture: 'telekom-growthhub-careers.html',
    apiFixture: 'telekom-growthhub-pcsx-page1.json',
    knownTitle: 'Senior SQL Developer with SAP BW4/Hana',
    knownLocation: 'Romania',
  },
  {
    label: 'Eightfold',
    url: 'https://app.eightfold.ai/careers',
    company: 'Eightfold',
    htmlFixture: 'app-careers.html',
    apiFixture: 'app-pcsx-page1.json',
    knownTitle: 'Senior Engineer, DevOps',
    knownLocation: 'Bangalore, India',
  },
] as const;

const LEGACY_CASES = [
  {
    label: 'Northrop Grumman',
    url: 'https://ngc.eightfold.ai/careers',
    company: 'Northrop Grumman',
    htmlFixture: 'ngc-careers.html',
    apiFixture: 'ngc-pcsx-page1.json',
    knownTitle: 'Staff Guidance Navigation and Controls Engineer',
    knownLocation: 'United States-Florida-Melbourne',
  },
  {
    label: 'Netflix',
    url: 'http://netflix.eightfold.ai/careers',
    company: 'Netflix',
    htmlFixture: 'netflix-careers.html',
    apiFixture: 'netflix-standard-page1.json',
    knownTitle: 'Retail Manager, Consumer Products - DACH',
    knownLocation: 'Germany - Remote',
  },
] as const;

const ALL_CASES = [...INLINE_JSON_CASES, ...LEGACY_CASES] as const;

describe('detectParserFromUrl — Eightfold patterns', () => {
  it.each(ALL_CASES)('detects $label board as eightfold', ({ url }) => {
    expect(detectParserFromUrl(url)).toBe('eightfold');
  });
});

describe('eightfoldApiFetch — newer inline-JSON PCS boards', () => {
  afterEach(() => {
    mockFetchHtml.mockReset();
    mockFetchJson.mockReset();
  });

  it.each(INLINE_JSON_CASES)('parses $label jobs from cached fixtures', async ({ url, htmlFixture, apiFixture, knownTitle, knownLocation }) => {
    mockFetchHtml.mockResolvedValue({ html: loadFixture('eightfold', htmlFixture) });
    mockFetchJson
      .mockResolvedValueOnce({ data: loadJsonFixture('eightfold', apiFixture) })
      .mockResolvedValueOnce({ data: { status: 200, data: { count: 10, positions: [] } } });

    const result = await eightfoldApiFetch(url);

    expect(result.error).toBeUndefined();
    expect(result.jobs.length).toBeGreaterThan(0);

    for (const job of result.jobs) {
      expect(job.title).toBeTruthy();
      expect(job.url).toMatch(/^https:\/\/.+\.eightfold\.ai\/careers\/job\/\d+$/);
    }

    const knownJob = result.jobs.find((job) => job.title === knownTitle);
    expect(knownJob).toBeDefined();
    expect(knownJob?.location).toBe(knownLocation);
  });

  it('normalises work location options from PCSX payloads', async () => {
    mockFetchHtml.mockResolvedValue({ html: loadFixture('eightfold', 'ptc-careers.html') });
    mockFetchJson
      .mockResolvedValueOnce({ data: loadJsonFixture('eightfold', 'ptc-pcsx-page1.json') })
      .mockResolvedValueOnce({ data: { status: 200, data: { count: 10, positions: [] } } });

    const { jobs } = await eightfoldApiFetch('https://ptc.eightfold.ai/careers');

    expect(jobs.some((job) => job.workplace_type === 'On-site')).toBe(true);
  });
});

describe('eightfoldApiFetch — legacy boards still supported', () => {
  afterEach(() => {
    mockFetchHtml.mockReset();
    mockFetchJson.mockReset();
  });

  it.each(LEGACY_CASES)('parses $label jobs from cached fixtures', async ({ url, htmlFixture, apiFixture, knownTitle, knownLocation }) => {
    mockFetchHtml.mockResolvedValue({ html: loadFixture('eightfold', htmlFixture) });
    mockFetchJson
      .mockResolvedValueOnce({ data: loadJsonFixture('eightfold', apiFixture) })
      .mockResolvedValueOnce({ data: { count: 10, positions: [] } });

    const result = await eightfoldApiFetch(url);

    expect(result.error).toBeUndefined();
    expect(result.jobs.length).toBeGreaterThan(0);

    const knownJob = result.jobs.find((job) => job.title === knownTitle);
    expect(knownJob).toBeDefined();
    expect(knownJob?.location).toBe(knownLocation);
  });

  it('keeps legacy standard-mode Eightfold job URLs on the original origin', async () => {
    mockFetchHtml.mockResolvedValue({ html: loadFixture('eightfold', 'netflix-careers.html') });
    mockFetchJson
      .mockResolvedValueOnce({ data: loadJsonFixture('eightfold', 'netflix-standard-page1.json') })
      .mockResolvedValueOnce({ data: { count: 10, positions: [] } });

    const { jobs } = await eightfoldApiFetch('http://netflix.eightfold.ai/careers');

    expect(jobs.length).toBeGreaterThan(0);
    for (const job of jobs) {
      expect(job.url).toMatch(/^http:\/\/netflix\.eightfold\.ai\/careers\/job\/\d+$/);
    }
  });
});

describe('eightfoldDetect — newer inline-JSON PCS boards', () => {
  afterEach(() => {
    mockFetchHtml.mockReset();
    mockFetchJson.mockReset();
  });

  it.each(INLINE_JSON_CASES)('detects company name for $label from HTML bootstrap data', async ({ url, htmlFixture, company }) => {
    mockFetchHtml.mockResolvedValue({ html: loadFixture('eightfold', htmlFixture) });

    const result = await eightfoldDetect(url);

    expect(result.error).toBeUndefined();
    expect(result.company).toBe(company);
    expect(mockFetchJson).not.toHaveBeenCalled();
  });

  it('detects company name for Northrop Grumman from legacy HTML fallback', async () => {
    mockFetchHtml.mockResolvedValue({ html: loadFixture('eightfold', 'ngc-careers.html') });

    const result = await eightfoldDetect('https://ngc.eightfold.ai/careers');

    expect(result.error).toBeUndefined();
    expect(result.company).toBe('Northrop Grumman');
    expect(mockFetchJson).not.toHaveBeenCalled();
  });

  it('detects company name for Netflix via the legacy standard jobs API', async () => {
    mockFetchHtml.mockResolvedValue({ html: loadFixture('eightfold', 'netflix-careers.html') });
    mockFetchJson.mockResolvedValue({
      data: {
        branding: {
          navBar: { title: 'Netflix' },
        },
      },
    });

    const result = await eightfoldDetect('http://netflix.eightfold.ai/careers');

    expect(result.error).toBeUndefined();
    expect(result.company).toBe('Netflix');
    expect(mockFetchJson).toHaveBeenCalledTimes(1);
  });
});
