/**
 * Search mode: knowledge search, question answering, scope control and
 * the vector-store popover.
 *
 * Owns: runKnowledgeSearch(), runQaSearch(), renderKnowledgeSearchResults(),
 * renderVectorStats(), loadSearchStats(), getSearchScopeFilename(),
 * updateSearchScopeState() and initSearch().
 *
 * The scope is a segmented control (This document / All documents) with
 * "This document" as the default whenever a document is open (plan defect B7).
 *
 * The implementations below carry a `search` prefix and are published on
 * `window` under the contract names. That keeps this module immune to
 * same-named declarations in other scripts, whatever the load order is.
 */

/* ------------------------------------------------------------------ *
 * State
 * ------------------------------------------------------------------ */

/** Current scope: 'this' (one document) or 'all' (the whole library). */
let searchScopeState = 'all';

/** True once the user has picked a scope explicitly. */
let searchScopeChosenByUser = false;

/** The file name the scope was last computed for. */
let searchScopeFileName = '';

/** In-flight guards, so a duplicated click handler cannot fire two requests. */
let searchRunInFlight = false;
let qaRunInFlight = false;

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

/** The global App object, or null when it is not ready yet. */
function searchApp() {
    try {
        return (typeof App !== 'undefined' && App) ? App : null;
    } catch (err) {
        return null;
    }
}

/** Call a global function from another module if it exists. */
function searchCall(name, ...args) {
    const fn = window[name];
    if (typeof fn === 'function') {
        return fn(...args);
    }
    return undefined;
}

/** Look up an element by id, preferring the main.js cache. */
function searchEl(id) {
    const app = searchApp();
    if (app && app.els && app.els[id]) {
        return app.els[id];
    }
    return document.getElementById(id);
}

