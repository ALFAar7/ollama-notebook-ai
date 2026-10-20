/**
 * Ollama Notebook — application glue.
 *
 * Owns: the element cache, top-level event wiring, and the boot sequence.
 * Feature logic lives in the per-feature modules (navigation, ui, translation,
 * notes, history, upload, search).
 */

const App = {
    pdfText: '',
    pages: [],
    currentPage: 1,
    currentFileName: '',
    translatedText: '',
    currentMode: 'text',
    processingTimer: null,
    pdfZoom: 100,
    pdfFitWidth: false,
    viewerFileName: '',
    viewerFrame: null,
    els: {}
};

/**
 * Every id the UI may reference. Missing elements are tolerated: the cache
 * stores null and every consumer guards its lookup.
 */
const ELEMENT_IDS = [
    // Translation settings bar (lives in index.html, above the mode panels)
    'settingsBar', 'rtlIndicator', 'sourceLanguage', 'targetLanguage', 'swapLanguagesBtn',

    // Global chrome
    'rail', 'railToggle', 'topbar', 'themeToggle', 'modelBadge', 'ollamaStatus',
    'ollamaDot', 'ollamaLabel', 'sourcesToggle', 'sourcesDrawer', 'sourcesClose',
    'sourcesOverlay', 'knowledgeToggle', 'knowledgePopover', 'knowledgeStats',
    'toastContainer', 'contextLabel',

    // Modes
    'tabText', 'tabDocument', 'tabNotes', 'tabSearch', 'tabHistory',
    'panelText', 'panelDocument', 'panelNotes', 'panelSearch', 'panelHistory',

    // Text mode
    'textInput', 'charCount', 'wordCount', 'clearTextBtn', 'copySourceBtn',
    'translateTextBtn', 'translationAreaText', 'copyTranslationBtnText',
    'downloadTranslationBtnText', 'retryTranslationBtnText', 'textModeLoading',

    // Document mode
    'sourceTitleFile', 'sourceStatus', 'copyOriginalBtn', 'prevPageBtn',
    'pageNumber', 'nextPageBtn', 'zoomOutBtn', 'zoomValue', 'zoomInBtn',
    'fitWidthBtn', 'translatePageBtn', 'translateAllBtn', 'addToNotesBtn',
    'attachmentPreview', 'attachmentLoading', 'translateAllProgress',

    // Search mode
    'searchInput', 'searchBtn', 'searchScopeThis', 'searchScopeAll',
    'searchResults', 'qaInput', 'qaBtn', 'qaAnswer', 'qaSources',

    // Notes mode
    'notesList', 'notesSummary', 'summarizeBtn', 'notesEmptyState',

    // History mode
    'historyPanel', 'historySearchInput', 'historyListView', 'historyStatsView',
    'historyList', 'historyStats', 'historyViewList', 'historyViewStats',
    'clearHistoryBtn',

    // Sources
    'fileInput', 'uploadCard', 'sourceFileName', 'sourcePageCount',
    'sourceFileType', 'sourceChunks', 'sourceCardStatus', 'fileLibrary',
    'fileLibraryList', 'fileLibraryRefresh',

    // Knowledge base (vector store)
    'knowledgeBase', 'knowledgeBaseList', 'knowledgeBaseText',
    'knowledgeChunkCount', 'clearKnowledgeBaseBtn'
];

function cacheElements() {
    ELEMENT_IDS.forEach((id) => {
        App.els[id] = document.getElementById(id);
    });

    // Legacy ids kept only so the old paths degrade gracefully instead of throwing.
    App.els.attachmentPreview = App.els.attachmentPreview
        || document.getElementById('attachmentPreview');
}

/** Call a global function if it exists, without throwing if the module failed to load. */
function callIfAvailable(name, ...args) {
    if (typeof window[name] === 'function') {
        return window[name](...args);
    }
    return undefined;
}

