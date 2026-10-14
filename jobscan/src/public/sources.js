/**
 * sources.js — Source CRUD and batch import
 */
function sourcesMixin() {
  return {
    // filteredSources() removed — filtering is now done server-side.
    // The template iterates `sources` directly (already filtered by the backend).

    async detectSource() {
      const url = (this.newSource.url || '').trim();
      if (!url) { this.addError = 'Enter a URL first'; return; }
      this.addError = '';
      this.addResult = null;
      this.detectedOk = false;
      this.detectedCandidates = [];
      this.detecting = true;
      try {
        const res = await fetch('/api/sources/detect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url }),
        });
        const data = await res.json();
        if (!res.ok) {
          this.addError = data.error || 'Detection failed';
          return;
        }
        if (data.candidates && data.candidates.length > 1) {
          // Multi-source: store all candidates with a selected flag and editable company
          this.detectedCandidates = data.candidates.map(c => ({
            ...c,
            companyEdit: c.company || '',
            selected: true,
          }));
          this.detectedOk = true;
        } else {
          // Single source: populate the regular form
          this.detectedCandidates = [];
          this.newSource.url     = data.url     || url;
          this.newSource.company = data.company || '';
          this.newSource.parser  = data.parser  || '';
          this.detectedOk = true;
        }
      } catch (err) {
        this.addError = 'Network error: ' + String(err);
      } finally {
        this.detecting = false;
      }
    },

    async addAllCandidates() {
      const selected = this.detectedCandidates.filter(c => c.selected);
      if (selected.length === 0) return;
      this.candidateResults = [];
      this.addingCandidates = true;
      for (const c of selected) {
        try {
          const saveRes = await fetch('/api/sources', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: c.url, company: c.companyEdit || c.company, parser: c.parser }),
          });
          const data = await saveRes.json();
          if (saveRes.status === 409) {
            this.candidateResults.push({ ...c, status: 'duplicate' });
          } else if (!saveRes.ok) {
            this.candidateResults.push({ ...c, status: 'error', error: data.error || 'Failed' });
          } else {
            this.candidateResults.push({
              ...c,
              status: 'ok',
              jobs: data.firstScrape?.count ?? null,
            });
          }
        } catch (err) {
          this.candidateResults.push({ ...c, status: 'error', error: String(err) });
        }
      }
      this.addingCandidates = false;
      await Promise.all([this.loadStats(), this.loadSources(), this.loadJobs()]);
    },

    async addSource() {
      this.addError = '';
      this.addResult = null;
      this.addingSource = true;
      try {
        const res = await fetch('/api/sources', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(this.newSource),
        });
        const data = await res.json();
        if (!res.ok) {
          this.addError = data.error || 'Failed to add source';
          return;
        }
        this.addResult = data;
        this.newSource = { url: '', company: '', parser: this.parsers[0] || '' };
        this.detectedOk = false;
        this.detectedCandidates = [];
        this.candidateResults = [];
        await Promise.all([this.loadStats(), this.loadSources(), this.loadJobs()]);
      } catch (err) {
        this.addError = 'Network error: ' + String(err);
      } finally {
        this.addingSource = false;
      }
    },

    async deleteSource(id) {
      if (!confirm('Delete this source and all its scraped jobs? This may take a moment for large sources.')) return;
      try {
        const res = await fetch('/api/sources/' + id, { method: 'DELETE' });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          this.showToast('Delete failed: ' + (data.error || res.status), 4000);
          return;
        }
        await Promise.all([this.loadStats(), this.loadSources(), this.loadJobs()]);
      } catch (err) {
        this.showToast('Delete failed: ' + String(err), 4000);
      }
    },

    async syncOneSource(id) {
      if (this.syncingSourceIds.has(id)) return;
      this.syncingSourceIds = new Set([...this.syncingSourceIds, id]);
      try {
        const res = await fetch('/api/sync/' + id, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        const data = await res.json();
        if (!res.ok || data.error) {
          this.showToast('Sync failed: ' + (data.error || res.status), 5000);
        } else if (data.status === 'zero-jobs') {
          this.showToast('Sync complete — 0 jobs found', 3000);
        } else if (data.status === 'timed-out') {
          this.showToast('Sync timed out — saved jobs preserved, will resume next sync', 5000);
        } else {
          const newJobs = data.newJobs || 0;
          this.showToast('Sync complete — ' + (newJobs > 0 ? '+' + newJobs + ' new jobs' : 'no new jobs'), 3000);
        }
        await Promise.all([this.loadStats(), this.loadSources(), this.loadJobs(), this.loadLatestSync()]);
      } catch (err) {
        this.showToast('Sync failed: ' + String(err), 5000);
      } finally {
        const next = new Set(this.syncingSourceIds);
        next.delete(id);
        this.syncingSourceIds = next;
      }
    },

    // ── Batch source import ───────────────────────────────────────────────

    async addBatch() {
      const inputUrls = this.batchUrls
        .split('\n')
        .map(u => u.trim())
        .filter(u => u.length > 0 && /^https?:\/\//i.test(u));

      if (inputUrls.length === 0) return;

      // Expand multi-candidate URLs into individual source entries
      const sources = []; // { url, company, parser }
      this.batchResults = [];
      this.batchRunning = true;
      this.batchProgress = { done: 0, total: inputUrls.length, current: '' };

      for (const url of inputUrls) {
        this.batchProgress.current = url;
        try {
          const detectRes = await fetch('/api/sources/detect', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url }),
          });
          const detected = await detectRes.json();
          if (detectRes.ok) {
            // Multi-candidate: add each separately
            const candidates = detected.candidates || [{ url: detected.url || url, company: detected.company || '', parser: detected.parser || '' }];
            for (const c of candidates) {
              sources.push({ url: c.url || url, company: c.company || '', parser: c.parser || '' });
            }
          } else {
            this.batchResults.push({ url, company: '', status: 'error', error: detected.error || 'No parser recognized' });
          }
        } catch (err) {
          this.batchResults.push({ url, company: '', status: 'error', error: String(err) });
        }
        this.batchProgress.done++;
      }

      // Save all expanded sources
      this.batchProgress = { done: 0, total: sources.length, current: '' };
      for (const { url, company, parser } of sources) {
        this.batchProgress.current = url;
        try {
          const saveRes = await fetch('/api/sources', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url, company, parser }),
          });
          const data = await saveRes.json();

          if (saveRes.status === 409) {
            this.batchResults.push({ url, company, status: 'duplicate' });
          } else if (!saveRes.ok) {
            this.batchResults.push({ url, company, status: 'error', error: data.error || 'Failed' });
          } else {
            this.batchResults.push({
              url,
              company: data.source?.company || company,
              status: 'ok',
              jobs: data.firstScrape?.count ?? null,
            });
          }
        } catch (err) {
          this.batchResults.push({ url, company, status: 'error', error: String(err) });
        }
        this.batchProgress.done++;
        await this.loadSources();
      }

      this.batchProgress.current = '';
      this.batchRunning = false;
      await Promise.all([this.loadStats(), this.loadJobs()]);
    },

    clearBatch() {
      this.batchUrls = '';
      this.batchResults = [];
      this.batchProgress = { done: 0, total: 0, current: '' };
    },
  };
}
