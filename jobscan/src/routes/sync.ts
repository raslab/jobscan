import { Router, Request, Response } from 'express';
import { runSync, runSyncOneSource } from '../sync';
import * as db from '../db/index';

const router = Router();

/**
 * In-flight per-source syncs keyed by shared syncId.
 *
 * The browser may abort its fetch for a slow source, but the backend keeps
 * working on it. POST /api/sync/complete awaits these promises so the sync
 * session is only marked complete after all its backend work has stopped
 * (each source sync is itself bounded by the server-side deadline).
 */
const inFlightBySyncId = new Map<number, Set<Promise<unknown>>>();

function trackInFlightSourceSync(syncId: number, promise: Promise<unknown>): void {
  let set = inFlightBySyncId.get(syncId);
  if (!set) {
    set = new Set();
    inFlightBySyncId.set(syncId, set);
  }
  // Settled-handler never rejects (cleanup cannot throw), so tracking an
  // already-rejected work promise cannot produce an unhandled rejection.
  const tracked: Promise<void> = promise.then(
    (): void => removeTracked(syncId, tracked),
    (): void => removeTracked(syncId, tracked),
  );
  set.add(tracked);
}

function removeTracked(syncId: number, tracked: Promise<unknown>): void {
  const set = inFlightBySyncId.get(syncId);
  if (!set) return;
  set.delete(tracked);
  if (set.size === 0) inFlightBySyncId.delete(syncId);
}

async function waitForInFlightSourceSyncs(syncId: number): Promise<void> {
  // Snapshot-and-loop: a settled sync must not be raced by a late registration.
  for (;;) {
    const pending = inFlightBySyncId.get(syncId);
    if (!pending || pending.size === 0) return;
    await Promise.allSettled([...pending]);
  }
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
    // Do not mark the session complete while its backend source syncs are
    // still running (they drain, bounded by the server-side deadline).
    await waitForInFlightSourceSyncs(syncId);
    // Server-side new-job count: rows that actually belong to this sync.
    // The client-supplied newJobs (which undercounts timed-out sources) is
    // deliberately ignored.
    const serverNewJobs = await db.countJobsBySyncId(syncId);
    await db.completeSyncLog(syncId, sourcesCount ?? 0, serverNewJobs);
    res.json({ ok: true, syncId, newJobs: serverNewJobs });
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
    if (existingSyncId !== undefined) {
      // Track the work so /api/sync/complete can wait for it before closing
      // the session, even if the browser aborts this request.
      const work = runSyncOneSource(sourceId, existingSyncId);
      trackInFlightSourceSync(existingSyncId, work);
      res.json(await work);
    } else {
      const result = await runSyncOneSource(sourceId);
      res.json(result);
    }
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
