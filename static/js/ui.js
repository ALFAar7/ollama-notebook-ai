/**
 * Shared UI chrome — toasts, theme, RTL, source metadata, PDF preview/toolbar
 * and the sources drawer.
 *
 * Everything here is defensive: any element may be missing from a given
 * template, so every lookup is guarded and every cross-module call is
 * resolved at call time with a typeof check.
 *
 * No emoji, no innerHTML with untrusted content.
 */

/* Apply the persisted theme as early as possible (before first paint). */
(function applyThemeOnLoad() {
    try {
        const stored = localStorage.getItem('notebook-theme');
        if (stored === 'dark' || stored === 'light') {
            document.documentElement.setAttribute('data-theme', stored);
        }
    } catch (err) {
        // Storage unavailable — keep the template default.
    }
})();

/* ------------------------------------------------------------------ *
 * Small helpers
 * ------------------------------------------------------------------ */

/** The cached element map from main.js, or an empty object. */
function uiEls() {
    try {
        if (typeof App !== 'undefined' && App && App.els) {
            return App.els;
        }
    } catch (err) {
        // App is still initialising — fall through.
    }
    return {};
}

/** Look up an element by id, preferring the main.js cache. */
function uiEl(id) {
    const cached = uiEls()[id];
    if (cached) {
        return cached;
    }
    return document.getElementById(id);
}

/** Call a global function from another module if it exists. */
function uiCall(name, ...args) {
    if (typeof window[name] === 'function') {
        return window[name](...args);
    }
    return undefined;
}

/** The em dash used as a placeholder (never the literal "&mdash;"). */
const UI_EM_DASH = '\u2014';

/* ------------------------------------------------------------------ *
 * Theme
 * ------------------------------------------------------------------ */

const THEME_STORAGE_KEY = 'notebook-theme';
const THEME_LIGHT = 'light';
const THEME_DARK = 'dark';

/** Read the persisted theme, falling back to light. */
function getStoredTheme() {
    try {
        const stored = localStorage.getItem(THEME_STORAGE_KEY);
        if (stored === THEME_DARK || stored === THEME_LIGHT) {
            return stored;
        }
    } catch (err) {
        // Storage can be unavailable (private mode) — fall through.
    }
    return THEME_LIGHT;
}

/** Persist the theme choice. */
function storeTheme(theme) {
    try {
        localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch (err) {
        // Ignore storage failures — the theme still applies for this page.
    }
}

/** The theme currently applied to the document. */
function getCurrentTheme() {
    const root = document.documentElement;
    const theme = root && root.dataset ? root.dataset.theme : '';
    return theme === THEME_DARK ? THEME_DARK : THEME_LIGHT;
}

/** Reflect the theme on the toggle button (icon + aria-pressed). */
function updateThemeToggle() {
    const button = uiEl('themeToggle');
    if (!button) {
        return;
    }

    const isDark = getCurrentTheme() === THEME_DARK;
    button.setAttribute('aria-pressed', isDark ? 'true' : 'false');
    button.setAttribute('aria-label', isDark ? 'Switch to light theme' : 'Switch to dark theme');

    const use = button.querySelector('use');
    if (use) {
        const next = isDark ? '#i-sun' : '#i-moon';
        if (use.getAttribute('href') !== next) {
            use.setAttribute('href', next);
        }
        if (!use.getAttribute('href')) {
            use.setAttribute('href', next);
        }
    }
}

/** Apply a theme to the document without touching storage. */
function applyTheme(theme) {
    const root = document.documentElement;
    if (!root) {
        return;
    }
    root.setAttribute('data-theme', theme === THEME_DARK ? THEME_DARK : THEME_LIGHT);
}

/** Apply the stored theme. Safe to call before the DOM is ready. */
function applyStoredTheme() {
    applyTheme(getStoredTheme());
}

/** Flip between light and dark, persist it and refresh the toggle. */
function toggleTheme() {
    const next = getCurrentTheme() === THEME_DARK ? THEME_LIGHT : THEME_DARK;
    applyTheme(next);
    storeTheme(next);
    updateThemeToggle();
    return next;
}

/* ------------------------------------------------------------------ *
 * Toasts
 * ------------------------------------------------------------------ */

const TOAST_MAX = 5;
const TOAST_TIMEOUT = 4000;

/** Map a toast type to its sprite icon id. */
function toastIconId(type) {
    if (type === 'success') {
        return '#i-check';
    }
    if (type === 'error' || type === 'warning') {
        return '#i-warning';
    }
    return '#i-info';
}

/** The toast container, creating one if the template does not ship it. */
function getToastContainer() {
    let container = uiEl('toastContainer');
    if (container) {
        return container;
    }

    container = document.getElementById('toastContainer');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toastContainer';
        container.className = 'toast-container';
        container.setAttribute('aria-live', 'polite');
        container.setAttribute('aria-atomic', 'false');
        document.body.appendChild(container);
    }
    return container;
}

