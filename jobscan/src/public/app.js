/**
 * app.js — Main Alpine.js app: state + init, composed from mixins.
 *
 * Mixin files (loaded before this script):
 *   helpers.js      — truncate, shortenJD, renderMD, formatDate, …
 *   data-loading.js — loadStats, loadSources, loadJobs, loadParsers, …
 *   pagination.js   — pagination/sorting/filter triggers
 *   sync.js         — syncAll orchestration + panel helpers
 *   sources.js      — source CRUD + batch import
 *   jobs.js         — row expand/collapse + on-demand description
 */
function app() {
  return {
    // ── State ──────────────────────────────────────────────────────────────
    activeTab: 'sources',

    // Sources (server-paginated)
    sources: [],
    sourcesTotal: 0,
    sourcesPage: 1,
    sourcesPageSize: 25,

    // Jobs (server-paginated, filtered, sorted)
    jobs: [],
    jobsTotal: 0,
    companies: [],
    locations: [],
    departments: [],
    workplaceTypes: [],
    commitmentTypes: [],
    jobsLoading: false,

    // New Jobs (server-paginated, filtered)
    newJobs: [],
    newJobsTotal: 0,

    // Lightweight stats for tab badges
    totalJobCount: 0,
    totalSourceCount: 0,

    latestSyncId: null,
    latestSyncNewCount: 0,
    syncing: false,
    syncSummary: null,

    filters: { company: '', title: '', location: '', department: '', workplace_type: '', commitment: '', query: '', since: '', inCrm: '' },
    newFilters: { company: '', title: '', location: '', department: '', workplace_type: '', commitment: '', query: '', inCrm: '' },

    // Cascading filter options (narrowed by other active filters)
    filterOptions:    { companies: [], locations: [], departments: [], workplaceTypes: [], commitmentTypes: [] },
    newFilterOptions: { companies: [], locations: [], departments: [], workplaceTypes: [], commitmentTypes: [] },

    // Filters panel collapsed state
    filtersExpanded: false,
    newFiltersExpanded: false,

    // Search mode: 'fuzzy' | 'regex' | 'exact'
    searchMode: 'fuzzy',
    newSearchMode: 'fuzzy',

    // Sync panel state
    syncPanel: {
      active: false,
      sources: [],
      startedAt: null,
      finishedAt: null,
      activeWorkers: 0,
      elapsedSec: 0,
      timerId: null,
      cancelled: false,
    },

    // Pagination
    pageSize: 25,
    currentPage: 1,
    newPageSize: 25,
    newCurrentPage: 1,

    // Sorting
    sortColumn: 'first_seen',
    sortDirection: 'desc',

    // Tracks expanded state + cached full descriptions
    expandedJobs: {},
    expandedNewJobs: {},
    jobDescriptions: {},

    // Tracks which individual source IDs are currently being synced
    syncingSourceIds: new Set(),

    // Sources client-side filter
    sourcesFilter: '',
    sourcesStatusFilter: '',

    showAddForm: false,
    addingSource: false,
    detecting: false,
    addError: '',
    addResult: null,
    newSource: { url: '', company: '', parser: '' },
    detectedOk: false,
    detectedCandidates: [],   // multi-source: [{parser,url,company,companyEdit,selected,detection}]
    addingCandidates: false,
    candidateResults: [],     // results after addAllCandidates()
    parsers: [],

    // Batch add
    showBatchForm: false,
    batchUrls: '',
    batchResults: [],
    batchRunning: false,
    batchProgress: { done: 0, total: 0, current: '' },

    // Debounce timers
    _searchTimer: null,
    _newSearchTimer: null,

    // ── Lifecycle ─────────────────────────────────────────────────────────
    async init() {
      await Promise.all([
        this.loadStats(),
        this.loadFilterOptions(),
        this.loadNewFilterOptions(),
        this.loadSources(),
        this.loadJobs(),
        this.loadParsers(),
        this.loadLatestSync(),
        this.loadCrmBucketCounts(),
        this.loadCrmSettings(),
      ]);

      // Watch for tab changes to manage CRM polling and load CRM data
      this.$watch('activeTab', (tab) => {
        if (tab === 'crm') {
          this.loadCrmJobs();
          this.loadCrmFilters();
          this.loadProcessingStatus();
          this.loadCrmFilterOptions();
          this.startCrmPolling();
          if (this.analyticsMode) {
            this.loadAnalytics();
          }
        } else {
          this.stopCrmPolling();
        }
        // Load CRM badges when switching to jobs tabs
        if (tab === 'jobs' || tab === 'new-jobs') {
          const jobIds = (tab === 'jobs' ? this.jobs : this.newJobs).map(j => j.id);
          if (jobIds.length > 0) this.loadCrmStatusMap(jobIds);
        }
      });
    },

    // ── Merge all mixin methods ───────────────────────────────────────────
    ...helpersMixin(),
    ...dataLoadingMixin(),
    ...paginationMixin(),
    ...syncMixin(),
    ...sourcesMixin(),
    ...jobsMixin(),
    ...crmMixin(),
    ...crmFiltersMixin(),
    ...crmSettingsMixin(),
    ...crmAnalyticsMixin(),
  };
}
