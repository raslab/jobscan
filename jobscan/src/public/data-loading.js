/**
 * data-loading.js — API data fetching (stats, sources, jobs, parsers, syncs)
 */
function dataLoadingMixin() {
  return {
    /** Load lightweight stats for tab badges */
    async loadStats() {
      try {
        const res = await fetch('/api/jobs/stats');
        const data = await res.json();
        this.totalJobCount = data.totalJobs;
        this.totalSourceCount = data.totalSources;
      } catch (err) {
        console.error('Failed to load stats', err);
      }
    },

    /** Load cascading filter options for All Jobs tab */
    async loadFilterOptions() {
      try {
        const params = new URLSearchParams();
        if (this.filters.company) params.set('company', this.filters.company);
        if (this.filters.title)   params.set('title', this.filters.title);
        if (this.filters.location) params.set('location', this.filters.location);
        if (this.filters.department) params.set('department', this.filters.department);
        if (this.filters.workplace_type) params.set('workplace_type', this.filters.workplace_type);
        if (this.filters.commitment) params.set('commitment', this.filters.commitment);
        if (this.filters.since)   params.set('since', this.filters.since);
        if (this.filters.inCrm)   params.set('inCrm', this.filters.inCrm);
        if (this.filters.query) {
          params.set('search', this.filters.query);
          params.set('searchMode', this.searchMode);
        }
        const res = await fetch('/api/jobs/filter-options?' + params);
        this.filterOptions = await res.json();
      } catch (err) {
        console.error('Failed to load filter options', err);
      }
    },

    /** Load cascading filter options for New Jobs tab */
    async loadNewFilterOptions() {
      try {
        const params = new URLSearchParams();
        if (this.latestSyncId) params.set('syncId', String(this.latestSyncId));
        if (this.newFilters.company) params.set('company', this.newFilters.company);
        if (this.newFilters.title)   params.set('title', this.newFilters.title);
        if (this.newFilters.location) params.set('location', this.newFilters.location);
        if (this.newFilters.department) params.set('department', this.newFilters.department);
        if (this.newFilters.workplace_type) params.set('workplace_type', this.newFilters.workplace_type);
        if (this.newFilters.commitment) params.set('commitment', this.newFilters.commitment);
        if (this.newFilters.inCrm) params.set('inCrm', this.newFilters.inCrm);
        if (this.newFilters.query) {
          params.set('search', this.newFilters.query);
          params.set('searchMode', this.newSearchMode);
        }
        const res = await fetch('/api/jobs/filter-options?' + params);
        this.newFilterOptions = await res.json();
      } catch (err) {
        console.error('Failed to load new filter options', err);
      }
    },

    /** Load sources page from server */
    async loadSources() {
      try {
        const params = new URLSearchParams({
          page: String(this.sourcesPage),
          pageSize: String(this.sourcesPageSize),
        });
        if (this.sourcesFilter)       params.set('search', this.sourcesFilter.trim());
        if (this.sourcesStatusFilter) params.set('status', this.sourcesStatusFilter);
        const res = await fetch('/api/sources?' + params);
        const data = await res.json();
        if (data.data) {
          this.sources = data.data;
          this.sourcesTotal = data.total;
          this.totalSourceCount = data.total;
        } else {
          this.sources = data;
          this.sourcesTotal = data.length;
          this.totalSourceCount = data.length;
        }
      } catch (err) {
        console.error('Failed to load sources', err);
      }
    },

    /** Load paginated/filtered/sorted jobs from server */
    async loadJobs() {
      this.jobsLoading = true;
      try {
        const params = new URLSearchParams();
        params.set('page', String(this.currentPage));
        params.set('pageSize', String(this.pageSize));
        params.set('sortBy', this.sortColumn);
        params.set('sortDir', this.sortDirection);

        if (this.filters.company) params.set('company', this.filters.company);
        if (this.filters.title)   params.set('title', this.filters.title);
        if (this.filters.location) params.set('location', this.filters.location);
        if (this.filters.department) params.set('department', this.filters.department);
        if (this.filters.workplace_type) params.set('workplace_type', this.filters.workplace_type);
        if (this.filters.commitment) params.set('commitment', this.filters.commitment);
        if (this.filters.since)   params.set('since', this.filters.since);
        if (this.filters.inCrm)   params.set('inCrm', this.filters.inCrm);
        if (this.filters.query) {
          params.set('search', this.filters.query);
          params.set('searchMode', this.searchMode);
        }

        const res = await fetch('/api/jobs?' + params);
        const data = await res.json();
        this.jobs = data.data;
        this.jobsTotal = data.total;

        // Refresh CRM status badges for the loaded page
        const jobIds = this.jobs.map(j => j.id);
        if (jobIds.length > 0) this.loadCrmStatusMap(jobIds);
      } catch (err) {
        console.error('Failed to load jobs', err);
      } finally {
        this.jobsLoading = false;
      }
    },

    async loadParsers() {
      const res = await fetch('/api/sources/parsers');
      this.parsers = await res.json();
      if (this.parsers.length > 0 && !this.parsers.includes(this.newSource.parser)) {
        this.newSource.parser = this.parsers[0];
      }
    },

    async loadLatestSync() {
      const res = await fetch('/api/sync/latest');
      const data = await res.json();
      if (data) {
        this.latestSyncId = data.id;
        this.latestSyncNewCount = data.new_jobs ?? 0;
        await this.loadNewJobs(data.id);
      }
    },

    /** Load paginated new jobs for a sync */
    async loadNewJobs(syncId) {
      if (!syncId) { this.newJobs = []; this.newJobsTotal = 0; return; }
      try {
        const params = new URLSearchParams();
        params.set('syncId', String(syncId));
        params.set('page', String(this.newCurrentPage));
        params.set('pageSize', String(this.newPageSize));

        if (this.newFilters.company) params.set('company', this.newFilters.company);
        if (this.newFilters.title)   params.set('title', this.newFilters.title);
        if (this.newFilters.location) params.set('location', this.newFilters.location);
        if (this.newFilters.department) params.set('department', this.newFilters.department);
        if (this.newFilters.workplace_type) params.set('workplace_type', this.newFilters.workplace_type);
        if (this.newFilters.commitment) params.set('commitment', this.newFilters.commitment);
        if (this.newFilters.inCrm) params.set('inCrm', this.newFilters.inCrm);
        if (this.newFilters.query) {
          params.set('search', this.newFilters.query);
          params.set('searchMode', this.newSearchMode);
        }

        const res = await fetch('/api/jobs?' + params);
        const data = await res.json();
        this.newJobs = data.data;
        this.newJobsTotal = data.total;

        // Refresh CRM status badges for the loaded page
        const jobIds = this.newJobs.map(j => j.id);
        if (jobIds.length > 0) this.loadCrmStatusMap(jobIds);
      } catch (err) {
        console.error('Failed to load new jobs', err);
      }
    },
  };
}