/** Remove a toast node from the stack. */
function dismissToast(toast) {
    if (!toast || !toast.parentNode) {
        return;
    }
    if (toast.dataset && toast.dataset.toastTimer) {
        clearTimeout(Number(toast.dataset.toastTimer));
    }
    toast.parentNode.removeChild(toast);
}

/** Delegated close-button handling for the whole toast stack. */
function handleToastContainerClick(event) {
    const closeButton = event.target.closest ? event.target.closest('.toast__close') : null;
    if (!closeButton) {
        return;
    }
    const toast = closeButton.closest('.toast');
    if (toast) {
        dismissToast(toast);
    }
}

/** Build a single toast node. */
function createToast(message, type) {
    const toast = document.createElement('div');
    toast.className = `toast toast--${type}`;
    toast.setAttribute('role', type === 'error' ? 'alert' : 'status');

    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('class', 'icon toast__icon');
    icon.setAttribute('aria-hidden', 'true');
    const iconUse = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    iconUse.setAttribute('href', toastIconId(type));
    icon.appendChild(iconUse);
    toast.appendChild(icon);

    const text = document.createElement('span');
    text.className = 'toast__message';
    text.textContent = message === undefined || message === null ? '' : String(message);
    toast.appendChild(text);

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'toast__close icon-btn';
    close.setAttribute('aria-label', 'Dismiss notification');
    const closeIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    closeIcon.setAttribute('class', 'icon');
    closeIcon.setAttribute('aria-hidden', 'true');
    const closeUse = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    closeUse.setAttribute('href', '#i-close');
    closeIcon.appendChild(closeUse);
    close.appendChild(closeIcon);
    toast.appendChild(close);

    return toast;
}

/**
 * Show a toast notification.
 * @param {string} message
 * @param {string} [type] - 'success' | 'error' | 'info' | 'warning'
 */
function showToast(message, type) {
    const container = getToastContainer();
    if (!container) {
        return;
    }

    if (container.dataset && container.dataset.toastBound !== 'true') {
        container.dataset.toastBound = 'true';
        container.addEventListener('click', handleToastContainerClick);
    }

    let resolved = type;
    if (resolved !== 'success' && resolved !== 'error' && resolved !== 'info' && resolved !== 'warning') {
        resolved = 'info';
    }

    const toast = createToast(message, resolved);
    container.appendChild(toast);

    // Cap the stack — drop the oldest toast.
    while (container.children.length > TOAST_MAX) {
        container.removeChild(container.firstElementChild);
    }

    // Errors stay until they are dismissed.
    if (resolved !== 'error') {
        const timer = setTimeout(() => {
            dismissToast(toast);
        }, TOAST_TIMEOUT);
        toast.dataset.toastTimer = String(timer);
    }

    return toast;
}

/** Backwards-compatible alias for call sites that still use showStatus(). */
function showStatus(message, type) {
    return showToast(message, type);
}

