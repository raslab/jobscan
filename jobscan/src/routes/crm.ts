import { Router, Request, Response } from 'express';
import * as db from '../db/index';
import { CrmBucket, CrmTier } from '../types';

const router = Router();

const VALID_BUCKETS = new Set<CrmBucket>([
  'sourced', 'filtered', 'processed', 'applied', 'disqualified', 'auto_disqualified',
]);

// ─── CRM Jobs ─────────────────────────────────────────────────────────────────

/** POST /api/crm/jobs — Add job(s) to CRM */
router.post('/jobs', async (req: Request, res: Response) => {
  try {
    const { jobIds, bucket = 'sourced', comment, reason } = req.body as {
      jobIds: number[];
      bucket?: CrmBucket;
      comment?: string;
      reason?: string;
    };

    if (!jobIds || !Array.isArray(jobIds) || jobIds.length === 0) {
      return res.status(400).json({ error: 'jobIds must be a non-empty array' });
    }
    if (!VALID_BUCKETS.has(bucket)) {
      return res.status(400).json({ error: `Invalid bucket: ${bucket}` });
    }
    if ((bucket === 'disqualified' || bucket === 'auto_disqualified') && !reason) {
      return res.status(400).json({ error: 'reason is required for disqualified/auto_disqualified' });
    }

    let added = 0;
    let skipped = 0;
    const now = new Date().toISOString();

    for (const jobId of jobIds) {
      const job = await db.getJobById(jobId);
      if (!job) { skipped++; continue; }

      const newId = await db.insertCrmJob(jobId, bucket, comment, reason);
      if (newId === 0) {
        skipped++;
        continue;
      }

      // Set application date if applied
      if (bucket === 'applied') {
        await db.updateCrmJobBucket(newId, bucket, { applicationDate: now });
      }

      // Record 'added' event
      await db.insertCrmEvent({
        crm_job_id: newId,
        event_type: 'added',
        actor: 'user',
        from_bucket: null,
        to_bucket: bucket,
        context_data: null,
        comment: comment ?? null,
        created_at: now,
      });

      // Auto-process if enabled and bucket is sourced
      if (bucket === 'sourced') {
        const settings = await db.getCrmSettings();
        if (settings.auto_process === 'true') {
          await db.updateCrmJobProcessingStatus(newId, 'pending');
          // Dynamically import processing to avoid circular deps at module load
          try {
            const { kickQueue } = await import('../processing');
            kickQueue();
          } catch { /* processing not available yet */ }
        }
      }

      added++;
    }

    res.json({ added, skipped });
  } catch (err) {
    console.error('[crm] POST /jobs error:', err);
    res.status(500).json({ error: 'Failed to add job(s) to CRM' });
  }
});

/** GET /api/crm/jobs — List CRM jobs by bucket (paginated, with optional filters) */
router.get('/jobs', async (req: Request, res: Response) => {
  try {
    const bucket = (req.query.bucket as CrmBucket) || 'sourced';
    const page = parseInt(req.query.page as string) || 1;
    const pageSize = parseInt(req.query.pageSize as string) || 25;
    const brief = req.query.brief === 'true';

    if (!VALID_BUCKETS.has(bucket)) {
      return res.status(400).json({ error: `Invalid bucket: ${bucket}` });
    }

    // Build optional filters from query params
    const filters: Record<string, string> = {};
    for (const key of ['company', 'title', 'location', 'department', 'workplace_type', 'commitment', 'search', 'searchMode', 'autoFilter']) {
      if (typeof req.query[key] === 'string' && req.query[key]) {
        filters[key] = req.query[key] as string;
      }
    }

    const hasFilters = Object.keys(filters).length > 0;
    const result = hasFilters
      ? await db.getCrmJobsByBucketFiltered(bucket, page, pageSize, filters)
      : await db.getCrmJobsByBucket(bucket, page, pageSize);

    // When brief=true, strip the heavy `description` field from each job to reduce payload size.
    // Use crm_get_job (GET /api/crm/jobs/:id) for full job descriptions.
    if (brief) {
      result.data = result.data.map(({ description, ...rest }: any) => rest);
    }

    res.json(result);
  } catch (err) {
    console.error('[crm] GET /jobs error:', err);
    res.status(500).json({ error: 'Failed to fetch CRM jobs' });
  }
});

