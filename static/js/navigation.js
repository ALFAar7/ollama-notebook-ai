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
        // Re-cache elements when entering attachment mode since they're loaded dynamically
        if (mode === 'attachment') {
            cacheAttachmentElements();
        }
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
    updatePDFViewerPage();
    if (App.currentFileName) {
        loadCurrentPageText().catch(() => {});
    }
    App.els.translationArea.innerHTML = `<div class="empty-state centered"><strong>Page ${App.currentPage}</strong><span>Translate this page when ready.</span></div>`;
    App.translatedText = '';
}

function cacheAttachmentElements() {
    // Remove existing event listeners to prevent duplicates
    if (App.els.pageNumberInput) {
        const newPageNumberInput = App.els.pageNumberInput.cloneNode(true);
        App.els.pageNumberInput.replaceWith(newPageNumberInput);
        App.els.pageNumberInput = newPageNumberInput;
    }
    if (App.els.prevPageBtn) {
        const newPrevPageBtn = App.els.prevPageBtn.cloneNode(true);
        App.els.prevPageBtn.replaceWith(newPrevPageBtn);
        App.els.prevPageBtn = newPrevPageBtn;
    }
    if (App.els.nextPageBtn) {
        const newNextPageBtn = App.els.nextPageBtn.cloneNode(true);
        App.els.nextPageBtn.replaceWith(newNextPageBtn);
        App.els.nextPageBtn = newNextPageBtn;
    }
    if (App.els.copyOriginalBtn) {
        const newCopyOriginalBtn = App.els.copyOriginalBtn.cloneNode(true);
        App.els.copyOriginalBtn.replaceWith(newCopyOriginalBtn);
        App.els.copyOriginalBtn = newCopyOriginalBtn;
    }

    // Cache elements that are loaded dynamically in attachment mode
    App.els.pageNumberInput = document.getElementById('pageNumber');
    App.els.prevPageBtn = document.getElementById('prevPageBtn');
    App.els.nextPageBtn = document.getElementById('nextPageBtn');
    App.els.translatePageBtn = document.getElementById('translatePageBtn');
    App.els.translateAllBtn = document.getElementById('translateAllBtn');
    App.els.copyOriginalBtn = document.getElementById('copyOriginalBtn');
    App.els.attachmentPreview = document.getElementById('attachmentPreview');
    App.els.translationArea = document.getElementById('translationArea');

    // Reattach event listeners for navigation elements
    if (App.els.pageNumberInput) {
        App.els.pageNumberInput.addEventListener('blur', () => {
            goToPage(Number(App.els.pageNumberInput.value));
        });
        App.els.pageNumberInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                goToPage(Number(App.els.pageNumberInput.value));
                e.preventDefault(); // Prevent form submission
            }
        });
    }
    if (App.els.prevPageBtn) {
        App.els.prevPageBtn.addEventListener('click', (e) => {
            e.preventDefault();
            goToPage(App.currentPage - 1);
        });
    }
    if (App.els.nextPageBtn) {
        App.els.nextPageBtn.addEventListener('click', (e) => {
            e.preventDefault();
            goToPage(App.currentPage + 1);
        });
    }
    if (App.els.copyOriginalBtn) {
        App.els.copyOriginalBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            const pageText = App.pages[App.currentPage - 1] || '';
            if (!pageText.trim()) {
                showStatus('No extracted text to copy.', 'error');
                return;
            }
            await copyToClipboard(pageText);
            showStatus('Current page text copied.', 'success');
        });
    }
}

function updatePageButtons() {
    if (App.els.prevPageBtn) {
        App.els.prevPageBtn.disabled = !App.pages.length || App.currentPage <= 1;
    }
    if (App.els.nextPageBtn) {
        App.els.nextPageBtn.disabled = !App.pages.length || App.currentPage >= App.pages.length;
    }
}
