/**
 * Ollama Notebook — translation actions.
 *
 * Owns: translate text / page / all, button label handling, copy / download / retry
 * on the output panels, and the Ctrl/Cmd shortcuts for the Text and Document panels.
 *
 * Every API call keeps its existing path, method and request body.
 */

const TRANSLATION_OUTPUT_ACTION_IDS = [
    'copyTranslationBtnText',
    'downloadTranslationBtnText',
    'retryTranslationBtnText',
    'copyTranslationBtnAttachment',
    'downloadTranslationBtnAttachment',
    'retryTranslationBtnAttachment'
];

/* --------------------------------------------------------------- utilities */

/** Show a toast through whichever feedback API is available. */
function showTranslationToast(message, type) {
    if (typeof showToast === 'function') {
        showToast(message, type || 'info');
        return;
    }
    if (typeof showStatus === 'function') {
        showStatus(message, type || 'info');
        return;
    }
    console.log(`[${type || 'info'}] ${message}`);
}

/** Call a cross-module function only when it exists. */
function callTranslationHelper(name, ...args) {
    if (typeof window[name] === 'function') {
        return window[name](...args);
    }
    return undefined;
}

/**
 * All elements carrying one of the output action ids (ids may repeat per panel).
 * When a mode is given, only the buttons belonging to that panel are returned.
 */
function getOutputActionButtons(mode) {
    const buttons = [];
    TRANSLATION_OUTPUT_ACTION_IDS.forEach((id) => {
        document.querySelectorAll(`[id="${id}"]`).forEach((element) => {
            if (buttons.includes(element)) {
                return;
            }
            if (!mode) {
                buttons.push(element);
                return;
            }
            const panel = element.closest ? element.closest('.tab-panel') : null;
            if (panel) {
                const panelMode = panel.id === 'panelDocument'
                    ? 'document'
                    : (panel.id === 'panelText' ? 'text' : null);
                if (panelMode === mode) {
                    buttons.push(element);
                }
                return;
            }
            // Not inside a panel: fall back to the id convention.
            const idMode = id.endsWith('Text') ? 'text' : 'document';
            if (idMode === mode) {
                buttons.push(element);
            }
        });
    });
    return buttons;
}

/**
 * Resolve the output element that belongs to a given control.
 * Prefers the panel the control lives in, so the same ids can be reused
 * by the Text panel and the Document panel.
 */
function resolveOutputElement(control, fallbackMode) {
    const panel = control && control.closest ? control.closest('.tab-panel') : null;
    if (panel) {
        const body = panel.querySelector('.output-body');
        if (body) {
            return body;
        }
        const legacy = panel.querySelector('#translationAreaText, #translationArea');
        if (legacy) {
            return legacy;
        }
    }
    if (fallbackMode) {
        return getPanelOutput(fallbackMode);
    }
    return null;
}

/** Output element of a mode: 'text' or 'document'. */
function getPanelOutput(mode) {
    const panelId = mode === 'document' ? 'panelDocument' : 'panelText';
    const panel = document.getElementById(panelId);
    if (panel) {
        const body = panel.querySelector('.output-body');
        if (body) {
            return body;
        }
        const legacy = panel.querySelector('#translationAreaText, #translationArea');
        if (legacy) {
            return legacy;
        }
    }
    const fallbackId = mode === 'document' ? 'translationArea' : 'translationAreaText';
    return document.getElementById(fallbackId);
}

/** The mode whose panel is currently active. */
function getActiveMode() {
    if (typeof App !== 'undefined' && App.currentMode === 'document') {
        return 'document';
    }
    return 'text';
}

/**
 * Plain text of an output element. An empty-state placeholder is not output,
 * so it never counts as something to copy or download.
 */
function getOutputText(element) {
    if (!element) {
        return '';
    }
    if (element.querySelector && element.querySelector('.empty-state')) {
        return '';
    }
    return (element.textContent || '').trim();
}

/* ------------------------------------------------------------ button state */

/**
 * Set the state of a button without destroying its icon.
 * Only the <span class="btn__label"> is mutated; the icon element is untouched.
 */
