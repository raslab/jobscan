/**
 * jobs.js — Job row expand/collapse and on-demand description fetching
 */
function jobsMixin() {
  return {
    async toggleJob(id) {
      const current = this.expandedJobs[id];
      if (!current) {
        this.expandedJobs[id] = 'full';
        this.expandedJobs = { ...this.expandedJobs };
        if (!this.jobDescriptions[id]) {
          await this.fetchJobDescription(id);
        }
      } else {
        delete this.expandedJobs[id];
        this.expandedJobs = { ...this.expandedJobs };
      }
    },

    async toggleNewJob(id) {
      const current = this.expandedNewJobs[id];
      if (!current) {
        this.expandedNewJobs[id] = 'full';
        this.expandedNewJobs = { ...this.expandedNewJobs };
        if (!this.jobDescriptions[id]) {
          await this.fetchJobDescription(id);
        }
      } else {
        delete this.expandedNewJobs[id];
        this.expandedNewJobs = { ...this.expandedNewJobs };
      }
    },

    async fetchJobDescription(id) {
      try {
        const res = await fetch('/api/jobs/' + id);
        const job = await res.json();
        this.jobDescriptions[id] = job.description || '';
        this.jobDescriptions = { ...this.jobDescriptions };
      } catch (err) {
        console.error('Failed to fetch job description', err);
        this.jobDescriptions[id] = '(Failed to load description)';
        this.jobDescriptions = { ...this.jobDescriptions };
      }
    },

    getJobDescription(id) {
      return this.jobDescriptions[id] || null;
    },

    async copyJD(id) {
      if (!this.jobDescriptions[id]) {
        await this.fetchJobDescription(id);
      }
      const text = this.jobDescriptions[id] || '';
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        const el = document.createElement('textarea');
        el.value = text;
        document.body.appendChild(el);
        el.select();
        document.execCommand('copy');
        document.body.removeChild(el);
      }
    },
  };
}
