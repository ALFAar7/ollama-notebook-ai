function updateSummary(translatedTextValue, sourceTextValue) {
    if (!App.els.notesSummary) {
        return;
    }

    const cleanText = (translatedTextValue || '').replace(/<[^>]+>/g, '').trim();
    const preview = cleanText.length > 220 ? `${cleanText.slice(0, 220)}…` : cleanText;
    const sourcePreview = (sourceTextValue || '').replace(/\s+/g, ' ').trim().slice(0, 140);

    App.els.notesSummary.innerHTML = `
        <strong>Summarizing…</strong>
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

function restoreNote() {
    if (App.els.noteInput) {
        App.els.noteInput.value = localStorage.getItem('notebook-note') || '';
    }
}
