/* ============================================
   ATTACHMENT PREVIEW RESIZE
   The preview box is resizable on all four edges and
   all four corners. Sizing is stored on the wrapper so
   it survives renderFilePreview() replacing the preview's
   innerHTML on every page change.
   ============================================ */

const PREVIEW_RESIZE = {
    MIN_WIDTH: 320,
    MIN_HEIGHT: 220,
    MIN_ABS_HEIGHT: 720,
    MAX_ABS_HEIGHT: 1200,
    KEY_STEP: 16,
    KEY_STEP_LARGE: 48,
    STORAGE_KEY: 'ollama-notebook.preview-size'
};

const previewResize = {
    wrapper: null,
    natural: null,
    size: null,
    drag: null
};

function previewResizeClamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

function previewResizeMetrics() {
    if (!previewResize.wrapper) {
        return null;
    }
    const width = previewResize.wrapper.offsetWidth;
    const height = previewResize.wrapper.offsetHeight;
    if (!width || !height) {
        return null;
    }
    return { width, height };
}

function previewResizeBounds() {
    const natural = previewResize.natural || { width: 0, height: 0 };
    return {
        minWidth: Math.min(PREVIEW_RESIZE.MIN_WIDTH, natural.width || PREVIEW_RESIZE.MIN_WIDTH),
        minHeight: Math.min(PREVIEW_RESIZE.MIN_HEIGHT, natural.height || PREVIEW_RESIZE.MIN_HEIGHT),
        // The box can never exceed the width the layout already gives it, but
        // it may grow taller: the workspace scrolls to accommodate it.
        maxWidth: natural.width || PREVIEW_RESIZE.MIN_WIDTH,
        maxHeight: Math.min(
            Math.max(natural.height * 2.5, PREVIEW_RESIZE.MIN_ABS_HEIGHT),
            PREVIEW_RESIZE.MAX_ABS_HEIGHT
        )
    };
}

function previewResizeApply(size) {
    const wrapper = previewResize.wrapper;
    if (!wrapper) {
        return;
    }
    const bounds = previewResizeBounds();
    const width = previewResizeClamp(size.width, bounds.minWidth, bounds.maxWidth);
    const height = previewResizeClamp(size.height, bounds.minHeight, bounds.maxHeight);
    const left = Math.max(0, Math.min(size.left || 0, Math.max(0, bounds.maxWidth - width)));
    const top = Math.max(0, Math.min(size.top || 0, Math.max(0, bounds.maxHeight - height)));

    previewResize.size = { width, height, left, top };
    wrapper.classList.add('is-resized');
    wrapper.style.width = `${width}px`;
    wrapper.style.height = `${height}px`;
    wrapper.style.marginLeft = `${left}px`;
    wrapper.style.marginTop = `${top}px`;
    previewResizeUpdateHandleAria();
}

function previewResizeReset() {
    const wrapper = previewResize.wrapper;
    if (!wrapper) {
        return;
    }
    wrapper.classList.remove('is-resized');
    wrapper.style.width = '';
    wrapper.style.height = '';
    wrapper.style.marginLeft = '';
    wrapper.style.marginTop = '';
    previewResize.size = null;
    previewResizeCaptureNatural();
    previewResizeUpdateHandleAria();
    try {
        localStorage.removeItem(PREVIEW_RESIZE.STORAGE_KEY);
    } catch (error) {
        /* storage unavailable: the reset still applies for this session */
    }
}

function previewResizeCaptureNatural() {
    const wrapper = previewResize.wrapper;
    if (!wrapper || wrapper.classList.contains('is-resized')) {
        return;
    }
    const metrics = previewResizeMetrics();
    if (metrics) {
        previewResize.natural = metrics;
        previewResizeUpdateHandleAria();
    }
}

function previewResizeSave() {
    if (!previewResize.size) {
        return;
    }
    try {
        localStorage.setItem(PREVIEW_RESIZE.STORAGE_KEY, JSON.stringify(previewResize.size));
    } catch (error) {
        /* storage unavailable: sizing still works for this session */
    }
}

