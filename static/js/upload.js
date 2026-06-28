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

        App.currentFileName = data.filename;
        App.pdfText = data.text || '';
        App.pages = Array(Math.max(data.page_count || 1, 1)).fill('');
        if (App.pdfText.trim()) {
            App.pages = parsePages(App.pdfText);
        }
        App.currentPage = 1;
        App.translatedText = '';

        renderFilePreview();
        updatePageButtons();
        updateSourceMeta();
        if (App.els.pageNumberInput) {
            App.els.pageNumberInput.value = App.currentPage;
        }
        if (data.processing) {
            App.els.translationArea.innerHTML = '<div class="empty-state centered"><strong>Preparing document</strong><span>This large PDF is being processed in the background. The preview will update shortly.</span></div>';
            showStatus('Document upload accepted. Processing in progress...', '');
            startProcessingPolling(data.filename);
        } else {
            App.els.translationArea.innerHTML = '<div class="empty-state centered"><strong>Source ready</strong><span>Translate the current page or the full document when you are ready.</span></div>';
            showStatus(`File processed. ${App.pages.length} page(s) ready.`, 'success');
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
    if (App.processingTimer) {
        clearInterval(App.processingTimer);
    }
    App.processingTimer = setInterval(async () => {
        try {
            const response = await fetch(`/api/document-status?filename=${encodeURIComponent(filename)}`);
            const data = await response.json();
            if (!response.ok || !data.success) {
                return;
            }
            if (data.ready) {
                clearInterval(App.processingTimer);
                App.processingTimer = null;
                App.pages = Array(Math.max(data.page_count || 1, 1)).fill('');
                App.currentPage = 1;
                updateSourceMeta();
                renderFilePreview();
                loadCurrentPageText().catch(() => {});
                App.els.translationArea.innerHTML = '<div class="empty-state centered"><strong>Source ready</strong><span>Translate the current page or the full document when you are ready.</span></div>';
                showStatus(`Document ready. ${data.page_count || 0} page(s) available.`, 'success');
            }
        } catch (error) {
            console.error(error);
        }
    }, 2000);
}

async function loadCurrentPageText() {
    if (!App.currentFileName) {
        return;
    }

    try {
        const response = await fetch(`/api/page-text?filename=${encodeURIComponent(App.currentFileName)}&page=${App.currentPage}`);
        const data = await response.json();
        if (!response.ok || !data.success) {
            return;
        }
        const pageText = data.page_text || '';
        App.pages[App.currentPage - 1] = pageText;
        renderFilePreview();
    } catch (error) {
        console.error(error);
    }
}
