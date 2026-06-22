/**
 * crm-analytics.js — CRM Analytics mixin for Alpine.js app.
 * Provides funnel Sankey chart, text representation, copy-to-clipboard,
 * filter disqualification analysis, and filtering support.
 */
function crmAnalyticsMixin() {
  return {
    // ── Analytics State ──────────────────────────────────────────────────
    analyticsMode: false,  // true = Analytics view, false = normal CRM buckets
    analyticsLoading: false,
    analyticsData: null,   // { flows, filterStats, bucketCounts, totalJobs }

    // CRM-scoped filters (shared between CRM bucket view and analytics)
    crmFilters_: { company: '', title: '', location: '', department: '', workplace_type: '', commitment: '', query: '', autoFilter: '' },
    crmSearchMode: 'fuzzy',
    crmFiltersExpanded: false,
    crmFilterOptions: { companies: [], locations: [], departments: [], workplaceTypes: [], commitmentTypes: [], autoFilterNames: [] },

    // Debounce
    _crmSearchTimer: null,

    // Google Charts loaded flag
    _googleChartsLoaded: false,

    // ── Bucket labels for analytics ──────────────────────────────────────
    bucketLabelFull(bucket) {
      const labels = {
        sourced: 'Sourced',
        filtered: 'Filtered',
        processed: 'Processed',
        applied: 'Applied',
        disqualified: 'Disqualified',
        auto_disqualified: 'Auto-Disqualified',
        _entry: 'Entry',
      };
      return labels[bucket] || bucket;
    },

    // ── Toggle analytics mode ────────────────────────────────────────────
    async toggleAnalyticsMode() {
      this.analyticsMode = !this.analyticsMode;
      if (this.analyticsMode) {
        await this.loadAnalytics();
      }
    },

    // ── CRM Filters Logic ────────────────────────────────────────────────
    applyCrmFilters() {
      this.crmPage = 1;
      this.loadCrmJobs();
      this.loadCrmBucketCounts();
      this.loadCrmFilterOptions();
      if (this.analyticsMode) {
        this.loadAnalytics();
      }
    },

    onCrmSearchInput() {
      clearTimeout(this._crmSearchTimer);
      this._crmSearchTimer = setTimeout(() => this.applyCrmFilters(), 300);
    },

    clearCrmFilters() {
      this.crmFilters_ = { company: '', title: '', location: '', department: '', workplace_type: '', commitment: '', query: '', autoFilter: '' };
      this.crmSearchMode = 'fuzzy';
      this.crmPage = 1;
      this.loadCrmJobs();
      this.loadCrmBucketCounts();
      this.loadCrmFilterOptions();
      if (this.analyticsMode) {
        this.loadAnalytics();
      }
    },

    hasActiveCrmFilters() {
      const f = this.crmFilters_;
      return !!(f.company || f.title || f.location || f.department || f.workplace_type || f.commitment || f.query || f.autoFilter);
    },

    getCrmFilterParams() {
      const params = new URLSearchParams();
      const f = this.crmFilters_;
      if (f.company) params.set('company', f.company);
      if (f.title) params.set('title', f.title);
      if (f.location) params.set('location', f.location);
      if (f.department) params.set('department', f.department);
      if (f.workplace_type) params.set('workplace_type', f.workplace_type);
      if (f.commitment) params.set('commitment', f.commitment);
      if (f.query) {
        params.set('search', f.query);
        params.set('searchMode', this.crmSearchMode);
      }
      if (f.autoFilter) params.set('autoFilter', f.autoFilter);
      return params;
    },

    async loadCrmFilterOptions() {
      try {
        const params = this.getCrmFilterParams();
        // Don't scope by bucket — show options from ALL CRM jobs (like Jobs tab),
        // cascaded only by other active filters. Bucket is a separate dimension.
        const res = await fetch('/api/crm/filter-options?' + params);
        if (res.ok) {
          this.crmFilterOptions = await res.json();
        }
      } catch (e) { console.error('Failed to load CRM filter options:', e); }
    },

    // Override loadCrmJobs to include filters
    _originalLoadCrmJobs: null,

    async loadCrmJobsWithFilters() {
      this.crmLoading = true;
      try {
        const params = this.getCrmFilterParams();
        params.set('bucket', this.crmBucket);
        params.set('page', String(this.crmPage));
        params.set('pageSize', String(this.crmPageSize));
        const res = await fetch(`/api/crm/jobs?${params}`);
        if (res.ok) {
          const data = await res.json();
          this.crmJobs = data.data;
          this.crmJobsTotal = data.total;
        }
      } catch (e) { console.error('Failed to load CRM jobs:', e); }
      this.crmLoading = false;
    },

    // ── Analytics Data Loading ───────────────────────────────────────────
    async loadAnalytics() {
      this.analyticsLoading = true;
      try {
        const params = this.getCrmFilterParams();
        const res = await fetch(`/api/crm/analytics/funnel?${params}`);
        if (res.ok) {
          this.analyticsData = await res.json();
          this.$nextTick(() => this.renderSankeyChart());
        }
      } catch (e) { console.error('Failed to load analytics:', e); }
      this.analyticsLoading = false;
    },

    // ── Google Charts Sankey ─────────────────────────────────────────────
    ensureGoogleCharts(callback) {
      if (this._googleChartsLoaded) {
        callback();
        return;
      }
      if (typeof google !== 'undefined' && google.visualization) {
        this._googleChartsLoaded = true;
        callback();
        return;
      }
      // Load Google Charts
      if (!document.getElementById('google-charts-loader')) {
        const script = document.createElement('script');
        script.id = 'google-charts-loader';
        script.src = 'https://www.gstatic.com/charts/loader.js';
        script.onload = () => {
          google.charts.load('current', { packages: ['sankey'] });
          google.charts.setOnLoadCallback(() => {
            this._googleChartsLoaded = true;
            callback();
          });
        };
        document.head.appendChild(script);
      } else {
        // Script already loading, poll
        const poll = setInterval(() => {
          if (typeof google !== 'undefined' && google.visualization && google.visualization.Sankey) {
            clearInterval(poll);
            this._googleChartsLoaded = true;
            callback();
          }
        }, 100);
      }
    },

    renderSankeyChart() {
      if (!this.analyticsData || !this.analyticsData.flows || this.analyticsData.flows.length === 0) return;

      this.ensureGoogleCharts(() => {
        const container = document.getElementById('sankey-chart');
        if (!container) return;

        const data = new google.visualization.DataTable();
        data.addColumn('string', 'From');
        data.addColumn('string', 'To');
        data.addColumn('number', 'Count');

        // Stage order index — used to detect forward vs backward flows
        // Google Charts Sankey does NOT support cycles, so we must filter them out
        const stageIndex = { _entry: 0, sourced: 1, filtered: 2, processed: 3, applied: 4, disqualified: 5, auto_disqualified: 5 };

        const flows = this.analyticsData.flows;

        // Separate forward flows (for Sankey) and backward flows (reclassifications, shown as note)
        const rows = [];
        const backflows = [];
        for (const flow of flows) {
          const fromIdx = stageIndex[flow.from] ?? -1;
          const toIdx = stageIndex[flow.to] ?? -1;
          const fromLabel = this.bucketLabelFull(flow.from);
          const toLabel = this.bucketLabelFull(flow.to);
          if (fromLabel === toLabel) continue; // skip self-loops

          if (toIdx > fromIdx) {
            // Forward flow — safe for Sankey
            rows.push([fromLabel, toLabel, flow.count]);
          } else {
            // Backward flow — would create a cycle, show separately
            backflows.push(flow);
          }
        }

        if (rows.length === 0) {
          container.innerHTML = '<p style="text-align:center;opacity:0.6">No forward transition data to display</p>';
          return;
        }

        data.addRows(rows);

        // Show reclassification note if there are backward flows
        let noteEl = document.getElementById('sankey-backflows-note');
        if (backflows.length > 0) {
          const noteText = backflows.map(f =>
            `${this.bucketLabelFull(f.from)} → ${this.bucketLabelFull(f.to)}: ${f.count}`
          ).join(', ');
          if (!noteEl) {
            noteEl = document.createElement('p');
            noteEl.id = 'sankey-backflows-note';
            noteEl.style.cssText = 'font-size:0.85em;opacity:0.7;margin-top:0.5rem;text-align:center';
            container.parentNode.appendChild(noteEl);
          }
          noteEl.textContent = `↩ Reclassifications (not shown in chart): ${noteText}`;
        } else if (noteEl) {
          noteEl.remove();
        }

        const colors = [
          '#4285F4', // blue
          '#34A853', // green
          '#FBBC05', // yellow
          '#EA4335', // red
          '#9C27B0', // purple
          '#FF9800', // orange
          '#00BCD4', // cyan
          '#795548', // brown
        ];

        const options = {
          width: container.clientWidth || 800,
          height: Math.max(300, rows.length * 40 + 100),
          sankey: {
            node: {
              colors: colors,
              label: { fontName: 'system-ui', fontSize: 13, bold: true },
              nodePadding: 16,
              width: 12,
            },
            link: {
              colorMode: 'gradient',
              colors: colors,
            },
          },
        };

        const chart = new google.visualization.Sankey(container);
        chart.draw(data, options);
      });
    },

    // ── Text Representation ──────────────────────────────────────────────
    generateFunnelText() {
      if (!this.analyticsData) return '(No analytics data)';

      const d = this.analyticsData;
      const lines = [];

      lines.push('═══════════════════════════════════════════');
      lines.push('         CRM FUNNEL ANALYTICS');
      lines.push('═══════════════════════════════════════════');
      lines.push('');

      // Active filters
      if (this.hasActiveCrmFilters()) {
        lines.push('Filters Applied:');
        const f = this.crmFilters_;
        if (f.company) lines.push(`  Company: ${f.company}`);
        if (f.title) lines.push(`  Title: ${f.title}`);
        if (f.location) lines.push(`  Location: ${f.location}`);
        if (f.department) lines.push(`  Department: ${f.department}`);
        if (f.workplace_type) lines.push(`  Workplace: ${f.workplace_type}`);
        if (f.commitment) lines.push(`  Type: ${f.commitment}`);
        if (f.query) lines.push(`  Search: ${f.query}`);
        lines.push('');
      }

      // Bucket counts
      lines.push(`Total CRM Jobs: ${d.totalJobs}`);
      lines.push('');
      lines.push('Current Stage Distribution:');
      lines.push('───────────────────────────────────────────');
      const bucketOrder = ['sourced', 'filtered', 'processed', 'applied', 'disqualified', 'auto_disqualified'];
      for (const b of bucketOrder) {
        const count = d.bucketCounts[b] || 0;
        const pct = d.totalJobs > 0 ? ((count / d.totalJobs) * 100).toFixed(1) : '0.0';
        const bar = '█'.repeat(Math.round(count / Math.max(1, d.totalJobs) * 30));
        lines.push(`  ${this.bucketLabelFull(b).padEnd(20)} ${String(count).padStart(5)}  (${pct.padStart(5)}%)  ${bar}`);
      }
      lines.push('');

      // Stage transitions
      lines.push('Stage Transitions (Flows):');
      lines.push('───────────────────────────────────────────');
      const transitions = (d.flows || []).filter(f => f.from !== '_entry').sort((a, b) => b.count - a.count);
      if (transitions.length === 0) {
        lines.push('  No transitions recorded yet.');
      } else {
        for (const flow of transitions) {
          lines.push(`  ${this.bucketLabelFull(flow.from)} → ${this.bucketLabelFull(flow.to)}: ${flow.count}`);
        }
      }
      lines.push('');

      // Entry points
      const entries = (d.flows || []).filter(f => f.from === '_entry');
      if (entries.length > 0) {
        lines.push('Entry Points:');
        lines.push('───────────────────────────────────────────');
        for (const flow of entries) {
          lines.push(`  → ${this.bucketLabelFull(flow.to)}: ${flow.count} jobs`);
        }
        lines.push('');
      }

      // Filter analysis
      if (d.filterStats && d.filterStats.length > 0) {
        lines.push('Filter Disqualification Analysis:');
        lines.push('───────────────────────────────────────────');
        const totalDisq = d.filterStats.reduce((sum, f) => sum + f.count, 0);
        for (const fs of d.filterStats) {
          const pct = totalDisq > 0 ? ((fs.count / totalDisq) * 100).toFixed(1) : '0.0';
          const typeTag = fs.filterType === 'keyword' ? '[KW]' : '[LLM]';
          lines.push(`  ${typeTag} ${fs.filterName.padEnd(25)} ${String(fs.count).padStart(5)} disqualified (${pct}%)`);
        }
        lines.push(`  ${''.padEnd(25)} ───── `);
        lines.push(`  ${'TOTAL'.padEnd(25)} ${String(totalDisq).padStart(5)}`);
        lines.push('');

        // Effectiveness analysis
        const totalSourced = entries.reduce((s, e) => e.to === 'sourced' ? s + e.count : s, 0) || d.totalJobs;
        if (totalSourced > 0) {
          const autoDisqRate = ((totalDisq / totalSourced) * 100).toFixed(1);
          lines.push(`Auto-disqualification rate: ${autoDisqRate}% of sourced jobs`);
          const manualDisq = d.bucketCounts['disqualified'] || 0;
          if (manualDisq > 0) {
            const manualRate = ((manualDisq / totalSourced) * 100).toFixed(1);
            lines.push(`Manual disqualification rate: ${manualRate}% of sourced jobs`);
          }
        }
      } else {
        lines.push('Filter Disqualification Analysis:');
        lines.push('───────────────────────────────────────────');
        lines.push('  No filter disqualifications recorded yet.');
      }

      lines.push('');
      lines.push(`Generated: ${new Date().toLocaleString()}`);
      return lines.join('\n');
    },

    async copyFunnelText() {
      const text = this.generateFunnelText();
      try {
        await navigator.clipboard.writeText(text);
        this.showToast('📋 Funnel analytics copied to clipboard!');
      } catch {
        // Fallback
        const el = document.createElement('textarea');
        el.value = text;
        document.body.appendChild(el);
        el.select();
        document.execCommand('copy');
        document.body.removeChild(el);
        this.showToast('📋 Funnel analytics copied to clipboard!');
      }
    },
  };
}
