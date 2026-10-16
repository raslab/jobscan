import * as db from './db/index';
import { scrapeSource, scrapeJobDetail, RateLimitError, JobGoneError } from './scraper';
import { randomDelay } from './fetch-utils';
import { ParsedJob, SyncSourceResult, SyncSummary } from './types';

/**
 * Per-parser concurrency for detail-page fetching.
 *
 * JSON API parsers (workday, eightfold, smartrecruiters, celonis) can tolerate
 * higher concurrency because they hit lightweight JSON endpoints, not full HTML
 * pages, and don't share a single-tenant server.
 *
 * HTML-page parsers (jobvite, lever, icims, default) get lower concurrency to
 * avoid triggering WAF/rate-limiting on customer-hosted ATS pages.
 *
 * SuccessFactors is limited to 1 because it rate-limits extremely aggressively
 * even with a 4–9 s inter-request delay.
 */
const DETAIL_CONCURRENCY: Record<string, number> = {
  workday:         5,  // CXS JSON API
  eightfold:       5,  // /api/apply/v2/jobs JSON API
  smartrecruiters: 4,  // SmartRecruiters detail JSON API
  celonis:         4,  // DXP JSON API
  jobvite:         5,  // SaaS CDN, shared infrastructure — safe to fan out
  icims:           2,  // iCIMS HTML iframe pages
  successfactors:  1,  // very aggressive rate limiting
};
const DEFAULT_DETAIL_CONCURRENCY = 3; // Jobvite, Lever, generic HTML

/**
 * Server-enforced per-source sync deadline. Once 5 minutes have elapsed since
 * the source sync started, no further detail fetches or job writes are
 * started; already-saved rows are preserved and the source is recorded as
 * 'timed-out'. The browser no longer enforces its own timeout — this is the
 * single source of truth for timeout state.
 */
export const SOURCE_SYNC_DEADLINE_MS = 5 * 60 * 1000;

/**
 * Run up to `concurrency` async tasks at a time.
 * Stops immediately when a task throws {@link RateLimitError} — all in-flight
 * tasks are awaited but no new tasks are started. The partial results collected
 * before the abort are returned along with a `rateLimited` flag.
 */
async function pLimitAbortable<T>(
  tasks: Array<() => Promise<T>>,
  concurrency: number,
  shouldStop?: () => boolean,
): Promise<{ results: Array<T>; rateLimited: boolean }> {
  const results: Array<T> = [];
  let idx = 0;
  let rateLimited = false;

  const stopped = () => rateLimited || (shouldStop !== undefined && shouldStop());

  async function worker() {
    while (idx < tasks.length && !stopped()) {
      const i = idx++;
      const result = await tasks[i](); // may throw RateLimitError
      results[i] = result;
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, tasks.length) },
    async () => {
      try {
        await worker();
      } catch (err) {
        if (err instanceof RateLimitError) {
          rateLimited = true;
          console.log(`[sync] Rate limit hit — stopping detail fetches early: ${err.message}`);
        } else {
          throw err;
        }
      }
    },
  );
  await Promise.all(workers);
  // Filter out slots that were never filled (tasks beyond the abort point)
  return { results: results.filter((r) => r !== undefined), rateLimited };
}

