const App = {
    pdfText: '',
    pages: [],
    currentPage: 1,
    currentFileName: '',
    translatedText: '',
    currentMode: 'text',
    processingTimer: null,
    els: {}
};

function cacheElements() {
    const ids = [
        'fileInput', 'translationArea', 'translationAreaText', 'translatePageBtn',
        'translateAllBtn', 'statusMessage', 'sourceLanguage', 'targetLanguage',
        'copyOriginalBtn', 'copyTranslationBtnAttachment', 'copyTranslationBtnText',
        'copySourceBtn', 'clearTextBtn', 'saveNoteBtn', 'modelBadge',
        'pageNumberInput', 'prevPageBtn', 'nextPageBtn', 'textModeBtn',
        'attachmentModeBtn', 'textModePanel', 'attachmentPanel', 'textInput',
        'translateTextBtn', 'filePreviewSidebar', 'attachmentPreview',
        'sourceFileName', 'sourcePageCount', 'sourceStatus', 'noteInput', 'notesSummary',
        'ollamaStatus', 'ollamaDot', 'ollamaLabel'
    ];
    ids.forEach(id => {
        App.els[id] = document.getElementById(id);
    });
    App.els.sidebar = document.querySelector('.sidebar');
}

document.addEventListener('DOMContentLoaded', () => {
    cacheElements();

    if (App.els.sourceLanguage) {
        App.els.sourceLanguage.addEventListener('change', updateRTLState);
    }
    if (App.els.targetLanguage) {
        App.els.targetLanguage.addEventListener('change', updateRTLState);
    }

    const sidebarToggle = document.getElementById('sidebarToggle');
    const closeSidebarBtn = document.getElementById('closeSidebarBtn');
    if (sidebarToggle && App.els.sidebar) {
        sidebarToggle.addEventListener('click', () => {
            const isOpen = App.els.sidebar.classList.toggle('open');
            sidebarToggle.setAttribute('aria-expanded', isOpen);
            if (isOpen && closeSidebarBtn) {
                setTimeout(() => closeSidebarBtn.focus(), 50);
            }
        });
    }

    if (closeSidebarBtn && App.els.sidebar) {
        closeSidebarBtn.addEventListener('click', () => {
            App.els.sidebar.classList.remove('open');
            if (sidebarToggle) {
                sidebarToggle.setAttribute('aria-expanded', 'false');
                sidebarToggle.focus();
            }
        });
    }

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && App.els.sidebar && App.els.sidebar.classList.contains('open')) {
            App.els.sidebar.classList.remove('open');
            if (sidebarToggle) {
                sidebarToggle.setAttribute('aria-expanded', 'false');
                sidebarToggle.focus();
            }
        }
    });

    const langDetails = document.querySelector('.lang-details');
    if (langDetails) {
        const updateLangDetails = () => {
            if (window.innerWidth >= 1080) {
                langDetails.setAttribute('open', '');
            } else {
                langDetails.removeAttribute('open');
            }
        };
        updateLangDetails();
        window.addEventListener('resize', updateLangDetails);
    }

    if (App.els.statusMessage) {
        App.els.statusMessage.setAttribute('aria-live', 'polite');
    }

    if (App.els.textInput) {
        App.els.textInput.addEventListener('input', () => {
            if (App.els.textInput.value.trim()) {
                App.els.translationAreaText.innerHTML = '<div class="empty-state centered"><strong>Paste text into the notebook</strong><span>Click Translate to turn this into a polished translation.</span></div>';
            }
        });
    }

    if (App.els.textModeBtn) {
        App.els.textModeBtn.addEventListener('click', () => switchMode('text'));
    }
    if (App.els.attachmentModeBtn) {
        App.els.attachmentModeBtn.addEventListener('click', () => switchMode('attachment'));
    }

    if (App.els.fileInput) {
        App.els.fileInput.addEventListener('change', (event) => {
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

    if (App.els.translatePageBtn) {
        App.els.translatePageBtn.addEventListener('click', translateCurrentPage);
    }
    if (App.els.translateAllBtn) {
        App.els.translateAllBtn.addEventListener('click', translateAllPages);
    }
    if (App.els.pageNumberInput) {
        App.els.pageNumberInput.addEventListener('change', () => {
            goToPage(Number(App.els.pageNumberInput.value));
        });
    }
    if (App.els.prevPageBtn) {
        App.els.prevPageBtn.addEventListener('click', () => goToPage(App.currentPage - 1));
    }
    if (App.els.nextPageBtn) {
        App.els.nextPageBtn.addEventListener('click', () => goToPage(App.currentPage + 1));
    }

    if (App.els.copyOriginalBtn) {
        App.els.copyOriginalBtn.addEventListener('click', async () => {
            const pageText = App.pages[App.currentPage - 1] || '';
            if (!pageText.trim()) {
                showStatus('No extracted text to copy.', 'error');
                return;
            }
            await copyToClipboard(pageText);
            showStatus('Current page text copied.', 'success');
        });
    }

    if (App.els.copyTranslationBtnText) {
        App.els.copyTranslationBtnText.addEventListener('click', async () => {
            const text = App.els.translationAreaText.textContent || '';
            if (!text.trim()) {
                showStatus('No translated text to copy.', 'error');
                return;
            }
            await copyToClipboard(text);
            showStatus('Translation copied.', 'success');
        });
    }

    if (App.els.copyTranslationBtnAttachment) {
        App.els.copyTranslationBtnAttachment.addEventListener('click', async () => {
            const text = App.els.translationArea.textContent || '';
            if (!text.trim()) {
                showStatus('No translated text to copy.', 'error');
                return;
            }
            await copyToClipboard(text);
            showStatus('Translation copied.', 'success');
        });
    }

    if (App.els.copySourceBtn) {
        App.els.copySourceBtn.addEventListener('click', async () => {
            const text = App.els.textInput.value || '';
            if (!text.trim()) {
                showStatus('Nothing to copy yet.', 'error');
                return;
            }
            await copyToClipboard(text);
            showStatus('Source copied.', 'success');
        });
    }

    if (App.els.clearTextBtn) {
        App.els.clearTextBtn.addEventListener('click', () => {
            App.els.textInput.value = '';
            App.els.translationAreaText.innerHTML = '<div class="empty-state centered"><strong>Clear workspace</strong><span>Start a fresh notebook entry whenever you want.</span></div>';
            showStatus('Notebook cleared.', 'success');
        });
    }

    if (App.els.saveNoteBtn) {
        App.els.saveNoteBtn.addEventListener('click', () => {
            localStorage.setItem('notebook-note', App.els.noteInput.value || '');
            showStatus('Note saved locally.', 'success');
        });
    }

    if (App.els.translateTextBtn) {
        App.els.translateTextBtn.addEventListener('click', translateTextMode);
    }

    document.addEventListener('keydown', (event) => {
        const isModifier = event.ctrlKey || event.metaKey;
        if (isModifier && event.key === 'Enter') {
            event.preventDefault();
            if (App.currentMode === 'attachment' && App.els.translatePageBtn) {
                App.els.translatePageBtn.click();
            } else if (App.els.translateTextBtn) {
                App.els.translateTextBtn.click();
            }
        }
    });

    loadModels();
    restoreNote();
    switchMode('text');
    updateSourceMeta();
    checkOllamaStatus();
    setInterval(checkOllamaStatus, 30000);
});

function checkOllamaStatus() {
    if (!App.els.ollamaStatus || !App.els.ollamaDot || !App.els.ollamaLabel) {
        return;
    }
    fetch('/api/ollama-status')
        .then(response => response.json())
        .then(data => {
            const isOnline = data.ollama_online === true;
            App.els.ollamaStatus.classList.toggle('online', isOnline);
            App.els.ollamaStatus.classList.toggle('offline', !isOnline);
            App.els.ollamaLabel.textContent = isOnline ? 'Ollama running' : 'Ollama unreachable';
        })
        .catch(() => {
            App.els.ollamaStatus.classList.add('offline');
            App.els.ollamaStatus.classList.remove('online');
            App.els.ollamaLabel.textContent = 'Ollama unreachable';
        });
}
