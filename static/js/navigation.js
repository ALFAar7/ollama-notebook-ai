/**
 * Workspace navigation — mode rail tabs only.
 *
 * Owns: switchWorkspaceTab(), roving tabindex + arrow-key navigation,
 * updateCharCount(), document page navigation (goToPage / updatePageButtons)
 * and the initNavigation() entry point called by main.js.
 *
 * The file loads before ui.js / api.js / search.js / notes.js / history.js,
 * so every cross-module call is resolved at call time and guarded.
 */

const NAV_MODES = ['text', 'document', 'notes', 'search', 'history'];

const NAV_TAB_IDS = {
    text: 'tabText',
    document: 'tabDocument',
    notes: 'tabNotes',
    search: 'tabSearch',
    history: 'tabHistory'
};

const NAV_PANEL_IDS = {
    text: 'panelText',
    document: 'panelDocument',
    notes: 'panelNotes',
    search: 'panelSearch',
    history: 'panelHistory'
};

/* ------------------------------------------------------------------ *
 * Small helpers
 * ------------------------------------------------------------------ */

/** The App global, or null when it is missing or still in its dead zone. */
function navApp() {
    try {
        if (typeof App !== 'undefined' && App) {
            return App;
        }
    } catch (err) {
        // App is still in its temporal dead zone — fall through.
    }
    return null;
}

/** The cached element map, or an empty object when App is not ready yet. */
function navEls() {
    const app = navApp();
    return (app && app.els) ? app.els : {};
}

/** Look up an element by id. The live DOM wins over the main.js cache. */
function navEl(id) {
    const el = document.getElementById(id);
    if (el) {
        return el;
    }
    return navEls()[id] || null;
}

/** Look up a rail tab button, falling back to the legacy data-tab selector. */
function navTabEl(mode) {
    const tab = navEl(NAV_TAB_IDS[mode]);
    if (tab) {
        return tab;
    }
    return document.querySelector(`[data-tab="${mode}"]`);
}

/** Look up a mode panel. */
function navPanelEl(mode) {
    return navEl(NAV_PANEL_IDS[mode]);
}

/** Call a global function from another module if it is available. */
function navCall(name, ...args) {
    if (typeof window[name] === 'function') {
        return window[name](...args);
    }
    return undefined;
}

/** The rail element (or the element carrying role="tablist"). */
function navTablist() {
    const rail = navEl('rail');
    if (rail) {
        return rail;
    }
    return document.querySelector('[role="tablist"]');
}

/** All tabs of the rail, in DOM order. */
function navTabs() {
    const list = navTablist();
    if (!list) {
        return [];
    }
    return Array.from(list.querySelectorAll('[role="tab"]'));
}

/** Resolve the mode a tab button represents. */
function navModeOf(tab) {
    if (!tab) {
        return null;
    }
    const explicit = tab.dataset ? (tab.dataset.mode || tab.getAttribute('data-mode')) : null;
    if (explicit && NAV_MODES.indexOf(explicit) !== -1) {
        return explicit;
    }
    const id = tab.id || '';
    const found = NAV_MODES.find((mode) => NAV_TAB_IDS[mode] === id);
    if (found) {
        return found;
    }
    const legacy = tab.dataset ? tab.dataset.tab : null;
    if (legacy && NAV_MODES.indexOf(legacy) !== -1) {
        return legacy;
    }
    return null;
}

/** Apply the roving tabindex: only the active tab is reachable with Tab. */
function navSyncTabindex(activeMode) {
    navTabs().forEach((tab) => {
        const isActive = navModeOf(tab) === activeMode;
        tab.setAttribute('tabindex', isActive ? '0' : '-1');
    });
}

/* ------------------------------------------------------------------ *
 * Mode switching
 * ------------------------------------------------------------------ */

/** The mode that was active the last time switchWorkspaceTab() ran. */
let navLastMode = null;

/**
 * True while the current task is still running. Two activations of the same
 * mode inside one task (the delegated handler plus main.js's own rail
 * handler) are treated as one, so a mode never loads twice.
 */
let navSameTurn = false;