/* ------------------------------------------------------------------ *
 * RTL
 * ------------------------------------------------------------------ */

/** Is the currently selected target language written right-to-left? */
function isTargetLanguageRTL() {
    const select = uiEl('targetLanguage');
    const value = select && select.value ? select.value : '';
    return ['Persian', 'Arabic', 'Kurdish', 'Hebrew'].indexOf(value) !== -1;
}

/** Apply dir + the .rtl class to a single element. */
function applyDirectionTo(element, isRTL) {
    if (!element) {
        return;
    }
    element.setAttribute('dir', isRTL ? 'rtl' : 'ltr');
    element.classList.toggle('rtl', isRTL);
}

/**
 * Apply the reading direction of the target language to the content
 * regions. The chrome (rail, top bar, buttons) always stays LTR.
 */
function updateRTLState() {
    const isRTL = isTargetLanguageRTL();

    ['textInput', 'translationAreaText', 'translationArea', 'qaAnswer', 'qaSources', 'searchResults']
        .forEach((id) => {
            applyDirectionTo(uiEl(id), isRTL);
        });

    // Note cards are rendered dynamically, so query them in the document.
    // The card and its body both flip, and the is-rtl class stays in sync
    // with the dir attribute the stylesheet keys off.
    document.querySelectorAll('.note-card__body, .note-card').forEach((element) => {
        applyDirectionTo(element, isRTL);
        if (element.classList.contains('note-card')) {
            element.classList.toggle('is-rtl', isRTL);
        }
    });

    const summary = uiEl('notesSummary');
    if (summary) {
        summary.classList.toggle('rtl', isRTL);
    }

    updateRTLIndicator(isRTL);
}

/** Show or hide the "RTL" badge next to the target language select. */
function updateRTLIndicator(isRTL) {
    const indicator = uiEl('rtlIndicator');
    if (!indicator) {
        return;
    }

    indicator.textContent = 'RTL';
    indicator.hidden = !isRTL;
    indicator.classList.toggle('hidden', !isRTL);
    indicator.classList.toggle('badge--brand', isRTL);
    indicator.classList.toggle('badge--neutral', !isRTL);
    indicator.setAttribute('aria-hidden', isRTL ? 'false' : 'true');
}

/* ------------------------------------------------------------------ *
 * Source metadata
 * ------------------------------------------------------------------ */

/** The uppercase extension of the current file, or a dash. */
function getCurrentFileType() {
    const name = (typeof App !== 'undefined' && App && App.currentFileName) ? App.currentFileName : '';
    if (!name || name.indexOf('.') === -1) {
        return UI_EM_DASH;
    }
    const extension = name.split('.').pop().toUpperCase();
    return extension || UI_EM_DASH;
}

/** Set the badge classes of the source status chip. */
function setSourceStatusBadge(statusElement, isReady) {
    if (!statusElement) {
        return;
    }
    statusElement.classList.toggle('badge--success', isReady);
    statusElement.classList.toggle('badge--neutral', !isReady);
}

/**
 * The label for the page-count readout.
 *
 * The sources drawer renders the count inside a <dl> that already carries a
 * "Pages" <dt>, so the value must not repeat the word there. A standalone
 * pill keeps the "Pages: n" prefix.
 */
function formatPageCount(pageCount, pageElement) {
    const hasLabelSibling = Boolean(
        pageElement
        && pageElement.tagName === 'DD'
        && pageElement.parentElement
        && pageElement.parentElement.querySelector('dt')
    );
    if (hasLabelSibling) {
        return pageCount ? String(pageCount) : UI_EM_DASH;
    }
    return pageCount ? `Pages: ${pageCount}` : `Pages: ${UI_EM_DASH}`;
}

