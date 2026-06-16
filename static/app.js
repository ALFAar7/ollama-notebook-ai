document.addEventListener('DOMContentLoaded', () => {
    const pdfInput = document.getElementById('pdfInput');
    const pdfFrame = document.getElementById('pdfFrame');
    const pdfMeta = document.getElementById('pdfMeta');
    const pageMeta = document.getElementById('pageMeta');
    const originalText = document.getElementById('originalText');
    const translationArea = document.getElementById('translationArea');
    const translationMeta = document.getElementById('translationMeta');
    const translateBtn = document.getElementById('translateBtn');
    const translateAllBtn = document.getElementById('translateAllBtn');
    const fileList = document.getElementById('fileList');
    const fileCount = document.getElementById('fileCount');
    const statusMessage = document.getElementById('statusMessage');
    const sourceLanguage = document.getElementById('sourceLanguage');
    const targetLanguage = document.getElementById('targetLanguage');
    const copyOriginalBtn = document.getElementById('copyOriginalBtn');
    const copyTranslationBtn = document.getElementById('copyTranslationBtn');
    const modelBadge = document.getElementById('modelBadge');
    const pageNumberInput = document.getElementById('pageNumber');
    const prevPageBtn = document.getElementById('prevPageBtn');
    const nextPageBtn = document.getElementById('nextPageBtn');

    let pdfText = '';
    let pages = [];
    let currentPage = 1;
    let currentFileName = '';
    let currentFileUrl = '';
    let translatedText = '';

    loadFiles();
    loadModels();

    pdfInput.addEventListener('change', (event) => {
        const file = event.target.files[0];
        if (file) uploadPdf(file);
    });

    document.querySelector('.upload-box').addEventListener('dragover', (event) => {
        event.preventDefault();
        document.querySelector('.upload-box').classList.add('dragging');
    });

    document.querySelector('.upload-box').addEventListener('dragleave', () => {
        document.querySelector('.upload-box').classList.remove('dragging');
    });

    document.querySelector('.upload-box').addEventListener('drop', (event) => {
        event.preventDefault();
        document.querySelector('.upload-box').classList.remove('dragging');
        const file = event.dataTransfer.files[0];
        if (file) uploadPdf(file);
    });

    translateBtn.addEventListener('click', translateCurrentPage);
    translateAllBtn.addEventListener('click', translateAllPages);

    pageNumberInput.addEventListener('change', () => {
        goToPage(Number(pageNumberInput.value));
    });

    prevPageBtn.addEventListener('click', () => {
        goToPage(currentPage - 1);
    });

    nextPageBtn.addEventListener('click', () => {
        goToPage(currentPage + 1);
    });

    copyOriginalBtn.addEventListener('click', async () => {
        const pageText = pages[currentPage - 1] || '';
        if (!pageText.trim()) {
            showStatus('No extracted text to copy.', 'error');
            return;
        }
        await copyToClipboard(pageText);
        showStatus('Current page text copied.', 'success');
    });

    copyTranslationBtn.addEventListener('click', async () => {
        if (!translatedText) {
            showStatus('No translated text to copy.', 'error');
            return;
        }
        await copyToClipboard(translatedText);
        showStatus('Translated page copied.', 'success');
    });

    async function uploadPdf(file) {
        if (!file.name.toLowerCase().endsWith('.pdf')) {
            showStatus('Please choose a PDF file.', 'error');
            return;
        }

        const formData = new FormData();
        formData.append('file', file);

        showStatus('Uploading and extracting text...', '');

        try {
            const response = await fetch('/api/upload', {
                method: 'POST',
                body: formData
            });
            const data = await response.json();

            if (!response.ok || !data.success) {
                showStatus(data.error || 'Upload failed.', 'error');
                return;
            }

            currentFileName = data.filename;
            pdfText = data.text;
            pages = parsePages(pdfText);
            currentPage = 1;
            currentFileUrl = URL.createObjectURL(file);
            translatedText = '';

            pdfMeta.textContent = `${file.name} • ${formatBytes(file.size)}`;
            renderCurrentPage();
            resetTranslation();

            await loadFiles();
            setActiveFile(currentFileName);
            showStatus(`PDF uploaded. ${pages.length} pages detected.`, 'success');
        } catch (error) {
            console.error(error);
            showStatus('Upload failed. Check the browser console for details.', 'error');
        }
    }

    async function translateCurrentPage() {
        if (!pdfText.trim()) {
            showStatus('Upload a PDF before translating.', 'error');
            return;
        }

        const pageText = pages[currentPage - 1] || '';
        if (!pageText.trim()) {
            showStatus(`Page ${currentPage} has no extractable text.`, 'error');
            return;
        }

        translateBtn.disabled = true;
        translateBtn.textContent = 'Translating page...';
        translationArea.innerHTML = '<div class="empty-state centered"><strong>Translating page ' + currentPage + '</strong><span>This should be much faster than translating the full PDF.</span></div>';
        translationMeta.textContent = `Translating page ${currentPage}`;

        try {
            const response = await fetch('/api/translate-page', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    page_text: pageText,
                    page_number: currentPage,
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
            translationMeta.textContent = `Translated page ${currentPage} to ${targetLanguage.value}`;
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
            showStatus('Upload a PDF before translating.', 'error');
            return;
        }

        translateAllBtn.disabled = true;
        translateAllBtn.textContent = 'Translating all...';
        translationArea.innerHTML = '<div class="empty-state centered"><strong>Translating all pages</strong><span>This may take a long time.</span></div>';
        translationMeta.textContent = 'Translating all pages';

        try {
            const response = await fetch('/api/translate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    text: pdfText,
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
            translationMeta.textContent = `Translated full PDF to ${targetLanguage.value}`;
            showStatus('Full PDF translation completed.', 'success');
        } catch (error) {
            console.error(error);
            translationArea.innerHTML = '<div class="empty-state centered"><strong>Translation failed</strong><span>Could not connect to the translation server.</span></div>';
            showStatus('Translation request failed.', 'error');
        } finally {
            translateAllBtn.disabled = false;
            translateAllBtn.textContent = 'Translate all';
        }
    }

    async function loadFiles() {
        try {
            const response = await fetch('/api/files');
            const data = await response.json();

            if (!response.ok || !data.success) {
                fileList.innerHTML = '<p class="empty-state">Could not load uploaded files.</p>';
                return;
            }

            const files = data.files;
            fileCount.textContent = `${files.length} ${files.length === 1 ? 'file' : 'files'}`;

            if (!files.length) {
                fileList.innerHTML = '<p class="empty-state">No PDFs uploaded yet.</p>';
                return;
            }

            fileList.innerHTML = files.map((file) => `
                <button class="file-item ${file.name === currentFileName ? 'active' : ''}" data-name="${escapeHtml(file.name)}" type="button">
                    <span class="file-name">${escapeHtml(file.name)}</span>
                    <span class="file-size">${formatBytes(file.size)}</span>
                </button>
            `).join('');

            document.querySelectorAll('.file-item').forEach((button) => {
                button.addEventListener('click', () => loadUploadedFile(button.dataset.name));
            });
        } catch (error) {
            console.error(error);
            fileList.innerHTML = '<p class="empty-state">Could not load uploaded files.</p>';
        }
    }

    async function loadUploadedFile(filename) {
        showStatus('Loading file...', '');

        try {
            const response = await fetch(`/api/file/${encodeURIComponent(filename)}`);
            const data = await response.json();

            if (!response.ok || !data.success) {
                showStatus(data.error || 'Could not load file.', 'error');
                return;
            }

            currentFileName = data.filename;
            pdfText = data.text;
            pages = parsePages(pdfText);
            currentPage = 1;
            currentFileUrl = '';
            translatedText = '';

            pdfMeta.textContent = data.filename;
            renderCurrentPage();
            resetTranslation();

            await loadFiles();
            setActiveFile(filename);
            showStatus(`File loaded. ${pages.length} pages detected.`, 'success');
        } catch (error) {
            console.error(error);
            showStatus('Could not load file.', 'error');
        }
    }

    async function loadModels() {
        try {
            const response = await fetch('/api/models');
            const data = await response.json();

            if (data.success && data.models.length) {
                const gemmaModel = data.models.find((model) => model.toLowerCase().includes('gemma4')) || data.models[0];
                modelBadge.textContent = gemmaModel;
            }
        } catch (error) {
            console.error(error);
        }
    }

    function renderCurrentPage() {
        if (!pages.length) {
            pageNumberInput.value = 1;
            pageMeta.textContent = 'No pages detected';
            originalText.textContent = '';
            pdfFrame.removeAttribute('src');
            updatePageButtons();
            return;
        }

        currentPage = Math.max(1, Math.min(currentPage, pages.length));
        pageNumberInput.max = pages.length;
        pageNumberInput.value = currentPage;
        pageMeta.textContent = `Page ${currentPage} of ${pages.length}`;
        originalText.textContent = pages[currentPage - 1] || '';

        if (currentFileUrl) {
            pdfFrame.src = `${currentFileUrl}#page=${currentPage}`;
        } else if (currentFileName) {
            pdfFrame.src = `/uploads/${encodeURIComponent(currentFileName)}#page=${currentPage}`;
        }

        updatePageButtons();
    }

    function goToPage(pageNumber) {
        if (!pages.length) return;

        const nextPage = Math.max(1, Math.min(Number(pageNumber) || 1, pages.length));
        if (nextPage === currentPage) {
            renderCurrentPage();
            return;
        }

        currentPage = nextPage;
        translatedText = '';
        renderCurrentPage();
        resetTranslation();
    }

    function resetTranslation() {
        translatedText = '';
        translationArea.innerHTML = '<div class="empty-state centered"><strong>Ready to translate</strong><span>Use Translate page for fast page-by-page translation.</span></div>';
        translationMeta.textContent = 'Waiting for page translation';
    }

    function updatePageButtons() {
        prevPageBtn.disabled = !pages.length || currentPage <= 1;
        nextPageBtn.disabled = !pages.length || currentPage >= pages.length;
    }

    function setActiveFile(filename) {
        document.querySelectorAll('.file-item').forEach((button) => {
            button.classList.toggle('active', button.dataset.name === filename);
        });
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

    function formatBytes(bytes) {
        if (!bytes) return '0 B';
        const units = ['B', 'KB', 'MB', 'GB'];
        let size = bytes;
        let unitIndex = 0;

        while (size >= 1024 && unitIndex < units.length - 1) {
            size /= 1024;
            unitIndex += 1;
        }

        return `${size.toFixed(size >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
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
