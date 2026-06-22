/**
 * crm-settings.js — CRM settings mixin for Alpine.js app.
 */
function crmSettingsMixin() {
  return {
    crmSettings: { gemini_api_key: '', llm_model: '', auto_process: 'true' },
    crmSettingsLoading: false,
    crmConnectionTestResult: null,

    async loadCrmSettings() {
      try {
        const res = await fetch('/api/crm/settings');
        if (res.ok) {
          this.crmSettings = await res.json();
        }
      } catch (e) { console.error('Failed to load CRM settings:', e); }
    },

    async saveCrmSettings() {
      this.crmSettingsLoading = true;
      try {
        const res = await fetch('/api/crm/settings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(this.crmSettings),
        });
        if (res.ok) {
          this.crmConnectionTestResult = { ok: true, message: 'Settings saved' };
          setTimeout(() => { this.crmConnectionTestResult = null; }, 2000);
        }
      } catch (e) { console.error('Failed to save CRM settings:', e); }
      this.crmSettingsLoading = false;
    },

    async testLlmConnection() {
      this.crmConnectionTestResult = null;
      this.crmSettingsLoading = true;
      try {
        const res = await fetch('/api/crm/settings/test', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            apiKey: this.crmSettings.gemini_api_key,
            model: this.crmSettings.llm_model,
          }),
        });
        if (res.ok) {
          this.crmConnectionTestResult = await res.json();
        }
      } catch (e) {
        this.crmConnectionTestResult = { ok: false, error: String(e) };
      }
      this.crmSettingsLoading = false;
    },
  };
}
