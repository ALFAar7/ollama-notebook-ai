/**
 * Restore saved note from localStorage
 */
function restoreNote() {
    if (App.els.notesArea) {
        const savedNote = localStorage.getItem('notebook-note') || '';
        App.els.notesArea.value = savedNote;

        // Show empty state if no note
        if (!savedNote.trim()) {
            // No empty state needed for notes textarea
        }
    }
}

/**
 * Update the notes summary display (legacy function, kept for compatibility)
 * @param {string} translatedTextValue - The translated text
 * @param {string} sourceTextValue - The source text
 */
function updateSummary(translatedTextValue, sourceTextValue) {
    // This function is kept for backward compatibility
    // but is not used in the new tab-based layout
    if (!App.els.notesSummary) {
        return;
    }

    const cleanText = (translatedTextValue || '').replace(/<[^>]+>/g, '').trim();
    const preview = cleanText.length > 220 ? `${cleanText.slice(0, 220)}...` : cleanText;
    const sourcePreview = (sourceTextValue || '').replace(/\s+/g, ' ').trim().slice(0, 140);

    App.els.notesSummary.innerHTML = `
        <strong>Summarizing...</strong>
        <div>${preview || 'No translation available yet.'}</div>
        <div class="summary-source">Source: ${escapeHtml(sourcePreview || 'No source text available')}</div>
    `;

    fetch('/api/summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            text: translatedTextValue,
            language: App.els.targetLanguage.value
        })
    })
    .then(response => response.json())
    .then(data => {
        if (data.success && data.summary) {
            App.els.notesSummary.innerHTML = `
                <strong>Current page summary</strong>
                <div>${escapeHtml(data.summary)}</div>
                <div class="summary-source">Source: ${escapeHtml(sourcePreview || 'No source text available')}</div>
            `;
        } else {
            App.els.notesSummary.innerHTML = `
                <strong>Current page summary</strong>
                <div>${preview || 'No translation available yet.'}</div>
                <div class="summary-source">Source: ${escapeHtml(sourcePreview || 'No source text available')}</div>
            `;
        }
    })
    .catch(() => {
        App.els.notesSummary.innerHTML = `
            <strong>Current page summary</strong>
            <div>${preview || 'No translation available yet.'}</div>
            <div class="summary-source">Source: ${escapeHtml(sourcePreview || 'No source text available')}</div>
        `;
    });
}