export async function syncOneSource(
  source: { id: number; company: string; url: string; parser: string; last_count: number | null },
  syncId: number
): Promise<SyncSourceResult> {
  console.log(`[sync] Scraping source: ${source.company} (${source.parser})`);
  const deadlineAt = Date.now() + SOURCE_SYNC_DEADLINE_MS;
  const deadlineExpired = () => Date.now() >= deadlineAt;
  const { jobs, html, error } = await scrapeSource(source as Parameters<typeof scrapeSource>[0]);

  if (error) {
    console.log(`[sync] Error for ${source.company}: ${error}`);
    await db.updateSourceSync(source.id, 'error', 0, error);
    return { sourceId: source.id, company: source.company, status: 'error', newJobs: 0, error };
  }

  if (html) {
    await db.insertHtmlBackup(source.id, syncId, html);
  }

  if (jobs.length === 0) {
    await db.updateSourceSync(source.id, 'zero-jobs', 0);
    return { sourceId: source.id, company: source.company, status: 'zero-jobs', newJobs: 0, totalJobs: 0 };
  }

  // Filter to only jobs not yet stored — avoids fetching detail pages for known positions
  const existingUrls = await db.getExistingJobUrls(source.id);
  const unseenJobs = jobs.filter((job) => !existingUrls.has(job.url));

  const concurrency = DETAIL_CONCURRENCY[source.parser] ?? DEFAULT_DETAIL_CONCURRENCY;

  // ── Backfill descriptions for existing jobs flagged needs_backfill ────────
  // This handles cases where a detail fetch previously failed (rate-limit,
  // transient error, parser gap) and left description=NULL in the DB. The pass
  // runs on EVERY successful sync — including when no new jobs were discovered
  // — and BEFORE new-job listing commit / detail enrichment, so old records
  // are repaired first while new-job scraping keeps the deadline budget
  // (owner comment 6188617637).
  //
  // Deadline-bounded (review comment rc:4283583004): skipped entirely when the
  // deadline already expired, and the shared deadlineExpired closure is passed
  // as shouldStop so in-flight tasks stop at the deadline. No numeric cap
  // (owner comment 6195486910).
  //
  // Flag lifecycle (owner comment 6195486910): a definitive 4xx (job gone)
  // clears needs_backfill so dead records retire permanently; success clears it
  // via updateJobDetails; 5xx/network/transient failures leave it raised so the
  // row is retried on the next sync.
  let backfillRateLimited = false;
  if (!deadlineExpired()) {
    const emptyDescJobs = await db.getJobsWithEmptyDescription(source.id);
    if (emptyDescJobs.length > 0) {
      console.log(`[sync] ${source.company}: ${emptyDescJobs.length} existing jobs flagged for description backfill — backfilling…`);

      // Build a url→id map so we can do a targeted UPDATE after enrichment
      const backfillUrlToId = new Map(emptyDescJobs.map((j) => [j.url, j.id]));

      // Convert DB rows to ParsedJob (no description field → scrapeJobDetail will fetch it)
      const forRefetch = emptyDescJobs.map((j) => ({
        url:            j.url,
        title:          j.title,
        location:       j.location    ?? undefined,
        department:     j.department  ?? undefined,
        workplace_type: j.workplace_type ?? undefined,
        commitment:     j.commitment  ?? undefined,
      }));

      const { results: backfilled, rateLimited: rlBackfill } = await pLimitAbortable(
        forRefetch.map((job) => async () => {
          try {
            return await scrapeJobDetail(job);
          } catch (err) {
            if (err instanceof RateLimitError) throw err; // aborts the batch
            if (err instanceof JobGoneError) {
              // Job definitively gone (4xx) — retire the row from the backlog.
              const dbId = backfillUrlToId.get(job.url);
              if (dbId !== undefined) await db.setJobNeedsBackfill(dbId, false);
              return undefined;
            }
            throw err;
          }
        }),
        concurrency,
        deadlineExpired,
      );
      backfillRateLimited = rlBackfill;

      let updatedCount = 0;
      for (const job of backfilled) {
        if (!job) continue;
        const hasUpdate =
          job.description    !== undefined ||
          job.workplace_type !== undefined ||
          job.commitment     !== undefined ||
          job.department     !== undefined ||
          job.team           !== undefined;
        if (hasUpdate) {
          const dbId = backfillUrlToId.get(job.url);
          if (dbId !== undefined) {
            await db.updateJobDetails(dbId, {
              description:    job.description,
              workplace_type: job.workplace_type,
              commitment:     job.commitment,
              department:     job.department,
              team:           job.team,
            });
            if (job.description) updatedCount++;
          }
        }
      }

      if (rlBackfill) {
        console.log(`[sync] ${source.company}: rate-limited during backfill — updated ${updatedCount}/${emptyDescJobs.length}`);
      } else {
        console.log(`[sync] ${source.company}: backfill done — ${updatedCount}/${emptyDescJobs.length} descriptions updated`);
      }
    }
  }

  if (unseenJobs.length === 0) {
    // All positions already known — the backfill pass above still ran; skip
    // listing commit and detail enrichment entirely (no duplicates, original
    // sync_id/first_seen untouched).
    console.log(`[sync] ${source.company}: no new jobs — backfill pass completed`);
  } else {
    console.log(`[sync] ${source.company}: ${unseenJobs.length} new jobs to enrich (${jobs.length} total)`);
  }

  // ── Step 1: Commit listing rows immediately ──────────────────────────────
  // Insert every unseen job now with whatever the listing gave us
  // (description is null at this point). This guarantees the jobs survive even
  // if the process is killed or times out during the detail-fetch pass below.
  const urlToId = new Map<string, number>();
  let newJobs = 0;
  let timedOut = false;
  const now = new Date().toISOString();
  for (const job of unseenJobs) {
    if (deadlineExpired()) { timedOut = true; break; }
    const { id, inserted } = await db.insertJobListingRow({
      source_id:      source.id,
      sync_id:        syncId,
      company:        source.company,
      title:          job.title,
      location:       job.location ?? null,
      workplace_type: job.workplace_type ?? null,
      commitment:     job.commitment ?? null,
      department:     job.department ?? null,
      team:           job.team ?? null,
      description:    job.description ?? null,
      url:            job.url,
      first_seen:     now,
    });
    urlToId.set(job.url, id);
    if (inserted) newJobs++;
  }
  console.log(`[sync] ${source.company}: ${newJobs} new jobs saved from listing — enriching descriptions…`);

  // ── Step 2: Fetch detail pages and update each row on-the-fly ────────────
  // Each task fetches the detail page and writes back description + any
  // additional fields (workplace_type, commitment, department, team) as soon
  // as it finishes — no waiting for the whole batch.
  // On RateLimitError the batch stops early; the rows inserted above are safe.
  // If the backfill pass was rate-limited, skip enrichment entirely
  // (anti-hammering): listing rows stay committed and enrichment defers to
  // the next sync, where the raised needs_backfill flag picks them up.
  const { rateLimited } = (timedOut || backfillRateLimited)
    ? { rateLimited: backfillRateLimited }
    : await pLimitAbortable(
    unseenJobs.map((job) => async () => {
      let enriched: ParsedJob;
      try {
        enriched = await scrapeJobDetail(job); // may throw RateLimitError
      } catch (err) {
        if (err instanceof JobGoneError) return undefined; // row keeps its raised flag; retired by a later backfill
        throw err;
      }
      const id = urlToId.get(enriched.url);
      if (id !== undefined) {
        const hasUpdate =
          enriched.description    !== undefined ||
          enriched.workplace_type !== undefined ||
          enriched.commitment     !== undefined ||
          enriched.department     !== undefined ||
          enriched.team           !== undefined;
        if (hasUpdate) {
          await db.updateJobDetails(id, {
            description:    enriched.description,
            workplace_type: enriched.workplace_type,
            commitment:     enriched.commitment,
            department:     enriched.department,
            team:           enriched.team,
          });
        }
      }
      return enriched;
    }),
    concurrency,
    deadlineExpired,
  );

  if (timedOut || deadlineExpired()) {
    console.log(`[sync] ${source.company}: server deadline exceeded — ${newJobs} jobs saved so far, stopping further fetches/writes`);
    await db.updateSourceSync(source.id, 'timed-out', jobs.length);
    return { sourceId: source.id, company: source.company, status: 'timed-out', newJobs, totalJobs: jobs.length };
  }

  if (backfillRateLimited) {
    console.log(`[sync] ${source.company}: rate-limited during backfill — new-job enrichment deferred to next sync`);
  } else if (rateLimited) {
    console.log(`[sync] ${source.company}: rate-limited during detail fetches — ${newJobs} jobs are saved, descriptions will backfill on next sync`);
  }

  await db.updateSourceSync(source.id, 'ok', jobs.length);
  console.log(`[sync] ${source.company}: done — ${newJobs} new jobs inserted`);

  return { sourceId: source.id, company: source.company, status: 'ok', newJobs, totalJobs: jobs.length };
}

