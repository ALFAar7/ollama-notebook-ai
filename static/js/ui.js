const PDF_ZOOM_STEPS = [50, 75, 100, 125, 150, 200, 300, 400];

function getPdfViewerUrl(filename, page, zoom, fitWidth) {
    const url = `/uploads/${encodeURIComponent(filename)}`;
    const params = [];
    if (page && page > 0) {
        params.push(`page=${page}`);
    }
    if (fitWidth) {
        params.push('view=FitWidth');
    } else if (zoom) {
        params.push(`zoom=${zoom}`);
    }
    return params.length ? `${url}#${params.join('&')}` : url;
}

function renderPdfToolbar() {
    return `
        <div class="pdf-toolbar" role="toolbar" aria-label="PDF zoom controls">
            <button class="pdf-tool" type="button" data-pdf-action="zoom-out" title="Zoom out" aria-label="Zoom out">&minus;</button>
            <span class="pdf-zoom-value" id="pdfZoomValue" aria-live="polite">${App.pdfFitWidth ? 'Fit' : `${App.pdfZoom}%`}</span>
            <button class="pdf-tool" type="button" data-pdf-action="zoom-in" title="Zoom in" aria-label="Zoom in">+</button>
            <button class="pdf-tool pdf-tool-wide" type="button" data-pdf-action="fit" title="Fit the page width to this panel">Fit</button>
        </div>
    `;
}

function syncPdfViewerSource() {
    const frame = App.viewerFrame;
    if (!frame || App.viewerFileName !== App.currentFileName) {
        return;
    }
    const url = getPdfViewerUrl(App.currentFileName, App.currentPage, App.pdfZoom, App.pdfFitWidth);
    // Assigning a URL that differs only by fragment is a same-document
    // navigation, so the viewer moves pages without re-downloading the PDF.
    if (frame.getAttribute('src') !== url) {
        frame.setAttribute('src', url);
    }
    updatePdfZoomLabel();
}

function updatePdfZoomLabel() {
    const label = document.getElementById('pdfZoomValue');
    if (label) {
        label.textContent = App.pdfFitWidth ? 'Fit' : `${App.pdfZoom}%`;
    }
}

function stepPdfZoom(direction) {
    if (App.pdfFitWidth) {
        App.pdfFitWidth = false;
    }
    const current = App.pdfZoom;
    if (direction > 0) {
        const next = PDF_ZOOM_STEPS.find((step) => step > current);
        App.pdfZoom = next || PDF_ZOOM_STEPS[PDF_ZOOM_STEPS.length - 1];
    } else {
        const lower = [...PDF_ZOOM_STEPS].reverse().find((step) => step < current);
        App.pdfZoom = lower || PDF_ZOOM_STEPS[0];
    }
    syncPdfViewerSource();
}

function togglePdfFitWidth() {
    App.pdfFitWidth = !App.pdfFitWidth;
    if (!App.pdfFitWidth && !App.pdfZoom) {
        App.pdfZoom = 100;
    }
    syncPdfViewerSource();
}

