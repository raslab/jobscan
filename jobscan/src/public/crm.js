/**
 * crm.js — CRM mixin for Alpine.js app.
 * Manages CRM state, job add/move/remove, bucket navigation, badges, processing.
 */
function crmMixin() {
  return {
    // ── CRM State ────────────────────────────────────────────────────────
    crmBucket: 'sourced',
    crmJobs: [],
    crmJobsTotal: 0,
    crmPage: 1,
    crmPageSize: 25,
    crmBucketCounts: { sourced: 0, filtered: 0, processed: 0, applied: 0, disqualified: 0, auto_disqualified: 0 },
    crmTotalCount: 0,
    crmExpandedJob: null,
    crmJobHistory: [],
    crmStatusMap: {},
    crmProcessingStatus: { state: 'idle', current_job: null, error_count: 0 },
    crmShowFilters: false,
    crmShowSettings: false,
    crmLoading: false,

    // Multi-select for bulk add
    selectMode: false,
    selectedJobIds: [],

    // Move dialog state
    moveTarget: '',
    moveComment: '',

    // Toast notifications
    toasts: [],
    _toastId: 0,

    // Status polling
    _statusInterval: null,

    // ── Bucket labels ────────────────────────────────────────────────────
    bucketLabel(bucket) {
      const labels = {
        sourced: 'Sourced',
        filtered: 'Filtered',
        processed: 'Processed',
        applied: 'Applied',
        disqualified: 'Disqualified',
        auto_disqualified: 'Auto-Disqualified',
      };
      return labels[bucket] || bucket;
    },

    formatCrmBadge(status) {
      if (!status) return '';
      let label = this.bucketLabel(status.bucket);
      if (status.tier) label += ' ' + status.tier;
      return `[${label}]`;
    },

    allBuckets() {
      return ['sourced', 'filtered', 'processed', 'applied', 'disqualified', 'auto_disqualified'];
    },

    // ── Data Loading ─────────────────────────────────────────────────────
    async loadCrmBucketCounts(skipFilters = false) {
      try {
        // When skipFilters=true (e.g. background polling), fetch raw counts
        // to avoid re-running expensive search/regex queries every few seconds.
        const params = (!skipFilters && this.getCrmFilterParams) ? this.getCrmFilterParams() : new URLSearchParams();
        const res = await fetch('/api/crm/jobs/counts?' + params);
        if (res.ok) {
          this.crmBucketCounts = await res.json();
          this.crmTotalCount = Object.values(this.crmBucketCounts).reduce((a, b) => a + b, 0);
        }
      } catch (e) { console.error('Failed to load CRM bucket counts:', e); }
    },

    async loadCrmJobs() {
      this.crmLoading = true;
      try {
        const params = new URLSearchParams({
          bucket: this.crmBucket,
          page: String(this.crmPage),
          pageSize: String(this.crmPageSize),
        });
        // Include CRM-scoped filters if the analytics mixin is present
        if (this.crmFilters_) {
          const f = this.crmFilters_;
          if (f.company) params.set('company', f.company);
          if (f.title) params.set('title', f.title);
          if (f.location) params.set('location', f.location);
          if (f.department) params.set('department', f.department);
          if (f.workplace_type) params.set('workplace_type', f.workplace_type);
          if (f.commitment) params.set('commitment', f.commitment);
          if (f.autoFilter) params.set('autoFilter', f.autoFilter);
          if (f.query) {
            params.set('search', f.query);
            params.set('searchMode', this.crmSearchMode || 'fuzzy');
          }
        }
        const res = await fetch(`/api/crm/jobs?${params}`);
        if (res.ok) {
          const data = await res.json();
          this.crmJobs = data.data;
          this.crmJobsTotal = data.total;
        }
      } catch (e) { console.error('Failed to load CRM jobs:', e); }
      this.crmLoading = false;
    },

    async loadCrmJobDetail(crmJobId) {
      try {
        const res = await fetch(`/api/crm/jobs/${crmJobId}`);
        if (res.ok) {
          const data = await res.json();
          this.crmExpandedJob = data;
          this.crmJobHistory = data.events || [];
        }
      } catch (e) { console.error('Failed to load CRM job detail:', e); }
    },

    async loadCrmStatusMap(jobIds) {
      if (!jobIds || jobIds.length === 0) return;
      try {
        const res = await fetch(`/api/crm/jobs/status-map?jobIds=${jobIds.join(',')}`);
        if (res.ok) {
          const map = await res.json();
          // Clear stale entries for the requested IDs before merging,
          // so jobs removed from CRM won't show stale badges.
          const updated = { ...this.crmStatusMap };
          for (const id of jobIds) {
            delete updated[id];
          }
          this.crmStatusMap = { ...updated, ...map };
        }
      } catch (e) { console.error('Failed to load CRM status map:', e); }
    },

    async loadProcessingStatus() {
      try {
        const res = await fetch('/api/crm/status');
        if (res.ok) {
          this.crmProcessingStatus = await res.json();
        }
      } catch (e) { /* silent */ }
    },

    // ── Actions ──────────────────────────────────────────────────────────
    async disqualifyJob(jobId) {
      const reason = prompt('Reason for disqualifying:');
      if (reason) {
        await this.addToCrm(jobId, 'disqualified', null, reason);
      }
    },

    async disqualifyJobsBulk(jobIds) {
      const reason = prompt('Reason for disqualifying:');
      if (reason) {
        await this.addToCrmBulk(jobIds, 'disqualified', null, reason);
      }
    },

    async addToCrm(jobId, bucket = 'sourced', comment = null, reason = null) {
      try {
        const body = { jobIds: [jobId], bucket };
        if (comment) body.comment = comment;
        if (reason) body.reason = reason;
        const res = await fetch('/api/crm/jobs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (res.ok) {
          const data = await res.json();
          // Update status map
          this.crmStatusMap = { ...this.crmStatusMap, [jobId]: { bucket, tier: null } };
          await this.loadCrmBucketCounts();
          this.showToast(`Added to ${this.bucketLabel(bucket)}`);
          return data;
        }
      } catch (e) { console.error('Failed to add to CRM:', e); }
    },

    async addToCrmBulk(jobIds, bucket = 'sourced', comment = null, reason = null) {
      try {
        const body = { jobIds, bucket };
        if (comment) body.comment = comment;
        if (reason) body.reason = reason;
        const res = await fetch('/api/crm/jobs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (res.ok) {
          const data = await res.json();
          // Update status map for all added
          for (const id of jobIds) {
            this.crmStatusMap[id] = { bucket, tier: null };
          }
          await this.loadCrmBucketCounts();
          this.selectedJobIds = [];
          this.selectMode = false;
          this.showToast(`Added ${data.added} job(s) to CRM` + (data.skipped > 0 ? `. Skipped ${data.skipped}.` : '.'));
          return data;
        }
      } catch (e) { console.error('Failed to bulk add to CRM:', e); }
    },

    async moveCrmJob(crmJobId, targetBucket, comment = '') {
      try {
        const res = await fetch(`/api/crm/jobs/${crmJobId}/move`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bucket: targetBucket, comment }),
        });
        if (res.ok) {
          await this.loadCrmBucketCounts();
          await this.loadCrmJobs();
          this.loadCrmFilterOptions();
          if (this.crmExpandedJob && this.crmExpandedJob.id === crmJobId) {
            await this.loadCrmJobDetail(crmJobId);
          }
          this.moveTarget = '';
          this.moveComment = '';
        }
      } catch (e) { console.error('Failed to move CRM job:', e); }
    },

    async removeCrmJob(crmJobId) {
      if (!confirm('Remove this job from CRM? This will delete all history.')) return;
      try {
        const jobId = this.crmExpandedJob?.job_id;
        const res = await fetch(`/api/crm/jobs/${crmJobId}`, { method: 'DELETE' });
        if (res.ok) {
          if (jobId) delete this.crmStatusMap[jobId];
          this.crmExpandedJob = null;
          await this.loadCrmBucketCounts();
          await this.loadCrmJobs();
          this.loadCrmFilterOptions();
        }
      } catch (e) { console.error('Failed to remove CRM job:', e); }
    },

    async updateCrmComment(crmJobId, comment) {
      try {
        await fetch(`/api/crm/jobs/${crmJobId}/comment`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ comment }),
        });
      } catch (e) { console.error('Failed to update comment:', e); }
    },

    async saveCrmComment(crmJobId, comment) {
      try {
        await fetch(`/api/crm/jobs/${crmJobId}/comment`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ comment }),
        });
        // Reload detail to show new history event
        await this.loadCrmJobDetail(crmJobId);
        this.showToast('Comment saved');
      } catch (e) { console.error('Failed to save comment:', e); }
    },

    async triggerProcessing() {
      try {
        await fetch('/api/crm/process', { method: 'POST' });
        await this.loadProcessingStatus();
      } catch (e) { console.error('Failed to trigger processing:', e); }
    },

    // ── Navigation ───────────────────────────────────────────────────────
    async switchCrmBucket(bucket) {
      this.crmBucket = bucket;
      this.crmPage = 1;
      this.crmExpandedJob = null;
      await this.loadCrmJobs();
      this.loadCrmFilterOptions();
    },

    async goToCrmPage(page) {
      this.crmPage = page;
      await this.loadCrmJobs();
    },

    crmTotalPages() {
      return Math.max(1, Math.ceil(this.crmJobsTotal / this.crmPageSize));
    },

    navigateToCrmJob(jobId) {
      this.activeTab = 'crm';
      // Find the CRM job by source job ID, then expand it
      this.crmExpandedJob = null;
      // We need to find which bucket this job is in
      const status = this.crmStatusMap[jobId];
      if (status) {
        this.crmBucket = status.bucket;
        this.crmPage = 1;
        this.loadCrmJobs().then(() => {
          const found = this.crmJobs.find(j => j.job_id === jobId);
          if (found) {
            this.loadCrmJobDetail(found.id);
          }
        });
      }
    },

    // ── Multi-select ─────────────────────────────────────────────────────
    toggleSelectMode() {
      this.selectMode = !this.selectMode;
      if (!this.selectMode) this.selectedJobIds = [];
    },

    toggleJobSelection(jobId) {
      const idx = this.selectedJobIds.indexOf(jobId);
      if (idx >= 0) {
        this.selectedJobIds.splice(idx, 1);
      } else {
        this.selectedJobIds.push(jobId);
      }
    },

    isJobSelected(jobId) {
      return this.selectedJobIds.includes(jobId);
    },

    // ── Processing status polling ────────────────────────────────────────
    startCrmPolling() {
      if (this._statusInterval) return;
      this._statusInterval = setInterval(() => {
        this.loadProcessingStatus();
        // Only refresh counts from polling when NO filter is active (fast unfiltered
        // query). When filters are active, counts are owned by applyCrmFilters() and
        // must not be overwritten by background polling.
        const hasFilters = this.hasActiveCrmFilters && this.hasActiveCrmFilters();
        if (!hasFilters) {
          this.loadCrmBucketCounts(true);
        }
      }, 3000);
    },

    stopCrmPolling() {
      if (this._statusInterval) {
        clearInterval(this._statusInterval);
        this._statusInterval = null;
      }
    },

    // ── Event formatting ─────────────────────────────────────────────────
    eventIcon(eventType) {
      const icons = {
        added: '➕',
        moved: '↗️',
        comment: '💬',
        keyword_disqualified: '🚫',
        llm_filter_passed: '✅',
        llm_filter_failed: '❌',
        tier_assigned: '🏷️',
        processing_error: '⚠️',
        processing_started: '⚙️',
        manual_trigger: '🔄',
      };
      return icons[eventType] || '•';
    },

    eventLabel(eventType) {
      const labels = {
        added: 'Added to CRM',
        moved: 'Moved',
        comment: 'Comment',
        keyword_disqualified: 'Keyword Disqualified',
        llm_filter_passed: 'LLM Filter Passed',
        llm_filter_failed: 'LLM Filter Failed',
        tier_assigned: 'Tier Assigned',
        processing_error: 'Processing Error',
        processing_started: 'Processing Started',
        manual_trigger: 'Manual Trigger',
      };
      return labels[eventType] || eventType;
    },

    /**
     * Copy job description as markdown with YAML front matter headers.
     * Only includes job info fields (no CRM state).
     */
    copyJobJD() {
      const job = this.crmExpandedJob;
      if (!job) return;

      const lines = ['---'];
      const addField = (key, val) => {
        if (val != null && val !== '') {
          const str = String(val);
          // Quote the value if it contains characters that need escaping in YAML
          const needsQuote = /[:#\[\]{}&*!|>'"%@`]/.test(str) || str.includes('\n') || str.startsWith(' ') || str.endsWith(' ');
          lines.push(`${key}: ${needsQuote ? '"' + str.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"' : str}`);
        }
      };
      addField('title', job.title);
      addField('company', job.company);
      addField('location', job.location);
      addField('workplace_type', job.workplace_type);
      addField('department', job.department);
      addField('team', job.team);
      addField('commitment', job.commitment);
      addField('url', job.url);
      lines.push('---');
      lines.push('');
      lines.push(job.description || '');

      const text = lines.join('\n');
      navigator.clipboard.writeText(text)
        .then(() => this.showToast('📋 Job description copied!'))
        .catch(() => this.showToast('❌ Failed to copy to clipboard'));
    },

    /**
     * Show a non-blocking toast notification.
     */
    showToast(message, duration = 3000) {
      const id = ++this._toastId;
      this.toasts.push({ id, message });
      setTimeout(() => {
        this.toasts = this.toasts.filter(t => t.id !== id);
      }, duration);
    },

    /**
     * Parse context_data JSON and format into readable lines for history timeline.
     * Returns an array of { label, value, type } objects for structured rendering.
     */
    formatEventDetail(evt) {
      const lines = [];
      let ctx = null;
      if (evt.context_data) {
        try { ctx = typeof evt.context_data === 'string' ? JSON.parse(evt.context_data) : evt.context_data; } catch { /* ignore */ }
      }

      // From → To bucket
      if (evt.from_bucket || evt.to_bucket) {
        const from = evt.from_bucket ? this.bucketLabel(evt.from_bucket) : '—';
        const to = evt.to_bucket ? this.bucketLabel(evt.to_bucket) : '—';
        lines.push({ label: null, value: `${from} → ${to}`, type: 'move' });
      }

      if (evt.comment) {
        lines.push({ label: null, value: `"${evt.comment}"`, type: 'comment' });
      }

      if (ctx) {
        // Keyword disqualification
        if (ctx.filter_name) lines.push({ label: 'Filter', value: ctx.filter_name, type: 'filter' });
        if (ctx.keyword)     lines.push({ label: 'Keyword', value: `"${ctx.keyword}" in ${ctx.field || 'text'}`, type: 'keyword' });
        if (ctx.text_snippet) lines.push({ label: 'Snippet', value: `…${ctx.text_snippet.substring(0, 120)}…`, type: 'snippet' });

        // LLM filter/tier results
        if (ctx.reason)    lines.push({ label: 'Reason', value: ctx.reason, type: 'reason' });
        if (ctx.reasoning) lines.push({ label: 'Reasoning', value: ctx.reasoning, type: 'reason' });
        if (ctx.tier)      lines.push({ label: 'Tier', value: ctx.tier, type: 'tier' });
        if (ctx.strengths && ctx.strengths.length) lines.push({ label: 'Strengths', value: ctx.strengths.join('; '), type: 'strengths' });
        if (ctx.gaps && ctx.gaps.length)           lines.push({ label: 'Gaps', value: ctx.gaps.join('; '), type: 'gaps' });

        // LLM token usage & timing
        if (ctx.tokens_in != null || ctx.tokens_out != null || ctx.elapsed_ms != null) {
          const stats = [];
          if (ctx.tokens_in  != null) stats.push(`🔢 in: ${ctx.tokens_in}`);
          if (ctx.tokens_out != null) stats.push(`out: ${ctx.tokens_out}`);
          if (ctx.elapsed_ms != null) stats.push(`⏱ ${ctx.elapsed_ms}ms`);
          lines.push({ label: null, value: stats.join('  '), type: 'stats' });
        }

        // Error info
        if (ctx.error) lines.push({ label: 'Error', value: ctx.error, type: 'error' });
      }

      return lines;
    },
  };
}