/** Refresh the source card: file name, type, page count, chunk count, status. */
function updateSourceMeta() {
    const els = uiEls();
    const app = (typeof App !== 'undefined' && App) ? App : null;
    const fileName = app && app.currentFileName ? app.currentFileName : '';
    const pageCount = app && app.pages ? app.pages.length : 0;

    const nameElement = els.sourceFileName || document.getElementById('sourceFileName');
    if (nameElement) {
        nameElement.textContent = fileName || 'No file';
    }

    const pageElement = els.sourcePageCount || document.getElementById('sourcePageCount');
    if (pageElement) {
        pageElement.textContent = formatPageCount(pageCount, pageElement);
    }

    const typeElement = els.sourceFileType || document.getElementById('sourceFileType');
    if (typeElement) {
        typeElement.textContent = getCurrentFileType();
    }

    const chunkElement = els.sourceChunks || document.getElementById('sourceChunks');
    if (chunkElement) {
        // The API does not expose a chunk count yet.
        chunkElement.textContent = UI_EM_DASH;
    }

    const statusElement = els.sourceStatus || document.getElementById('sourceStatus');
    if (statusElement) {
        statusElement.textContent = fileName ? 'Source ready' : 'No source loaded';
        setSourceStatusBadge(statusElement, Boolean(fileName));
    }

    // The sources drawer carries its own status badge; without an id it would
    // stay stuck on "No source loaded" even with a document open.
    const drawerStatus = els.sourceCardStatus || document.getElementById('sourceCardStatus');
    if (drawerStatus) {
        drawerStatus.textContent = fileName ? 'Source ready' : 'No source loaded';
        setSourceStatusBadge(drawerStatus, Boolean(fileName));
    }

    const titleElement = els.sourceTitleFile || document.getElementById('sourceTitleFile');
    if (titleElement) {
        titleElement.textContent = fileName || 'Document';
    }

    const contextLabel = els.contextLabel || document.getElementById('contextLabel');
    if (contextLabel) {
        contextLabel.textContent = fileName || 'New translation';
    }
}

/* ------------------------------------------------------------------ *
 * PDF toolbar
 * ------------------------------------------------------------------ */

const PDF_ZOOM_STEPS = [50, 75, 100, 125, 150, 200, 300, 400];

/** Build the URL of the embedded PDF viewer. */
function getPdfViewerUrl(filename, page, zoom, fitWidth) {
    const url = `/uploads/${encodeURIComponent(filename)}`;
    const params = [];
    if (page && page > 0) {
        params.push(`page=${page}`);
    }
    if (fitWidth) {
        params.push('view=FitWidth');
    } else if (zoom) {
        params.push(`zoom=${zoom}`);
    }
    return params.length ? `${url}#${params.join('&')}` : url;
}

/** The zoom toolbar shown above the embedded PDF viewer. */
function renderPdfToolbar() {
    return `
        <div class="pdf-toolbar" role="toolbar" aria-label="PDF zoom controls">
            <button class="btn btn--ghost btn--sm pdf-tool" type="button" data-pdf-action="zoom-out" title="Zoom out" aria-label="Zoom out">
                <svg class="icon btn__icon" aria-hidden="true"><use href="#i-zoom-out"></use></svg>
            </button>
            <span class="badge badge--neutral pdf-zoom-value" aria-live="polite">100%</span>
            <button class="btn btn--ghost btn--sm pdf-tool" type="button" data-pdf-action="zoom-in" title="Zoom in" aria-label="Zoom in">
                <svg class="icon btn__icon" aria-hidden="true"><use href="#i-zoom-in"></use></svg>
            </button>
            <button class="btn btn--ghost btn--sm pdf-tool pdf-tool-wide" type="button" data-pdf-action="fit" title="Fit the page width to this panel" aria-label="Fit the page width to this panel">
                <svg class="icon btn__icon" aria-hidden="true"><use href="#i-fit"></use></svg>
                <span class="btn__label">Fit</span>
            </button>
        </div>
    `;
}

