/**
 * Route tests for POST /api/sync/complete and POST /api/sync/:sourceId.
 *
 * Verifies:
 *   - the new-job count written to the sync log is computed server-side from
 *     jobs rows belonging to the sync (countJobsBySyncId), ignoring the
 *     client-supplied newJobs;
 *   - /api/sync/complete does not write completed_at until in-flight source
 *     syncs for that syncId have stopped.
 */

jest.mock('../../db/index', () => ({
  startSyncLog: jest.fn(),
  completeSyncLog: jest.fn(),
  countJobsBySyncId: jest.fn(),
  getSourcesForSync: jest.fn(),
  getLatestSyncLog: jest.fn(),
}));

jest.mock('../../sync', () => ({
  runSync: jest.fn(),
  runSyncOneSource: jest.fn(),
}));

import { Request, Response } from 'express';
import syncRouter, { pendingSyncWork } from '../../routes/sync';
import * as db from '../../db/index';
import * as syncModule from '../../sync';

const mockedDb = db as jest.Mocked<typeof db>;
const mockedSync = syncModule as jest.Mocked<typeof syncModule>;

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
  const res = {} as Response & { statusCode: number; body?: unknown };
  res.statusCode = 200;
  res.status = ((code: number) => {
    res.statusCode = code;
    return res;
  }) as Response['status'];
  res.json = ((payload: unknown) => {
    res.body = payload;
    return res;
  }) as Response['json'];
  return res;
}

const completeHandler = findHandler('/complete', 'post');
const sourceHandler = findHandler('/:sourceId', 'post');

beforeEach(() => {
  jest.resetAllMocks();
});

describe('POST /api/sync/complete', () => {
  it('ignores the client newJobs and stores the server-computed count', async () => {
    mockedDb.countJobsBySyncId.mockResolvedValue(404461);
    mockedDb.completeSyncLog.mockResolvedValue(undefined);

    const res = mockRes();
    await completeHandler(
      { body: { syncId: 1, sourcesCount: 10, newJobs: 161305 } } as unknown as Request,
      res,
    );

    expect(res.statusCode).toBe(200);
    expect(mockedDb.completeSyncLog).toHaveBeenCalledWith(1, 10, 404461);
    expect((res.body as { newJobs: number }).newJobs).toBe(404461);
  });

  it('rejects a missing syncId with 400', async () => {
    const res = mockRes();
    await completeHandler({ body: {} } as unknown as Request, res);
    expect(res.statusCode).toBe(400);
    expect(mockedDb.completeSyncLog).not.toHaveBeenCalled();
  });

  it('waits for in-flight source syncs of the session before writing completed_at', async () => {
    let resolveSlow: (value: unknown) => void = () => {};
    const slowSync = new Promise((resolve) => { resolveSlow = resolve; });

    // Register an in-flight source sync the same way POST /api/sync/:sourceId does.
    mockedSync.runSyncOneSource.mockReturnValue(slowSync as never);
    const sourceRes = mockRes();
    const sourceReqPromise = sourceHandler(
      { params: { sourceId: '5' }, body: { syncId: 3 } } as unknown as Request,
      sourceRes,
    );

    expect(pendingSyncWork(3).length).toBe(1);

    // Fire /complete while the source sync is still running.
    const completeRes = mockRes();
    const completePromise = completeHandler(
      { body: { syncId: 3, sourcesCount: 1, newJobs: 0 } } as unknown as Request,
      completeRes,
    );

    // Give the complete handler a chance to (incorrectly) proceed.
    await Promise.resolve();
    await Promise.resolve();
    expect(mockedDb.completeSyncLog).not.toHaveBeenCalled();

    // Now let the in-flight source sync finish.
    resolveSlow({ sourceId: 5, company: 'X', status: 'ok', newJobs: 7, totalJobs: 7 });
    await sourceReqPromise;
    await completePromise;

    expect(mockedDb.completeSyncLog).toHaveBeenCalledTimes(1);
    expect(mockedDb.countJobsBySyncId).toHaveBeenCalledWith(3);
    expect(pendingSyncWork(3).length).toBe(0);
  });
});
