/**
 * crm-filters.js — CRM filter configuration mixin for Alpine.js app.
 */
function crmFiltersMixin() {
  return {
    crmFilters: [],
    crmFilterForm: { name: '', filter_type: 'keyword', config: {}, is_active: 1 },
    crmFilterEditing: null,
    crmFilterTestResult: null,
    crmFilterTestJobId: null,
    crmFilterFormOpen: false,

    initKeywordConfig() { return { keywords: [''], fields: ['title'], match_mode: 'any' }; },
    initLlmFilterConfig() { return { prompt: '' }; },
    initLlmTierConfig() { return { prompt: '' }; },

    getDefaultConfig(filterType) {
      if (filterType === 'keyword') return this.initKeywordConfig();
      if (filterType === 'llm_filter') return this.initLlmFilterConfig();
      if (filterType === 'llm_tier') return this.initLlmTierConfig();
      return {};
    },

    async loadCrmFilters() {
      try {
        const res = await fetch('/api/crm/filters');
        if (res.ok) {
          this.crmFilters = await res.json();
        }
      } catch (e) { console.error('Failed to load CRM filters:', e); }
    },

    openFilterForm(filter = null) {
      if (filter) {
        this.crmFilterEditing = filter.id;
        let config;
        try { config = JSON.parse(filter.config); } catch { config = {}; }
        this.crmFilterForm = {
          name: filter.name,
          filter_type: filter.filter_type,
          config,
          is_active: filter.is_active,
        };
      } else {
        this.crmFilterEditing = null;
        this.crmFilterForm = {
          name: '',
          filter_type: 'keyword',
          config: this.initKeywordConfig(),
          is_active: 1,
        };
      }
      this.crmFilterFormOpen = true;
    },

    closeFilterForm() {
      this.crmFilterFormOpen = false;
      this.crmFilterEditing = null;
      this.crmFilterTestResult = null;
    },

    async saveCrmFilter() {
      const body = {
        name: this.crmFilterForm.name,
        filter_type: this.crmFilterForm.filter_type,
        config: this.crmFilterForm.config,
        is_active: this.crmFilterForm.is_active ? 1 : 0,
      };

      try {
        let res;
        if (this.crmFilterEditing) {
          res = await fetch(`/api/crm/filters/${this.crmFilterEditing}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
        } else {
          res = await fetch('/api/crm/filters', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
        }
        if (res.ok) {
          this.closeFilterForm();
          await this.loadCrmFilters();
        }
      } catch (e) { console.error('Failed to save CRM filter:', e); }
    },

    async deleteCrmFilter(id) {
      if (!confirm('Delete this filter?')) return;
      try {
        await fetch(`/api/crm/filters/${id}`, { method: 'DELETE' });
        await this.loadCrmFilters();
      } catch (e) { console.error('Failed to delete CRM filter:', e); }
    },

    async toggleCrmFilter(id) {
      const filter = this.crmFilters.find(f => f.id === id);
      if (!filter) return;
      try {
        await fetch(`/api/crm/filters/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ is_active: filter.is_active ? 0 : 1 }),
        });
        await this.loadCrmFilters();
      } catch (e) { console.error('Failed to toggle CRM filter:', e); }
    },

    async reorderCrmFilters(ids) {
      try {
        await fetch('/api/crm/filters/reorder', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids }),
        });
        await this.loadCrmFilters();
      } catch (e) { console.error('Failed to reorder CRM filters:', e); }
    },

    async testCrmFilter(filterId, crmJobId) {
      this.crmFilterTestResult = null;
      try {
        const res = await fetch(`/api/crm/filters/${filterId}/test`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ crmJobId }),
        });
        if (res.ok) {
          this.crmFilterTestResult = await res.json();
        }
      } catch (e) { console.error('Failed to test CRM filter:', e); }
    },

    addKeyword() {
      if (!this.crmFilterForm.config.keywords) this.crmFilterForm.config.keywords = [];
      this.crmFilterForm.config.keywords.push('');
    },

    removeKeyword(idx) {
      this.crmFilterForm.config.keywords.splice(idx, 1);
    },

    filterTypeLabel(type) {
      const labels = { keyword: 'Keyword', llm_filter: 'LLM Filter', llm_tier: 'LLM Tier' };
      return labels[type] || type;
    },
  };
}