/** Point the embedded viewer at the current page/zoom without reloading. */
function syncPdfViewerSource() {
    const app = (typeof App !== 'undefined' && App) ? App : null;
    if (!app) {
        return;
    }

    const frame = app.viewerFrame;
    if (!frame || app.viewerFileName !== app.currentFileName) {
        return;
    }

    const url = getPdfViewerUrl(app.currentFileName, app.currentPage, app.pdfZoom, app.pdfFitWidth);
    // Assigning a URL that differs only by fragment is a same-document
    // navigation, so the viewer moves pages without re-downloading the PDF.
    if (frame.getAttribute('src') !== url) {
        frame.setAttribute('src', url);
    }
    updatePdfZoomLabel();
}

/** Write the current zoom level into the zoom readouts. */
function updatePdfZoomLabel() {
    const app = (typeof App !== 'undefined' && App) ? App : null;
    const fitWidth = app ? Boolean(app.pdfFitWidth) : false;
    const zoom = app && app.pdfZoom ? app.pdfZoom : 100;
    const label = fitWidth ? 'Fit' : `${zoom}%`;

    const zoomValue = uiEl('zoomValue') || document.getElementById('zoomValue');
    if (zoomValue) {
        zoomValue.textContent = label;
    }

    const toolbarValue = document.querySelector('.pdf-zoom-value');
    if (toolbarValue) {
        toolbarValue.textContent = label;
    }
}

/** Step the zoom up (direction > 0) or down (direction < 0). */
function stepPdfZoom(direction) {
    const app = (typeof App !== 'undefined' && App) ? App : null;
    if (!app) {
        return;
    }

    if (app.pdfFitWidth) {
        app.pdfFitWidth = false;
    }

    const current = app.pdfZoom || 100;
    if (direction > 0) {
        const next = PDF_ZOOM_STEPS.find((step) => step > current);
        app.pdfZoom = next || PDF_ZOOM_STEPS[PDF_ZOOM_STEPS.length - 1];
    } else {
        const lower = [...PDF_ZOOM_STEPS].reverse().find((step) => step < current);
        app.pdfZoom = lower || PDF_ZOOM_STEPS[0];
    }

    syncPdfViewerSource();
}

/** Toggle the "fit to width" mode of the PDF viewer. */
function togglePdfFitWidth() {
    const app = (typeof App !== 'undefined' && App) ? App : null;
    if (!app) {
        return;
    }

    app.pdfFitWidth = !app.pdfFitWidth;
    if (!app.pdfFitWidth && !app.pdfZoom) {
        app.pdfZoom = 100;
    }
    syncPdfViewerSource();
}

/** Delegated handler for the buttons inside the PDF toolbar. */
function handlePdfToolbarClick(event) {
    const button = event.target.closest ? event.target.closest('[data-pdf-action]') : null;
    const preview = uiEl('attachmentPreview');
    if (!button || !preview || !preview.contains(button)) {
        return;
    }

    const action = button.getAttribute('data-pdf-action');
    if (action === 'zoom-in') {
        stepPdfZoom(1);
    } else if (action === 'zoom-out') {
        stepPdfZoom(-1);
    } else if (action === 'fit') {
        togglePdfFitWidth();
    }
}

/* ------------------------------------------------------------------ *
 * File preview
 * ------------------------------------------------------------------ */

/** The sprite icon for a file extension. */
function fileTypeIconId(fileType) {
    if (fileType === 'pdf') {
        return '#i-doc';
    }
    if (fileType === 'docx') {
        return '#i-file';
    }
    return '#i-text';
}

/** The empty-state block used when there is nothing to show. */
function buildEmptyState(iconId, title, text) {
    return `
        <div class="empty-state">
            <svg class="icon empty-state__icon" aria-hidden="true"><use href="${iconId}"></use></svg>
            <p class="empty-state__title">${escapeHtml(title)}</p>
            <p class="empty-state__text">${escapeHtml(text)}</p>
        </div>
    `;
}

