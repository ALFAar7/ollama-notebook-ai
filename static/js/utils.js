/**
 * Shared helpers: text parsing, escaping, clipboard, downloads and
 * formatting utilities.
 *
 * Classic script — no modules, global scope.
 */

/** Split the extracted document text into pages. */
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

/** Render plain text as escaped HTML paragraphs. */
function formatText(text) {
    return text
        .split('\n\n')
        .filter((paragraph) => paragraph.trim())
        .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`)
        .join('');
}

/** Escape a value for safe insertion into HTML. */
function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/** Copy text to the clipboard, with a fallback for insecure contexts. */
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

/**
 * Trigger a download of a text file.
 * @param {string} filename
 * @param {string} text
 */
function downloadTextFile(filename, text) {
    const name = filename || 'download.txt';
    const blob = new Blob([text === undefined || text === null ? '' : String(text)], {
        type: 'text/plain;charset=utf-8'
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.rel = 'noopener';
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => {
        URL.revokeObjectURL(url);
    }, 0);
}

/**
 * Format an ISO timestamp as a short relative time.
 * @param {string} isoString
 * @returns {string} e.g. "Just now", "5 mins ago", "3 hours ago", or a date.
 */
function formatRelativeTime(isoString) {
    if (!isoString) {
        return '';
    }

    const timestamp = new Date(isoString);
    if (Number.isNaN(timestamp.getTime())) {
        return '';
    }

    const seconds = Math.floor((Date.now() - timestamp.getTime()) / 1000);
    if (seconds < 0) {
        return 'Just now';
    }
    if (seconds < 60) {
        return 'Just now';
    }

    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) {
        return `${minutes} min${minutes === 1 ? '' : 's'} ago`;
    }

    const hours = Math.floor(minutes / 60);
    if (hours < 24) {
        return `${hours} hour${hours === 1 ? '' : 's'} ago`;
    }

    const days = Math.floor(hours / 24);
    if (days < 7) {
        return `${days} day${days === 1 ? '' : 's'} ago`;
    }

    return timestamp.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    });
}

/**
 * Format a byte count as a human readable size.
 * @param {number} bytes
 * @returns {string} e.g. "1.2 KB"
 */
function formatBytes(bytes) {
    const value = Number(bytes);
    if (!Number.isFinite(value) || value <= 0) {
        return '0 B';
    }

    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const exponent = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
    const size = value / Math.pow(1024, exponent);
    const decimals = exponent === 0 ? 0 : 1;
    return `${size.toFixed(decimals)} ${units[exponent]}`;
}