/**
 * Sync a single source by ID. Used by the per-source sync API.
 * If an existing syncId is provided (batch orchestration from frontend),
 * reuse it instead of creating a new sync log entry.
 */
export async function runSyncOneSource(sourceId: number, existingSyncId?: number): Promise<SyncSourceResult & { syncId: number }> {
  const source = await db.getSourceById(sourceId);
  if (!source) {
    return { syncId: existingSyncId ?? 0, sourceId, company: '', status: 'error', newJobs: 0, error: 'Source not found' };
  }

  const ownSession = !existingSyncId;
  const syncId = existingSyncId ?? await db.startSyncLog();
  const result = await syncOneSource(source, syncId);

  // Only complete the sync log if we created it ourselves (single-source sync).
  // When the frontend orchestrates a batch, it manages the session lifecycle.
  if (ownSession) {
    await db.completeSyncLog(syncId, 1, await db.countJobsBySyncId(syncId));
  }

  return { ...result, syncId };
}

export async function runSync(): Promise<SyncSummary> {
  const sources = await db.getSourcesForSync();

  if (sources.length === 0) {
    return { syncId: 0, sourcesChecked: 0, newJobsTotal: 0, results: [] };
  }

  const syncId = await db.startSyncLog();

  // Process sources sequentially with random delays between them
  // to avoid hammering servers and triggering rate limits
  const results: SyncSourceResult[] = [];
  for (let i = 0; i < sources.length; i++) {
    if (i > 0) {
      // Random 2-5s delay between sources
      await randomDelay(2000, 5000);
    }
    const result = await syncOneSource(sources[i], syncId);
    results.push(result);
  }

  const newJobsTotal = await db.countJobsBySyncId(syncId);
  await db.completeSyncLog(syncId, sources.length, newJobsTotal);

  return { syncId, sourcesChecked: sources.length, newJobsTotal, results };
}
