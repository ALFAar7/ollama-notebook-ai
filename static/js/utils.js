function parsePages(text) {
    const pageRegex = /--- Page (\d+) ---\s*([\s\S]*?)(?=\n\n--- Page \d+ ---\n\n|$)/g;
    const parsed = [];
    let match;

    while ((match = pageRegex.exec(text)) !== null) {
        const pageNumber = Number(match[1]);
        parsed[pageNumber - 1] = match[2].trim();
    }

    if (!parsed.length && text.trim()) {
        parsed.push(text.trim());
    }

    return parsed;
}

function formatText(text) {
    return text
        .split('\n\n')
        .filter((paragraph) => paragraph.trim())
        .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`)
        .join('');
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

async function copyToClipboard(text) {
    if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return;
    }

    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    textarea.remove();
}