function setButtonState(button, state) {
    if (!button) {
        return;
    }
    const options = state || {};
    const label = button.querySelector('.btn__label');

    if (label) {
        if (label.dataset.defaultLabel === undefined) {
            label.dataset.defaultLabel = (label.textContent || '').trim();
        }
        if (options.loading) {
            label.textContent = options.label || 'Working…';
        } else if (options.label !== undefined) {
            label.textContent = options.label;
        } else {
            label.textContent = label.dataset.defaultLabel;
        }
    } else {
        // Legacy button without a label span: keep the original markup so the
        // icon can be restored once the run finishes.
        if (button.dataset.defaultMarkup === undefined) {
            button.dataset.defaultMarkup = button.innerHTML;
        }
        if (options.loading) {
            button.textContent = options.label || 'Working…';
        } else if (options.label !== undefined) {
            button.textContent = options.label;
        } else {
            button.innerHTML = button.dataset.defaultMarkup;
        }
    }

    if (options.loading) {
        button.classList.add('is-loading');
        button.disabled = true;
        return;
    }

    button.classList.remove('is-loading');
    button.disabled = options.disabled === undefined ? false : Boolean(options.disabled);
}

/** Which mode a given output action button belongs to. */
function getButtonMode(button) {
    const panel = button && button.closest ? button.closest('.tab-panel') : null;
    if (panel) {
        if (panel.id === 'panelDocument') {
            return 'document';
        }
        if (panel.id === 'panelText') {
            return 'text';
        }
        return null;
    }
    return button.id.endsWith('Text') ? 'text' : 'document';
}

/**
 * Enable or disable the output action buttons (Copy / Download .txt / Retry).
 * They are disabled rather than hidden until there is output.
 *
 * Pass a mode ('text' / 'document') to scope the change to one panel.
 * Without a mode, only the buttons whose panel has no output are disabled, so
 * clearing the text source never disables an unrelated document output.
 */
function setOutputActionsEnabled(enabled, mode) {
    getOutputActionButtons(mode).forEach((button) => {
        if (enabled) {
            button.removeAttribute('disabled');
            button.disabled = false;
            return;
        }
        if (!mode) {
            const output = resolveOutputElement(button, getButtonMode(button));
            if (getOutputText(output)) {
                return;
            }
        }
        button.setAttribute('disabled', '');
        button.disabled = true;
    });
}

/** Show or hide an element, using both the `hidden` class and the `hidden` attribute. */
function setElementHidden(element, hidden) {
    if (!element) {
        return;
    }
    if (hidden) {
        element.classList.add('hidden');
        element.setAttribute('hidden', '');
    } else {
        element.classList.remove('hidden');
        element.removeAttribute('hidden');
    }
}

/* ------------------------------------------------------------ empty states */

/**
 * Indeterminate sweep for the "translate all" progress bar.
 * Uses the Web Animations API so no inline style attribute is written and the
 * bar keeps working without a build step. Reduced motion gets a static bar.
 */
function startIndeterminateProgress(bar) {
    stopIndeterminateProgress(bar);
    if (!bar) {
        return;
    }
    const reduced = window.matchMedia
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
        bar.style.setProperty('--progress', '1');
        return;
    }
    if (typeof bar.animate !== 'function') {
        bar.style.setProperty('--progress', '1');
        return;
    }
    bar.translationProgressAnimation = bar.animate(
        [
            { transform: 'translateX(-120%) scaleX(0.35)' },
            { transform: 'translateX(260%) scaleX(0.35)' }
        ],
        { duration: 1100, iterations: Infinity, easing: 'ease-in-out' }
    );
}

function stopIndeterminateProgress(bar) {
    if (!bar) {
        return;
    }
    if (bar.translationProgressAnimation) {
        bar.translationProgressAnimation.cancel();
        bar.translationProgressAnimation = null;
    }
    bar.style.removeProperty('--progress');
}

