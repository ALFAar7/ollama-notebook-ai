/**
 * Upload + file library.
 *
 * Owns: uploadAndTranslateFile(), the drag-over feedback on the drop zone,
 * and the file library list backed by GET /api/files (plan defect D3).
 *
 * Every cross-module call is resolved through `window` at call time and
 * guarded, so the script order in base.html does not matter.
 */

const UPLOAD_ALLOWED_EXTENSIONS = ['.pdf', '.docx', '.txt'];
const UPLOAD_TIMEOUT_MS = 600000;

/** Files currently being uploaded, to avoid double submissions. */
const uploadInFlight = new Set();

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

/** The global App object, or null when it is not ready yet. */
function uploadApp() {
    try {
        return (typeof App !== 'undefined' && App) ? App : null;
    } catch (err) {
        return null;
    }
}

/** Call a global function from another module if it exists. */
function uploadCall(name, ...args) {
    const fn = window[name];
    if (typeof fn === 'function') {
        return fn(...args);
    }
    return undefined;
}

/** Look up an element by id, preferring the main.js cache. */
function uploadEl(id) {
    const app = uploadApp();
    if (app && app.els && app.els[id]) {
        return app.els[id];
    }
    return document.getElementById(id);
}

/** Escape text for safe insertion into innerHTML. */
function uploadEsc(value) {
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
function uploadToast(message, type) {
    if (typeof window.showToast === 'function') {
        window.showToast(message, type || 'info');
        return;
    }
    console.log('[toast]', type || 'info', message);
}

/** Human readable file size. */
function uploadFormatBytes(bytes) {
    if (typeof window.formatBytes === 'function') {
        return window.formatBytes(bytes);
    }
    const value = Number(bytes);
    if (!Number.isFinite(value) || value < 0) {
        return '—';
    }
    if (value < 1024) {
        return `${value} B`;
    }
    const units = ['KB', 'MB', 'GB', 'TB'];
    let size = value / 1024;
    let unit = 0;
    while (size >= 1024 && unit < units.length - 1) {
        size /= 1024;
        unit += 1;
    }
    return `${size.toFixed(size >= 10 ? 0 : 1)} ${units[unit]}`;
}

/** Empty-state markup used inside the document output area. */
function uploadEmptyState(title, text, iconId) {
    return `
        <div class="empty-state">
            <svg class="icon empty-state__icon" aria-hidden="true"><use href="#${iconId}"></use></svg>
            <p class="empty-state__title">${uploadEsc(title)}</p>
            <p class="empty-state__text">${uploadEsc(text)}</p>
        </div>
    `;
}

/** Update the "current source" card in the sources drawer. */
function uploadUpdateSourceCard(fileType, chunks) {
    const typeEl = uploadEl('sourceFileType');
    if (typeEl) {
        typeEl.textContent = fileType ? String(fileType).toUpperCase() : '—';
    }
    const chunksEl = uploadEl('sourceChunks');
    if (chunksEl) {
        chunksEl.textContent = (chunks === null || chunks === undefined) ? '—' : String(chunks);
    }
}

/**
 * Write the file name and page count into the source card.
 * The card uses a definition list, so the values are bare (no "Pages:" prefix).
 */
function uploadUpdateSourceMetaFields() {
    const app = uploadApp();
    const nameEl = uploadEl('sourceFileName');
    if (nameEl) {
        nameEl.textContent = (app && app.currentFileName) || 'No file';
    }
    const pagesEl = uploadEl('sourcePageCount');
    if (pagesEl) {
        const count = app && app.pages ? app.pages.length : 0;
        pagesEl.textContent = count ? String(count) : '—';
    }
}

/** Parse the extracted text into pages, falling back to a single page. */
function uploadParsePages(text) {
    if (!text || !text.trim()) {
        return [''];
    }
    if (typeof window.parsePages === 'function') {
        const parsed = window.parsePages(text);
        if (parsed && parsed.length) {
            return parsed;
        }
    }
    return [text.trim()];
}

/* ------------------------------------------------------------------ *
 * Upload
 * ------------------------------------------------------------------ */

/**
 * Upload a source file and make it the active document.
 * @param {File} file
 */
async function uploadAndTranslateFile(file) {
    if (!file) {
        return;
    }

    const app = uploadApp();
    const ext = '.' + String(file.name).split('.').pop().toLowerCase();

    if (!UPLOAD_ALLOWED_EXTENSIONS.includes(ext)) {
        uploadToast('Please choose a valid file (PDF, DOCX, or TXT).', 'error');
        return;
    }

    const key = `${file.name}:${file.size}`;
    if (uploadInFlight.has(key)) {
        return;
    }
    uploadInFlight.add(key);

    const formData = new FormData();
    formData.append('file', file);

    uploadToast('Processing source...', 'info');

    const attachmentLoading = uploadEl('attachmentLoading');
    if (attachmentLoading) {
        attachmentLoading.classList.remove('hidden');
    }

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);
        const response = await fetch('/api/upload', {
            method: 'POST',
            body: formData,
            signal: controller.signal
        });
        clearTimeout(timeoutId);

        const data = await response.json();

        if (!response.ok || !data.success) {
            uploadToast(data.error || 'Upload failed.', 'error');
            return;
        }

        if (app) {
            app.currentFileName = data.filename;
            app.pdfText = data.text || '';
            app.pages = Array(Math.max(data.page_count || 1, 1)).fill('');
            if (app.pdfText.trim()) {
                app.pages = uploadParsePages(app.pdfText);
            }
            app.currentPage = 1;
            app.translatedText = '';
        }

        uploadUpdateSourceCard(data.file_type || ext.replace('.', ''), data.chunks_indexed);

        uploadCall('renderFilePreview');
        uploadCall('updatePageButtons');
        uploadCall('updateSourceMeta');
        uploadCall('updateSearchScopeState');
        uploadUpdateSourceMetaFields();

        const pageNumber = uploadEl('pageNumber');
        if (pageNumber && app) {
            pageNumber.value = app.currentPage;
        }

        const translationArea = uploadEl('translationArea');
        if (translationArea) {
            if (data.processing) {
                translationArea.innerHTML = uploadEmptyState(
                    'Preparing document',
                    'This large PDF is being processed in the background. The preview will update shortly.',
                    'i-sparkle'
                );
            } else {
                translationArea.innerHTML = uploadEmptyState(
                    'Source ready',
                    'Translate the current page or the full document when you are ready.',
                    'i-doc'
                );
            }
        }

        if (data.processing) {
            uploadToast('Document upload accepted. Processing in progress...', 'info');
            uploadStartProcessingPolling(data.filename);
        } else {
            const pageCount = app && app.pages ? app.pages.length : 0;
            uploadToast(`File processed. ${pageCount} page(s) ready.`, 'success');
        }

        uploadCall('switchWorkspaceTab', 'document');
        uploadCall('loadFileLibrary');
        // The upload re-indexes the document, so refresh the knowledge base list.
        uploadLoadKnowledgeBase();
    } catch (error) {
        console.error(error);
        if (error && error.name === 'AbortError') {
            uploadToast('Processing timed out. Try a smaller file.', 'error');
        } else {
            uploadToast('Upload failed. Check the browser console.', 'error');
        }
    } finally {
        uploadInFlight.delete(key);
        if (attachmentLoading) {
            attachmentLoading.classList.add('hidden');
        }
    }
}

