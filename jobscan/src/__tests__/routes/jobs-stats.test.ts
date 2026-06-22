import jobsRouter from '../../routes/jobs';
import * as db from '../../db/index';
import { Request, Response } from 'express';

jest.mock('../../db/index', () => ({
  getJobCounts: jest.fn(),
  getJobStats: jest.fn(),
  getSources: jest.fn(),
}));

const mockedDb = db as jest.Mocked<typeof db>;

function getStatsHandler() {
  const layer = (jobsRouter as unknown as {
    stack: Array<{
      route?: {
        path: string;
        methods: Record<string, boolean>;
        stack: Array<{ handle: (req: Request, res: Response) => Promise<void> }>;
      };
    }>;
  }).stack.find(entry => entry.route?.path === '/stats' && entry.route.methods.get);

  if (!layer?.route) {
    throw new Error('GET /stats handler not found');
  }

  return layer.route.stack[0].handle;
}

describe('GET /api/jobs/stats', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockedDb.getJobCounts.mockResolvedValue({
      totalJobs: 123,
      totalSources: 456,
    });
    mockedDb.getJobStats.mockResolvedValue({
      totalJobs: 123,
      totalSources: 456,
      companies: ['Acme'],
      locations: ['Berlin'],
      departments: ['Engineering'],
      workplaceTypes: ['remote'],
      commitmentTypes: ['full-time'],
    });
    mockedDb.getSources.mockResolvedValue([
      {
        id: 1,
        company: 'Acme',
        url: 'https://example.com/jobs',
        parser: 'greenhouse',
        added_at: '2026-04-29T00:00:00.000Z',
        last_synced: null,
        last_status: null,
        last_error: null,
        last_count: null,
      },
    ]);
  });

  it('does not include sources by default', async () => {
    const handler = getStatsHandler();
    const json = jest.fn();
    const res = { json, status: jest.fn().mockReturnThis() } as unknown as Response;
    const req = { query: {} } as Request;

    await handler(req, res);

    expect(json).toHaveBeenCalledWith({
      totalJobs: 123,
      totalSources: 456,
    });
    expect(mockedDb.getJobCounts).toHaveBeenCalledTimes(1);
    expect(mockedDb.getJobStats).not.toHaveBeenCalled();
    expect(mockedDb.getSources).not.toHaveBeenCalled();
  });

  it('includes filters when explicitly requested', async () => {
    const handler = getStatsHandler();
    const json = jest.fn();
    const res = { json, status: jest.fn().mockReturnThis() } as unknown as Response;
    const req = { query: { includeFilters: 'true' } } as unknown as Request;

    await handler(req, res);

    expect(json).toHaveBeenCalledWith({
      totalJobs: 123,
      totalSources: 456,
      companies: ['Acme'],
      locations: ['Berlin'],
      departments: ['Engineering'],
      workplaceTypes: ['remote'],
      commitmentTypes: ['full-time'],
    });
    expect(mockedDb.getJobCounts).toHaveBeenCalledTimes(1);
    expect(mockedDb.getJobStats).toHaveBeenCalledTimes(1);
    expect(mockedDb.getSources).not.toHaveBeenCalled();
  });

  it('includes sources when explicitly requested', async () => {
    const handler = getStatsHandler();
    const json = jest.fn();
    const res = { json, status: jest.fn().mockReturnThis() } as unknown as Response;
    const req = { query: { includeSources: 'true' } } as unknown as Request;

    await handler(req, res);

    expect(json).toHaveBeenCalledWith({
      totalJobs: 123,
      totalSources: 456,
      sources: [
        {
          id: 1,
          company: 'Acme',
          url: 'https://example.com/jobs',
          parser: 'greenhouse',
          added_at: '2026-04-29T00:00:00.000Z',
          last_synced: null,
          last_status: null,
          last_error: null,
          last_count: null,
        },
      ],
    });
    expect(mockedDb.getJobCounts).toHaveBeenCalledTimes(1);
    expect(mockedDb.getJobStats).not.toHaveBeenCalled();
    expect(mockedDb.getSources).toHaveBeenCalledTimes(1);
  });

  it('includes filters and sources together when both flags are requested', async () => {
    const handler = getStatsHandler();
    const json = jest.fn();
    const res = { json, status: jest.fn().mockReturnThis() } as unknown as Response;
    const req = { query: { includeFilters: '1', includeSources: '1' } } as unknown as Request;

    await handler(req, res);

    expect(json).toHaveBeenCalledWith({
      totalJobs: 123,
      totalSources: 456,
      companies: ['Acme'],
      locations: ['Berlin'],
      departments: ['Engineering'],
      workplaceTypes: ['remote'],
      commitmentTypes: ['full-time'],
      sources: [
        {
          id: 1,
          company: 'Acme',
          url: 'https://example.com/jobs',
          parser: 'greenhouse',
          added_at: '2026-04-29T00:00:00.000Z',
          last_synced: null,
          last_status: null,
          last_error: null,
          last_count: null,
        },
      ],
    });
    expect(mockedDb.getJobCounts).toHaveBeenCalledTimes(1);
    expect(mockedDb.getJobStats).toHaveBeenCalledTimes(1);
    expect(mockedDb.getSources).toHaveBeenCalledTimes(1);
  });
});