/** Escape a value, falling back to a minimal encoder if utils.js is absent. */
function safeEscape(value) {
    if (typeof escapeHtml === 'function') {
        return escapeHtml(value);
    }
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/** Format translated text as paragraphs, falling back to escaped plain text. */
function safeFormat(text) {
    if (typeof formatText === 'function') {
        return formatText(text);
    }
    const paragraphs = String(text || '').split('\n\n').filter((p) => p.trim());
    return paragraphs
        .map((p) => `<p>${safeEscape(p).replace(/\n/g, '<br>')}</p>`)
        .join('');
}

function renderEmptyState(container, title, text, iconId) {
    if (!container) {
        return;
    }
    const icon = iconId || 'i-text';
    container.innerHTML = `
        <div class="empty-state">
            <svg class="icon empty-state__icon" aria-hidden="true"><use href="#${icon}"></use></svg>
            <p class="empty-state__title">${safeEscape(title)}</p>
            <p class="empty-state__text">${safeEscape(text)}</p>
        </div>
    `;
}

function renderTranslatedText(container, text) {
    if (!container) {
        return;
    }
    container.innerHTML = safeFormat(text);
}

/* ------------------------------------------------------------- text mode */

/**
 * Translate the text in the Text panel.
 * POST /api/translate {text, source_language, target_language}
 */
async function translateTextMode() {
    const input = (typeof App !== 'undefined' && App.els) ? App.els.textInput : null;
    const text = input ? (input.value || '').trim() : '';

    if (!text) {
        showTranslationToast('Please enter some text to translate.', 'error');
        return;
    }

    const translateBtn = (typeof App !== 'undefined' && App.els) ? App.els.translateTextBtn : null;
    const output = getPanelOutput('text');

    const loadingBadge = document.getElementById('textModeLoading');
    setElementHidden(loadingBadge, false);

    setButtonState(translateBtn, { loading: true, label: 'Translating…' });
    setOutputActionsEnabled(false, 'text');
    renderEmptyState(output, 'Translating…', 'This may take a moment.', 'i-sparkle');

    try {
        const response = await fetch('/api/translate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                text,
                source_language: App.els.sourceLanguage.value,
                target_language: App.els.targetLanguage.value
            })
        });

        const data = await response.json();

        if (!response.ok || !data.success) {
            renderEmptyState(output, 'Translation failed', data.error || 'Unknown error.', 'i-warning');
            showTranslationToast(data.error || 'Translation failed.', 'error');
            return;
        }

        App.translatedText = data.translated_text;
        renderTranslatedText(output, App.translatedText);
        callTranslationHelper('updateSummary', App.translatedText, text);
        callTranslationHelper('updateRTLState');
        callTranslationHelper('updateCharCount');
        setOutputActionsEnabled(true, 'text');
        showTranslationToast('Text translated successfully.', 'success');
    } catch (error) {
        console.error(error);
        renderEmptyState(output, 'Translation failed', 'Could not connect to the translation server.', 'i-warning');
        showTranslationToast('Translation request failed.', 'error');
    } finally {
        setElementHidden(loadingBadge, true);
        setButtonState(translateBtn, { loading: false });
    }
}

/* ---------------------------------------------------------- document mode */

/** GET /api/translation-cache?filename=&page=&target_language= */
async function checkTranslationCache(filename, pageNumber, targetLanguage) {
    try {
        const response = await fetch(`/api/translation-cache?filename=${encodeURIComponent(filename)}&page=${pageNumber}&target_language=${encodeURIComponent(targetLanguage)}`);
        const data = await response.json();
        return response.ok && data.success ? data.translated_text : null;
    } catch (error) {
        console.error('Error checking translation cache:', error);
        return null;
    }
}

/**
 * Translate the current page of the open document.
 * POST /api/translate-page {page_text, page_number, filename, source_language, target_language}
 */
