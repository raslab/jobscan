import { Router, Request, Response } from 'express';
import { runSync, runSyncOneSource } from '../sync';
import * as db from '../db/index';

const router = Router();

/**
 * In-flight per-source syncs keyed by sync session id. POST /api/sync/complete
 * awaits these before writing completed_at, so a sync is only marked complete
 * after all of its backend work has stopped (each source sync is itself bounded
 * by the server-side SOURCE_SYNC_DEADLINE_MS).
 */
const inFlightBySyncId = new Map<number, Set<Promise<unknown>>>();

function trackInFlight(syncId: number, promise: Promise<unknown>): void {
  let set = inFlightBySyncId.get(syncId);
  if (!set) {
    set = new Set();
    inFlightBySyncId.set(syncId, set);
  }
  set.add(promise);
  const settle = () => {
    const s2 = inFlightBySyncId.get(syncId);
    if (s2) {
      s2.delete(promise);
      if (s2.size === 0) inFlightBySyncId.delete(syncId);
    }
  };
  promise.then(settle, settle);
}

/** Test/inspection helper: pending backend work for a sync session. */
export function pendingSyncWork(syncId: number): Promise<unknown>[] {
  return Array.from(inFlightBySyncId.get(syncId) ?? []);
}

// POST /api/sync — trigger full sync
router.post('/', async (_req: Request, res: Response) => {
  try {
    const summary = await runSync();
    res.json(summary);
  } catch (err) {
    res
      .status(500)
      .json({ error: `Sync failed: ${err instanceof Error ? err.message : String(err)}` });
  }
});

// POST /api/sync/start — create a shared sync session (returns syncId)
router.post('/start', async (_req: Request, res: Response) => {
  try {
    const syncId = await db.startSyncLog();
    res.json({ syncId });
  } catch (err) {
    res
      .status(500)
      .json({ error: `Failed to start sync session: ${err instanceof Error ? err.message : String(err)}` });
  }
});

// POST /api/sync/complete — mark a sync session as completed
router.post('/complete', async (req: Request, res: Response) => {
  const { syncId, sourcesCount, newJobs } = req.body as {
    syncId?: number; sourcesCount?: number; newJobs?: number;
  };
  if (!syncId || !Number.isInteger(syncId)) {
    res.status(400).json({ error: 'syncId is required' });
    return;
  }
  try {
    // Wait for all in-flight backend source syncs of this session to stop
    // before marking the session complete. The client-supplied newJobs is
    // ignored: the count is computed server-side from jobs rows belonging to
    // this sync.
    await Promise.allSettled(pendingSyncWork(syncId));
    const newJobsServer = await db.countJobsBySyncId(syncId);
    await db.completeSyncLog(syncId, sourcesCount ?? 0, newJobsServer);
    res.json({ ok: true, syncId, newJobs: newJobsServer });
  } catch (err) {
    res
      .status(500)
      .json({ error: `Failed to complete sync session: ${err instanceof Error ? err.message : String(err)}` });
  }
});

// POST /api/sync/:sourceId — sync a single source
router.post('/:sourceId', async (req: Request, res: Response) => {
  const sourceId = Number(req.params.sourceId);
  if (!sourceId || isNaN(sourceId)) {
    res.status(400).json({ error: 'Invalid source ID' });
    return;
  }
  // Accept optional syncId from request body (batch orchestration)
  const bodySyncId = req.body?.syncId;
  const existingSyncId = (typeof bodySyncId === 'number' && Number.isInteger(bodySyncId) && bodySyncId > 0)
    ? bodySyncId
    : undefined;
  try {
    const promise = runSyncOneSource(sourceId, existingSyncId);
    if (existingSyncId) trackInFlight(existingSyncId, promise);
    const result = await promise;
    res.json(result);
  } catch (err) {
    // Return 200 with error payload so OAuth proxies don't treat it as their own error
    const errorMsg = err instanceof Error ? err.message : String(err);
    res.json({ sourceId, status: 'error', newJobs: 0, error: `Sync failed: ${errorMsg}` });
  }
});

// GET /api/sync/sources — return sources ordered by staleness for sync UI
router.get('/sources', async (_req: Request, res: Response) => {
  const sources = await db.getSourcesForSync();
  res.json(sources);
});

// GET /api/sync/latest — return latest completed sync log entry
router.get('/latest', async (_req: Request, res: Response) => {
  const latest = await db.getLatestSyncLog();
  if (!latest) {
    res.json(null);
    return;
  }
  res.json(latest);
});

export default router;
