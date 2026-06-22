/**
 * helpers.js — Pure utility / formatting functions
 */
function helpersMixin() {
  return {
    truncate(text, n = 200) {
      if (!text) return '';
      return text.length > n ? text.slice(0, n) + '…' : text;
    },

    shortenJD(text, n = 500) {
      if (!text) return '(No description available)';
      return text.length > n ? text.slice(0, n) + '…' : text;
    },

    renderMD(text) {
      if (!text) return '<em>(No description available)</em>';
      if (typeof marked !== 'undefined' && marked.parse) {
        return marked.parse(text);
      }
      const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      return '<pre>' + escaped + '</pre>';
    },

    truncateUrl(url, n = 60) {
      if (!url) return '';
      return url.length > n ? url.slice(0, n) + '…' : url;
    },

    formatDate(isoString) {
      if (!isoString) return '—';
      try {
        return new Date(isoString).toLocaleDateString(undefined, {
          year: 'numeric', month: 'short', day: 'numeric',
        });
      } catch {
        return isoString;
      }
    },

    formatDateTime(isoString) {
      if (!isoString) return '—';
      try {
        return new Date(isoString).toLocaleString(undefined, {
          year: 'numeric', month: 'short', day: 'numeric',
          hour: '2-digit', minute: '2-digit',
        });
      } catch {
        return isoString;
      }
    },

    formatDuration(secs) {
      if (secs == null) return '--:--';
      const m = Math.floor(secs / 60);
      const s = secs % 60;
      return m + ':' + String(s).padStart(2, '0');
    },

    showingFrom(page, pageSize, total) {
      if (total === 0) return 0;
      return ((page - 1) * pageSize) + 1;
    },

    showingTo(page, pageSize, total) {
      return Math.min(page * pageSize, total);
    },
  };
}
