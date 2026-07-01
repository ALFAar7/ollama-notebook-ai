// History management functionality

const History = {
    entries: [],
    currentView: 'list', // 'list' or 'stats'
    searchQuery: '',
    
    async loadHistory(limit = 50, skip = 0) {
        try {
            const url = this.searchQuery 
                ? `/api/history?limit=${limit}&skip=${skip}&q=${encodeURIComponent(this.searchQuery)}`
                : `/api/history?limit=${limit}&skip=${skip}`;
            
            const response = await fetch(url);
            const data = await response.json();
            
            if (data.success) {
                this.entries = data.entries;
                this.renderHistory();
            } else {
                showStatus('Failed to load history', 'error');
            }
        } catch (error) {
            console.error('Error loading history:', error);
            showStatus('Failed to load history', 'error');
        }
    },
    
    async loadStats() {
        try {
            const response = await fetch('/api/history/stats');
            const data = await response.json();
            
            if (data.success) {
                this.renderStats(data.stats);
            } else {
                showStatus('Failed to load statistics', 'error');
            }
        } catch (error) {
            console.error('Error loading stats:', error);
            showStatus('Failed to load statistics', 'error');
        }
    },
    
    async deleteEntry(entryId) {
        if (!confirm('Delete this translation from history?')) {
            return;
        }
        
        try {
            const response = await fetch(`/api/history/${entryId}`, {
                method: 'DELETE'
            });
            const data = await response.json();
            
            if (data.success) {
                showStatus('Entry deleted', 'success');
                this.loadHistory();
            } else {
                showStatus('Failed to delete entry', 'error');
            }
        } catch (error) {
            console.error('Error deleting entry:', error);
            showStatus('Failed to delete entry', 'error');
        }
    },
    
    async clearHistory() {
        if (!confirm('Clear all translation history? This cannot be undone.')) {
            return;
        }
        
        try {
            const response = await fetch('/api/history/clear', {
                method: 'POST'
            });
            const data = await response.json();
            
            if (data.success) {
                showStatus('History cleared', 'success');
                this.entries = [];
                this.renderHistory();
            } else {
                showStatus('Failed to clear history', 'error');
            }
        } catch (error) {
            console.error('Error clearing history:', error);
            showStatus('Failed to clear history', 'error');
        }
    },
    
    searchHistory(query) {
        this.searchQuery = query.trim();
        this.loadHistory();
    },
    
    formatTimestamp(isoString) {
        const date = new Date(isoString);
        const now = new Date();
        const diffMs = now - date;
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
        const icons = {
            'text': '📝',
            'page': '📄',
            'document': '📚'
        };
        return icons[mode] || '📄';
    },
    
    renderHistory() {
        const container = document.getElementById('historyList');
        if (!container) return;
        
        if (this.entries.length === 0) {
            container.innerHTML = `
                <div class="empty-state centered">
                    <strong>No history yet</strong>
                    <span>Your translation history will appear here</span>
                </div>
            `;
            return;
        }
        
        container.innerHTML = this.entries.map(entry => `
            <div class="history-entry" data-entry-id="${entry.id}">
                <div class="history-entry-header">
                    <span class="history-mode">${this.getModeIcon(entry.mode)} ${entry.mode}</span>
                    <span class="history-timestamp">${this.formatTimestamp(entry.timestamp)}</span>
                    <button class="history-delete-btn icon-btn" onclick="History.deleteEntry('${entry.id}')" aria-label="Delete entry">×</button>
                </div>
                <div class="history-languages">
                    <span class="lang-badge">${entry.source_language}</span>
                    <span class="arrow">→</span>
                    <span class="lang-badge">${entry.target_language}</span>
                    ${entry.filename ? `<span class="history-filename">📎 ${escapeHtml(entry.filename)}</span>` : ''}
                    ${entry.page_number ? `<span class="history-page">Page ${entry.page_number}</span>` : ''}
                </div>
                <div class="history-content">
                    <div class="history-text">
                        <strong>Source</strong>
                        <p>${escapeHtml(entry.source_text.substring(0, 150))}${entry.source_length > 150 ? '...' : ''}</p>
                    </div>
                    <div class="history-text">
                        <strong>Translation</strong>
                        <p>${escapeHtml(entry.translated_text.substring(0, 150))}${entry.translated_length > 150 ? '...' : ''}</p>
                    </div>
                </div>
                <div class="history-actions">
                    <button class="ghost-btn small" onclick="History.copyToClipboard('${entry.id}', 'source')">Copy source</button>
                    <button class="ghost-btn small" onclick="History.copyToClipboard('${entry.id}', 'translation')">Copy translation</button>
                </div>
            </div>
        `).join('');
    },
    
    renderStats(stats) {
        const container = document.getElementById('historyStats');
        if (!container) return;
        
        const languagePairs = Object.entries(stats.languages || {})
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([pair, count]) => `
                <div class="stat-row">
                    <span>${escapeHtml(pair)}</span>
                    <strong>${count}</strong>
                </div>
            `).join('');
        
        const modes = Object.entries(stats.modes || {})
            .map(([mode, count]) => `
                <div class="stat-badge">
                    <span>${this.getModeIcon(mode)} ${mode}</span>
                    <strong>${count}</strong>
                </div>
            `).join('');
        
        container.innerHTML = `
            <div class="stats-grid">
                <div class="stat-card">
                    <p class="eyebrow">Total translations</p>
                    <h2>${stats.total_translations || 0}</h2>
                </div>
                <div class="stat-card">
                    <p class="eyebrow">Characters translated</p>
                    <h2>${(stats.total_characters_translated || 0).toLocaleString()}</h2>
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
            </div>
        `;
    },
    
    async copyToClipboard(entryId, type) {
        const entry = this.entries.find(e => e.id === entryId);
        if (!entry) return;
        
        const text = type === 'source' ? entry.source_text : entry.translated_text;
        
        try {
            await navigator.clipboard.writeText(text);
            showStatus(`${type === 'source' ? 'Source' : 'Translation'} copied to clipboard`, 'success');
        } catch (error) {
            console.error('Failed to copy:', error);
            showStatus('Failed to copy to clipboard', 'error');
        }
    },
    
    switchView(view) {
        this.currentView = view;
        
        // Update UI
        document.querySelectorAll('[data-history-view]').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.historyView === view);
        });
        
        const listContainer = document.getElementById('historyListView');
        const statsContainer = document.getElementById('historyStatsView');
        
        if (view === 'list') {
            if (listContainer) listContainer.classList.remove('hidden');
            if (statsContainer) statsContainer.classList.add('hidden');
            this.loadHistory();
        } else {
            if (listContainer) listContainer.classList.add('hidden');
            if (statsContainer) statsContainer.classList.remove('hidden');
            this.loadStats();
        }
    },
    
    init() {
        // Set up event listeners
        const searchInput = document.getElementById('historySearchInput');
        if (searchInput) {
            let searchTimeout;
            searchInput.addEventListener('input', (e) => {
                clearTimeout(searchTimeout);
                searchTimeout = setTimeout(() => {
                    this.searchHistory(e.target.value);
                }, 300);
            });
        }
        
        const viewToggle = document.getElementById('historyViewToggle');
        if (viewToggle) {
            viewToggle.addEventListener('click', () => {
                const newView = this.currentView === 'list' ? 'stats' : 'list';
                this.switchView(newView);
                
                // Update button text
                const icon = document.getElementById('historyViewIcon');
                const label = document.getElementById('historyViewLabel');
                if (icon && label) {
                    if (newView === 'stats') {
                        icon.textContent = '📋';
                        label.textContent = 'List';
                    } else {
                        icon.textContent = '📊';
                        label.textContent = 'Stats';
                    }
                }
            });
        }
        
        const clearBtn = document.getElementById('clearHistoryBtn');
        if (clearBtn) {
            clearBtn.addEventListener('click', () => this.clearHistory());
        }
        
        // Load initial history
        this.loadHistory();
    }
};

// Initialize when history mode is activated
function initHistoryMode() {
    History.init();
}