/** GET /api/crm/jobs/counts — Bucket counts (optionally filtered by job-property filters) */
router.get('/jobs/counts', async (req: Request, res: Response) => {
  try {
    // Check if any filter params are present
    const filterKeys = ['company', 'title', 'location', 'department', 'workplace_type', 'commitment', 'search', 'searchMode', 'autoFilter'];
    const hasFilters = filterKeys.some(k => typeof req.query[k] === 'string' && req.query[k]);
    if (hasFilters) {
      const filters: Record<string, string> = {};
      for (const key of filterKeys) {
        if (typeof req.query[key] === 'string' && req.query[key]) {
          filters[key] = req.query[key] as string;
        }
      }
      const counts = await db.getCrmBucketCountsFiltered(filters);
      res.json(counts);
    } else {
      const counts = await db.getCrmBucketCounts();
      res.json(counts);
    }
  } catch (err) {
    console.error('[crm] GET /jobs/counts error:', err);
    res.status(500).json({ error: 'Failed to fetch bucket counts' });
  }
});

/** GET /api/crm/jobs/status-map — CRM status for given job IDs (for sourcing badges) */
router.get('/jobs/status-map', async (req: Request, res: Response) => {
  try {
    const jobIdsParam = req.query.jobIds as string;
    if (!jobIdsParam) return res.json({});

    const jobIds = jobIdsParam.split(',').map(Number).filter(n => !isNaN(n));
    if (jobIds.length === 0) return res.json({});

    const map = await db.getCrmStatusMap(jobIds);
    res.json(map);
  } catch (err) {
    console.error('[crm] GET /jobs/status-map error:', err);
    res.status(500).json({ error: 'Failed to fetch CRM status map' });
  }
});

/** GET /api/crm/jobs/:id — Get CRM job detail with history */
router.get('/jobs/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const job = await db.getCrmJobWithDetails(id);
    if (!job) return res.status(404).json({ error: 'CRM job not found' });

    const events = await db.getCrmEventsByJob(id);
    res.json({ ...job, events });
  } catch (err) {
    console.error('[crm] GET /jobs/:id error:', err);
    res.status(500).json({ error: 'Failed to fetch CRM job detail' });
  }
});

/** PATCH /api/crm/jobs/:id — Unified update: move bucket and/or set comment */
router.patch('/jobs/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const { bucket, comment, reason } = req.body as {
      bucket?: CrmBucket;
      comment?: string | null;
      reason?: string;
    };

    const job = await db.getCrmJobWithDetails(id);
    if (!job) return res.status(404).json({ error: 'CRM job not found' });

    const now = new Date().toISOString();

    // ── Handle bucket move ──────────────────────────────────────────────────
    if (bucket !== undefined) {
      if (!VALID_BUCKETS.has(bucket)) {
        return res.status(400).json({ error: `Invalid bucket: ${bucket}` });
      }

      if (job.bucket !== bucket) {
        const opts: { tier?: CrmTier | null; applicationDate?: string; reason?: string; processingStatus?: string } = {};

        if (bucket === 'applied') {
          opts.applicationDate = now;
        }
        if (bucket === 'disqualified' || bucket === 'auto_disqualified') {
          opts.reason = reason || comment || 'Manually disqualified';
        }
        if (bucket === 'sourced' || bucket === 'filtered') {
          opts.processingStatus = 'pending';
          if (bucket === 'sourced') {
            opts.tier = null;
          }
        }

        await db.updateCrmJobBucket(id, bucket, opts as any);

        await db.insertCrmEvent({
          crm_job_id: id,
          event_type: 'moved',
          actor: 'user',
          from_bucket: job.bucket,
          to_bucket: bucket,
          context_data: null,
          comment: comment ?? null,
          created_at: now,
        });

        if (bucket === 'sourced' || bucket === 'filtered') {
          try {
            const { kickQueue } = await import('../processing');
            kickQueue();
          } catch { /* processing not available */ }
        }
      }
    }

    // ── Handle comment update (when no bucket move, or standalone) ──────────
    if (comment !== undefined && bucket === undefined) {
      await db.updateCrmJobComment(id, comment ?? null);

      if (comment) {
        await db.insertCrmEvent({
          crm_job_id: id,
          event_type: 'comment',
          actor: 'user',
          comment: comment,
          from_bucket: null,
          to_bucket: null,
          context_data: null,
          created_at: now,
        });
      }
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('[crm] PATCH /jobs/:id error:', err);
    res.status(500).json({ error: 'Failed to update CRM job' });
  }
});

