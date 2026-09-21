async function translateTextMode() {
    const text = App.els.textInput.value.trim();
    if (!text) {
        showStatus('Please enter some text to translate.', 'error');
        return;
    }

    const textModeLoading = document.getElementById('textModeLoading');
    if (textModeLoading) textModeLoading.classList.remove('hidden');

    App.els.translateTextBtn.disabled = true;
    App.els.translateTextBtn.textContent = 'Translating...';
    App.els.translationAreaText.innerHTML = '<div class="empty-state centered"><strong>Translating...</strong><span>This may take a moment.</span></div>';

    const ragEnabled = App.els.ragToggleBtn && App.els.ragToggleBtn.getAttribute('aria-checked') === 'true';

    try {
        const response = await fetch(ragEnabled ? '/api/rag-translate' : '/api/translate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                text,
                source_language: App.els.sourceLanguage.value,
                target_language: App.els.targetLanguage.value,
                enable_rag: ragEnabled
            })
        });

        const data = await response.json();

        if (!response.ok || !data.success) {
            App.els.translationAreaText.innerHTML = `<div class="empty-state centered"><strong>Translation failed</strong><span>${escapeHtml(data.error || 'Unknown error')}</span></div>`;
            showStatus(data.error || 'Translation failed.', 'error');
            return;
        }

        App.translatedText = data.translated_text;
        App.els.translationAreaText.innerHTML = formatText(App.translatedText);
        updateSummary(App.translatedText, text);
        updateRTLState();
        showStatus('Text translated successfully.', 'success');
    } catch (error) {
        console.error(error);
        App.els.translationAreaText.innerHTML = '<div class="empty-state centered"><strong>Translation failed</strong><span>Could not connect to the translation server.</span></div>';
        showStatus('Translation request failed.', 'error');
    } finally {
        if (textModeLoading) textModeLoading.classList.add('hidden');
        App.els.translateTextBtn.disabled = false;
        App.els.translateTextBtn.textContent = 'Translate';
    }
}

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

async function translateCurrentPage() {
    let pageText = App.pages[App.currentPage - 1] || '';
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
        showStatus('Upload a source file before translating.', 'error');
        return;
    }

    // Check translation cache first
    const targetLanguage = App.els.targetLanguage.value;
    const cachedTranslation = await checkTranslationCache(App.currentFileName, App.currentPage, targetLanguage);

    if (cachedTranslation) {
        App.translatedText = cachedTranslation;
        App.els.translationArea.innerHTML = formatText(App.translatedText);
        updateSummary(App.translatedText, pageText);
        updateRTLState();
        showStatus(`Page ${App.currentPage} loaded from cache.`, 'success');
        return;
    }

    const attachmentLoading = document.getElementById('attachmentLoading');
    if (attachmentLoading) attachmentLoading.classList.remove('hidden');

    App.els.translatePageBtn.disabled = true;
    App.els.translatePageBtn.textContent = 'Translating...';
    App.els.translationArea.innerHTML = '<div class="empty-state centered"><strong>Translating page...</strong><span>This should be fast.</span></div>';

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
            App.els.translationArea.innerHTML = `<div class="empty-state centered"><strong>Translation failed</strong><span>${escapeHtml(data.error || 'Unknown error')}</span></div>`;
            showStatus(data.error || 'Translation failed.', 'error');
            return;
        }

        App.translatedText = data.translated_text;
        App.els.translationArea.innerHTML = formatText(App.translatedText);
        updateSummary(App.translatedText, pageText);
        updateRTLState();
        showStatus(`Page ${App.currentPage} translated.`, 'success');
    } catch (error) {
        console.error(error);
        App.els.translationArea.innerHTML = '<div class="empty-state centered"><strong>Translation failed</strong><span>Could not connect to the translation server.</span></div>';
        showStatus('Translation request failed.', 'error');
    } finally {
        if (attachmentLoading) attachmentLoading.classList.add('hidden');
        App.els.translatePageBtn.disabled = false;
        App.els.translatePageBtn.textContent = 'Translate page';
    }
}

async function translateAllPages() {
    if (!App.currentFileName) {
        showStatus('Upload a source file before translating.', 'error');
        return;
    }

    const attachmentLoading = document.getElementById('attachmentLoading');
    if (attachmentLoading) attachmentLoading.classList.remove('hidden');

    App.els.translateAllBtn.disabled = true;
    App.els.translateAllBtn.textContent = 'Translating...';
    App.els.translationArea.innerHTML = '<div class="empty-state centered"><strong>Translating all...</strong><span>This may take a while.</span></div>';

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
            App.els.translationArea.innerHTML = `<div class="empty-state centered"><strong>Translation failed</strong><span>${escapeHtml(data.error || 'Unknown error')}</span></div>`;
            showStatus(data.error || 'Translation failed.', 'error');
            return;
        }

        App.translatedText = data.translated_text;
        App.els.translationArea.innerHTML = formatText(App.translatedText);
        updateSummary(App.translatedText, App.pdfText);
        updateRTLState();
        showStatus('Full file translated.', 'success');
    } catch (error) {
        console.error(error);
        App.els.translationArea.innerHTML = '<div class="empty-state centered"><strong>Translation failed</strong><span>Could not connect to the translation server.</span></div>';
        showStatus('Translation request failed.', 'error');
    } finally {
        if (attachmentLoading) attachmentLoading.classList.add('hidden');
        App.els.translateAllBtn.disabled = false;
        App.els.translateAllBtn.textContent = 'Translate all';
    }
}