/** Poll the backend until a background-processed document is ready. */
function uploadStartProcessingPolling(filename) {
    const app = uploadApp();
    if (!app) {
        return;
    }

    if (app.processingTimer) {
        clearInterval(app.processingTimer);
    }

    app.processingTimer = setInterval(async () => {
        try {
            const response = await fetch(`/api/document-status?filename=${encodeURIComponent(filename)}`);
            const data = await response.json();
            if (!response.ok || !data.success) {
                return;
            }
            if (data.ready) {
                clearInterval(app.processingTimer);
                app.processingTimer = null;
                app.pages = Array(Math.max(data.page_count || 1, 1)).fill('');
                app.currentPage = 1;

                uploadCall('updateSourceMeta');
                uploadCall('renderFilePreview');

                const pageTextPromise = uploadCall('loadCurrentPageText');
                if (pageTextPromise && typeof pageTextPromise.catch === 'function') {
                    pageTextPromise.catch(() => {});
                }

                const translationArea = uploadEl('translationArea');
                if (translationArea) {
                    translationArea.innerHTML = uploadEmptyState(
                        'Source ready',
                        'Translate the current page or the full document.',
                        'i-doc'
                    );
                }
                uploadToast(`Document ready. ${data.page_count || 0} page(s) available.`, 'success');
            }
        } catch (error) {
            console.error(error);
        }
    }, 2000);
}