function previewResizeRestore() {
    let stored = null;
    try {
        stored = JSON.parse(localStorage.getItem(PREVIEW_RESIZE.STORAGE_KEY) || 'null');
    } catch (error) {
        stored = null;
    }
    if (!stored || !previewResizeMetrics()) {
        return;
    }
    previewResizeApply({
        width: Number(stored.width) || 0,
        height: Number(stored.height) || 0,
        left: Number(stored.left) || 0,
        top: Number(stored.top) || 0
    });
}

function previewResizeUpdateHandleAria() {
    if (!previewResize.wrapper) {
        return;
    }
    const size = previewResize.size;
    const bounds = previewResizeBounds();
    previewResize.wrapper.querySelectorAll('.resize-handle').forEach((handle) => {
        const dir = handle.getAttribute('data-dir') || '';
        if (size && dir.includes('e')) {
            handle.setAttribute('aria-valuenow', String(Math.round(size.width)));
        } else if (size && dir.includes('w')) {
            handle.setAttribute('aria-valuenow', String(Math.round(size.width)));
        } else if (size && dir.includes('s')) {
            handle.setAttribute('aria-valuenow', String(Math.round(size.height)));
        } else if (size && dir.includes('n')) {
            handle.setAttribute('aria-valuenow', String(Math.round(size.height)));
        }
        if (dir.includes('e') || dir.includes('w')) {
            handle.setAttribute('aria-valuemin', String(Math.round(bounds.minWidth)));
            handle.setAttribute('aria-valuemax', String(Math.round(bounds.maxWidth)));
        }
        if (dir.includes('n') || dir.includes('s')) {
            handle.setAttribute('aria-valuemin', String(Math.round(bounds.minHeight)));
            handle.setAttribute('aria-valuemax', String(Math.round(bounds.maxHeight)));
        }
    });
}

function previewResizeCurrentSize() {
    if (previewResize.size) {
        return { ...previewResize.size };
    }
    const metrics = previewResizeMetrics() || { width: 0, height: 0 };
    return { width: metrics.width, height: metrics.height, left: 0, top: 0 };
}

/**
 * Resolve a drag into a new box.
 *
 * The edge opposite the dragged handle stays pinned, and the position is
 * clamped before the size is derived from it. Clamping the size first would
 * let the pinned edge drift when the box runs out of room.
 */
function previewResizeCompute(start, dir, dx, dy) {
    const bounds = previewResizeBounds();
    const next = { ...start };

    if (dir.includes('e')) {
        next.left = start.left;
        // Growth is limited by the room between the pinned left edge and the
        // right edge of the available space, so the box never has to shift to
        // stay inside the layout.
        const room = Math.max(bounds.minWidth, bounds.maxWidth - start.left);
        next.width = previewResizeClamp(start.width + dx, bounds.minWidth, room);
    } else if (dir.includes('w')) {
        const right = start.left + start.width;
        const left = previewResizeClamp(
            start.left + dx, 0, Math.max(0, right - bounds.minWidth)
        );
        next.width = previewResizeClamp(right - left, bounds.minWidth, bounds.maxWidth);
        next.left = right - next.width;
    }

    if (dir.includes('s')) {
        next.top = start.top;
        const room = Math.max(bounds.minHeight, bounds.maxHeight - start.top);
        next.height = previewResizeClamp(start.height + dy, bounds.minHeight, room);
    } else if (dir.includes('n')) {
        const bottom = start.top + start.height;
        const top = previewResizeClamp(
            start.top + dy, 0, Math.max(0, bottom - bounds.minHeight)
        );
        next.height = previewResizeClamp(bottom - top, bounds.minHeight, bounds.maxHeight);
        next.top = bottom - next.height;
    }

    return next;
}

function previewResizeNudge(handle, dir, dx, dy) {
    previewResizeApply(previewResizeCompute(previewResizeCurrentSize(), dir, dx, dy));
}