async function translateCurrentPage() {
    let pageText = (App.pages && App.pages[App.currentPage - 1]) || '';
    if (!pageText.trim() && App.currentFileName) {
        try {
            const response = await fetch(`/api/page-text?filename=${encodeURIComponent(App.currentFileName)}&page=${App.currentPage}`);
            const data = await response.json();
            if (response.ok && data.success) {
                pageText = data.page_text || '';
                App.pages[App.currentPage - 1] = pageText;
            }
        } catch (error) {
            console.error(error);
        }
    }

    if (!pageText.trim()) {
        showTranslationToast('Upload a source file before translating.', 'error');
        return;
    }

    const output = getPanelOutput('document');
    const translateBtn = (typeof App !== 'undefined' && App.els) ? App.els.translatePageBtn : null;
    // Short-circuit on a cached translation.
    const targetLanguage = App.els.targetLanguage.value;
    const cachedTranslation = await checkTranslationCache(App.currentFileName, App.currentPage, targetLanguage);

    if (cachedTranslation) {
        App.translatedText = cachedTranslation;
        renderTranslatedText(output, App.translatedText);
        callTranslationHelper('updateSummary', App.translatedText, pageText);
        callTranslationHelper('updateRTLState');
        setOutputActionsEnabled(true, 'document');
        showTranslationToast(`Page ${App.currentPage} loaded from cache.`, 'success');
        return;
    }

    const loadingBadge = document.getElementById('attachmentLoading');
    setElementHidden(loadingBadge, false);

    setButtonState(translateBtn, { loading: true, label: 'Translating…' });
    setOutputActionsEnabled(false, 'document');
    renderEmptyState(output, 'Translating page…', 'This should be fast.', 'i-sparkle');

    try {
        const response = await fetch('/api/translate-page', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                page_text: pageText,
                page_number: App.currentPage,
                filename: App.currentFileName,
                source_language: App.els.sourceLanguage.value,
                target_language: App.els.targetLanguage.value
            })
        });

        const data = await response.json();

        if (!response.ok || !data.success) {
            renderEmptyState(output, 'Translation failed', data.error || 'Unknown error.', 'i-warning');
            showTranslationToast(data.error || 'Translation failed.', 'error');
            return;
        }

        App.translatedText = data.translated_text;
        renderTranslatedText(output, App.translatedText);
        callTranslationHelper('updateSummary', App.translatedText, pageText);
        callTranslationHelper('updateRTLState');
        setOutputActionsEnabled(true, 'document');
        showTranslationToast(`Page ${App.currentPage} translated.`, 'success');
    } catch (error) {
        console.error(error);
        renderEmptyState(output, 'Translation failed', 'Could not connect to the translation server.', 'i-warning');
        showTranslationToast('Translation request failed.', 'error');
    } finally {
        setElementHidden(loadingBadge, true);
        setButtonState(translateBtn, { loading: false });
    }
}

/**
 * Translate the whole document. The backend returns the full text in one
 * response, so there is no per-page progress to show.
 * POST /api/translate {text, filename, source_language, target_language}
 */
async function translateAllPages() {
    if (!App.currentFileName) {
        showTranslationToast('Upload a source file before translating.', 'error');
        return;
    }

    const output = getPanelOutput('document');
    const translateBtn = (typeof App !== 'undefined' && App.els) ? App.els.translateAllBtn : null;
    const progress = document.getElementById('translateAllProgress');
    const progressBar = progress ? progress.querySelector('.progress__bar') : null;

    const loadingBadge = document.getElementById('attachmentLoading');
    setElementHidden(loadingBadge, false);

    if (progress) {
        setElementHidden(progress, false);
        progress.classList.add('is-indeterminate');
    }
    if (progressBar) {
        progressBar.classList.add('is-indeterminate');
        startIndeterminateProgress(progressBar);
    }

    setButtonState(translateBtn, { loading: true, label: 'Translating…' });
    setOutputActionsEnabled(false, 'document');
    renderEmptyState(output, 'Translating all…', 'This may take a while.', 'i-sparkle');

    try {
        const response = await fetch('/api/translate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                text: App.pdfText,
                filename: App.currentFileName,
                source_language: App.els.sourceLanguage.value,
                target_language: App.els.targetLanguage.value
            })
        });

        const data = await response.json();

        if (!response.ok || !data.success) {
            renderEmptyState(output, 'Translation failed', data.error || 'Unknown error.', 'i-warning');
            showTranslationToast(data.error || 'Translation failed.', 'error');
            return;
        }

        App.translatedText = data.translated_text;
        renderTranslatedText(output, App.translatedText);
        callTranslationHelper('updateSummary', App.translatedText, App.pdfText);
        callTranslationHelper('updateRTLState');
        setOutputActionsEnabled(true, 'document');
        showTranslationToast('Full document translated in one response.', 'success');
    } catch (error) {
        console.error(error);
        renderEmptyState(output, 'Translation failed', 'Could not connect to the translation server.', 'i-warning');
        showTranslationToast('Translation request failed.', 'error');
    } finally {
        setElementHidden(loadingBadge, true);
        if (progress) {
            setElementHidden(progress, true);
            progress.classList.remove('is-indeterminate');
        }
        if (progressBar) {
            progressBar.classList.remove('is-indeterminate');
            stopIndeterminateProgress(progressBar);
        }
        setButtonState(translateBtn, { loading: false });
    }
}