/** PATCH /api/crm/jobs/:id/comment — Update user comment and log to history */
router.patch('/jobs/:id/comment', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const { comment } = req.body as { comment: string | null };

    const job = await db.getCrmJobWithDetails(id);
    if (!job) return res.status(404).json({ error: 'CRM job not found' });

    await db.updateCrmJobComment(id, comment ?? null);

    // Log a comment event in history
    if (comment) {
      await db.insertCrmEvent({
        crm_job_id: id,
        event_type: 'comment',
        actor: 'user',
        comment: comment,
        from_bucket: null,
        to_bucket: null,
        context_data: null,
        created_at: new Date().toISOString(),
      });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('[crm] PATCH /jobs/:id/comment error:', err);
    res.status(500).json({ error: 'Failed to update comment' });
  }
});

/** POST /api/crm/jobs/:id/move — Move job to another bucket */
router.post('/jobs/:id/move', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const { bucket, comment } = req.body as { bucket: CrmBucket; comment?: string };

    if (!VALID_BUCKETS.has(bucket)) {
      return res.status(400).json({ error: `Invalid bucket: ${bucket}` });
    }

    const job = await db.getCrmJobWithDetails(id);
    if (!job) return res.status(404).json({ error: 'CRM job not found' });

    if (job.bucket === bucket) {
      return res.json({ ok: true, message: 'Already in that bucket' });
    }

    const now = new Date().toISOString();
    const opts: { tier?: CrmTier | null; applicationDate?: string; reason?: string; processingStatus?: string } = {};

    // Set application date when entering applied
    if (bucket === 'applied') {
      opts.applicationDate = now;
    }

    // Set disqualify_reason when entering disqualified/auto_disqualified
    if (bucket === 'disqualified' || bucket === 'auto_disqualified') {
      opts.reason = comment || 'Manually disqualified';
    }

    // Re-trigger processing when moving to sourced/filtered
    if (bucket === 'sourced' || bucket === 'filtered') {
      opts.processingStatus = 'pending';
      if (bucket === 'sourced') {
        opts.tier = null; // clear tier
      }
    }

    await db.updateCrmJobBucket(id, bucket, opts as any);

    // Record 'moved' event
    await db.insertCrmEvent({
      crm_job_id: id,
      event_type: 'moved',
      actor: 'user',
      from_bucket: job.bucket,
      to_bucket: bucket,
      context_data: null,
      comment: comment ?? null,
      created_at: now,
    });

    // Kick processing if moved to sourced/filtered
    if (bucket === 'sourced' || bucket === 'filtered') {
      try {
        const { kickQueue } = await import('../processing');
        kickQueue();
      } catch { /* processing not available */ }
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('[crm] POST /jobs/:id/move error:', err);
    res.status(500).json({ error: 'Failed to move CRM job' });
  }
});

/** DELETE /api/crm/jobs/:id — Remove job from CRM */
router.delete('/jobs/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const job = await db.getCrmJobWithDetails(id);
    if (!job) return res.status(404).json({ error: 'CRM job not found' });

    await db.deleteCrmJob(id); // CASCADE deletes events
    res.json({ ok: true });
  } catch (err) {
    console.error('[crm] DELETE /jobs/:id error:', err);
    res.status(500).json({ error: 'Failed to remove CRM job' });
  }
});

