/**
 * Route tests for POST /api/sync/complete and POST /api/sync/:sourceId
 * (issue #1): server-side new-job counts and complete-waits-for-in-flight.
 */
import syncRouter from '../../routes/sync';
import * as db from '../../db/index';
import { runSync, runSyncOneSource } from '../../sync';
import { Request, Response } from 'express';

jest.mock('../../db/index', () => ({
  startSyncLog: jest.fn(),
  completeSyncLog: jest.fn(),
  countJobsBySyncId: jest.fn(),
  getLatestSyncLog: jest.fn(),
  getSourcesForSync: jest.fn(),
}));

jest.mock('../../sync', () => ({
  runSync: jest.fn(),
  runSyncOneSource: jest.fn(),
}));

const mockedDb = db as jest.Mocked<typeof db>;
const mockedRunSyncOneSource = runSyncOneSource as jest.MockedFunction<typeof runSyncOneSource>;

function findHandler(path: string, method: 'post' | 'get') {
  const layer = (syncRouter as unknown as {
    stack: Array<{
      route?: {
        path: string;
        methods: Record<string, boolean>;
        stack: Array<{ handle: (req: Request, res: Response) => Promise<void> }>;
      };
    }>;
  }).stack.find((entry) => entry.route?.path === path && entry.route.methods[method]);
  if (!layer?.route) throw new Error(`${method.toUpperCase()} ${path} handler not found`);
  return layer.route.stack[0].handle;
}

function mockRes() {
  const json = jest.fn();
  const res = { json, status: jest.fn().mockReturnThis() } as unknown as Response & {
    json: jest.Mock;
    status: jest.Mock;
  };
  return res;
}

beforeEach(() => {
  jest.resetAllMocks();
  mockedDb.completeSyncLog.mockResolvedValue(undefined);
  mockedDb.countJobsBySyncId.mockResolvedValue(404461);
});

describe('POST /api/sync/complete', () => {
  it('stores new_jobs from the DB count for the syncId, ignoring the client-sent count', async () => {
    const handler = findHandler('/complete', 'post');
    const res = mockRes();
    const req = { body: { syncId: 1, sourcesCount: 10, newJobs: 161305 } } as Request;

    await handler(req, res);

    expect(mockedDb.countJobsBySyncId).toHaveBeenCalledWith(1);
    expect(mockedDb.completeSyncLog).toHaveBeenCalledWith(1, 10, 404461);
    expect(res.json).toHaveBeenCalledWith({ ok: true, syncId: 1, newJobs: 404461 });
  });

  it('does not write completed_at until in-flight source syncs for the syncId have stopped', async () => {
    const sourceHandler = findHandler('/:sourceId', 'post');
    const completeHandler = findHandler('/complete', 'post');

    // Slow stubbed source sync — resolves only when we say so.
    let finishWork!: (r: unknown) => void;
    const workPromise = new Promise((resolve) => { finishWork = resolve; });
    mockedRunSyncOneSource.mockReturnValue(workPromise as never);

    // Kick off a batch-orchestrated source sync (shares syncId 5).
    const sourceRes = mockRes();
    const sourceReq = { params: { sourceId: '1' }, body: { syncId: 5 } } as unknown as Request;
    const sourceCall = sourceHandler(sourceReq, sourceRes);

    // Request completion while the source sync is still in flight.
    const completeRes = mockRes();
    const completeReq = { body: { syncId: 5, sourcesCount: 1, newJobs: 0 } } as Request;
    const completeCall = completeHandler(completeReq, completeRes);

    // Let the handlers progress; completeSyncLog must NOT have run yet.
    await new Promise((setImmediate_) => setImmediate(setImmediate_));
    expect(mockedDb.completeSyncLog).not.toHaveBeenCalled();

    // Backend work stops → completion may proceed.
    finishWork({ sourceId: 1, company: 'Acme', status: 'timed-out', newJobs: 1200, totalJobs: 1200 });
    await Promise.all([sourceCall, completeCall]);

    expect(mockedDb.completeSyncLog).toHaveBeenCalledTimes(1);
    expect(mockedDb.completeSyncLog).toHaveBeenCalledWith(5, 1, 404461);
    expect(completeRes.json).toHaveBeenCalledWith({ ok: true, syncId: 5, newJobs: 404461 });
  });

  it('rejects a missing syncId', async () => {
    const handler = findHandler('/complete', 'post');
    const res = mockRes();
    await handler({ body: {} } as Request, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockedDb.completeSyncLog).not.toHaveBeenCalled();
  });
});