/**
 * Switch the workspace to a mode.
 * @param {string} mode - 'text' | 'document' | 'notes' | 'search' | 'history'
 */
function switchWorkspaceTab(mode) {
    if (NAV_MODES.indexOf(mode) === -1) {
        return;
    }

    const app = navApp();
    if (app) {
        app.currentMode = mode;
    }

    // Rail buttons: is-active is the new class name, 'active' is kept for
    // any stylesheet that still expects the legacy name.
    NAV_MODES.forEach((candidate) => {
        const tab = navTabEl(candidate);
        if (!tab) {
            return;
        }
        const isActive = candidate === mode;
        tab.classList.toggle('is-active', isActive);
        tab.classList.toggle('active', isActive);
        tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });

    // Panels: visibility is driven by CSS (.tab-panel.is-active), the
    // hidden attribute is not used so transitions keep working.
    NAV_MODES.forEach((candidate) => {
        const panel = navPanelEl(candidate);
        if (!panel) {
            return;
        }
        const isActive = candidate === mode;
        panel.classList.toggle('is-active', isActive);
        panel.classList.toggle('active', isActive);
        panel.setAttribute('aria-hidden', isActive ? 'false' : 'true');
    });

    navSyncTabindex(mode);

    // A duplicate activation inside the same task (the delegated handler
    // below plus main.js's own rail handler) must not load the mode twice.
    // A deliberate later click on the same tab re-runs the initialiser.
    const duplicate = navLastMode === mode && navSameTurn;
    navLastMode = mode;
    navSameTurn = true;
    setTimeout(() => {
        navSameTurn = false;
    }, 0);

    if (mode === 'text') {
        updateCharCount();
    }

    if (mode === 'document') {
        updatePageButtons();
        navCall('renderFilePreview');
    }

    if (duplicate) {
        navCall('updateRTLState');
        return;
    }

    if (mode === 'search') {
        navCall('loadSearchStats');
    }

    if (mode === 'notes') {
        navCall('initNotesMode');
    }

    if (mode === 'history') {
        navCall('initHistoryMode');
    }

    navCall('updateRTLState');
}

/* ------------------------------------------------------------------ *
 * Keyboard support (plan defect B8)
 * ------------------------------------------------------------------ */

/**
 * Roving tabindex + arrow-key navigation for the mode rail.
 * Safe to call more than once.
 */
function initTabKeyboard() {
    const list = navTablist();
    if (!list || list.dataset.navKeyboardBound === 'true') {
        return;
    }
    list.dataset.navKeyboardBound = 'true';

    list.addEventListener('keydown', (event) => {
        const tab = event.target.closest ? event.target.closest('[role="tab"]') : null;
        if (!tab || !list.contains(tab)) {
            return;
        }

        const tabs = navTabs();
        if (!tabs.length) {
            return;
        }
        const index = tabs.indexOf(tab);
        let targetIndex = -1;

        switch (event.key) {
            case 'ArrowRight':
            case 'ArrowDown':
                targetIndex = (index + 1) % tabs.length;
                break;
            case 'ArrowLeft':
            case 'ArrowUp':
                targetIndex = (index - 1 + tabs.length) % tabs.length;
                break;
            case 'Home':
                targetIndex = 0;
                break;
            case 'End':
                targetIndex = tabs.length - 1;
                break;
            default:
                return;
        }

        event.preventDefault();
        const target = tabs[targetIndex];
        if (!target) {
            return;
        }
        target.focus();
        const mode = navModeOf(target);
        if (mode) {
            switchWorkspaceTab(mode);
        }
    });

    // Click delegation so the rail works even if main.js does not wire it.
    list.addEventListener('click', (event) => {
        const tab = event.target.closest ? event.target.closest('[role="tab"]') : null;
        if (!tab || !list.contains(tab)) {
            return;
        }
        const mode = navModeOf(tab);
        if (mode) {
            switchWorkspaceTab(mode);
        }
    });
}

/* ------------------------------------------------------------------ *
 * Text mode counters (plan defect B1)
 * ------------------------------------------------------------------ */

