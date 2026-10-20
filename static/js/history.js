/**
 * History mode — list / stats segmented control, search, delete, stats.
 *
 * Endpoints (unchanged):
 *   GET    /api/history?limit=50&skip=0[&q=...]
 *   GET    /api/history/stats
 *   DELETE /api/history/<entry_id>
 *   POST   /api/history/clear
 */

const History = {
    entries: [],
    currentView: 'list', // 'list' or 'stats'
    searchQuery: '',
    searchTimer: null,
    wired: false,

    /* -------------------------------------------------------------- */
    /* Loading                                                         */
    /* -------------------------------------------------------------- */

    async loadHistory(limit = 50, skip = 0) {
        const container = document.getElementById('historyList');
        try {
            const url = this.searchQuery
                ? `/api/history?limit=${limit}&skip=${skip}&q=${encodeURIComponent(this.searchQuery)}`
                : `/api/history?limit=${limit}&skip=${skip}`;

            const response = await fetch(url);
            const data = await response.json();

            if (data && data.success) {
                this.entries = Array.isArray(data.entries) ? data.entries : [];
                this.renderHistory();
            } else {
                this.entries = [];
                this.renderHistory();
                this.renderError('Could not load history.', (data && data.error) || 'The server rejected the request.');
                historyToast('Failed to load history', 'error');
            }
        } catch (error) {
            console.error('Error loading history:', error);
            this.entries = [];
            this.renderHistory();
            this.renderError('Could not load history.', 'Check the browser console and try again.');
            historyToast('Failed to load history', 'error');
        }
    },

    async loadStats() {
        try {
            const response = await fetch('/api/history/stats');
            const data = await response.json();

            if (data && data.success && data.stats) {
                this.renderStats(data.stats);
            } else {
                this.renderStats(null);
                historyToast('Failed to load statistics', 'error');
            }
        } catch (error) {
            console.error('Error loading stats:', error);
            this.renderStats(null);
            historyToast('Failed to load statistics', 'error');
        }
    },

    /* -------------------------------------------------------------- */
    /* Mutations                                                       */
    /* -------------------------------------------------------------- */

    async deleteEntry(entryId) {
        if (!entryId) {
            return;
        }
        if (!window.confirm('Delete this translation from history?')) {
            return;
        }

        try {
            const response = await fetch(`/api/history/${encodeURIComponent(entryId)}`, {
                method: 'DELETE'
            });
            const data = await response.json();

            if (data && data.success) {
                historyToast(data.message || 'Entry deleted', 'success');
                await this.loadHistory();
            } else {
                historyToast('Failed to delete entry', 'error');
            }
        } catch (error) {
            console.error('Error deleting entry:', error);
            historyToast('Failed to delete entry', 'error');
        }
    },

    async clearHistory() {
        if (!window.confirm('Clear all translation history? This cannot be undone.')) {
            return;
        }

        try {
            const response = await fetch('/api/history/clear', {
                method: 'POST'
            });
            const data = await response.json();

            if (data && data.success) {
                historyToast(data.message || 'History cleared', 'success');
                this.entries = [];
                this.renderHistory();
            } else {
                historyToast('Failed to clear history', 'error');
            }
        } catch (error) {
            console.error('Error clearing history:', error);
            historyToast('Failed to clear history', 'error');
        }
    },

    searchHistory(query) {
        this.searchQuery = (query || '').trim();
        this.loadHistory();
    },

    /* -------------------------------------------------------------- */
    /* Helpers                                                         */
    /* -------------------------------------------------------------- */

    formatTimestamp(isoString) {
        if (!isoString) {
            return '';
        }
        if (typeof formatRelativeTime === 'function') {
            const formatted = formatRelativeTime(isoString);
            if (formatted) {
                return formatted;
            }
        }
        const date = new Date(isoString);
        if (isNaN(date.getTime())) {
            return '';
        }
        const diffMs = Date.now() - date.getTime();
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMs / 3600000);
        const diffDays = Math.floor(diffMs / 86400000);

        if (diffMins < 1) return 'Just now';
        if (diffMins < 60) return `${diffMins} min${diffMins > 1 ? 's' : ''} ago`;
        if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
        if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    },

    getModeIcon(mode) {
        const key = String(mode || '').toLowerCase();
        if (key === 'text') {
            return '#i-text';
        }
        if (key === 'page' || key === 'document') {
            return '#i-doc';
        }
        return '#i-file';
    },

    truncate(text, limit = 150) {
        const value = (text === null || text === undefined) ? '' : String(text);
        return value.length > limit ? `${value.slice(0, limit)}…` : value;
    },

    /* -------------------------------------------------------------- */
    /* Rendering                                                       */
    /* -------------------------------------------------------------- */

    renderError(title, message) {
        const container = document.getElementById('historyList');
        if (!container) {
            return;
        }
        container.innerHTML = `
            <div class="empty-state">
                <svg class="icon empty-state__icon" aria-hidden="true"><use href="#i-warning"></use></svg>
                <p class="empty-state__title">${historyEscape(title)}</p>
                <p class="empty-state__text">${historyEscape(message)}</p>
            </div>`;
    },

    renderHistory() {
        const container = document.getElementById('historyList');
        if (!container) {
            return;
        }

        if (!this.entries.length) {
            const message = this.searchQuery
                ? 'No translations match your search.'
                : 'Your translation history will appear here.';
            container.innerHTML = `
                <div class="empty-state">
                    <svg class="icon empty-state__icon" aria-hidden="true"><use href="#i-clock"></use></svg>
                    <p class="empty-state__title">${this.searchQuery ? 'No results' : 'No history yet'}</p>
                    <p class="empty-state__text">${historyEscape(message)}</p>
                </div>`;
            return;
        }

        container.innerHTML = this.entries.map((entry) => this.renderEntry(entry)).join('');
    },

    renderEntry(entry) {
        const id = historyEscape(entry.id);
        const mode = historyEscape(entry.mode || 'text');
        const icon = this.getModeIcon(entry.mode);
        const timestamp = this.formatTimestamp(entry.timestamp);
        const sourceLang = historyEscape(entry.source_language || 'auto');
        const targetLang = historyEscape(entry.target_language || '');

        const fileBadge = entry.filename
            ? `<span class="badge badge--neutral history-entry__file">${historyEscape(entry.filename)}${entry.page_number ? ` · p.${historyEscape(entry.page_number)}` : ''}</span>`
            : '';
        const pageBadge = (!entry.filename && entry.page_number)
            ? `<span class="badge badge--neutral history-entry__file">p.${historyEscape(entry.page_number)}</span>`
            : '';

        return `
            <article class="history-entry" data-entry-id="${id}" role="listitem">
                <div class="history-entry__head">
                    <span class="history-entry__mode">
                        <svg class="icon" aria-hidden="true"><use href="${icon}"></use></svg>
                        <span>${mode}</span>
                    </span>
                    <span class="history-entry__timestamp">${historyEscape(timestamp)}</span>
                </div>
                <div class="history-entry__langs">
                    <span class="lang-chip">${sourceLang}</span>
                    <svg class="icon" aria-hidden="true"><use href="#i-arrow-right"></use></svg>
                    <span class="lang-chip">${targetLang}</span>
                    ${fileBadge}
                    ${pageBadge}
                </div>
                <div class="history-entry__preview">
                    <div class="history-entry__preview-block">
                        <p class="history-entry__preview-label">Source</p>
                        <p class="history-entry__preview-text">${historyEscape(this.truncate(entry.source_text))}</p>
                    </div>
                    <div class="history-entry__preview-block">
                        <p class="history-entry__preview-label">Translation</p>
                        <p class="history-entry__preview-text">${historyEscape(this.truncate(entry.translated_text))}</p>
                    </div>
                </div>
                <div class="history-entry__actions">
                    <button type="button" class="btn btn--ghost btn--sm" data-entry-action="copy-source">
                        <svg class="icon btn__icon" aria-hidden="true"><use href="#i-copy"></use></svg>
                        <span class="btn__label">Copy source</span>
                    </button>
                    <button type="button" class="btn btn--ghost btn--sm" data-entry-action="copy-translation">
                        <svg class="icon btn__icon" aria-hidden="true"><use href="#i-copy"></use></svg>
                        <span class="btn__label">Copy translation</span>
                    </button>
                    <button type="button" class="btn btn--ghost btn--sm btn--danger" data-entry-action="delete" aria-label="Delete entry">
                        <svg class="icon btn__icon" aria-hidden="true"><use href="#i-trash"></use></svg>
                        <span class="btn__label">Delete</span>
                    </button>
                </div>
            </article>`;
    },

    renderStats(stats) {
        const container = document.getElementById('historyStats');
        if (!container) {
            return;
        }

        if (!stats) {
            container.innerHTML = `
                <div class="empty-state">
                    <svg class="icon empty-state__icon" aria-hidden="true"><use href="#i-warning"></use></svg>
                    <p class="empty-state__title">Statistics unavailable</p>
                    <p class="empty-state__text">The stats endpoint did not respond. Try again shortly.</p>
                </div>`;
            return;
        }

        const languagePairs = Object.entries(stats.languages || {})
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([pair, count]) => `
                <div class="stat-row">
                    <span>${historyEscape(pair)}</span>
                    <strong>${historyEscape(count)}</strong>
                </div>`).join('');

        const modes = Object.entries(stats.modes || {})
            .sort((a, b) => b[1] - a[1])
            .map(([mode, count]) => `
                <div class="stat-badge">
                    <span>
                        <svg class="icon" aria-hidden="true"><use href="${this.getModeIcon(mode)}"></use></svg>
                        ${historyEscape(mode)}
                    </span>
                    <strong>${historyEscape(count)}</strong>
                </div>`).join('');

        const characters = Number(stats.total_characters_translated || 0);

        container.innerHTML = `
            <div class="stats-grid stat-grid">
                <div class="stat-card">
                    <p class="eyebrow">Total translations</p>
                    <h2>${historyEscape(stats.total_translations || 0)}</h2>
                </div>
                <div class="stat-card">
                    <p class="eyebrow">Characters translated</p>
                    <h2>${historyEscape(characters.toLocaleString('en-US'))}</h2>
                </div>
            </div>

            <div class="stat-section">
                <h3>Translation modes</h3>
                <div class="stat-badges">
                    ${modes || '<span>No data</span>'}
                </div>
            </div>

            <div class="stat-section">
                <h3>Top language pairs</h3>
                <div class="stat-list">
                    ${languagePairs || '<span>No data</span>'}
                </div>
            </div>`;
    },

    /* -------------------------------------------------------------- */
    /* Actions                                                         */
    /* -------------------------------------------------------------- */

    async copyToClipboard(entryId, type) {
        const entry = this.entries.find((item) => String(item.id) === String(entryId));
        if (!entry) {
            return;
        }
        const text = type === 'source' ? entry.source_text : entry.translated_text;
        const label = type === 'source' ? 'Source' : 'Translation';

        try {
            if (typeof copyToClipboard === 'function') {
                await copyToClipboard(text || '');
            } else if (navigator.clipboard) {
                await navigator.clipboard.writeText(text || '');
            } else {
                throw new Error('Clipboard unavailable');
            }
            historyToast(`${label} copied to clipboard`, 'success');
        } catch (error) {
            console.error('Failed to copy:', error);
            historyToast('Failed to copy to clipboard', 'error');
        }
    },

    handleListClick(event) {
        const button = event.target.closest('[data-entry-action]');
        if (!button) {
            return;
        }
        const card = button.closest('[data-entry-id]');
        if (!card) {
            return;
        }
        const entryId = card.getAttribute('data-entry-id');
        const action = button.getAttribute('data-entry-action');

        if (action === 'copy-source') {
            this.copyToClipboard(entryId, 'source');
        } else if (action === 'copy-translation') {
            this.copyToClipboard(entryId, 'translation');
        } else if (action === 'delete') {
            this.deleteEntry(entryId);
        }
    },

    /* -------------------------------------------------------------- */
    /* View switching                                                  */
    /* -------------------------------------------------------------- */

    switchView(view) {
        this.currentView = view === 'stats' ? 'stats' : 'list';

        const listButton = document.getElementById('historyViewList');
        const statsButton = document.getElementById('historyViewStats');
        if (listButton) {
            const isActive = this.currentView === 'list';
            listButton.classList.toggle('is-active', isActive);
            listButton.setAttribute('aria-pressed', String(isActive));
        }
        if (statsButton) {
            const isActive = this.currentView === 'stats';
            statsButton.classList.toggle('is-active', isActive);
            statsButton.setAttribute('aria-pressed', String(isActive));
        }

        const listView = document.getElementById('historyListView');
        const statsView = document.getElementById('historyStatsView');

        // The markup ships the `hidden` attribute and the stylesheet also
        // defines a `.hidden` utility, so both are toggled to be safe.
        const setHidden = (node, hidden) => {
            if (!node) {
                return;
            }
            node.classList.toggle('hidden', hidden);
            if (hidden) {
                node.setAttribute('hidden', '');
            } else {
                node.removeAttribute('hidden');
            }
        };

        if (this.currentView === 'list') {
            setHidden(listView, false);
            setHidden(statsView, true);
            this.loadHistory();
        } else {
            setHidden(listView, true);
            setHidden(statsView, false);
            this.loadStats();
        }
    },

    /* -------------------------------------------------------------- */
    /* Wiring                                                          */
    /* -------------------------------------------------------------- */

    init() {
        const searchInput = document.getElementById('historySearchInput');
        if (searchInput && searchInput.dataset.historyWired !== '1') {
            searchInput.dataset.historyWired = '1';
            searchInput.addEventListener('input', (event) => {
                window.clearTimeout(this.searchTimer);
                this.searchTimer = window.setTimeout(() => {
                    this.searchHistory(event.target.value);
                }, 300);
            });
        }

        const listButton = document.getElementById('historyViewList');
        if (listButton && listButton.dataset.historyWired !== '1') {
            listButton.dataset.historyWired = '1';
            listButton.addEventListener('click', () => this.switchView('list'));
        }

        const statsButton = document.getElementById('historyViewStats');
        if (statsButton && statsButton.dataset.historyWired !== '1') {
            statsButton.dataset.historyWired = '1';
            statsButton.addEventListener('click', () => this.switchView('stats'));
        }

        const clearBtn = document.getElementById('clearHistoryBtn');
        if (clearBtn && clearBtn.dataset.historyWired !== '1') {
            clearBtn.dataset.historyWired = '1';
            clearBtn.addEventListener('click', () => this.clearHistory());
        }

        const list = document.getElementById('historyList');
        if (list && list.dataset.historyWired !== '1') {
            list.dataset.historyWired = '1';
            list.addEventListener('click', (event) => this.handleListClick(event));
        }

        this.loadHistory();
    }
};

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function historyEscape(value) {
    const text = (value === null || value === undefined) ? '' : String(value);
    if (typeof escapeHtml === 'function') {
        return escapeHtml(text);
    }
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function historyToast(message, type) {
    if (typeof showToast === 'function') {
        showToast(message, type);
        return;
    }
    if (typeof showStatus === 'function') {
        showStatus(message, type);
        return;
    }
    console.info(`[history] ${message}`);
}

/**
 * Entry point called by main.js when the History tab is activated.
 */
function initHistoryMode() {
    History.init();
}
