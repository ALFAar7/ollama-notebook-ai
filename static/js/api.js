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

async function knowledgeSearch(query, targetLanguage, sourceLanguage = 'auto', filename = '', limit = 5) {
    const payload = {
        query,
        target_language: targetLanguage,
        source_language: sourceLanguage,
        limit
    };
    if (filename) {
        payload.filename = filename;
    }
    const response = await fetch('/api/knowledge-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
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

/**
 * List the files already present in the upload folder.
 * @returns {Promise<Object>} { success, files: [{ name, size, modified, file_type }] }
 */
async function loadFiles() {
    const response = await fetch('/api/files');
    const data = await response.json();
    if (!response.ok || !data.success) {
        throw new Error(data.error || 'Could not list files');
    }
    return data;
}

/** Alias kept for readability at the call sites. */
async function listFiles() {
    return loadFiles();
}

/**
 * Fetch the extracted text of an already uploaded file.
 * @param {string} filename
 * @returns {Promise<Object>} { success, filename, text, page_count, file_type }
 */
async function getFileText(filename) {
    const response = await fetch('/api/file/' + encodeURIComponent(filename));
    const data = await response.json();
    if (!response.ok || !data.success) {
        throw new Error(data.error || 'Could not load file');
    }
    return data;
}

async function qaSearch(query, targetLanguage, sourceLanguage = 'auto', filename = '', limit = 5) {
    const payload = {
        query,
        target_language: targetLanguage,
        source_language: sourceLanguage,
        limit
    };
    if (filename) {
        payload.filename = filename;
    }
    const response = await fetch('/api/qa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (!response.ok || !data.success) {
        throw new Error(data.error || 'QA request failed');
    }
    return data;
}

/**
 * List the documents currently indexed in the knowledge base.
 * Named with a `VectorStore` prefix so it cannot collide with the UI-facing
 * `clearKnowledgeBase` / `loadKnowledgeBase` helpers in upload.js.
 * @returns {Promise<Object>} { success, documents: [{filename, chunks, page_count}], total_embeddings }
 */
async function listVectorStoreDocuments() {
    const response = await fetch('/api/vector-store/documents');
    const data = await response.json();
    if (!response.ok || !data.success) {
        throw new Error(data.error || 'Could not list indexed documents');
    }
    return data;
}

/**
 * Remove every chunk of one document from the knowledge base.
 * The uploaded file itself is left untouched.
 * @param {string} filename
 * @returns {Promise<Object>} { success, filename, removed, total_embeddings }
 */
async function removeDocumentFromVectorStore(filename) {
    const response = await fetch('/api/vector-store/' + encodeURIComponent(filename), {
        method: 'DELETE'
    });
    const data = await response.json();
    if (!response.ok || !data.success) {
        throw new Error(data.error || 'Could not remove document');
    }
    return data;
}

/**
 * Empty the knowledge base entirely.
 * @returns {Promise<Object>} { success, removed, total_embeddings }
 */
async function clearVectorStore() {
    const response = await fetch('/api/vector-store', { method: 'DELETE' });
    const data = await response.json();
    if (!response.ok || !data.success) {
        throw new Error(data.error || 'Could not clear the knowledge base');
    }
    return data;
}