/** Render the document preview (PDF viewer or extracted text). */
function renderFilePreview() {
    const app = (typeof App !== 'undefined' && App) ? App : null;
    const preview = uiEl('attachmentPreview');
    if (!app || !preview) {
        return;
    }

    const fileName = app.currentFileName || '';
    const fileType = fileName ? fileName.split('.').pop().toLowerCase() : '';
    const currentPageText = (app.pages[app.currentPage - 1] || '').trim();

    if (!fileName) {
        app.viewerFileName = '';
        app.viewerFrame = null;
        preview.innerHTML = buildEmptyState(
            '#i-upload',
            'Upload a source file',
            'Once a document is uploaded, its pages appear here.'
        );
        return;
    }

    if (fileType === 'pdf') {
        const existingFrame = preview.querySelector('.viewer-frame');
        if (existingFrame && app.viewerFileName === fileName) {
            // Same document: keep the viewer alive so zoom, scroll and the
            // embedded viewer state survive a page change.
            syncPdfViewerSource();
        } else {
            preview.innerHTML = `
                <div class="pdf-viewer">
                    ${renderPdfToolbar()}
                    <iframe class="viewer-frame" title="PDF Preview" src="${getPdfViewerUrl(fileName, app.currentPage, app.pdfZoom, app.pdfFitWidth)}"></iframe>
                </div>
            `;
            app.viewerFileName = fileName;
            app.viewerFrame = preview.querySelector('.viewer-frame');
            updatePdfZoomLabel();
        }
        return;
    }

    app.viewerFileName = '';
    app.viewerFrame = null;

    if (currentPageText) {
        preview.innerHTML = `
            <div class="preview-content">
                <div class="preview-caption">Page ${app.currentPage} of ${app.pages.length}</div>
                <div class="preview-text">${escapeHtml(currentPageText)}</div>
            </div>
        `;
        return;
    }

    preview.innerHTML = buildEmptyState(
        fileTypeIconId(fileType),
        fileName,
        'This page has no extractable text yet.'
    );
}

/* ------------------------------------------------------------------ *
 * Sources drawer
 * ------------------------------------------------------------------ */

/** Open or close the sources drawer. */
function setSourcesDrawerOpen(isOpen) {
    const drawer = uiEl('sourcesDrawer');
    const overlay = uiEl('sourcesOverlay');
    const toggle = uiEl('sourcesToggle');

    if (drawer) {
        drawer.classList.toggle('is-open', isOpen);
    }
    if (overlay) {
        overlay.classList.toggle('is-visible', isOpen);
        overlay.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
        // The stylesheet hides the overlay with the hidden attribute.
        overlay.hidden = !isOpen;
    }
    if (toggle) {
        toggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    }

    if (isOpen) {
        const closeButton = uiEl('sourcesClose');
        if (closeButton) {
            setTimeout(() => closeButton.focus(), 50);
        }
    } else if (toggle && document.activeElement && drawer && drawer.contains(document.activeElement)) {
        toggle.focus();
    }
}

/** Close the sources drawer and return focus to its toggle. */
function closeSourcesDrawer() {
    setSourcesDrawerOpen(false);
    const toggle = uiEl('sourcesToggle');
    if (toggle) {
        toggle.focus();
    }
}