/** Fetch the text of the currently open page. */
async function uploadLoadCurrentPageText() {
    const app = uploadApp();
    if (!app || !app.currentFileName) {
        return;
    }

    try {
        const response = await fetch(`/api/page-text?filename=${encodeURIComponent(app.currentFileName)}&page=${app.currentPage}`);
        const data = await response.json();
        if (!response.ok || !data.success) {
            return;
        }
        const pageText = data.page_text || '';
        app.pages[app.currentPage - 1] = pageText;
        uploadCall('renderFilePreview');
    } catch (error) {
        console.error(error);
    }
}

/* ------------------------------------------------------------------ *
 * File library
 * ------------------------------------------------------------------ */

/** Uppercase type badge for a file name or file type. */
function uploadTypeBadge(file) {
    const raw = (file && (file.file_type || file.name)) || '';
    const ext = String(raw).split('.').pop().toLowerCase();
    if (ext === 'docx') {
        return 'DOCX';
    }
    if (ext === 'pdf') {
        return 'PDF';
    }
    if (ext === 'txt') {
        return 'TXT';
    }
    return (ext || 'FILE').toUpperCase();
}

/** Format the modified timestamp of a library entry. */
function uploadFormatDate(modified) {
    if (modified === null || modified === undefined || modified === '') {
        return '—';
    }
    const date = new Date(Number(modified) * 1000);
    if (Number.isNaN(date.getTime())) {
        return '—';
    }
    return date.toLocaleString();
}

/** Render one library entry as a button. */
function uploadRenderLibraryItem(file) {
    const name = (file && file.name) || '';
    const type = uploadTypeBadge(file);
    const size = uploadFormatBytes(file && file.size);
    const modified = uploadFormatDate(file && file.modified);

    return `
        <li>
            <button type="button" class="file-library-item" data-filename="${uploadEsc(name)}">
                <span class="file-library-item__name">${uploadEsc(name)}</span>
                <span class="badge badge--neutral">${uploadEsc(type)}</span>
                <span class="file-library-item__meta">${uploadEsc(size)} · ${uploadEsc(modified)}</span>
            </button>
        </li>
    `;
}

/**
 * Load the file library list from GET /api/files.
 */
async function uploadLoadFileLibrary() {
    const list = uploadEl('fileLibraryList');
    if (!list) {
        return;
    }

    let data = null;
    try {
        if (typeof window.loadFiles === 'function') {
            data = await window.loadFiles();
        } else {
            const response = await fetch('/api/files');
            data = await response.json();
        }
    } catch (error) {
        console.error(error);
        list.innerHTML = '<li class="file-library__empty">No uploads yet</li>';
        return;
    }

    const files = (data && Array.isArray(data.files)) ? data.files : [];

    if (!files.length) {
        list.innerHTML = '<li class="file-library__empty">No uploads yet</li>';
        return;
    }

    list.innerHTML = files.map(uploadRenderLibraryItem).join('');
}

/**
 * Load an already uploaded document and make it the active source.
 * @param {string} filename
 */
async function uploadLoadExistingFile(filename) {
    if (!filename) {
        return;
    }

    const app = uploadApp();
    if (!app) {
        return;
    }

    uploadToast(`Loading ${filename}...`, 'info');

    let data = null;
    try {
        if (typeof window.getFileText === 'function') {
            data = await window.getFileText(filename);
        } else {
            const response = await fetch('/api/file/' + encodeURIComponent(filename));
            data = await response.json();
        }
    } catch (error) {
        console.error(error);
        uploadToast((error && error.message) || `Could not load ${filename}.`, 'error');
        return;
    }

    if (!data || !data.success) {
        uploadToast((data && data.error) || `Could not load ${filename}.`, 'error');
        return;
    }

    const text = data.text || '';
    app.currentFileName = data.filename || filename;
    app.pdfText = text;
    app.pages = Array(Math.max(data.page_count || 1, 1)).fill('');
    if (text.trim()) {
        app.pages = uploadParsePages(text);
    }
    app.currentPage = 1;
    app.translatedText = '';

    uploadUpdateSourceCard(data.file_type || '', null);

    uploadCall('renderFilePreview');
    uploadCall('updatePageButtons');
    uploadCall('updateSourceMeta');
    uploadCall('updateSearchScopeState');
    uploadUpdateSourceMetaFields();

    const pageNumber = uploadEl('pageNumber');
    if (pageNumber) {
        pageNumber.value = app.currentPage;
    }

    const translationArea = uploadEl('translationArea');
    if (translationArea) {
        translationArea.innerHTML = uploadEmptyState(
            'Source ready',
            'Translate the current page or the full document when you are ready.',
            'i-doc'
        );
    }

    uploadCall('switchWorkspaceTab', 'document');
    uploadToast(`Loaded ${app.currentFileName}.`, 'success');
}

