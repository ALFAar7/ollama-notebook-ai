document.addEventListener('DOMContentLoaded', () => {
    const fileInput = document.getElementById('fileInput');
    const translationArea = document.getElementById('translationArea');
    const translateBtn = document.getElementById('translatePageBtn');
    const translateAllBtn = document.getElementById('translateAllBtn');
    const statusMessage = document.getElementById('statusMessage');
    const sourceLanguage = document.getElementById('sourceLanguage');
    const targetLanguage = document.getElementById('targetLanguage');
    const copyOriginalBtn = document.getElementById('copyOriginalBtn');
    const copyTranslationBtnAttachment = document.getElementById('copyTranslationBtnAttachment');
    const copyTranslationBtnText = document.getElementById('copyTranslationBtnText');
    const copySourceBtn = document.getElementById('copySourceBtn');
    const clearTextBtn = document.getElementById('clearTextBtn');
    const saveNoteBtn = document.getElementById('saveNoteBtn');
    const modelBadge = document.getElementById('modelBadge');
    const pageNumberInput = document.getElementById('pageNumber');
    const prevPageBtn = document.getElementById('prevPageBtn');
    const nextPageBtn = document.getElementById('nextPageBtn');
    const textModeBtn = document.getElementById('textModeBtn');
    const attachmentModeBtn = document.getElementById('attachmentModeBtn');
    const textModePanel = document.getElementById('textModePanel');
    const attachmentPanel = document.getElementById('attachmentPanel');
    const textInput = document.getElementById('textInput');
    const translateTextBtn = document.getElementById('translateTextBtn');
    const translationAreaText = document.getElementById('translationAreaText');
    const filePreviewSidebar = document.getElementById('filePreviewSidebar');
    const attachmentPreview = document.getElementById('attachmentPreview');
    const sourceFileName = document.getElementById('sourceFileName');
    const sourcePageCount = document.getElementById('sourcePageCount');
    const sourceStatus = document.getElementById('sourceStatus');
    const noteInput = document.getElementById('noteInput');
    const notesSummary = document.getElementById('notesSummary');

    let pdfText = '';
    let pages = [];
    let currentPage = 1;
    let currentFileName = '';
    let translatedText = '';
    let currentMode = 'text';
    let processingTimer = null;

    loadModels();
    restoreNote();
    switchMode('text');
    updateSourceMeta();

    sourceLanguage.addEventListener('change', updateRTLState);
    targetLanguage.addEventListener('change', updateRTLState);

    textInput.addEventListener('input', () => {
        if (textInput.value.trim()) {
            translationAreaText.innerHTML = '<div class="empty-state centered"><strong>Ready to translate</strong><span>Click translate to turn this notebook entry into a polished translation.</span></div>';
        }
    });

    textModeBtn.addEventListener('click', () => switchMode('text'));
    attachmentModeBtn.addEventListener('click', () => switchMode('attachment'));

    if (fileInput) {
        fileInput.addEventListener('change', (event) => {
            const file = event.target.files[0];
            if (file) uploadAndTranslateFile(file);
        });
    }

    const uploadCard = document.querySelector('.upload-card');
    if (uploadCard) {
        uploadCard.addEventListener('dragover', (event) => {
            event.preventDefault();
            uploadCard.classList.add('dragging');
        });

        uploadCard.addEventListener('dragleave', () => {
            uploadCard.classList.remove('dragging');
        });

        uploadCard.addEventListener('drop', (event) => {
            event.preventDefault();
            uploadCard.classList.remove('dragging');
            const file = event.dataTransfer.files[0];
            if (file) uploadAndTranslateFile(file);
        });
    }

    if (translateBtn) {
        translateBtn.addEventListener('click', translateCurrentPage);
    }
    if (translateAllBtn) {
        translateAllBtn.addEventListener('click', translateAllPages);
    }
    if (pageNumberInput) {
        pageNumberInput.addEventListener('change', () => {
            goToPage(Number(pageNumberInput.value));
        });
    }
    if (prevPageBtn) {
        prevPageBtn.addEventListener('click', () => goToPage(currentPage - 1));
    }
    if (nextPageBtn) {
        nextPageBtn.addEventListener('click', () => goToPage(currentPage + 1));
    }

    if (copyOriginalBtn) {
        copyOriginalBtn.addEventListener('click', async () => {
            const pageText = pages[currentPage - 1] || '';
            if (!pageText.trim()) {
                showStatus('No extracted text to copy.', 'error');
                return;
            }
            await copyToClipboard(pageText);
            showStatus('Current page text copied.', 'success');
        });
    }

    if (copyTranslationBtnText) {
        copyTranslationBtnText.addEventListener('click', async () => {
            const text = translationAreaText.textContent || '';
            if (!text.trim()) {
                showStatus('No translated text to copy.', 'error');
                return;
            }
            await copyToClipboard(text);
            showStatus('Translation copied.', 'success');
        });
    }

    if (copyTranslationBtnAttachment) {
        copyTranslationBtnAttachment.addEventListener('click', async () => {
            const text = translationArea.textContent || '';
            if (!text.trim()) {
                showStatus('No translated text to copy.', 'error');
                return;
            }
            await copyToClipboard(text);
            showStatus('Translation copied.', 'success');
        });
    }

    if (copySourceBtn) {
        copySourceBtn.addEventListener('click', async () => {
            const text = textInput.value || '';
            if (!text.trim()) {
                showStatus('Nothing to copy yet.', 'error');
                return;
            }
            await copyToClipboard(text);
            showStatus('Source copied.', 'success');
        });
    }

    if (clearTextBtn) {
        clearTextBtn.addEventListener('click', () => {
            textInput.value = '';
            translationAreaText.innerHTML = '<div class="empty-state centered"><strong>Clear workspace</strong><span>Start a fresh notebook entry whenever you want.</span></div>';
            showStatus('Notebook cleared.', 'success');
        });
    }

    if (saveNoteBtn) {
        saveNoteBtn.addEventListener('click', () => {
            localStorage.setItem('notebook-note', noteInput.value || '');
            showStatus('Note saved locally.', 'success');
        });
    }

    if (translateTextBtn) {
        translateTextBtn.addEventListener('click', translateTextMode);
    }

    function switchMode(mode) {
        currentMode = mode;
        textModeBtn.classList.toggle('active', mode === 'text');
        attachmentModeBtn.classList.toggle('active', mode === 'attachment');
        textModePanel.classList.toggle('hidden', mode !== 'text');
        attachmentPanel.classList.toggle('hidden', mode !== 'attachment');
        const textOutput = document.querySelector('.text-mode-output');
        if (textOutput) {
            textOutput.classList.toggle('hidden', mode === 'attachment');
        }
        updateRTLState();
    }

    async function uploadAndTranslateFile(file) {
        const allowedTypes = ['.pdf', '.docx', '.txt'];
        const ext = '.' + file.name.split('.').pop().toLowerCase();

        if (!allowedTypes.includes(ext)) {
            showStatus('Please choose a valid file (PDF, DOCX, or TXT).', 'error');
            return;
        }

        const formData = new FormData();
        formData.append('file', file);

        showStatus('Processing source...', '');

        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 600000);
            const response = await fetch('/api/upload', {
                method: 'POST',
                body: formData,
                signal: controller.signal
            });
            clearTimeout(timeoutId);

            const data = await response.json();

            if (!response.ok || !data.success) {
                showStatus(data.error || 'Upload failed.', 'error');
                return;
            }

            currentFileName = data.filename;
            pdfText = data.text || '';
            pages = Array(Math.max(data.page_count || 1, 1)).fill('');
            if (pdfText.trim()) {
                pages = parsePages(pdfText);
            }
            currentPage = 1;
            translatedText = '';

            renderFilePreview();
            updatePageButtons();
            updateSourceMeta();
            if (pageNumberInput) {
                pageNumberInput.value = currentPage;
            }
            if (data.processing) {
                translationArea.innerHTML = '<div class="empty-state centered"><strong>Preparing document</strong><span>This large PDF is being processed in the background. The preview will update shortly.</span></div>';
                showStatus('Document upload accepted. Processing in progress...', '');
                startProcessingPolling(data.filename);
            } else {
                translationArea.innerHTML = '<div class="empty-state centered"><strong>Source ready</strong><span>Translate the current page or the full document when you are ready.</span></div>';
                showStatus(`File processed. ${pages.length} page(s) ready.`, 'success');
            }
        } catch (error) {
            console.error(error);
            if (error.name === 'AbortError') {
                showStatus('Processing timed out. Try a smaller file.', 'error');
            } else {
                showStatus('Upload failed. Check the browser console.', 'error');
            }
        }
    }

    function startProcessingPolling(filename) {
        if (processingTimer) {
            clearInterval(processingTimer);
        }
        processingTimer = setInterval(async () => {
            try {
                const response = await fetch(`/api/document-status?filename=${encodeURIComponent(filename)}`);
                const data = await response.json();
                if (!response.ok || !data.success) {
                    return;
                }
                if (data.ready) {
                    clearInterval(processingTimer);
                    processingTimer = null;
                    pages = Array(Math.max(data.page_count || 1, 1)).fill('');
                    currentPage = 1;
                    updateSourceMeta();
                    renderFilePreview();
                    loadCurrentPageText().catch(() => {});
                    translationArea.innerHTML = '<div class="empty-state centered"><strong>Source ready</strong><span>Translate the current page or the full document when you are ready.</span></div>';
                    showStatus(`Document ready. ${data.page_count || 0} page(s) available.`, 'success');
                }
            } catch (error) {
                console.error(error);
            }
        }, 2000);
    }

    async function loadCurrentPageText() {
        if (!currentFileName) {
            return;
        }

        try {
            const response = await fetch(`/api/page-text?filename=${encodeURIComponent(currentFileName)}&page=${currentPage}`);
            const data = await response.json();
            if (!response.ok || !data.success) {
                return;
            }
            const pageText = data.page_text || '';
            pages[currentPage - 1] = pageText;
            pdfText = pageText;
            renderFilePreview();
        } catch (error) {
            console.error(error);
        }
    }

    function renderFilePreview() {
        const fileType = currentFileName.split('.').pop().toLowerCase();
        const currentPageText = (pages[currentPage - 1] || '').trim();
        const sidebarMarkup = currentFileName
            ? `
                <div class="empty-state centered">
                    <strong>${fileType === 'docx' ? '📘' : fileType === 'txt' ? '📄' : fileType === 'pdf' ? '📕' : '📎'} ${currentFileName}</strong>
                    <span>${pages.length} page(s) • Ready for translation</span>
                </div>
            `
            : `
                <div class="empty-state centered">
                    <strong>Start with a source</strong>
                    <span>Upload a PDF, DOCX, or TXT file to preview it here.</span>
                </div>
            `;
        const mainMarkup = currentFileName
            ? fileType === 'pdf'
                ? `<iframe class="source-iframe" title="PDF Preview" src="/uploads/${encodeURIComponent(currentFileName)}"></iframe>`
                : currentPageText
                    ? `
                        <div class="preview-content">
                            <div class="preview-caption">Page ${currentPage} of ${pages.length}</div>
                            <div class="preview-text">${escapeHtml(currentPageText)}</div>
                        </div>
                    `
                    : `
                        <div class="empty-state centered">
                            <strong>${fileType === 'docx' ? '📘' : fileType === 'txt' ? '📄' : '📎'} ${currentFileName}</strong>
                            <span>This page has no extractable text yet.</span>
                        </div>
                    `
            : `
                <div class="empty-state centered">
                    <strong>Upload a source file</strong>
                    <span>Once a document is uploaded, its pages appear here.</span>
                </div>
            `;

        if (filePreviewSidebar) {
            filePreviewSidebar.innerHTML = sidebarMarkup;
        }
        if (attachmentPreview) {
            attachmentPreview.innerHTML = mainMarkup;
        }
    }

    async function translateTextMode() {
        const text = textInput.value.trim();
        if (!text) {
            showStatus('Please enter some text to translate.', 'error');
            return;
        }

        translateTextBtn.disabled = true;
        translateTextBtn.textContent = 'Translating...';
        translationAreaText.innerHTML = '<div class="empty-state centered"><strong>Translating...</strong><span>This may take a moment.</span></div>';

        try {
            const response = await fetch('/api/translate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    text,
                    source_language: sourceLanguage.value,
                    target_language: targetLanguage.value
                })
            });

            const data = await response.json();

            if (!response.ok || !data.success) {
                translationAreaText.innerHTML = `<div class="empty-state centered"><strong>Translation failed</strong><span>${escapeHtml(data.error || 'Unknown error')}</span></div>`;
                showStatus(data.error || 'Translation failed.', 'error');
                return;
            }

            translatedText = data.translated_text;
            translationAreaText.innerHTML = formatText(translatedText);
            updateSummary(translatedText, text);
            updateRTLState();
            showStatus('Text translated successfully.', 'success');
        } catch (error) {
            console.error(error);
            translationAreaText.innerHTML = '<div class="empty-state centered"><strong>Translation failed</strong><span>Could not connect to the translation server.</span></div>';
            showStatus('Translation request failed.', 'error');
        } finally {
            translateTextBtn.disabled = false;
            translateTextBtn.textContent = 'Translate';
        }
    }

    async function translateCurrentPage() {
        let pageText = pages[currentPage - 1] || '';
        if (!pageText.trim() && currentFileName) {
            try {
                const response = await fetch(`/api/page-text?filename=${encodeURIComponent(currentFileName)}&page=${currentPage}`);
                const data = await response.json();
                if (response.ok && data.success) {
                    pageText = data.page_text || '';
                    pages[currentPage - 1] = pageText;
                }
            } catch (error) {
                console.error(error);
            }
        }

        if (!pageText.trim()) {
            showStatus('Upload a source file before translating.', 'error');
            return;
        }

        translateBtn.disabled = true;
        translateBtn.textContent = 'Translating...';
        translationArea.innerHTML = '<div class="empty-state centered"><strong>Translating page...</strong><span>This should be fast.</span></div>';

        try {
            const response = await fetch('/api/translate-page', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    page_text: pageText,
                    page_number: currentPage,
                    filename: currentFileName,
                    source_language: sourceLanguage.value,
                    target_language: targetLanguage.value
                })
            });

            const data = await response.json();

            if (!response.ok || !data.success) {
                translationArea.innerHTML = `<div class="empty-state centered"><strong>Translation failed</strong><span>${escapeHtml(data.error || 'Unknown error')}</span></div>`;
                showStatus(data.error || 'Translation failed.', 'error');
                return;
            }

            translatedText = data.translated_text;
            translationArea.innerHTML = formatText(translatedText);
            updateSummary(translatedText, pageText);
            updateRTLState();
            showStatus(`Page ${currentPage} translated.`, 'success');
        } catch (error) {
            console.error(error);
            translationArea.innerHTML = '<div class="empty-state centered"><strong>Translation failed</strong><span>Could not connect to the translation server.</span></div>';
            showStatus('Translation request failed.', 'error');
        } finally {
            translateBtn.disabled = false;
            translateBtn.textContent = 'Translate page';
        }
    }

    async function translateAllPages() {
        if (!pdfText.trim()) {
            showStatus('Upload a source file before translating.', 'error');
            return;
        }

        translateAllBtn.disabled = true;
        translateAllBtn.textContent = 'Translating...';
        translationArea.innerHTML = '<div class="empty-state centered"><strong>Translating all...</strong><span>This may take a while.</span></div>';

        try {
            const response = await fetch('/api/translate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    text: pdfText,
                    filename: currentFileName,
                    source_language: sourceLanguage.value,
                    target_language: targetLanguage.value
                })
            });

            const data = await response.json();

            if (!response.ok || !data.success) {
                translationArea.innerHTML = `<div class="empty-state centered"><strong>Translation failed</strong><span>${escapeHtml(data.error || 'Unknown error')}</span></div>`;
                showStatus(data.error || 'Translation failed.', 'error');
                return;
            }

            translatedText = data.translated_text;
            translationArea.innerHTML = formatText(translatedText);
            updateSummary(translatedText, pdfText);
            updateRTLState();
            showStatus('Full file translated.', 'success');
        } catch (error) {
            console.error(error);
            translationArea.innerHTML = '<div class="empty-state centered"><strong>Translation failed</strong><span>Could not connect to the translation server.</span></div>';
            showStatus('Translation request failed.', 'error');
        } finally {
            translateAllBtn.disabled = false;
            translateAllBtn.textContent = 'Translate all';
        }
    }

    async function loadModels() {
        try {
            const response = await fetch('/api/models');
            const data = await response.json();
            if (data.success && data.models.length && modelBadge) {
                const gemmaModel = data.models.find((model) => model.toLowerCase().includes('gemma4')) || data.models[0];
                modelBadge.textContent = gemmaModel;
            }
        } catch (error) {
            console.error(error);
        }
    }

    function updateRTLState() {
        const isRTL = targetLanguage.value === 'Persian';
        if (translationArea) {
            translationArea.classList.toggle('rtl', isRTL);
        }
        if (translationAreaText) {
            translationAreaText.classList.toggle('rtl', isRTL);
        }
    }

    function updateSummary(translatedTextValue, sourceTextValue) {
        if (!notesSummary) {
            return;
        }

        const cleanText = (translatedTextValue || '').replace(/<[^>]+>/g, '').trim();
        const preview = cleanText.length > 220 ? `${cleanText.slice(0, 220)}…` : cleanText;
        const sourcePreview = (sourceTextValue || '').replace(/\s+/g, ' ').trim().slice(0, 140);

        notesSummary.innerHTML = `
            <strong>Current page summary</strong>
            <div>${preview || 'No translation available yet.'}</div>
            <div class="summary-source">Source: ${escapeHtml(sourcePreview || 'No source text available')}</div>
        `;
    }

    function goToPage(pageNumber) {
        if (!pages.length) {
            return;
        }

        const targetPage = Math.min(Math.max(1, Number(pageNumber) || 1), pages.length);
        currentPage = targetPage;
        if (pageNumberInput) {
            pageNumberInput.value = currentPage;
        }
        updatePageButtons();
        renderFilePreview();
        if (currentFileName) {
            loadCurrentPageText().catch(() => {});
        }
        translationArea.innerHTML = `<div class="empty-state centered"><strong>Page ${currentPage}</strong><span>Translate this page when ready.</span></div>`;
        translatedText = '';
    }

    function updatePageButtons() {
        if (prevPageBtn) {
            prevPageBtn.disabled = !pages.length || currentPage <= 1;
        }
        if (nextPageBtn) {
            nextPageBtn.disabled = !pages.length || currentPage >= pages.length;
        }
    }

    function updateSourceMeta() {
        if (sourceFileName) {
            sourceFileName.textContent = currentFileName || 'No file';
        }
        if (sourcePageCount) {
            sourcePageCount.textContent = pages.length ? `Pages: ${pages.length}` : 'Pages: —';
        }
        if (sourceStatus) {
            sourceStatus.textContent = currentFileName ? 'Source ready' : 'No source loaded';
        }
    }

    function restoreNote() {
        if (noteInput) {
            noteInput.value = localStorage.getItem('notebook-note') || '';
        }
    }

    function showStatus(message, type) {
        statusMessage.textContent = message;
        statusMessage.className = `status-message ${type || ''}`;
        statusMessage.classList.remove('hidden');
        clearTimeout(showStatus.timer);
        showStatus.timer = setTimeout(() => {
            statusMessage.classList.add('hidden');
        }, 6000);
    }

    function parsePages(text) {
        const pageRegex = /--- Page (\d+) ---\s*([\s\S]*?)(?=\n\n--- Page \d+ ---\n\n|$)/g;
        const parsed = [];
        let match;

        while ((match = pageRegex.exec(text)) !== null) {
            const pageNumber = Number(match[1]);
            parsed[pageNumber - 1] = match[2].trim();
        }

        if (!parsed.length && text.trim()) {
            parsed.push(text.trim());
        }

        return parsed;
    }

    function formatText(text) {
        return text
            .split('\n\n')
            .filter((paragraph) => paragraph.trim())
            .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`)
            .join('');
    }

    function escapeHtml(value) {
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    async function copyToClipboard(text) {
        if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(text);
            return;
        }

        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        textarea.remove();
    }
});

