/**
 * Notes mode — note cards, debounced autosave, and the summary card.
 *
 * Storage:
 *   'notebook-notes'  -> JSON array of note objects (current format)
 *   'notebook-note'   -> legacy single note (mirrored for backwards compatibility)
 *
 * A note looks like:
 *   {
 *     id: string,
 *     title: string,
 *     body: string,
 *     source: { filename, page, sourceLanguage, targetLanguage },
 *     timestamp: ISO string
 *   }
 */

const NOTES_STORAGE_KEY = 'notebook-notes';
const LEGACY_NOTE_KEY = 'notebook-note';
const NOTE_AUTOSAVE_DELAY = 800;
const NOTE_SAVED_HINT_DELAY = 1500;
const NOTES_SUMMARY_TIMEOUT = 60000;

const NotesState = {
    notes: [],
    autosaveTimers: {},
    summaryManuallySet: false,
    summaryText: '',
    summarySource: ''
};

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function notesEscape(value) {
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

function notesEl(id) {
    if (typeof App !== 'undefined' && App.els && App.els[id]) {
        return App.els[id];
    }
    return document.getElementById(id);
}

function notesToast(message, type) {
    if (typeof showToast === 'function') {
        showToast(message, type);
        return;
    }
    if (typeof showStatus === 'function') {
        showStatus(message, type);
        return;
    }
    console.info(`[notes] ${message}`);
}

function notesMakeId() {
    return `note-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function notesNowIso() {
    return new Date().toISOString();
}

function notesNormalise(raw) {
    if (!raw || typeof raw !== 'object') {
        return null;
    }
    const source = (raw.source && typeof raw.source === 'object') ? raw.source : {};
    return {
        id: raw.id ? String(raw.id) : notesMakeId(),
        title: raw.title ? String(raw.title) : '',
        body: raw.body ? String(raw.body) : '',
        source: {
            filename: source.filename ? String(source.filename) : '',
            page: source.page === undefined || source.page === null ? null : source.page,
            sourceLanguage: source.sourceLanguage ? String(source.sourceLanguage) : '',
            targetLanguage: source.targetLanguage ? String(source.targetLanguage) : ''
        },
        timestamp: raw.timestamp ? String(raw.timestamp) : notesNowIso()
    };
}

/* ------------------------------------------------------------------ */
/* Storage                                                             */
/* ------------------------------------------------------------------ */

function notesReadLegacy() {
    try {
        const raw = window.localStorage.getItem(LEGACY_NOTE_KEY);
        return raw ? String(raw) : '';
    } catch (error) {
        return '';
    }
}

function notesWriteLegacy(text) {
    try {
        window.localStorage.setItem(LEGACY_NOTE_KEY, text || '');
    } catch (error) {
        /* storage unavailable — nothing else to do */
    }
}

/**
 * Read the persisted notes, migrating the legacy single note when needed.
 * @returns {Array} array of normalised notes
 */
function getNotes() {
    let raw = null;
    try {
        raw = window.localStorage.getItem(NOTES_STORAGE_KEY);
    } catch (error) {
        raw = null;
    }

    if (raw === null) {
        // First run: migrate the legacy note into the first card.
        const legacy = notesReadLegacy();
        if (legacy.trim()) {
            const migrated = [notesNormalise({
                id: notesMakeId(),
                title: 'Note',
                body: legacy,
                source: { filename: '', page: null, sourceLanguage: '', targetLanguage: '' },
                timestamp: notesNowIso()
            })];
            saveNotes(migrated);
            return migrated;
        }
        return [];
    }

    let parsed = null;
    try {
        parsed = JSON.parse(raw);
    } catch (error) {
        parsed = null;
    }

    if (Array.isArray(parsed)) {
        if (parsed.length === 0) {
            // Legacy fallback: the new key is present but empty, so only use the
            // legacy note when it still holds content. It is persisted so the
            // note keeps a stable id across reloads.
            const legacy = notesReadLegacy();
            if (legacy.trim()) {
                const migrated = [notesNormalise({
                    id: notesMakeId(),
                    title: 'Note',
                    body: legacy,
                    source: { filename: '', page: null, sourceLanguage: '', targetLanguage: '' },
                    timestamp: notesNowIso()
                })];
                saveNotes(migrated);
                return migrated;
            }
            return [];
        }
        return parsed.map(notesNormalise).filter(Boolean);
    }

    return [];
}

/**
 * Persist the notes array.
 * @param {Array} notes
 */
function saveNotes(notes) {
    const list = Array.isArray(notes) ? notes.map(notesNormalise).filter(Boolean) : [];
    NotesState.notes = list;
    try {
        window.localStorage.setItem(NOTES_STORAGE_KEY, JSON.stringify(list));
    } catch (error) {
        notesToast('Could not save notes locally.', 'error');
    }
    // Mirror the first note into the legacy key so older builds keep working.
    notesWriteLegacy(list.length ? list[0].body : '');
    return list;
}

/* ------------------------------------------------------------------ */
/* Rendering                                                           */
/* ------------------------------------------------------------------ */

function notesTargetLanguage() {
    if (typeof App !== 'undefined' && App.els && App.els.targetLanguage) {
        return App.els.targetLanguage.value || '';
    }
    const select = document.getElementById('targetLanguage');
    return select ? (select.value || '') : '';
}

function notesSourceLanguage() {
    if (typeof App !== 'undefined' && App.els && App.els.sourceLanguage) {
        return App.els.sourceLanguage.value || '';
    }
    const select = document.getElementById('sourceLanguage');
    return select ? (select.value || '') : '';
}

function notesIsRtl(note) {
    const lang = (note && note.source && note.source.targetLanguage) || notesTargetLanguage();
    if (lang) {
        const normalised = String(lang).toLowerCase();
        if (['persian', 'farsi', 'arabic', 'kurdish', 'hebrew', 'urdu'].includes(normalised)) {
            return true;
        }
    }
    if (typeof isTargetLanguageRTL === 'function') {
        return Boolean(isTargetLanguageRTL());
    }
    return false;
}

function notesRelativeTime(isoString) {
    if (!isoString) {
        return '';
    }
    const date = new Date(isoString);
    if (isNaN(date.getTime())) {
        return '';
    }
    const diffMs = Date.now() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) {
        return 'just now';
    }
    if (diffMins < 60) {
        return `${diffMins} min${diffMins > 1 ? 's' : ''} ago`;
    }
    if (diffHours < 24) {
        return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    }
    if (diffDays < 7) {
        return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
    }
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function notesAttribution(note) {
    const parts = [];
    const source = note.source || {};
    if (source.filename) {
        parts.push(source.filename);
    }
    if (source.page !== null && source.page !== undefined && source.page !== '') {
        parts.push(`p.${source.page}`);
    }
    const from = source.sourceLanguage || '';
    const to = source.targetLanguage || '';
    if (from && to) {
        parts.push(`${from} → ${to}`);
    } else if (to) {
        parts.push(to);
    }
    const relative = notesRelativeTime(note.timestamp);
    if (relative) {
        parts.push(relative);
    }
    return parts.length ? parts.join(' · ') : 'No source';
}

function notesCardMarkup(note) {
    const rtl = notesIsRtl(note);
    const dir = rtl ? 'rtl' : 'ltr';
    return `
        <article class="note-card${rtl ? ' is-rtl' : ''}" data-note-id="${notesEscape(note.id)}" dir="${dir}">
            <div class="note-card__head">
                <input type="text" class="input note-card__title" placeholder="Note title" aria-label="Note title" autocomplete="off" data-note-field="title" value="${notesEscape(note.title)}">
                <span class="note-card__source badge badge--neutral" data-note-source>${notesEscape(notesAttribution(note))}</span>
            </div>
            <textarea class="textarea note-card__body" placeholder="Write your note…" aria-label="Note body" data-note-field="body" dir="${dir}">${notesEscape(note.body)}</textarea>
            <div class="note-card__actions">
                <button type="button" class="btn btn--primary btn--sm" data-note-action="save" aria-label="Save note">
                    <svg class="icon btn__icon" aria-hidden="true"><use href="#i-check"></use></svg>
                    <span class="btn__label">Save</span>
                </button>
                <button type="button" class="btn btn--ghost btn--sm btn--danger" data-note-action="delete" aria-label="Delete note">
                    <svg class="icon btn__icon" aria-hidden="true"><use href="#i-trash"></use></svg>
                    <span class="btn__label">Delete</span>
                </button>
                <span class="badge badge--success note-card__saved hidden" data-note-saved>Saved</span>
            </div>
        </article>`;
}

function renderNotes() {
    const list = notesEl('notesList');
    if (!list) {
        return;
    }
    list.innerHTML = NotesState.notes.map(notesCardMarkup).join('');

    const empty = notesEl('notesEmptyState');
    if (empty) {
        empty.classList.toggle('hidden', NotesState.notes.length > 0);
    }
}

function notesMarkSaved(card) {
    if (!card) {
        return;
    }
    card.classList.add('is-saved');
    const badge = card.querySelector('[data-note-saved]');
    if (badge) {
        badge.classList.remove('hidden');
    }
    window.setTimeout(() => {
        card.classList.remove('is-saved');
        if (badge) {
            badge.classList.add('hidden');
        }
    }, NOTE_SAVED_HINT_DELAY);
}

/* ------------------------------------------------------------------ */
/* Summary card                                                        */
/* ------------------------------------------------------------------ */

function notesCurrentTranslation() {
    if (typeof App !== 'undefined' && App.translatedText && App.translatedText.trim()) {
        return String(App.translatedText);
    }
    const candidates = ['translationAreaText', 'translationArea'];
    for (const id of candidates) {
        const node = notesEl(id);
        if (!node) {
            continue;
        }
        // An output panel showing its empty-state placeholder is not a translation.
        if (node.querySelector('.empty-state')) {
            continue;
        }
        const text = (node.textContent || '').trim();
        if (text) {
            return text;
        }
    }
    return '';
}

function notesRenderSummaryPreview() {
    const container = notesEl('notesSummary');
    if (!container) {
        return;
    }
    const clean = NotesState.summaryText.replace(/<[^>]+>/g, '').trim();
    const preview = clean.length > 220 ? `${clean.slice(0, 220)}…` : clean;
    const source = NotesState.summarySource.replace(/\s+/g, ' ').trim().slice(0, 140);

    container.innerHTML = '';

    const title = document.createElement('strong');
    title.textContent = 'Current translation summary';
    container.appendChild(title);

    const text = document.createElement('p');
    text.className = 'summary-text';
    text.textContent = preview || 'No translation available yet.';
    container.appendChild(text);

    const sourceLine = document.createElement('p');
    sourceLine.className = 'summary-source';
    sourceLine.textContent = `Source: ${source || 'No source text available'}`;
    container.appendChild(sourceLine);
}

function notesRenderSummaryState(titleText, messageText, extraClass) {
    const container = notesEl('notesSummary');
    if (!container) {
        return;
    }
    container.innerHTML = '';

    const state = document.createElement('div');
    state.className = `empty-state${extraClass ? ` ${extraClass}` : ''}`;

    const title = document.createElement('p');
    title.className = 'empty-state__title';
    title.textContent = titleText;
    state.appendChild(title);

    const text = document.createElement('p');
    text.className = 'empty-state__text';
    text.textContent = messageText;
    state.appendChild(text);

    container.appendChild(state);
}

function notesRenderSummaryText(summaryText) {
    const container = notesEl('notesSummary');
    if (!container) {
        return;
    }
    container.innerHTML = '';

    const title = document.createElement('strong');
    title.textContent = 'Current translation summary';
    container.appendChild(title);

    const text = document.createElement('p');
    text.className = 'summary-text';
    text.textContent = summaryText;
    container.appendChild(text);

    const source = document.createElement('p');
    source.className = 'summary-source';
    const sourcePreview = NotesState.summarySource.replace(/\s+/g, ' ').trim().slice(0, 140);
    source.textContent = `Source: ${sourcePreview || 'No source text available'}`;
    container.appendChild(source);
}

function notesSetSummarizeLoading(isLoading) {
    const button = notesEl('summarizeBtn');
    if (!button) {
        return;
    }
    const label = button.querySelector('.btn__label');
    if (label) {
        label.textContent = isLoading ? 'Summarising…' : 'Summarize current translation';
    }
    button.classList.toggle('is-loading', isLoading);
    // `is-loading` already blocks pointer events; aria-busy carries the state
    // to assistive tech without the disabled opacity treatment.
    button.setAttribute('aria-busy', String(isLoading));
}

async function summarizeCurrentTranslation() {
    const text = notesCurrentTranslation();
    if (!text || !text.trim()) {
        notesToast('Translate something first, then summarise it.', 'info');
        return;
    }

    const language = notesTargetLanguage() || 'English';
    notesSetSummarizeLoading(true);
    notesRenderSummaryState('Summarising…', 'Generating a summary of the current translation.');

    // The backend can block for a long time when Ollama is unreachable, so the
    // request is aborted client-side to guarantee the button always recovers.
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timeout = controller
        ? window.setTimeout(() => controller.abort(), NOTES_SUMMARY_TIMEOUT)
        : null;

    try {
        const response = await fetch('/api/summary', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: text, language: language }),
            signal: controller ? controller.signal : undefined
        });

        let data = null;
        try {
            data = await response.json();
        } catch (parseError) {
            data = null;
        }

        if (response.ok && data && data.success && data.summary) {
            NotesState.summaryManuallySet = true;
            notesRenderSummaryText(String(data.summary));
            notesToast('Summary ready.', 'success');
        } else {
            const message = (data && data.error) ? String(data.error) : 'The summary service did not respond.';
            notesRenderSummaryState('Summary unavailable', message);
            notesToast('Could not generate a summary.', 'error');
        }
    } catch (error) {
        console.error('Summary request failed:', error);
        const aborted = error && (error.name === 'AbortError' || error.code === 20);
        notesRenderSummaryState(
            'Summary unavailable',
            aborted
                ? 'The summary request timed out. Check that Ollama is running, then try again.'
                : 'The summary request failed. Check the browser console.'
        );
        notesToast('Could not generate a summary.', 'error');
    } finally {
        if (timeout) {
            window.clearTimeout(timeout);
        }
        notesSetSummarizeLoading(false);
    }
}

/**
 * Legacy entry point kept for translation.js.
 * Refreshes the summary card preview (and its source attribution).
 * @param {string} translatedTextValue
 * @param {string} sourceTextValue
 */
function updateSummary(translatedTextValue, sourceTextValue) {
    NotesState.summaryText = translatedTextValue || '';
    NotesState.summarySource = sourceTextValue || '';

    if (NotesState.summaryManuallySet) {
        // The user already asked for a summary — keep the generated text but
        // still refresh the source attribution underneath it.
        const sourceLine = notesEl('notesSummary') ? notesEl('notesSummary').querySelector('.summary-source') : null;
        if (sourceLine) {
            const source = NotesState.summarySource.replace(/\s+/g, ' ').trim().slice(0, 140);
            sourceLine.textContent = `Source: ${source || 'No source text available'}`;
        }
        return;
    }
    notesRenderSummaryPreview();
}

/* ------------------------------------------------------------------ */
/* Note actions                                                        */
/* ------------------------------------------------------------------ */

function notesFindNote(noteId) {
    return NotesState.notes.find((note) => note.id === noteId) || null;
}

function notesFindCard(noteId) {
    const list = notesEl('notesList');
    if (!list) {
        return null;
    }
    return list.querySelector(`[data-note-id="${noteId}"]`);
}

function notesScheduleAutosave(noteId) {
    if (NotesState.autosaveTimers[noteId]) {
        window.clearTimeout(NotesState.autosaveTimers[noteId]);
    }
    NotesState.autosaveTimers[noteId] = window.setTimeout(() => {
        delete NotesState.autosaveTimers[noteId];
        saveNotes(NotesState.notes);
        notesMarkSaved(notesFindCard(noteId));
    }, NOTE_AUTOSAVE_DELAY);
}

function notesSaveNote(noteId, showConfirmation) {
    const note = notesFindNote(noteId);
    if (!note) {
        return;
    }
    saveNotes(NotesState.notes);
    notesMarkSaved(notesFindCard(noteId));
    if (showConfirmation) {
        notesToast('Note saved.', 'success');
    }
}

function notesDeleteNote(noteId) {
    const note = notesFindNote(noteId);
    if (!note) {
        return;
    }
    if (!window.confirm('Delete this note? This cannot be undone.')) {
        return;
    }
    if (NotesState.autosaveTimers[noteId]) {
        window.clearTimeout(NotesState.autosaveTimers[noteId]);
        delete NotesState.autosaveTimers[noteId];
    }
    NotesState.notes = NotesState.notes.filter((item) => item.id !== noteId);
    saveNotes(NotesState.notes);
    renderNotes();
    notesToast('Note deleted.', 'success');
}

function notesHandleListInput(event) {
    const field = event.target.closest('[data-note-field]');
    if (!field) {
        return;
    }
    const card = field.closest('[data-note-id]');
    if (!card) {
        return;
    }
    const note = notesFindNote(card.getAttribute('data-note-id'));
    if (!note) {
        return;
    }
    if (field.getAttribute('data-note-field') === 'title') {
        note.title = field.value;
    } else {
        note.body = field.value;
    }
    notesScheduleAutosave(note.id);
}

function notesHandleListClick(event) {
    const button = event.target.closest('[data-note-action]');
    if (!button) {
        return;
    }
    const card = button.closest('[data-note-id]');
    if (!card) {
        return;
    }
    const noteId = card.getAttribute('data-note-id');
    const action = button.getAttribute('data-note-action');
    if (action === 'save') {
        notesSaveNote(noteId, true);
    } else if (action === 'delete') {
        notesDeleteNote(noteId);
    }
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

/**
 * Create a note from the current translation (Document mode "Add to notes").
 */
function addTranslationToNotes() {
    const text = (typeof App !== 'undefined' && App.translatedText) ? String(App.translatedText) : '';
    if (!text.trim()) {
        notesToast('Translate the page before adding it to notes.', 'info');
        return;
    }

    const filename = (typeof App !== 'undefined' && App.currentFileName) ? App.currentFileName : '';
    const page = (typeof App !== 'undefined' && App.currentPage) ? App.currentPage : null;

    const note = notesNormalise({
        id: notesMakeId(),
        title: filename || 'Translation',
        body: text,
        source: {
            filename: filename,
            page: page,
            sourceLanguage: notesSourceLanguage(),
            targetLanguage: notesTargetLanguage()
        },
        timestamp: notesNowIso()
    });

    NotesState.notes = [note, ...NotesState.notes];
    saveNotes(NotesState.notes);
    renderNotes();
    notesToast('Added to notes.', 'success');
}

/**
 * Entry point called by main.js when the Notes tab is activated.
 */
function initNotesMode() {
    NotesState.notes = getNotes();
    renderNotes();

    const list = notesEl('notesList');
    if (list && list.dataset.notesWired !== '1') {
        list.dataset.notesWired = '1';
        list.addEventListener('input', notesHandleListInput);
        list.addEventListener('click', notesHandleListClick);
    }

    const button = notesEl('summarizeBtn');
    if (button && button.dataset.notesWired !== '1') {
        button.dataset.notesWired = '1';
        button.addEventListener('click', summarizeCurrentTranslation);
    }

    if (!NotesState.summaryText) {
        notesRenderSummaryPreview();
    }
}
