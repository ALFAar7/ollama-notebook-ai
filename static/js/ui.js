function renderFilePreview() {
    const fileType = (App.currentFileName || '').split('.').pop().toLowerCase();
    const currentPageText = (App.pages[App.currentPage - 1] || '').trim();
    const sidebarMarkup = App.currentFileName
        ? `
            <div class="empty-state centered">
                <strong>${fileType === 'docx' ? '&#128214;' : fileType === 'txt' ? '&#128196;' : fileType === 'pdf' ? '&#128215;' : '&#128206;'} ${escapeHtml(App.currentFileName)}</strong>
                <span>${App.pages.length} page(s) &#8226; Ready for translation</span>
            </div>
        `
        : `
            <div class="empty-state centered">
                <strong>Start with a source</strong>
                <span>Upload a PDF, DOCX, or TXT file to preview it here.</span>
            </div>
        `;
    const mainMarkup = App.currentFileName
        ? fileType === 'pdf'
            ? `<iframe class="source-iframe" title="PDF Preview" src="/uploads/${encodeURIComponent(App.currentFileName)}"></iframe>`
            : currentPageText
                ? `
                    <div class="preview-content">
                        <div class="preview-caption">Page ${App.currentPage} of ${App.pages.length}</div>
                        <div class="preview-text">${escapeHtml(currentPageText)}</div>
                    </div>
                `
                : `
                    <div class="empty-state centered">
                        <strong>${fileType === 'docx' ? '&#128214;' : fileType === 'txt' ? '&#128196;' : fileType === 'pdf' ? '&#128215;' : '&#128206;'} ${escapeHtml(App.currentFileName)}</strong>
                        <span>This page has no extractable text yet.</span>
                    </div>
                `
        : `
            <div class="empty-state centered">
                <strong>Upload a source file</strong>
                <span>Once a document is uploaded, its pages appear here.</span>
            </div>
        `;

    if (App.els.filePreviewSidebar) {
        App.els.filePreviewSidebar.innerHTML = sidebarMarkup;
    }
    if (App.els.attachmentPreview) {
        App.els.attachmentPreview.innerHTML = mainMarkup;
    }
}

function updateRTLState() {
    const isRTL = App.els.targetLanguage && (App.els.targetLanguage.value === 'Persian' || App.els.targetLanguage.value === 'Arabic');
    if (App.els.translationArea) {
        App.els.translationArea.classList.toggle('rtl', isRTL);
    }
    if (App.els.translationAreaText) {
        App.els.translationAreaText.classList.toggle('rtl', isRTL);
    }
    if (App.els.notesSummary) {
        App.els.notesSummary.classList.toggle('rtl', isRTL);
    }
    if (App.els.noteInput) {
        App.els.noteInput.classList.toggle('rtl', isRTL);
    }
}

function updateSourceMeta() {
    if (App.els.sourceFileName) {
        App.els.sourceFileName.textContent = App.currentFileName || 'No file';
    }
    if (App.els.sourcePageCount) {
        App.els.sourcePageCount.textContent = App.pages.length ? `Pages: ${App.pages.length}` : 'Pages: &mdash;';
    }
    if (App.els.sourceStatus) {
        App.els.sourceStatus.textContent = App.currentFileName ? 'Source ready' : 'No source loaded';
    }
}

function showStatus(message, type) {
    if (!App.els.statusMessage) {
        return;
    }
    App.els.statusMessage.textContent = message;
    App.els.statusMessage.className = `status-message ${type || ''}`;
    App.els.statusMessage.classList.remove('hidden');
    clearTimeout(showStatus.timer);
    showStatus.timer = setTimeout(() => {
        App.els.statusMessage.classList.add('hidden');
    }, 6000);
}