/** Update the live character and word counters of the text mode. */
function updateCharCount() {
    const input = navEl('textInput');
    if (!input) {
        return;
    }

    const value = input.value || '';
    const chars = value.length;
    const trimmed = value.trim();
    const words = trimmed ? trimmed.split(/\s+/).length : 0;

    const charEl = navEl('charCount');
    if (charEl) {
        charEl.textContent = `${chars} character${chars === 1 ? '' : 's'}`;
    }

    const wordEl = navEl('wordCount');
    if (wordEl) {
        wordEl.textContent = `${words} word${words === 1 ? '' : 's'}`;
    }
}

/* ------------------------------------------------------------------ *
 * Document mode page navigation
 * ------------------------------------------------------------------ */

/** Move to a page, clamped to the loaded document. */
function goToPage(pageNumber) {
    const app = navApp();
    const pages = (app && app.pages) ? app.pages : [];
    if (!pages.length) {
        return;
    }

    const targetPage = Math.min(Math.max(1, Number(pageNumber) || 1), pages.length);
    if (app) {
        app.currentPage = targetPage;
    }

    const pageInput = navEl('pageNumber');
    if (pageInput) {
        pageInput.value = targetPage;
    }

    updatePageButtons();
    navCall('renderFilePreview');

    if (app && app.currentFileName) {
        navCall('loadCurrentPageText');
    }

    resetDocumentOutput();
}

/** Clear the document translation area for the newly selected page. */
function resetDocumentOutput() {
    const app = navApp();
    if (app) {
        app.translatedText = '';
    }

    const output = navEl('translationArea');
    if (!output) {
        return;
    }

    const currentPage = (app && app.currentPage) ? app.currentPage : 1;
    output.innerHTML = `
        <div class="empty-state centered">
            <strong>Page ${currentPage}</strong>
            <span>Translate this page when ready.</span>
        </div>
    `;
}

/** Enable/disable the page and zoom controls of the document mode. */
function updatePageButtons() {
    const app = navApp();
    const pages = (app && app.pages) ? app.pages : [];
    const currentPage = (app && app.currentPage) ? app.currentPage : 1;
    const hasDocument = pages.length > 0;

    const prevBtn = navEl('prevPageBtn');
    if (prevBtn) {
        prevBtn.disabled = !hasDocument || currentPage <= 1;
    }

    const nextBtn = navEl('nextPageBtn');
    if (nextBtn) {
        nextBtn.disabled = !hasDocument || currentPage >= pages.length;
    }

    const zoomOutBtn = navEl('zoomOutBtn');
    if (zoomOutBtn) {
        zoomOutBtn.disabled = !hasDocument;
    }

    const zoomInBtn = navEl('zoomInBtn');
    if (zoomInBtn) {
        zoomInBtn.disabled = !hasDocument;
    }

    const fitWidthBtn = navEl('fitWidthBtn');
    if (fitWidthBtn) {
        fitWidthBtn.disabled = !hasDocument;
    }
}

/* ------------------------------------------------------------------ *
 * Entry point
 * ------------------------------------------------------------------ */

/** Wire the rail: clicks, keyboard and the initial mode. */
function initNavigation() {
    if (initNavigation.done === true) {
        return;
    }
    initNavigation.done = true;

    initTabKeyboard();

    const tabs = navTabs();
    if (tabs.length) {
        navSyncTabindex(navModeOf(tabs[0]));
    }

    const app = navApp();
    const initialMode = (app && app.currentMode) ? app.currentMode : 'text';
    switchWorkspaceTab(NAV_MODES.indexOf(initialMode) !== -1 ? initialMode : 'text');
}

// Boot safely when the DOM is ready, even if main.js never calls us.
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initNavigation);
} else {
    initNavigation();
}

// Expose the public API on window for the other modules.
window.switchWorkspaceTab = switchWorkspaceTab;
window.updateCharCount = updateCharCount;
window.goToPage = goToPage;
window.updatePageButtons = updatePageButtons;
window.initNavigation = initNavigation;
window.initTabKeyboard = initTabKeyboard;