/* --------------------------------------------------- copy / download / retry */

/** Copy the text of an output element. */
async function copyOutputElement(element) {
    const text = getOutputText(element);
    if (!text) {
        showTranslationToast('No translated text to copy.', 'error');
        return;
    }
    await callTranslationHelper('copyToClipboard', text);
    showTranslationToast('Translation copied.', 'success');
}

/** Download an output element as a .txt file. */
function downloadOutputElement(element) {
    const text = getOutputText(element);
    if (!text) {
        showTranslationToast('No translated text to download.', 'error');
        return;
    }
    if (typeof downloadTextFile === 'function') {
        downloadTextFile('translation.txt', text);
    } else {
        const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = 'translation.txt';
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(link.href);
    }
    showTranslationToast('Translation downloaded.', 'success');
}

/** Copy the output of the Text panel. */
async function copyTranslationFromTextPanel() {
    await copyOutputElement(getPanelOutput('text'));
}

/** Download the output of the Text panel. */
function downloadTranslationFromTextPanel() {
    downloadOutputElement(getPanelOutput('text'));
}

/** Retry the Text panel translation. */
function retryTranslation() {
    translateTextMode();
}

/** Copy the output of the panel that is currently active. */
async function copyActiveOutput() {
    await copyOutputElement(getPanelOutput(getActiveMode()));
}

/** Download the output of the panel that is currently active. */
function downloadActiveOutput() {
    downloadOutputElement(getPanelOutput(getActiveMode()));
}

/** Re-run the translation of the panel that is currently active. */
function retryActiveTranslation() {
    if (getActiveMode() === 'document') {
        translateCurrentPage();
        return;
    }
    translateTextMode();
}

/* -------------------------------------------------------------- shortcuts */

/**
 * Ctrl/Cmd+Enter translates, Ctrl/Cmd+Shift+C copies the active output.
 * Bound once, on the document, so the panels never double-handle the key.
 */
function bindTranslationShortcuts() {
    if (window.__translationShortcutsBound) {
        return;
    }
    window.__translationShortcutsBound = true;

    document.addEventListener('keydown', (event) => {
        const isModifier = event.ctrlKey || event.metaKey;
        if (!isModifier) {
            return;
        }

        if (event.key === 'Enter') {
            event.preventDefault();
            if (getActiveMode() === 'document') {
                translateCurrentPage();
            } else {
                translateTextMode();
            }
            return;
        }

        if (event.key === 'c' || event.key === 'C') {
            if (!event.shiftKey) {
                return;
            }
            event.preventDefault();
            copyActiveOutput();
        }
    });
}

/**
 * Wire the output action buttons. Delegated so the same ids can be reused by
 * the Text panel and the Document panel.
 */
function bindTranslationActions() {
    document.addEventListener('click', (event) => {
        const button = event.target && event.target.closest ? event.target.closest('button') : null;
        if (!button) {
            return;
        }

        const id = button.id;
        if (!TRANSLATION_OUTPUT_ACTION_IDS.includes(id)) {
            return;
        }

        const isTextAction = id.endsWith('Text');
        const fallbackMode = isTextAction ? 'text' : 'document';
        const output = resolveOutputElement(button, fallbackMode);

        if (id === 'copyTranslationBtnText' || id === 'copyTranslationBtnAttachment') {
            event.preventDefault();
            copyOutputElement(output);
            return;
        }

        if (id === 'downloadTranslationBtnText' || id === 'downloadTranslationBtnAttachment') {
            event.preventDefault();
            downloadOutputElement(output);
            return;
        }

        if (id === 'retryTranslationBtnText' || id === 'retryTranslationBtnAttachment') {
            event.preventDefault();
            const panel = button.closest ? button.closest('.tab-panel') : null;
            const mode = panel && panel.id === 'panelDocument' ? 'document' : fallbackMode;
            if (mode === 'document') {
                translateCurrentPage();
            } else {
                translateTextMode();
            }
        }
    });
}

function initTranslation() {
    bindTranslationActions();
    bindTranslationShortcuts();
    setOutputActionsEnabled(false);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initTranslation);
} else {
    initTranslation();
}