function handlePdfToolbarClick(event) {
    const button = event.target.closest('[data-pdf-action]');
    if (!button || !App.els.attachmentPreview || !App.els.attachmentPreview.contains(button)) {
        return;
    }
    const action = button.getAttribute('data-pdf-action');
    if (action === 'zoom-in') {
        stepPdfZoom(1);
    } else if (action === 'zoom-out') {
        stepPdfZoom(-1);
    } else if (action === 'fit') {
        togglePdfFitWidth();
    }
}

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

    if (App.els.filePreviewSidebar) {
        App.els.filePreviewSidebar.innerHTML = sidebarMarkup;
    }
    if (!App.els.attachmentPreview) {
        return;
    }

    if (!App.currentFileName) {
        App.viewerFileName = '';
        App.viewerFrame = null;
        App.els.attachmentPreview.innerHTML = `
            <div class="empty-state centered">
                <strong>Upload a source file</strong>
                <span>Once a document is uploaded, its pages appear here.</span>
            </div>
        `;
        return;
    }

    if (fileType === 'pdf') {
        const existingFrame = App.els.attachmentPreview.querySelector('.viewer-frame');
        if (existingFrame && App.viewerFileName === App.currentFileName) {
            // Same document: keep the viewer alive so zoom, scroll and the
            // embedded viewer state survive a page change.
            syncPdfViewerSource();
        } else {
            App.els.attachmentPreview.innerHTML = `
                <div class="pdf-viewer">
                    ${renderPdfToolbar()}
                    <iframe class="viewer-frame" title="PDF Preview" src="${getPdfViewerUrl(App.currentFileName, App.currentPage, App.pdfZoom, App.pdfFitWidth)}"></iframe>
                </div>
            `;
            App.viewerFileName = App.currentFileName;
            App.viewerFrame = App.els.attachmentPreview.querySelector('.viewer-frame');
            updatePdfZoomLabel();
        }
        return;
    }

    App.viewerFileName = '';
    App.viewerFrame = null;
    App.els.attachmentPreview.innerHTML = currentPageText
        ? `
            <div class="preview-content">
                <div class="preview-caption">Page ${App.currentPage} of ${App.pages.length}</div>
                <div class="preview-text">${escapeHtml(currentPageText)}</div>
            </div>
        `
        : `
            <div class="empty-state centered">
                <strong>${fileType === 'docx' ? '&#128214;' : '&#128196;'} ${escapeHtml(App.currentFileName)}</strong>
                <span>This page has no extractable text yet.</span>
            </div>
        `;
}

function updateRTLState() {
    const isRTL = isTargetLanguageRTL();
    if (App.els.translationArea) {
        App.els.translationArea.classList.toggle('rtl', isRTL);
        App.els.translationArea.dir = isRTL ? 'rtl' : 'ltr';
    }
    if (App.els.translationAreaText) {
        App.els.translationAreaText.classList.toggle('rtl', isRTL);
        App.els.translationAreaText.dir = isRTL ? 'rtl' : 'ltr';
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

function renderKnowledgeSearchResults(results) {
    const container = App.els.searchResults;
    if (!container) {
        return;
    }

    const isRTL = isTargetLanguageRTL();
    container.dir = isRTL ? 'rtl' : 'ltr';
    container.classList.toggle('rtl', isRTL);
    container.classList.toggle('ltr', !isRTL);

    if (!results || results.length === 0) {
        container.innerHTML = `
            <div class="empty-state centered">
                <div class="empty-icon" aria-hidden="true">&#128269;</div>
                <strong>No results found</strong>
                <span>Try a different query or upload a document to build the knowledge base.</span>
            </div>
        `;
        return;
    }

    container.innerHTML = results.map((result) => {
        const citationParts = [];
        if (result.filename) {
            citationParts.push(escapeHtml(result.filename));
        }
        if (result.page_number) {
            citationParts.push(`Page ${result.page_number}`);
        }
        const citation = citationParts.join(' - ') || '—';
        const similarity = Math.round((result.similarity || 0) * 100);

        return `
            <article class="search-result-item">
                <div class="search-result-meta">
                    <span class="search-citation">${citation}</span>
                    <span class="search-result-similarity">Match: ${similarity}%</span>
                </div>
                <div class="search-result-body${isRTL ? ' rtl' : ''}" dir="${isRTL ? 'rtl' : 'ltr'}">${escapeHtml(result.translated_text || '')}</div>
            </article>
        `;
    }).join('');
}

function isTargetLanguageRTL() {
    const lang = (App.els.targetLanguage && App.els.targetLanguage.value) || '';
    return lang === 'Persian' || lang === 'Arabic' || lang === 'Kurdish';
}

function renderVectorStats(stats) {
    const container = App.els.searchStats;
    if (!container) {
        return;
    }

    if (!stats) {
        container.innerHTML = `
            <div class="empty-state centered">
                <strong>Unable to load stats</strong>
                <span>Vector store is not ready.</span>
            </div>
        `;
        return;
    }

    const rows = [
        { label: 'Total chunks', value: stats.total_embeddings || 0 },
        { label: 'Collection', value: stats.collection_name || '—' },
        { label: 'Database', value: stats.db_path || '—' }
    ];

    container.innerHTML = rows.map((row) => `
        <div class="search-stat-row">
            <span>${escapeHtml(row.label)}</span>
            <strong>${escapeHtml(String(row.value))}</strong>
        </div>
    `).join('');
}