/** Escape text for safe insertion into innerHTML. */
function searchEsc(value) {
    if (typeof window.escapeHtml === 'function') {
        return window.escapeHtml(value);
    }
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/** Toast helper: prefers the ui.js toast system, falls back to the console. */
function searchToast(message, type) {
    if (typeof window.showToast === 'function') {
        window.showToast(message, type || 'info');
        return;
    }
    console.log('[toast]', type || 'info', message);
}

/** True when the target language is written right-to-left. */
function searchIsRTL() {
    if (typeof window.isTargetLanguageRTL === 'function') {
        return Boolean(window.isTargetLanguageRTL());
    }
    const target = searchEl('targetLanguage');
    const lang = (target && target.value) || '';
    return lang === 'Persian' || lang === 'Arabic' || lang === 'Kurdish';
}

/** Empty-state markup used for the result list and the answer area. */
function searchEmptyState(title, text, iconId) {
    return `
        <div class="empty-state">
            <svg class="icon empty-state__icon" aria-hidden="true"><use href="#${iconId}"></use></svg>
            <p class="empty-state__title">${searchEsc(title)}</p>
            <p class="empty-state__text">${searchEsc(text)}</p>
        </div>
    `;
}

/** Set a button label without destroying its icon. */
function searchSetButtonLabel(button, label) {
    if (!button) {
        return;
    }
    const labelEl = button.querySelector('.btn__label');
    if (labelEl) {
        labelEl.textContent = label;
        return;
    }
    // No label span: only fall back to textContent when there is no icon to lose.
    if (!button.querySelector('svg, .btn__icon')) {
        button.textContent = label;
    }
}

/* ------------------------------------------------------------------ *
 * Scope
 * ------------------------------------------------------------------ */

/**
 * Sync the segmented scope control with the open document.
 * "This document" is the default as soon as a document is loaded.
 */
function searchUpdateScopeState() {
    const app = searchApp();
    const hasDocument = Boolean(app && app.currentFileName);
    const currentFileName = (app && app.currentFileName) || '';

    // A newly opened document resets the scope to the documented default.
    if (currentFileName !== searchScopeFileName) {
        searchScopeFileName = currentFileName;
        searchScopeChosenByUser = false;
    }

    if (!hasDocument) {
        searchScopeState = 'all';
        searchScopeChosenByUser = false;
    } else if (!searchScopeChosenByUser) {
        searchScopeState = 'this';
    }

    const thisBtn = searchEl('searchScopeThis');
    const allBtn = searchEl('searchScopeAll');

    if (thisBtn) {
        thisBtn.disabled = !hasDocument;
        thisBtn.classList.toggle('is-active', searchScopeState === 'this');
        thisBtn.setAttribute('aria-pressed', searchScopeState === 'this' ? 'true' : 'false');
    }

    if (allBtn) {
        allBtn.classList.toggle('is-active', searchScopeState === 'all');
        allBtn.setAttribute('aria-pressed', searchScopeState === 'all' ? 'true' : 'false');
    }
}

/** The filename the search should be restricted to, or '' for all documents. */
function searchGetScopeFilename() {
    if (searchScopeState === 'all') {
        return '';
    }
    const app = searchApp();
    return (app && app.currentFileName) || '';
}

/** Apply a scope selection coming from the segmented control. */
function searchSetScope(scope) {
    searchScopeState = (scope === 'this') ? 'this' : 'all';
    searchScopeChosenByUser = true;
    searchUpdateScopeState();
}

/* ------------------------------------------------------------------ *
 * Knowledge search
 * ------------------------------------------------------------------ */

/**
 * Run a semantic search over the knowledge base and render the results.
 */
async function searchRunKnowledgeSearch() {
    const input = searchEl('searchInput');
    const query = (input && input.value.trim()) || '';
    if (!query) {
        searchToast('Please enter a search query.', 'error');
        return;
    }
    if (searchRunInFlight) {
        return;
    }
    searchRunInFlight = true;

    const results = searchEl('searchResults');
    if (results) {
        results.innerHTML = searchEmptyState(
            'Searching the knowledge base',
            'This may take a moment while results are retrieved and translated.',
            'i-search'
        );
    }

    const searchBtn = searchEl('searchBtn');
    if (searchBtn) {
        searchBtn.disabled = true;
        searchSetButtonLabel(searchBtn, 'Searching...');
    }

    try {
        const targetEl = searchEl('targetLanguage');
        const sourceEl = searchEl('sourceLanguage');
        const targetLanguage = (targetEl && targetEl.value) || 'English';
        const sourceLanguage = (sourceEl && sourceEl.value) || 'auto';
        const scopeFilename = searchGetScopeFilename();

        let found = [];
        if (typeof window.knowledgeSearch === 'function') {
            found = await window.knowledgeSearch(query, targetLanguage, sourceLanguage, scopeFilename, 5);
        } else {
            const payload = {
                query,
                target_language: targetLanguage,
                source_language: sourceLanguage,
                limit: 5
            };
            if (scopeFilename) {
                payload.filename = scopeFilename;
            }
            const response = await fetch('/api/knowledge-search', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await response.json();
            if (!response.ok || !data.success) {
                throw new Error(data.error || 'Search failed');
            }
            found = data.results || [];
        }

        searchRenderResults(found);

        if (!found.length) {
            searchToast(scopeFilename
                ? `No matching content found in ${scopeFilename}.`
                : 'No matching content found in the knowledge base.', 'success');
        } else {
            searchToast(`${found.length} result(s) translated${scopeFilename ? ` from ${scopeFilename}` : ''}.`, 'success');
        }
    } catch (error) {
        console.error(error);
        if (results) {
            results.innerHTML = searchEmptyState(
                'Search failed',
                'Could not complete the knowledge search. Check the browser console.',
                'i-warning'
            );
        }
        searchToast((error && error.message) || 'Knowledge search failed.', 'error');
    } finally {
        searchRunInFlight = false;
        if (searchBtn) {
            searchBtn.disabled = false;
            searchSetButtonLabel(searchBtn, 'Search');
        }
    }
}

/**
 * Render the knowledge-search results as cards with a similarity meter.
 * @param {Array} results
 */
function searchRenderResults(results) {
    const container = searchEl('searchResults');
    if (!container) {
        return;
    }

    const isRTL = searchIsRTL();
    container.dir = isRTL ? 'rtl' : 'ltr';
    container.classList.toggle('rtl', isRTL);

    const list = Array.isArray(results) ? results : [];

    if (!list.length) {
        container.innerHTML = searchEmptyState(
            'No results found',
            'Try a different query or upload a document to build the knowledge base.',
            'i-search'
        );
        return;
    }

    container.innerHTML = list.map((result, index) => {
        const citationParts = [];
        if (result.filename) {
            citationParts.push(searchEsc(result.filename));
        }
        if (result.page_number) {
            citationParts.push(`Page ${result.page_number}`);
        }
        const citation = citationParts.join(' · ') || '—';

        const similarity = Math.round((Number(result.similarity) || 0) * 100);
        const meterClass = similarity >= 75 ? 'meter__fill--high' : (similarity >= 45 ? 'meter__fill--mid' : 'meter__fill--low');

        const body = result.translated_text || result.source_text || '';

        return `
            <article class="result-card" data-index="${index}">
                <div class="result-card__meta">
                    <span class="result-card__citation">${citation}</span>
                    <div class="similarity-meter">
                        <div class="meter" data-meter-fill="${index}">
                            <div class="meter__fill ${meterClass}"></div>
                        </div>
                        <span class="hint">${similarity}%</span>
                    </div>
                </div>
                <div class="result-card__body${isRTL ? ' rtl' : ''}" dir="${isRTL ? 'rtl' : 'ltr'}">${searchEsc(body)}</div>
                <div class="result-card__actions">
                    <button type="button" class="btn btn--ghost btn--sm" data-copy-index="${index}">
                        <svg class="btn__icon" aria-hidden="true"><use href="#i-copy"></use></svg>
                        <span class="btn__label">Copy</span>
                    </button>
                </div>
            </article>
        `;
    }).join('');

    // The meter width is dynamic data, so it is applied here and not in markup.
    container.querySelectorAll('.meter[data-meter-fill]').forEach((meter) => {
        const index = Number(meter.getAttribute('data-meter-fill'));
        const result = list[index];
        const similarity = Math.round((Number(result && result.similarity) || 0) * 100);
        const fill = meter.querySelector('.meter__fill');
        if (fill) {
            fill.style.width = `${similarity}%`;
            fill.style.setProperty('--meter', `${similarity}%`);
        }
    });
}

/* ------------------------------------------------------------------ *
 * Question answering
 * ------------------------------------------------------------------ */

/**
 * Ask a question about the loaded documents.
 */
async function searchRunQa() {
    const input = searchEl('qaInput');
    const query = (input && input.value.trim()) || '';
    if (!query) {
        searchToast('Please enter a question.', 'error');
        return;
    }
    if (qaRunInFlight) {
        return;
    }
    qaRunInFlight = true;

    const answer = searchEl('qaAnswer');
    const sources = searchEl('qaSources');

    if (answer) {
        answer.innerHTML = searchEmptyState(
            'Thinking',
            'Analyzing your documents and generating an answer.',
            'i-sparkle'
        );
    }
    if (sources) {
        sources.innerHTML = '';
    }

    const qaBtn = searchEl('qaBtn');
    if (qaBtn) {
        qaBtn.disabled = true;
        searchSetButtonLabel(qaBtn, 'Thinking...');
    }

    try {
        const targetEl = searchEl('targetLanguage');
        const sourceEl = searchEl('sourceLanguage');
        const targetLanguage = (targetEl && targetEl.value) || 'English';
        const sourceLanguage = (sourceEl && sourceEl.value) || 'auto';
        const scopeFilename = searchGetScopeFilename();

        let data = null;
        if (typeof window.qaSearch === 'function') {
            data = await window.qaSearch(query, targetLanguage, sourceLanguage, scopeFilename, 5);
        } else {
            const payload = {
                query,
                target_language: targetLanguage,
                source_language: sourceLanguage,
                limit: 5
            };
            if (scopeFilename) {
                payload.filename = scopeFilename;
            }
            const response = await fetch('/api/qa', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            data = await response.json();
            if (!response.ok || !data.success) {
                throw new Error(data.error || 'QA request failed');
            }
        }

        if (data && data.no_context) {
            if (answer) {
                answer.innerHTML = searchEmptyState(
                    'No relevant content found',
                    'No matching chunks were found in the knowledge base. Upload and process a document first.',
                    'i-search'
                );
            }
            searchToast('No relevant content found in knowledge base.', 'error');
            return;
        }

        if (answer) {
            const answerText = (data && data.answer) || 'No answer was generated.';
            answer.innerHTML = typeof window.formatText === 'function'
                ? window.formatText(answerText)
                : searchEsc(answerText);
        }

        searchRenderQaSources(data && data.sources);
        searchToast('Answer generated from your documents.', 'success');
    } catch (error) {
        console.error(error);
        if (answer) {
            answer.innerHTML = searchEmptyState(
                'Q&A failed',
                'Could not generate an answer. Check the browser console.',
                'i-warning'
            );
        }
        if (sources) {
            sources.innerHTML = '';
        }
        searchToast((error && error.message) || 'QA request failed.', 'error');
    } finally {
        qaRunInFlight = false;
        if (qaBtn) {
            qaBtn.disabled = false;
            searchSetButtonLabel(qaBtn, 'Ask');
        }
    }
}

/**
 * Render the citations of an answer.
 * @param {Array} sources
 */
function searchRenderQaSources(sources) {
    const container = searchEl('qaSources');
    if (!container) {
        return;
    }

    const list = Array.isArray(sources) ? sources : [];
    if (!list.length) {
        container.innerHTML = '';
        return;
    }

    container.innerHTML = list.map((src) => {
        const parts = [];
        if (src.filename) {
            parts.push(searchEsc(src.filename));
        }
        if (src.page_number) {
            parts.push(`Page ${src.page_number}`);
        }
        const citation = parts.join(' · ') || '—';
        const relevance = Math.round((Number(src.similarity) || 0) * 100);

        return `
            <div class="source-citation-item">
                <span class="source-citation">${citation}</span>
                <span class="source-citation__relevance">Relevance: ${relevance}%</span>
            </div>
        `;
    }).join('');
}

/* ------------------------------------------------------------------ *
 * Vector store stats
 * ------------------------------------------------------------------ */

/**
 * Render the knowledge-base statistics into the top-bar popover.
 * @param {Object|null} stats
 */
function searchRenderVectorStats(stats) {
    const container = searchEl('knowledgeStats') || searchEl('searchStats');
    if (!container) {
        return;
    }

    if (!stats) {
        container.innerHTML = `
            <p class="panel__title">Vector store is not ready</p>
        `;
        return;
    }

    const chunks = Number(stats.total_embeddings) || 0;
    const collection = stats.collection_name || '—';
    const dbPath = stats.db_path || '—';

    container.innerHTML = `
        <p class="panel__title">Knowledge base · ${chunks} chunk${chunks === 1 ? '' : 's'}</p>
        <p class="hint">Collection: ${searchEsc(collection)}</p>
        <p class="hint">Database: ${searchEsc(dbPath)}</p>
    `;
}

/**
 * Fetch the vector-store statistics and render them.
 */
async function searchLoadStats() {
    try {
        const response = await fetch('/api/vector-stats');
        const data = await response.json();
        if (!response.ok || !data.success) {
            searchRenderVectorStats(null);
            return;
        }
        searchRenderVectorStats(data.stats);
    } catch (error) {
        console.error(error);
        searchRenderVectorStats(null);
    }
}

/* ------------------------------------------------------------------ *
 * Wiring
 * ------------------------------------------------------------------ */

/** Toggle the knowledge-base popover. */
function searchTogglePopover(force) {
    const toggle = searchEl('knowledgeToggle');
    const popover = searchEl('knowledgePopover');
    if (!toggle || !popover) {
        return;
    }
    const isOpen = typeof force === 'boolean' ? force : !popover.classList.contains('is-open');
    popover.classList.toggle('is-open', isOpen);
    // The markup may hide the popover with the `hidden` attribute.
    if (isOpen) {
        popover.removeAttribute('hidden');
    } else {
        popover.setAttribute('hidden', '');
    }
    toggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
}

/** Wire the search mode: buttons, inputs, scope control and the popover. */
function searchInit() {
    const searchBtn = searchEl('searchBtn');
    if (searchBtn && searchBtn.dataset.searchBound !== 'true') {
        searchBtn.dataset.searchBound = 'true';
        searchBtn.addEventListener('click', () => {
            searchRunKnowledgeSearch();
        });
    }

    const searchInput = searchEl('searchInput');
    if (searchInput && searchInput.dataset.searchBound !== 'true') {
        searchInput.dataset.searchBound = 'true';
        searchInput.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                searchRunKnowledgeSearch();
            }
        });
    }

    const qaBtn = searchEl('qaBtn');
    if (qaBtn && qaBtn.dataset.searchBound !== 'true') {
        qaBtn.dataset.searchBound = 'true';
        qaBtn.addEventListener('click', () => {
            searchRunQa();
        });
    }

    const qaInput = searchEl('qaInput');
    if (qaInput && qaInput.dataset.searchBound !== 'true') {
        qaInput.dataset.searchBound = 'true';
        qaInput.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                searchRunQa();
            }
        });
    }

    const scopeThis = searchEl('searchScopeThis');
    if (scopeThis && scopeThis.dataset.searchBound !== 'true') {
        scopeThis.dataset.searchBound = 'true';
        scopeThis.addEventListener('click', () => {
            searchSetScope('this');
        });
    }

    const scopeAll = searchEl('searchScopeAll');
    if (scopeAll && scopeAll.dataset.searchBound !== 'true') {
        scopeAll.dataset.searchBound = 'true';
        scopeAll.addEventListener('click', () => {
            searchSetScope('all');
        });
    }

    const results = searchEl('searchResults');
    if (results && results.dataset.searchCopyBound !== 'true') {
        results.dataset.searchCopyBound = 'true';
        results.addEventListener('click', (event) => {
            const button = event.target.closest ? event.target.closest('[data-copy-index]') : null;
            if (!button || !results.contains(button)) {
                return;
            }
            const index = Number(button.getAttribute('data-copy-index'));
            const card = results.querySelector(`.result-card[data-index="${index}"]`);
            const body = card ? card.querySelector('.result-card__body') : null;
            const text = body ? (body.textContent || '').trim() : '';
            if (!text) {
                searchToast('Nothing to copy.', 'error');
                return;
            }
            if (typeof window.copyToClipboard === 'function') {
                window.copyToClipboard(text)
                    .then(() => searchToast('Result copied.', 'success'))
                    .catch(() => searchToast('Could not copy the result.', 'error'));
            }
        });
    }

    const knowledgeToggle = searchEl('knowledgeToggle');
    if (knowledgeToggle && knowledgeToggle.dataset.searchBound !== 'true') {
        knowledgeToggle.dataset.searchBound = 'true';
        knowledgeToggle.addEventListener('click', (event) => {
            event.stopPropagation();
            searchTogglePopover();
        });
    }

    if (!document.body.dataset.searchPopoverBound) {
        document.body.dataset.searchPopoverBound = 'true';
        document.addEventListener('click', (event) => {
            const popover = searchEl('knowledgePopover');
            const toggle = searchEl('knowledgeToggle');
            if (!popover || !popover.classList.contains('is-open')) {
                return;
            }
            if (popover.contains(event.target) || (toggle && toggle.contains(event.target))) {
                return;
            }
            searchTogglePopover(false);
        });

        document.addEventListener('keydown', (event) => {
            if (event.key !== 'Escape') {
                return;
            }
            const popover = searchEl('knowledgePopover');
            if (popover && popover.classList.contains('is-open')) {
                searchTogglePopover(false);
            }
        });
    }

    searchUpdateScopeState();
    searchLoadStats();
}

/* ------------------------------------------------------------------ *
 * Public API
 * ------------------------------------------------------------------ */

function installSearchGlobals() {
    window.loadSearchStats = searchLoadStats;
    window.runKnowledgeSearch = searchRunKnowledgeSearch;
    window.runQaSearch = searchRunQa;
    window.renderKnowledgeSearchResults = searchRenderResults;
    window.renderVectorStats = searchRenderVectorStats;
    window.renderQaSources = searchRenderQaSources;
    window.getSearchScopeFilename = searchGetScopeFilename;
    window.updateSearchScopeState = searchUpdateScopeState;
    window.initSearch = searchInit;
}

// Install immediately, so the global bindings are correct before any other
// script binds an event handler to them.
installSearchGlobals();

if (document.readyState === 'loading') {
    // The capture-phase listener runs before the ordinary DOMContentLoaded
    // listeners of other scripts, so the contract names always resolve to
    // this module's implementations.
    document.addEventListener('DOMContentLoaded', () => {
        installSearchGlobals();
        searchInit();
    }, true);
    window.addEventListener('load', installSearchGlobals);
} else {
    searchInit();
}
