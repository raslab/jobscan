import { Router, Request, Response } from 'express';
import { runSync, runSyncOneSource } from '../sync';
import * as db from '../db/index';

const router = Router();

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
    await db.completeSyncLog(syncId, sourcesCount ?? 0, newJobs ?? 0);
    res.json({ ok: true });
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
    const result = await runSyncOneSource(sourceId, existingSyncId);
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