function wireSourceText() {
    const input = App.els.textInput;
    if (!input) {
        return;
    }

    input.addEventListener('input', () => {
        const output = App.els.translationAreaText;
        if (output && !App.translatedText) {
            output.innerHTML = `
                <div class="empty-state">
                    <svg class="icon empty-state__icon" aria-hidden="true"><use href="#i-text"></use></svg>
                    <p class="empty-state__title">Ready to translate</p>
                    <p class="empty-state__text">Your translation will appear here.</p>
                </div>
            `;
        }
        callIfAvailable('updateCharCount');
        callIfAvailable('setOutputActionsEnabled', false);
    });
}

function wireTextActions() {
    if (App.els.clearTextBtn) {
        App.els.clearTextBtn.addEventListener('click', () => {
            if (App.els.textInput) {
                App.els.textInput.value = '';
            }
            App.translatedText = '';
            if (App.els.translationAreaText) {
                App.els.translationAreaText.innerHTML = `
                    <div class="empty-state">
                        <svg class="icon empty-state__icon" aria-hidden="true"><use href="#i-sparkle"></use></svg>
                        <p class="empty-state__title">Your translation will appear here</p>
                        <p class="empty-state__text">Paste text and click Translate to begin.</p>
                    </div>
                `;
            }
            callIfAvailable('updateCharCount');
            callIfAvailable('setOutputActionsEnabled', false);
            callIfAvailable('showToast', 'Workspace cleared.', 'success');
        });
    }

    if (App.els.copySourceBtn) {
        App.els.copySourceBtn.addEventListener('click', async () => {
            const text = App.els.textInput ? App.els.textInput.value : '';
            if (!text.trim()) {
                callIfAvailable('showToast', 'Nothing to copy yet.', 'error');
                return;
            }
            await callIfAvailable('copyToClipboard', text);
            callIfAvailable('showToast', 'Source copied.', 'success');
        });
    }

    if (App.els.translateTextBtn) {
        App.els.translateTextBtn.addEventListener('click', () => {
            callIfAvailable('translateTextMode');
        });
    }
}

function wireDocumentActions() {
    if (App.els.translatePageBtn) {
        App.els.translatePageBtn.addEventListener('click', () => {
            callIfAvailable('translateCurrentPage');
        });
    }
    if (App.els.translateAllBtn) {
        App.els.translateAllBtn.addEventListener('click', () => {
            callIfAvailable('translateAllPages');
        });
    }
    if (App.els.pageNumber) {
        App.els.pageNumber.addEventListener('change', () => {
            callIfAvailable('goToPage', Number(App.els.pageNumber.value));
        });
    }
    if (App.els.prevPageBtn) {
        App.els.prevPageBtn.addEventListener('click', () => {
            callIfAvailable('goToPage', App.currentPage - 1);
        });
    }
    if (App.els.nextPageBtn) {
        App.els.nextPageBtn.addEventListener('click', () => {
            callIfAvailable('goToPage', App.currentPage + 1);
        });
    }
    if (App.els.copyOriginalBtn) {
        App.els.copyOriginalBtn.addEventListener('click', async () => {
            const pageText = App.pages[App.currentPage - 1] || '';
            if (!pageText.trim()) {
                callIfAvailable('showToast', 'No extracted text to copy.', 'error');
                return;
            }
            await callIfAvailable('copyToClipboard', pageText);
            callIfAvailable('showToast', 'Current page text copied.', 'success');
        });
    }
    if (App.els.addToNotesBtn) {
        App.els.addToNotesBtn.addEventListener('click', () => {
            if (!App.translatedText) {
                callIfAvailable('showToast', 'Translate the page before adding it to notes.', 'info');
                return;
            }
            callIfAvailable('addTranslationToNotes');
        });
    }
}

function wireUpload() {
    if (App.els.fileInput) {
        App.els.fileInput.addEventListener('change', (event) => {
            const file = event.target.files && event.target.files[0];
            if (file) {
                callIfAvailable('uploadAndTranslateFile', file);
            }
        });
    }
}