// ─── CRM Filters ──────────────────────────────────────────────────────────────

/** GET /api/crm/filters — List all filters */
router.get('/filters', async (_req: Request, res: Response) => {
  try {
    const filters = await db.getCrmFilters();
    res.json(filters);
  } catch (err) {
    console.error('[crm] GET /filters error:', err);
    res.status(500).json({ error: 'Failed to fetch filters' });
  }
});

/** POST /api/crm/filters — Create a filter */
router.post('/filters', async (req: Request, res: Response) => {
  try {
    const { name, filter_type, config, is_active = 1 } = req.body;

    if (!name || !filter_type || !config) {
      return res.status(400).json({ error: 'name, filter_type, and config are required' });
    }

    // Enforce single active llm_tier
    if (filter_type === 'llm_tier' && is_active) {
      await db.deactivateCrmFiltersByType('llm_tier');
    }

    const existing = await db.getCrmFilters();
    const sortOrder = existing.length;

    const id = await db.insertCrmFilter({
      name,
      filter_type,
      config: typeof config === 'string' ? config : JSON.stringify(config),
      is_active: is_active ? 1 : 0,
      sort_order: sortOrder,
      created_at: new Date().toISOString(),
    });

    res.json({ id });
  } catch (err) {
    console.error('[crm] POST /filters error:', err);
    res.status(500).json({ error: 'Failed to create filter' });
  }
});

/** PUT /api/crm/filters/reorder — Reorder filters */
router.put('/filters/reorder', async (req: Request, res: Response) => {
  try {
    const { ids } = req.body as { ids: number[] };
    if (!ids || !Array.isArray(ids)) {
      return res.status(400).json({ error: 'ids must be an array' });
    }
    await db.reorderCrmFilters(ids);
    res.json({ ok: true });
  } catch (err) {
    console.error('[crm] PUT /filters/reorder error:', err);
    res.status(500).json({ error: 'Failed to reorder filters' });
  }
});

/** PUT /api/crm/filters/:id — Update a filter */
router.put('/filters/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const filter = await db.getCrmFilterById(id);
    if (!filter) return res.status(404).json({ error: 'Filter not found' });

    const updates = req.body;
    if (updates.config && typeof updates.config !== 'string') {
      updates.config = JSON.stringify(updates.config);
    }

    // Enforce single active llm_tier
    if (updates.filter_type === 'llm_tier' && updates.is_active) {
      await db.deactivateCrmFiltersByType('llm_tier');
    } else if (filter.filter_type === 'llm_tier' && updates.is_active) {
      await db.deactivateCrmFiltersByType('llm_tier');
    }

    await db.updateCrmFilter(id, updates);
    res.json({ ok: true });
  } catch (err) {
    console.error('[crm] PUT /filters/:id error:', err);
    res.status(500).json({ error: 'Failed to update filter' });
  }
});

/** DELETE /api/crm/filters/:id — Delete a filter */
router.delete('/filters/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    await db.deleteCrmFilter(id);
    res.json({ ok: true });
  } catch (err) {
    console.error('[crm] DELETE /filters/:id error:', err);
    res.status(500).json({ error: 'Failed to delete filter' });
  }
});

/** POST /api/crm/filters/:id/test — Test filter against a job (no state change) */
router.post('/filters/:id/test', async (req: Request, res: Response) => {
  try {
    const filterId = parseInt(req.params.id);
    const { crmJobId } = req.body as { crmJobId: number };

    const filter = await db.getCrmFilterById(filterId);
    if (!filter) return res.status(404).json({ error: 'Filter not found' });

    const job = await db.getCrmJobWithDetails(crmJobId);
    if (!job) return res.status(404).json({ error: 'CRM job not found' });

    // Import processing to run test
    try {
      const { testFilter } = await import('../processing');
      const result = await testFilter(filter, job);
      res.json(result);
    } catch {
      res.status(500).json({ error: 'Processing module not available' });
    }
  } catch (err) {
    console.error('[crm] POST /filters/:id/test error:', err);
    res.status(500).json({ error: 'Failed to test filter' });
  }
});