/** Wire the sources drawer chrome: toggle, close button, Escape key. */
function initSourcesDrawer() {
    const drawer = uiEl('sourcesDrawer');
    const toggle = uiEl('sourcesToggle');
    const closeButton = uiEl('sourcesClose');
    const overlay = uiEl('sourcesOverlay');

    if (toggle) {
        toggle.setAttribute('aria-expanded', 'false');
        if (toggle.dataset && toggle.dataset.drawerBound !== 'true') {
            toggle.dataset.drawerBound = 'true';
            toggle.addEventListener('click', () => {
                const isOpen = drawer ? drawer.classList.contains('is-open') : false;
                setSourcesDrawerOpen(!isOpen);
                // Refresh the knowledge base list each time the drawer opens, so
                // the chunk count reflects the current index.
                if (!isOpen && typeof window.loadKnowledgeBase === 'function') {
                    window.loadKnowledgeBase();
                }
            });
        }
    }

    if (closeButton && closeButton.dataset && closeButton.dataset.drawerBound !== 'true') {
        closeButton.dataset.drawerBound = 'true';
        closeButton.addEventListener('click', () => {
            closeSourcesDrawer();
        });
    }

    if (overlay && overlay.dataset && overlay.dataset.drawerBound !== 'true') {
        overlay.dataset.drawerBound = 'true';
        // The overlay starts closed.
        if (!drawer || !drawer.classList.contains('is-open')) {
            overlay.hidden = true;
            overlay.classList.remove('is-visible');
        }
        overlay.addEventListener('click', () => {
            closeSourcesDrawer();
        });
    }

    if (document.documentElement.dataset && document.documentElement.dataset.sourcesDrawerBound === 'true') {
        return;
    }
    if (document.documentElement.dataset) {
        document.documentElement.dataset.sourcesDrawerBound = 'true';
    }

    document.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') {
            return;
        }
        if (drawer && drawer.classList.contains('is-open')) {
            closeSourcesDrawer();
        }
    });
}

/* ------------------------------------------------------------------ *
 * Entry point
 * ------------------------------------------------------------------ */

/** Wire the shared UI: theme, zoom controls, drawer, metadata, direction. */
function initUI() {
    applyStoredTheme();
    updateThemeToggle();

    const themeToggle = uiEl('themeToggle');
    if (themeToggle && themeToggle.dataset && themeToggle.dataset.uiBound !== 'true') {
        themeToggle.dataset.uiBound = 'true';
        themeToggle.addEventListener('click', () => {
            toggleTheme();
        });
    }

    const preview = uiEl('attachmentPreview');
    if (preview && preview.dataset && preview.dataset.uiBound !== 'true') {
        preview.dataset.uiBound = 'true';
        preview.addEventListener('click', handlePdfToolbarClick);
    }

    const zoomOut = uiEl('zoomOutBtn');
    if (zoomOut && zoomOut.dataset && zoomOut.dataset.uiBound !== 'true') {
        zoomOut.dataset.uiBound = 'true';
        zoomOut.addEventListener('click', () => stepPdfZoom(-1));
    }

    const zoomIn = uiEl('zoomInBtn');
    if (zoomIn && zoomIn.dataset && zoomIn.dataset.uiBound !== 'true') {
        zoomIn.dataset.uiBound = 'true';
        zoomIn.addEventListener('click', () => stepPdfZoom(1));
    }

    const fitWidth = uiEl('fitWidthBtn');
    if (fitWidth && fitWidth.dataset && fitWidth.dataset.uiBound !== 'true') {
        fitWidth.dataset.uiBound = 'true';
        fitWidth.addEventListener('click', () => togglePdfFitWidth());
    }

    initSourcesDrawer();

    updateSourceMeta();
    updateRTLState();
    updatePdfZoomLabel();

    // Keep the source card in sync with the loaded document.
    uiCall('updatePageButtons');
}

// Apply the persisted theme as early as possible.
applyStoredTheme();

/* ------------------------------------------------------------------ *
 * Public API
 * ------------------------------------------------------------------ */

window.showToast = showToast;
window.showStatus = showStatus;
window.toggleTheme = toggleTheme;
window.updateRTLState = updateRTLState;
window.updateSourceMeta = updateSourceMeta;
window.renderFilePreview = renderFilePreview;
window.updatePdfZoomLabel = updatePdfZoomLabel;
window.stepPdfZoom = stepPdfZoom;
window.togglePdfFitWidth = togglePdfFitWidth;
window.initUI = initUI;
window.isTargetLanguageRTL = isTargetLanguageRTL;
window.setSourcesDrawerOpen = setSourcesDrawerOpen;
window.closeSourcesDrawer = closeSourcesDrawer;