function wireRail() {
    const rail = App.els.rail;
    if (!rail) {
        return;
    }

    rail.addEventListener('click', (event) => {
        const tab = event.target.closest('[role="tab"]');
        if (tab && tab.dataset.mode) {
            callIfAvailable('switchWorkspaceTab', tab.dataset.mode);
        }
    });

    if (App.els.railToggle) {
        App.els.railToggle.addEventListener('click', () => {
            const isOpen = rail.classList.toggle('is-open');
            App.els.railToggle.setAttribute('aria-expanded', String(isOpen));
        });
    }

    document.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') {
            return;
        }
        if (rail.classList.contains('is-open')) {
            rail.classList.remove('is-open');
            App.els.railToggle.setAttribute('aria-expanded', 'false');
            if (App.els.railToggle) {
                App.els.railToggle.focus();
            }
        }
    });
}

function wireLanguageSelects() {
    ['sourceLanguage', 'targetLanguage'].forEach((id) => {
        const select = App.els[id];
        if (!select) {
            return;
        }
        select.addEventListener('change', () => {
            callIfAvailable('updateRTLState');
        });
    });

    if (App.els.swapLanguagesBtn) {
        App.els.swapLanguagesBtn.addEventListener('click', () => {
            const from = App.els.sourceLanguage;
            const to = App.els.targetLanguage;
            if (!from || !to) {
                return;
            }
            const previous = from.value;
            from.value = to.value;
            to.value = previous === 'auto' ? 'English' : previous;
            callIfAvailable('updateRTLState');
        });
    }
}

function wireModelBadge() {
    const badge = App.els.modelBadge;
    if (!badge) {
        return;
    }
    fetch('/api/models')
        .then((response) => response.json())
        .then((data) => {
            if (data.success && data.models && data.models.length) {
                const model = data.models.find((name) => name.toLowerCase().includes('gemma4'))
                    || data.models[0];
                badge.textContent = model;
                badge.title = `Active Ollama model: ${model}`;
            } else {
                badge.textContent = 'No model';
            }
        })
        .catch(() => {
            badge.textContent = 'Offline';
        });
}

/**
 * Poll the Ollama status endpoint and reflect it in the top bar.
 * The status card in the sources drawer reads the same state.
 */
function checkOllamaStatus() {
    const dot = App.els.ollamaDot;
    const label = App.els.ollamaLabel;
    const status = App.els.ollamaStatus;
    if (!dot && !label) {
        return;
    }

    fetch('/api/ollama-status')
        .then((response) => response.json())
        .then((data) => {
            const online = data.ollama_online === true;
            if (dot) {
                dot.classList.toggle('online', online);
                dot.classList.toggle('offline', !online);
            }
            if (status) {
                status.classList.toggle('online', online);
                status.classList.toggle('offline', !online);
            }
            if (label) {
                label.textContent = online ? 'Ollama running' : 'Ollama unreachable';
            }
        })
        .catch(() => {
            if (dot) {
                dot.classList.remove('online');
                dot.classList.add('offline');
            }
            if (status) {
                status.classList.remove('online');
                status.classList.add('offline');
            }
            if (label) {
                label.textContent = 'Ollama unreachable';
            }
        });
}

function boot() {
    cacheElements();

    callIfAvailable('initUI');
    callIfAvailable('initUpload');
    callIfAvailable('initSearch');
    callIfAvailable('initNavigation');

    wireRail();
    wireLanguageSelects();
    wireSourceText();
    wireTextActions();
    wireDocumentActions();
    wireUpload();
    wireModelBadge();

    if (typeof initPreviewResize === 'function') {
        initPreviewResize();
    }

    callIfAvailable('updateCharCount');
    callIfAvailable('updateSourceMeta');
    callIfAvailable('updateRTLState');
    callIfAvailable('setOutputActionsEnabled', false);
    callIfAvailable('switchWorkspaceTab', 'text');

    checkOllamaStatus();
    window.setInterval(checkOllamaStatus, 30000);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
} else {
    boot();
}