// ─── CRM Analytics ────────────────────────────────────────────────────────────

/** GET /api/crm/analytics/funnel — Get funnel analytics (Sankey data + filter stats) */
router.get('/analytics/funnel', async (req: Request, res: Response) => {
  try {
    const filters: Record<string, string> = {};
    for (const key of ['company', 'title', 'location', 'department', 'workplace_type', 'commitment', 'search', 'searchMode', 'autoFilter']) {
      if (typeof req.query[key] === 'string' && req.query[key]) {
        filters[key] = req.query[key] as string;
      }
    }
    const result = await db.getCrmFunnelAnalytics(filters);
    res.json(result);
  } catch (err) {
    console.error('[crm] GET /analytics/funnel error:', err);
    res.status(500).json({ error: 'Failed to fetch funnel analytics' });
  }
});

/** GET /api/crm/filter-options — Cascading filter options scoped to CRM jobs */
router.get('/filter-options', async (req: Request, res: Response) => {
  try {
    const filters: Record<string, string> = {};
    for (const key of ['company', 'title', 'location', 'department', 'workplace_type', 'commitment', 'search', 'searchMode', 'autoFilter', 'bucket']) {
      if (typeof req.query[key] === 'string' && req.query[key]) {
        filters[key] = req.query[key] as string;
      }
    }
    const result = await db.getCrmFilterOptions(filters);
    res.json(result);
  } catch (err) {
    console.error('[crm] GET /filter-options error:', err);
    res.status(500).json({ error: 'Failed to fetch CRM filter options' });
  }
});

// ─── CRM Settings ─────────────────────────────────────────────────────────────

/** GET /api/crm/settings — Get all settings */
router.get('/settings', async (_req: Request, res: Response) => {
  try {
    const settings = await db.getCrmSettings();
    res.json(settings);
  } catch (err) {
    console.error('[crm] GET /settings error:', err);
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

/** PUT /api/crm/settings — Update settings */
router.put('/settings', async (req: Request, res: Response) => {
  try {
    const updates = req.body as Record<string, string>;
    for (const [key, value] of Object.entries(updates)) {
      await db.setCrmSetting(key, value);
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('[crm] PUT /settings error:', err);
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

/** POST /api/crm/settings/test — Test Gemini API connection */
router.post('/settings/test', async (req: Request, res: Response) => {
  try {
    const { apiKey, model } = req.body as { apiKey?: string; model?: string };
    const settings = await db.getCrmSettings();
    const { testGeminiConnection, resolveLlmModel } = await import('../llm');
    const key = apiKey !== undefined ? apiKey : (settings.gemini_api_key || '');
    const mod = resolveLlmModel(model || settings.llm_model);

    const result = await testGeminiConnection(key, mod);
    res.json(result);
  } catch (err) {
    console.error('[crm] POST /settings/test error:', err);
    res.status(500).json({ error: 'Failed to test Gemini connection' });
  }
});

// ─── Processing ───────────────────────────────────────────────────────────────

/** GET /api/crm/status — Get processing status */
router.get('/status', async (_req: Request, res: Response) => {
  try {
    const { getProcessingStatus } = await import('../processing');
    res.json(getProcessingStatus());
  } catch {
    res.json({ state: 'idle', current_job: null, error_count: 0 });
  }
});

/** POST /api/crm/process — Trigger processing (manual) */
router.post('/process', async (_req: Request, res: Response) => {
  try {
    const { triggerProcessing } = await import('../processing');
    await triggerProcessing();
    res.json({ ok: true });
  } catch (err) {
    console.error('[crm] POST /process error:', err);
    res.status(500).json({ error: 'Failed to trigger processing' });
  }
});

export default router;
