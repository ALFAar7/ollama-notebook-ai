function switchMode(mode) {
    App.currentMode = mode;
    if (App.els.textModeBtn) {
        App.els.textModeBtn.classList.toggle('active', mode === 'text');
        App.els.textModeBtn.setAttribute('aria-pressed', mode === 'text');
    }
    if (App.els.attachmentModeBtn) {
        App.els.attachmentModeBtn.classList.toggle('active', mode === 'attachment');
        App.els.attachmentModeBtn.setAttribute('aria-pressed', mode === 'attachment');
    }
    if (App.els.historyModeBtn) {
        App.els.historyModeBtn.classList.toggle('active', mode === 'history');
        App.els.historyModeBtn.setAttribute('aria-pressed', mode === 'history');
    }
    if (App.els.textModePanel) {
        App.els.textModePanel.classList.toggle('hidden', mode !== 'text');
    }
    if (App.els.attachmentPanel) {
        App.els.attachmentPanel.classList.toggle('hidden', mode !== 'attachment');
    }
    if (App.els.historyPanel) {
        App.els.historyPanel.classList.toggle('hidden', mode !== 'history');
        // Load history when switching to history mode
        if (mode === 'history' && typeof History !== 'undefined') {
            History.loadHistory();
            History.loadStats();
        }
    }
    const textOutput = document.querySelector('.text-mode-output');
    if (textOutput) {
        textOutput.classList.toggle('hidden', mode === 'attachment' || mode === 'history');
    }
    updateRTLState();
}

function goToPage(pageNumber) {
    if (!App.pages.length) {
        return;
    }

    const targetPage = Math.min(Math.max(1, Number(pageNumber) || 1), App.pages.length);
    App.currentPage = targetPage;
    if (App.els.pageNumberInput) {
        App.els.pageNumberInput.value = App.currentPage;
    }
    updatePageButtons();
    renderFilePreview();
    if (App.currentFileName) {
        loadCurrentPageText().catch(() => {});
    }
    App.els.translationArea.innerHTML = `<div class="empty-state centered"><strong>Page ${App.currentPage}</strong><span>Translate this page when ready.</span></div>`;
    App.translatedText = '';
}

function updatePageButtons() {
    if (App.els.prevPageBtn) {
        App.els.prevPageBtn.disabled = !App.pages.length || App.currentPage <= 1;
    }
    if (App.els.nextPageBtn) {
        App.els.nextPageBtn.disabled = !App.pages.length || App.currentPage >= App.pages.length;
    }
}
