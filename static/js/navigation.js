/**
 * Switch between workspace tabs (Text, Document, Notes)
 * @param {string} tab - The tab to switch to: 'text', 'document', or 'notes'
 */
function switchWorkspaceTab(tab) {
    App.currentMode = tab;

    if (App.els.tabText) {
        const isText = tab === 'text';
        App.els.tabText.classList.toggle('active', isText);
        App.els.tabText.setAttribute('aria-selected', isText);
    }
    if (App.els.tabDocument) {
        const isDocument = tab === 'document';
        App.els.tabDocument.classList.toggle('active', isDocument);
        App.els.tabDocument.setAttribute('aria-selected', isDocument);
    }
    if (App.els.tabNotes) {
        const isNotes = tab === 'notes';
        App.els.tabNotes.classList.toggle('active', isNotes);
        App.els.tabNotes.setAttribute('aria-selected', isNotes);
    }

    if (App.els.panelText) {
        App.els.panelText.classList.toggle('active', tab === 'text');
    }
    if (App.els.panelDocument) {
        App.els.panelDocument.classList.toggle('active', tab === 'document');
    }
    if (App.els.panelNotes) {
        App.els.panelNotes.classList.toggle('active', tab === 'notes');
    }

    if (tab === 'text' && App.els.textInput) {
        updateCharCount();
    }

    if (App.els.panelRag) {
        App.els.panelRag.classList.toggle('active', tab === 'search');
    }

    updateRTLState();
}

function updateCharCount() {
    if (App.els.charCount && App.els.textInput) {
        const count = App.els.textInput.value.length;
        App.els.charCount.textContent = `${count} character${count !== 1 ? 's' : ''}`;
    }
}

function goToPage(pageNumber) {
    if (!App.pages.length) {
        return;
    }

    const targetPage = Math.min(Math.max(1, Number(pageNumber) || 1), App.pages.length);
    App.currentPage = targetPage;
    if (App.els.pageNumber) {
        App.els.pageNumber.value = App.currentPage;
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
