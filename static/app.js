document.addEventListener('DOMContentLoaded', () => {
    const fileInput = document.getElementById('fileInput');
    const translationArea = document.getElementById('translationArea');
    const translateBtn = document.getElementById('translatePageBtn');
    const translateAllBtn = document.getElementById('translateAllBtn');
    const statusMessage = document.getElementById('statusMessage');
    const sourceLanguage = document.getElementById('sourceLanguage');
    const targetLanguage = document.getElementById('targetLanguage');
    const copyOriginalBtn = document.getElementById('copyOriginalBtn');
    const copyTranslationBtn = document.getElementById('copyTranslationBtn');
    const copyTranslationBtnText = document.getElementById('copyTranslationBtnText');
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
    const filePreview = document.getElementById('filePreview');

    let pdfText = '';
    let pages = [];
    let currentPage = 1;
    let currentFileName = '';
    let translatedText = '';
    let currentMode = 'text';

    loadModels();
    switchMode('text');

    sourceLanguage.addEventListener('change', updateRTLState);
    targetLanguage.addEventListener('change', updateRTLState);

    textInput.addEventListener('input', () => {
        if (textInput.value.trim()) {
            translationAreaText.innerHTML = '<div class="empty-state centered"><strong>Ready to translate</strong><span>Click "Translate" to translate your text.</span></div>';
        }
    });

    textModeBtn.addEventListener('click', () => switchMode('text'));
    attachmentModeBtn.addEventListener('click', () => switchMode('attachment'));

    function switchMode(mode) {
        currentMode = mode;
        textModeBtn.classList.toggle('active', mode === 'text');
        attachmentModeBtn.classList.toggle('active', mode === 'attachment');
        textModePanel.classList.toggle('hidden', mode !== 'text');
        attachmentPanel.classList.toggle('hidden', mode !== 'attachment');
        updateRTLState();
    }

    fileInput.addEventListener('change', (event) => {
        const file = event.target.files[0];
        if (file) uploadAndTranslateFile(file);
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
        if (file) uploadAndTranslateFile(file);
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

    copyTranslationBtnText.addEventListener('click', async () => {
        const text = translationAreaText.textContent || '';
        if (!text.trim()) {
            showStatus('No translated text to copy.', 'error');
            return;
        }
        await copyToClipboard(text);
        showStatus('Translation copied.', 'success');
    });

    translateTextBtn.addEventListener('click', translateTextMode);

    async function uploadAndTranslateFile(file) {
        const allowedTypes = ['.pdf', '.docx', '.txt'];
        const ext = '.' + file.name.split('.').pop().toLowerCase();
        
        if (!allowedTypes.includes(ext)) {
            showStatus('Please choose a valid file (PDF, DOCX, or TXT).', 'error');
            return;
        }

        const formData = new FormData();
        formData.append('file', file);

        showStatus('Processing file...', '');

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
            pdfText = data.text;
            pages = parsePages(pdfText);
            currentPage = 1;
            translatedText = '';

            renderFilePreview();
            translationArea.innerHTML = '<div class="empty-state centered"><strong>Ready to translate</strong><span>Click "Translate page" or "Translate all".</span></div>';

            showStatus(`File processed. ${pages.length} page(s) found.`, 'success');
        } catch (error) {
            console.error(error);
            if (error.name === 'AbortError') {
                showStatus('Processing timed out. Try a smaller file.', 'error');
            } else {
                showStatus('Upload failed. Check the browser console.', 'error');
            }
        }
    }

    function renderFilePreview() {
        const fileType = currentFileName.split('.').pop().toLowerCase();
        
        if (fileType === 'pdf') {
            filePreview.innerHTML = '<iframe id="pdfFrame" title="PDF Preview" src="/uploads/' + encodeURIComponent(currentFileName) + '"></iframe>';
        } else {
            const icon = fileType === 'docx' ? '📘' : fileType === 'txt' ? '📄' : '📎';
            filePreview.innerHTML = `
                <div class="empty-state centered">
                    <strong>${icon} ${currentFileName}</strong>
                    <span>${pages.length} page(s) • Click translate to process</span>
                </div>
            `;
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
                    text: text,
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
        if (!pdfText.trim()) {
            showStatus('Upload a file before translating.', 'error');
            return;
        }

        const pageText = pages[currentPage - 1] || '';
        if (!pageText.trim()) {
            showStatus(`Page ${currentPage} has no extractable text.`, 'error');
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
            showStatus('Upload a file before translating.', 'error');
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

            if (data.success && data.models.length) {
                const gemmaModel = data.models.find((model) => model.toLowerCase().includes('gemma4')) || data.models[0];
                modelBadge.textContent = gemmaModel;
            }
        } catch (error) {
            console.error(error);
        }
    }

    function updateRTLState() {
        const isRTL = targetLanguage.value === 'Persian';
        
        translationArea.classList.toggle('rtl', isRTL);
        translationAreaText.classList.toggle('rtl', isRTL);
    }

    function updatePageButtons() {
        prevPageBtn.disabled = !pages.length || currentPage <= 1;
        nextPageBtn.disabled = !pages.length || currentPage >= pages.length;
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