function previewResizeOnPointerDown(event) {
    const handle = event.target.closest('.resize-handle');
    if (!handle || !previewResize.wrapper || !previewResize.wrapper.contains(handle)) {
        return;
    }
    if (event.button !== undefined && event.button !== 0) {
        return;
    }
    event.preventDefault();
    previewResizeCaptureNatural();
    const current = previewResizeCurrentSize();
    previewResize.drag = {
        handle,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        start: current
    };
    handle.classList.add('is-dragging');
    document.body.classList.add('is-resizing-preview');
    if (handle.setPointerCapture) {
        try {
            handle.setPointerCapture(event.pointerId);
        } catch (error) {
            /* capture is a nicety; the document-level listeners still work */
        }
    }
}

function previewResizeOnPointerMove(event) {
    const drag = previewResize.drag;
    if (!drag || event.pointerId !== drag.pointerId) {
        return;
    }
    event.preventDefault();
    const dir = drag.handle.getAttribute('data-dir') || '';
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    previewResizeApply(previewResizeCompute(drag.start, dir, dx, dy));
}

function previewResizeEndDrag() {
    const drag = previewResize.drag;
    if (!drag) {
        return;
    }
    if (drag.handle.releasePointerCapture) {
        try {
            drag.handle.releasePointerCapture(drag.pointerId);
        } catch (error) {
            /* already released */
        }
    }
    drag.handle.classList.remove('is-dragging');
    document.body.classList.remove('is-resizing-preview');
    previewResize.drag = null;
    previewResizeSave();
}

function previewResizeOnKeyDown(event) {
    const handle = event.target.closest('.resize-handle');
    if (!handle) {
        return;
    }
    const step = event.shiftKey ? PREVIEW_RESIZE.KEY_STEP_LARGE : PREVIEW_RESIZE.KEY_STEP;
    const dir = handle.getAttribute('data-dir') || '';
    const vertical = dir.includes('n') || dir.includes('s');
    const horizontal = dir.includes('e') || dir.includes('w');
    let handled = true;
    switch (event.key) {
        case 'ArrowRight':
            if (horizontal) previewResizeNudge(handle, dir, step, 0);
            else handled = false;
            break;
        case 'ArrowLeft':
            if (horizontal) previewResizeNudge(handle, dir, -step, 0);
            else handled = false;
            break;
        case 'ArrowDown':
            if (vertical) previewResizeNudge(handle, dir, 0, step);
            else handled = false;
            break;
        case 'ArrowUp':
            if (vertical) previewResizeNudge(handle, dir, 0, -step);
            else handled = false;
            break;
        case 'Enter':
        case ' ':
            previewResizeReset();
            break;
        default:
            handled = false;
    }
    if (handled) {
        event.preventDefault();
        previewResizeSave();
    }
}

function previewResizeOnDoubleClick(event) {
    if (event.target.closest('.resize-handle')) {
        event.preventDefault();
        previewResizeReset();
    }
}

function previewResizeOnWindowResize() {
    if (previewResize.wrapper && !previewResize.wrapper.classList.contains('is-resized')) {
        previewResizeCaptureNatural();
    }
}

function initPreviewResize() {
    const wrapper = document.getElementById('previewResizer');
    if (!wrapper) {
        return;
    }
    previewResize.wrapper = wrapper;
    previewResize.natural = null;
    previewResize.size = null;

    wrapper.addEventListener('pointerdown', previewResizeOnPointerDown);
    wrapper.addEventListener('keydown', previewResizeOnKeyDown);
    wrapper.addEventListener('dblclick', previewResizeOnDoubleClick);
    document.addEventListener('pointermove', previewResizeOnPointerMove, { passive: false });
    document.addEventListener('pointerup', previewResizeEndDrag);
    document.addEventListener('pointercancel', previewResizeEndDrag);
    window.addEventListener('resize', previewResizeOnWindowResize);

    previewResizeCaptureNatural();
    previewResizeRestore();
}
