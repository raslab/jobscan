import { Router, Request, Response } from 'express';
import * as db from '../db/index';
import { JobStatsResponse, PaginatedJobQuery } from '../types';

const router = Router();

// GET /api/jobs — paginated, filtered, sorted
router.get('/', async (req: Request, res: Response) => {
  try {
    const query: PaginatedJobQuery = {};

    if (typeof req.query['company'] === 'string' && req.query['company']) {
      query.company = req.query['company'];
    }
    if (typeof req.query['title'] === 'string' && req.query['title']) {
      query.title = req.query['title'];
    }
    if (typeof req.query['location'] === 'string' && req.query['location']) {
      query.location = req.query['location'];
    }
    if (typeof req.query['department'] === 'string' && req.query['department']) {
      query.department = req.query['department'];
    }
    if (typeof req.query['workplace_type'] === 'string' && req.query['workplace_type']) {
      query.workplace_type = req.query['workplace_type'];
    }
    if (typeof req.query['commitment'] === 'string' && req.query['commitment']) {
      query.commitment = req.query['commitment'];
    }
    if (typeof req.query['since'] === 'string' && req.query['since']) {
      query.since = req.query['since'];
    }
    if (typeof req.query['inCrm'] === 'string' && (req.query['inCrm'] === 'yes' || req.query['inCrm'] === 'no')) {
      query.inCrm = req.query['inCrm'];
    }
    if (typeof req.query['syncId'] === 'string' && req.query['syncId']) {
      const syncId = Number(req.query['syncId']);
      if (Number.isInteger(syncId) && syncId > 0) {
        query.syncId = syncId;
      }
    }
    if (typeof req.query['search'] === 'string' && req.query['search']) {
      query.search = req.query['search'];
    }
    if (typeof req.query['searchMode'] === 'string') {
      const mode = req.query['searchMode'] as string;
      if (mode === 'fuzzy' || mode === 'exact' || mode === 'regex') {
        query.searchMode = mode;
      }
    }
    if (typeof req.query['page'] === 'string') {
      const p = Number(req.query['page']);
      if (Number.isInteger(p) && p > 0) query.page = p;
    }
    if (typeof req.query['pageSize'] === 'string') {
      const ps = Number(req.query['pageSize']);
      if (Number.isInteger(ps) && ps > 0 && ps <= 100) query.pageSize = ps;
    }
    if (typeof req.query['sortBy'] === 'string' && req.query['sortBy']) {
      query.sortBy = req.query['sortBy'];
    }
    if (typeof req.query['sortDir'] === 'string') {
      const dir = req.query['sortDir'];
      if (dir === 'asc' || dir === 'desc') query.sortDir = dir;
    }

    const result = await db.getJobsPaginated(query);
    res.json(result);
  } catch (err) {
    console.error('[jobs] GET / error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/jobs/stats — lightweight counts by default.
// Use ?includeFilters=true for distinct filter values and ?includeSources=true for full sources.
router.get('/stats', async (req: Request, res: Response) => {
  try {
    const includeFilters = req.query['includeFilters'] === 'true' || req.query['includeFilters'] === '1';
    const includeSources = req.query['includeSources'] === 'true' || req.query['includeSources'] === '1';
    const response: JobStatsResponse = await db.getJobCounts();

    if (includeFilters) {
      Object.assign(response, await db.getJobStats());
    }
    if (includeSources) {
      response.sources = await db.getSources();
    }

    res.json(response);
  } catch (err) {
    console.error('[jobs] GET /stats error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/jobs/companies — distinct company list for filter dropdown
router.get('/companies', async (_req: Request, res: Response) => {
  try {
    const companies = await db.getDistinctCompanies();
    res.json(companies);
  } catch (err) {
    console.error('[jobs] GET /companies error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/jobs/filter-options — cascading filter options (each field filtered by others)
router.get('/filter-options', async (req: Request, res: Response) => {
  try {
    const query: PaginatedJobQuery = {};

    if (typeof req.query['company'] === 'string' && req.query['company']) {
      query.company = req.query['company'];
    }
    if (typeof req.query['title'] === 'string' && req.query['title']) {
      query.title = req.query['title'];
    }
    if (typeof req.query['location'] === 'string' && req.query['location']) {
      query.location = req.query['location'];
    }
    if (typeof req.query['department'] === 'string' && req.query['department']) {
      query.department = req.query['department'];
    }
    if (typeof req.query['workplace_type'] === 'string' && req.query['workplace_type']) {
      query.workplace_type = req.query['workplace_type'];
    }
    if (typeof req.query['commitment'] === 'string' && req.query['commitment']) {
      query.commitment = req.query['commitment'];
    }
    if (typeof req.query['since'] === 'string' && req.query['since']) {
      query.since = req.query['since'];
    }
    if (typeof req.query['inCrm'] === 'string' && (req.query['inCrm'] === 'yes' || req.query['inCrm'] === 'no')) {
      query.inCrm = req.query['inCrm'];
    }
    if (typeof req.query['syncId'] === 'string' && req.query['syncId']) {
      const syncId = Number(req.query['syncId']);
      if (Number.isInteger(syncId) && syncId > 0) {
        query.syncId = syncId;
      }
    }
    if (typeof req.query['search'] === 'string' && req.query['search']) {
      query.search = req.query['search'];
    }
    if (typeof req.query['searchMode'] === 'string') {
      const mode = req.query['searchMode'] as string;
      if (mode === 'fuzzy' || mode === 'exact' || mode === 'regex') {
        query.searchMode = mode;
      }
    }

    const options = await db.getJobFilterOptions(query);
    res.json(options);
  } catch (err) {
    console.error('[jobs] GET /filter-options error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/jobs/:id — full job including description
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const id = Number(req.params['id']);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: 'Invalid job id' });
      return;
    }
    const job = await db.getJobById(id);
    if (!job) {
      res.status(404).json({ error: 'Job not found' });
      return;
    }
    res.json(job);
  } catch (err) {
    console.error('[jobs] GET /:id error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
