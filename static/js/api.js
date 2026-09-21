async function loadModels() {
    try {
        const response = await fetch('/api/models');
        const data = await response.json();
        if (data.success && data.models.length && App.els.modelBadge) {
            const gemmaModel = data.models.find((model) => model.toLowerCase().includes('gemma4')) || data.models[0];
            App.els.modelBadge.textContent = gemmaModel;
        }
    } catch (error) {
        console.error(error);
    }
}

async function knowledgeSearch(query, targetLanguage, sourceLanguage = 'auto', limit = 5) {
    const response = await fetch('/api/knowledge-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            query,
            target_language: targetLanguage,
            source_language: sourceLanguage,
            limit
        })
    });
    const data = await response.json();
    if (!response.ok || !data.success) {
        throw new Error(data.error || 'Search failed');
    }
    return data.results;
}

async function loadVectorStats() {
    const response = await fetch('/api/vector-stats');
    const data = await response.json();
    if (!response.ok || !data.success) {
        return null;
    }
    return data.stats;
}
