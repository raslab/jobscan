/**
 * sync.js — Sync-all orchestration, sync panel state helpers
 */
function syncMixin() {
  return {
    async syncAll() {
      if (this.syncing) return;
      this.syncing = true;
      this.syncSummary = null;

      let sources;
      try {
        const res = await fetch('/api/sync/sources');
        sources = await res.json();
      } catch (err) {
        console.error('Failed to fetch sync sources', err);
        this.syncing = false;
        return;
      }

      if (sources.length === 0) {
        this.syncing = false;
        return;
      }

      // Create a shared sync session so all per-source syncs share one syncId
      let sessionSyncId;
      try {
        const res = await fetch('/api/sync/start', { method: 'POST' });
        const data = await res.json();
        sessionSyncId = data.syncId;
      } catch (err) {
        console.error('Failed to start sync session', err);
        this.syncing = false;
        return;
      }

      const panel = this.syncPanel;
      panel.active = true;
      panel.cancelled = false;
      panel.startedAt = new Date();
      panel.finishedAt = null;
      panel.currentIndex = -1;
      panel.elapsedSec = 0;
      panel.sources = sources.map(s => ({
        id: s.id,
        company: s.company,
        parser: s.parser,
        last_synced: s.last_synced,
        last_count: s.last_count,
        state: 'pending',
        newJobs: 0,
        totalJobs: null,
        error: null,
      }));

      panel.timerId = setInterval(() => {
        panel.elapsedSec = Math.floor((Date.now() - panel.startedAt.getTime()) / 1000);
      }, 1000);

      const WORKER_COUNT = 5;
      const activeParsers = new Map();
      panel.activeWorkers = WORKER_COUNT;

      function pickNext() {
        const busy = new Set(activeParsers.keys());
        let fallback = null;
        for (const src of panel.sources) {
          if (src.state !== 'pending') continue;
          if (!busy.has(src.parser)) return src;
          if (!fallback) fallback = src;
        }
        return fallback;
      }

      async function syncOne(src) {
        src.state = 'syncing';
        activeParsers.set(src.parser, (activeParsers.get(src.parser) || 0) + 1);
        try {
          // No client-side timeout: the backend enforces its own per-source
          // deadline and reports 'timed-out' status in the response.
          const res = await fetch('/api/sync/' + src.id, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ syncId: sessionSyncId }),
          });
          const data = await res.json();
          if (data.error && data.status === 'error') {
            src.state = 'error';
            src.error = data.error;
          } else if (data.status === 'zero-jobs') {
            src.state = 'zero-jobs';
            src.totalJobs = 0;
            src.newJobs = 0;
          } else if (data.status === 'timed-out') {
            src.state = 'timed-out';
            src.newJobs = data.newJobs || 0;
            src.totalJobs = data.totalJobs ?? null;
          } else {
            src.state = 'done';
            src.newJobs = data.newJobs || 0;
            src.totalJobs = data.totalJobs ?? null;
          }
        } catch (err) {
          src.state = 'error';
          src.error = String(err);
        } finally {
          const cnt = activeParsers.get(src.parser) || 1;
          if (cnt <= 1) activeParsers.delete(src.parser);
          else activeParsers.set(src.parser, cnt - 1);
        }
      }

      async function worker() {
        while (!panel.cancelled) {
          const src = pickNext();
          if (!src) break;
          await syncOne(src);
        }
        panel.activeWorkers = Math.max(0, (panel.activeWorkers || 0) - 1);
      }

      await Promise.all(Array.from({ length: WORKER_COUNT }, () => worker()));

      panel.finishedAt = new Date();
      panel.activeWorkers = 0;
      clearInterval(panel.timerId);
      panel.timerId = null;
      panel.elapsedSec = Math.floor((panel.finishedAt.getTime() - panel.startedAt.getTime()) / 1000);

      const totalNewJobs = panel.sources.reduce((sum, s) => sum + (s.newJobs || 0), 0);
      const sourcesChecked = panel.sources.filter(s => s.state !== 'pending').length;

      // Complete the shared sync session. The server waits for its in-flight
      // source syncs to stop, then computes the new-job count itself from the
      // jobs rows belonging to this sync — the client count is only a hint.
      let serverNewJobsTotal = null;
      try {
        const res = await fetch('/api/sync/complete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            syncId: sessionSyncId,
            sourcesCount: sourcesChecked,
            newJobs: totalNewJobs,
          }),
        });
        const data = await res.json();
        if (typeof data.newJobs === 'number') serverNewJobsTotal = data.newJobs;
      } catch (err) {
        console.error('Failed to complete sync session', err);
      }

      const results = panel.sources.map(s => ({
        sourceId: s.id,
        company: s.company,
        status: s.state === 'done' ? 'ok' : s.state,
        newJobs: s.newJobs,
        error: s.error,
      }));
      this.syncSummary = {
        sourcesChecked: sourcesChecked,
        newJobsTotal: serverNewJobsTotal ?? totalNewJobs,
        results,
      };

      this.syncing = false;
      await Promise.all([
        this.loadStats(),
        this.loadSources(),
        this.loadJobs(),
        this.loadLatestSync(),
      ]);
    },

    cancelSync() {
      this.syncPanel.cancelled = true;
    },

    closeSyncPanel() {
      if (this.syncing) return;
      this.syncPanel.active = false;
    },

    syncDoneCount() {
      return this.syncPanel.sources.filter(s => s.state === 'done' || s.state === 'error' || s.state === 'zero-jobs' || s.state === 'timed-out').length;
    },

    syncWithJobsCount() {
      return this.syncPanel.sources.filter(s =>
        (s.state === 'done' || s.state === 'zero-jobs') && s.totalJobs > 0
      ).length;
    },

    syncEta() {
      const done = this.syncDoneCount();
      const total = this.syncPanel.sources.length;
      if (done === 0 || !this.syncing) return null;
      const throughput = done / this.syncPanel.elapsedSec;
      const remaining = total - done - (this.syncPanel.activeWorkers || 0);
      if (remaining <= 0) return 0;
      return Math.ceil(remaining / throughput);
    },

    syncNewJobsTotal() {
      return this.syncPanel.sources.reduce((sum, s) => sum + (s.newJobs || 0), 0);
    },

    /** Navigate to Sources tab and filter by company name */
    syncDotClick(company) {
      this.sourcesFilter = company;
      this.sourcesPage = 1;
      this.activeTab = 'sources';
      this.loadSources();
    },

    /**
     * Compute CSS custom properties for adaptive dot sizing.
     * Targets roughly 50vh for the dot grid area.
     */
    syncDotStyle() {
      const count = this.syncPanel.sources.length;
      if (count <= 0) return '';
      // Estimate available width (grid container ~98vw minus padding)
      // and target max height = 50vh
      // For a grid of N dots, each dot+gap = (size+gap), cols = floor(width/(size+gap)),
      // rows = ceil(count/cols), grid height = rows*(size+gap)
      // We want rows*(size+gap) <= target height
      // Quick adaptive: pick size based on count thresholds
      let size, gap;
      if (count <= 200)      { size = 14; gap = 5; }
      else if (count <= 500) { size = 10; gap = 4; }
      else if (count <= 1500){ size = 7;  gap = 3; }
      else if (count <= 3000){ size = 5;  gap = 2; }
      else                   { size = 4;  gap = 1; }
      return `--dot-size:${size}px;--dot-gap:${gap}px`;
    },

    viewNewJobs() { this.activeTab = 'new-jobs'; },
  };
}