/* ------------------------------------------------------------------ *
 * Wiring
 * ------------------------------------------------------------------ */

/** Wire the drop zone, the file input and the library refresh button. */
function uploadInit() {
    const fileInput = uploadEl('fileInput');
    if (fileInput && fileInput.dataset.uploadBound !== 'true') {
        fileInput.dataset.uploadBound = 'true';
        fileInput.addEventListener('change', (event) => {
            const file = event.target.files && event.target.files[0];
            if (file) {
                uploadAndTranslateFile(file);
            }
        });
    }

    const uploadCard = uploadEl('uploadCard');
    if (uploadCard && uploadCard.dataset.dragBound !== 'true') {
        uploadCard.dataset.dragBound = 'true';

        uploadCard.addEventListener('dragenter', (event) => {
            event.preventDefault();
            uploadCard.classList.add('is-dragging');
        });

        uploadCard.addEventListener('dragover', (event) => {
            event.preventDefault();
            uploadCard.classList.add('is-dragging');
        });

        uploadCard.addEventListener('dragleave', (event) => {
            event.preventDefault();
            uploadCard.classList.remove('is-dragging');
        });

        uploadCard.addEventListener('drop', (event) => {
            event.preventDefault();
            uploadCard.classList.remove('is-dragging');
            const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
            if (file) {
                uploadAndTranslateFile(file);
            }
        });
    }

    const refreshBtn = uploadEl('fileLibraryRefresh');
    if (refreshBtn && refreshBtn.dataset.uploadBound !== 'true') {
        refreshBtn.dataset.uploadBound = 'true';
        refreshBtn.addEventListener('click', () => {
            uploadLoadFileLibrary();
        });
    }

    // Knowledge base: clear everything, or drop a single document.
    const clearKbBtn = uploadEl('clearKnowledgeBaseBtn');
    if (clearKbBtn && clearKbBtn.dataset.uploadBound !== 'true') {
        clearKbBtn.dataset.uploadBound = 'true';
        clearKbBtn.addEventListener('click', () => {
            uploadClearKnowledgeBase();
        });
    }

    const kbList = uploadEl('knowledgeBaseList');
    if (kbList && kbList.dataset.uploadBound !== 'true') {
        kbList.dataset.uploadBound = 'true';
        kbList.addEventListener('click', (event) => {
            const button = event.target.closest ? event.target.closest('.knowledge-base__remove') : null;
            if (button) {
                uploadRemoveIndexedDocument(button.dataset.filename);
            }
        });
    }

    // The knowledge base list is a snapshot; refresh it when the drawer opens
    // and whenever a document is added or removed.
    uploadLoadKnowledgeBase();

    const libraryList = uploadEl('fileLibraryList');
    if (libraryList && libraryList.dataset.uploadBound !== 'true') {
        libraryList.dataset.uploadBound = 'true';
        libraryList.addEventListener('click', (event) => {
            const button = event.target.closest ? event.target.closest('.file-library-item') : null;
            if (!button || !libraryList.contains(button)) {
                return;
            }
            const filename = button.getAttribute('data-filename');
            if (filename) {
                uploadLoadExistingFile(filename);
            }
        });
    }

    uploadLoadFileLibrary();
}

/* ------------------------------------------------------------------ *
 * Public API
 * ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ *
 * Knowledge base (vector store)
 * ------------------------------------------------------------------ */

