/**
 * pagination.js — Pagination, sorting, and filter-trigger logic
 */
function paginationMixin() {
  return {
    // ── Server-side filter/sort/page triggers ─────────────────────────────

    /** Called when any filter changes on All Jobs tab */
    applyJobFilters() {
      this.currentPage = 1;
      this.loadJobs();
      this.loadFilterOptions();
    },

    /** Debounced search for All Jobs */
    onJobSearchInput() {
      this.currentPage = 1;
      clearTimeout(this._searchTimer);
      this._searchTimer = setTimeout(() => { this.loadJobs(); this.loadFilterOptions(); }, 300);
    },

    /** Called when any filter changes on New Jobs tab */
    applyNewJobFilters() {
      this.newCurrentPage = 1;
      this.loadNewJobs(this.latestSyncId);
      this.loadNewFilterOptions();
    },

    /** Debounced search for New Jobs */
    onNewJobSearchInput() {
      this.newCurrentPage = 1;
      clearTimeout(this._newSearchTimer);
      this._newSearchTimer = setTimeout(() => { this.loadNewJobs(this.latestSyncId); this.loadNewFilterOptions(); }, 300);
    },

    // ── Jobs pagination ───────────────────────────────────────────────────

    totalPages() {
      return Math.max(1, Math.ceil(this.jobsTotal / this.pageSize));
    },

    setPageSize(size) {
      this.pageSize = size;
      this.currentPage = 1;
      this.loadJobs();
    },

    goToPage(page) {
      const tp = this.totalPages();
      this.currentPage = Math.max(1, Math.min(page, tp));
      this.loadJobs();
    },

    // ── New Jobs pagination ───────────────────────────────────────────────

    newTotalPages() {
      return Math.max(1, Math.ceil(this.newJobsTotal / this.newPageSize));
    },

    setNewPageSize(size) {
      this.newPageSize = size;
      this.newCurrentPage = 1;
      this.loadNewJobs(this.latestSyncId);
    },

    goToNewPage(page) {
      const tp = this.newTotalPages();
      this.newCurrentPage = Math.max(1, Math.min(page, tp));
      this.loadNewJobs(this.latestSyncId);
    },

    // ── Sources pagination ────────────────────────────────────────────────

    sourcesTotalPages() {
      return Math.max(1, Math.ceil(this.sourcesTotal / this.sourcesPageSize));
    },

    setSourcesPageSize(size) {
      this.sourcesPageSize = size;
      this.sourcesPage = 1;
      this.loadSources();
    },

    goToSourcesPage(page) {
      const tp = this.sourcesTotalPages();
      this.sourcesPage = Math.max(1, Math.min(page, tp));
      this.loadSources();
    },

    /** Called when any sources filter changes (status dropdown) */
    applySourceFilters() {
      this.sourcesPage = 1;
      this.loadSources();
    },

    /** Debounced search for Sources tab */
    onSourceSearchInput() {
      this.sourcesPage = 1;
      clearTimeout(this._sourceSearchTimer);
      this._sourceSearchTimer = setTimeout(() => this.loadSources(), 300);
    },

    clearSourceFilters() {
      this.sourcesFilter = '';
      this.sourcesStatusFilter = '';
      this.sourcesPage = 1;
      this.loadSources();
    },

    // ── Sorting ───────────────────────────────────────────────────────────

    toggleSort(column) {
      if (this.sortColumn === column) {
        this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
      } else {
        this.sortColumn = column;
        this.sortDirection = 'asc';
      }
      this.currentPage = 1;
      this.loadJobs();
    },

    sortIcon(column) {
      if (this.sortColumn !== column) return '⇅';
      return this.sortDirection === 'asc' ? '↑' : '↓';
    },

    // ── Filter clear ──────────────────────────────────────────────────────

    clearFilters() {
      this.filters = { company: '', title: '', location: '', department: '', workplace_type: '', commitment: '', query: '', since: '', inCrm: '' };
      this.searchMode = 'fuzzy';
      this.currentPage = 1;
      this.loadJobs();
      this.loadFilterOptions();
    },

    clearNewFilters() {
      this.newFilters = { company: '', title: '', location: '', department: '', workplace_type: '', commitment: '', query: '', inCrm: '' };
      this.newSearchMode = 'fuzzy';
      this.newCurrentPage = 1;
      this.loadNewJobs(this.latestSyncId);
      this.loadNewFilterOptions();
    },

    /** Check whether any filter is actively set (for badge indicator) */
    hasActiveFilters() {
      return !!(this.filters.company || this.filters.title || this.filters.location || this.filters.department || this.filters.workplace_type || this.filters.commitment || this.filters.query || this.filters.since || this.filters.inCrm);
    },

    hasActiveNewFilters() {
      return !!(this.newFilters.company || this.newFilters.title || this.newFilters.location || this.newFilters.department || this.newFilters.workplace_type || this.newFilters.commitment || this.newFilters.query || this.newFilters.inCrm);
    },
  };
}