/** Render the indexed-document list inside the sources drawer. */
function uploadRenderKnowledgeBase(data) {
    const list = uploadEl('knowledgeBaseList');
    const counter = uploadEl('knowledgeChunkCount');
    const documents = (data && data.documents) || [];
    const total = (data && data.total_embeddings) || 0;

    if (counter) {
        counter.textContent = `${total} chunk${total === 1 ? '' : 's'}`;
        counter.classList.toggle('badge--neutral', total === 0);
        counter.classList.toggle('badge--brand', total > 0);
    }

    if (!list) {
        return;
    }

    if (!documents.length) {
        list.innerHTML = '<li class="knowledge-base__empty">Nothing indexed yet</li>';
        return;
    }

    list.innerHTML = documents.map((doc) => {
        const name = doc.filename || '(unnamed)';
        const pages = doc.page_count ? ` · ${doc.page_count} pages` : '';
        return `
            <li class="knowledge-base__item">
                <span class="knowledge-base__name" title="${uploadEsc(name)}">${uploadEsc(name)}</span>
                <span class="knowledge-base__meta">${doc.chunks} chunks${pages}</span>
                <button type="button" class="icon-btn knowledge-base__remove"
                        data-filename="${uploadEsc(name)}"
                        aria-label="Remove ${uploadEsc(name)} from the knowledge base"
                        title="Remove from knowledge base">
                    <svg class="icon" aria-hidden="true"><use href="#i-trash"></use></svg>
                </button>
            </li>
        `;
    }).join('');
}

/** Load the knowledge base summary from the API. */
async function uploadLoadKnowledgeBase() {
    try {
        const data = typeof window.listVectorStoreDocuments === 'function'
            ? await window.listVectorStoreDocuments()
            : { documents: [], total_embeddings: 0 };
        uploadRenderKnowledgeBase(data);
        return data;
    } catch (error) {
        console.error(error);
        const list = uploadEl('knowledgeBaseList');
        if (list) {
            list.innerHTML = '<li class="knowledge-base__empty">Knowledge base unavailable</li>';
        }
        return null;
    }
}

/** Remove one document's chunks from the knowledge base. */
async function uploadRemoveIndexedDocument(filename) {
    if (!filename) {
        return;
    }
    const label = filename.length > 40 ? `${filename.slice(0, 37)}...` : filename;
    if (!window.confirm(`Remove "${label}" from the knowledge base?\n\nThe uploaded file is not deleted.`)) {
        return;
    }
    try {
        const result = typeof window.removeDocumentFromVectorStore === 'function'
            ? await window.removeDocumentFromVectorStore(filename)
            : null;
        uploadToast(`Removed ${result ? result.removed : 0} chunk(s) from the knowledge base.`, 'success');
        uploadLoadKnowledgeBase();
    } catch (error) {
        console.error(error);
        uploadToast(error.message || 'Could not remove the document.', 'error');
    }
}

/** Empty the whole knowledge base. */
async function uploadClearKnowledgeBase() {
    if (!window.confirm('Clear the entire knowledge base?\n\nAll indexed chunks are removed. Uploaded files are not deleted.')) {
        return;
    }
    const button = uploadEl('clearKnowledgeBaseBtn');
    if (button) {
        button.disabled = true;
    }
    try {
        const result = typeof window.clearVectorStore === 'function'
            ? await window.clearVectorStore()
            : null;
        uploadToast(`Knowledge base cleared (${result ? result.removed : 0} chunks removed).`, 'success');
        uploadLoadKnowledgeBase();
    } catch (error) {
        console.error(error);
        uploadToast(error.message || 'Could not clear the knowledge base.', 'error');
    } finally {
        if (button) {
            button.disabled = false;
        }
    }
}

function installUploadGlobals() {
    window.uploadAndTranslateFile = uploadAndTranslateFile;
    window.loadFileLibrary = uploadLoadFileLibrary;
    window.loadExistingFile = uploadLoadExistingFile;
    window.initUpload = uploadInit;
    window.startProcessingPolling = uploadStartProcessingPolling;
    window.loadCurrentPageText = uploadLoadCurrentPageText;
    window.loadKnowledgeBase = uploadLoadKnowledgeBase;
    window.clearKnowledgeBase = uploadClearKnowledgeBase;
    window.removeIndexedDocument = uploadRemoveIndexedDocument;
}

// Install immediately, so the global bindings are correct before any other
// script binds an event handler to them, and re-assert on DOMContentLoaded.
installUploadGlobals();

if (document.readyState === 'loading') {
    // The capture-phase listener runs before the ordinary DOMContentLoaded
    // listeners of other scripts, so the contract names always resolve to
    // this module's implementations.
    document.addEventListener('DOMContentLoaded', () => {
        installUploadGlobals();
        uploadInit();
    }, true);
} else {
    uploadInit();
}
