# UI Refactor — Shared Contract (authoritative for all agents)

Read this BEFORE writing code. It is the single source of truth for tokens, class names,
element IDs, and JS ownership. The detailed intent lives in `docs/UI-UX-REFACTOR-PLAN.md`.

Repo root: `/home/alfa/Myfile/works/translator`. Branch: `feat/refactor-ui`.
Backend (`src/*.py`) is OUT OF SCOPE — never edit it. Every existing API endpoint keeps
its path, method, request body and response shape. No new backend endpoints.

---

## 1. Global rules

1. Plain Jinja + CSS + vanilla JS. No build step, no framework, no npm.
2. **No emoji anywhere.** All icons come from the SVG sprite (see §6).
3. **No inline `style="..."`** in templates, no inline `style` attributes in JS-created HTML.
4. **No hard-coded colours** in CSS. Use only the tokens in §2. Exception: `currentColor`.
5. No `backdrop-filter`, no gradients on text or buttons, no glassmorphism.
6. Fonts loaded once in `base.html`: Space Grotesk (display), Inter (text), Cairo (Arabic).
7. Every element referenced by JS must exist in the DOM with the exact ID in §4.
8. `aria-labelledby` / `aria-controls` / `aria-describedby` must point at IDs that exist.
9. Respect `prefers-reduced-motion` globally.
10. No `position: fixed` overlays that trap scroll — drawers must be scrollable.
11. Keep the existing JS style: 4-space indent, `const App = {...}` global, plain functions.

---

## 2. Design tokens — `static/css/tokens.css` (owned by agent `tokens`)

Only `tokens.css` may define CSS custom properties. No other file may declare `:root` vars.

```css
:root {
  /* colour — light (default) */
  --canvas:      #f8f7f4;
  --chrome:      #f8f4e9;
  --surface:     #ffffff;
  --surface-2:   #f4f4f5;
  --line:        #e4e4e7;
  --line-strong: #3f3f46;
  --ink-950:     #09090b;
  --ink-700:     #3f3f46;
  --ink-500:     #71717a;
  --brand:       #e8590c;
  --brand-ink:   #ffffff;
  --success:     #15803d;
  --danger:      #b91c1c;
  --warning:     #b45309;

  /* subtle translucent washes derived from the above */
  --brand-wash:  rgba(232, 89, 12, .10);
  --success-wash:rgba(21, 128, 61, .10);
  --danger-wash: rgba(185, 28, 28, .10);
  --overlay:     rgba(9, 9, 11, .40);

  /* type */
  --font-display: "Space Grotesk", "Inter", sans-serif;
  --font-sans:    "Inter", system-ui, sans-serif;
  --font-arabic:  "Cairo", "Inter", sans-serif;
  --font-mono:    ui-monospace, "JetBrains Mono", monospace;

  /* space */
  --space-1: 2px;  --space-2: 4px;  --space-3: 8px;  --space-4: 12px;
  --space-5: 16px; --space-6: 24px; --space-7: 32px; --space-8: 48px;

  /* radius */
  --r-control: 9px; --r-field: 10px; --r-card: 14px; --r-panel: 20px; --r-shell: 12px;
  --r-pill: 999px;

  /* elevation — two levels only */
  --shadow-card: 0 1px 2px rgba(0,0,0,.04);
  --shadow-overlay: 0 8px 24px rgba(0,0,0,.08);

  /* motion */
  --motion-fast: 120ms cubic-bezier(.4,0,.2,1);
  --motion-base: 200ms cubic-bezier(.4,0,.2,1);

  /* z-index */
  --z-base: 1; --z-sticky: 100; --z-drawer: 200; --z-overlay: 300; --z-toast: 400;
}

[data-theme="dark"] {
  --canvas: #0b0b0e; --chrome: #08080a; --surface: #131317; --surface-2: #1b1b20;
  --line: #27272a; --line-strong: #3f3f46; --ink-950: #fafafa; --ink-700: #a1a1aa;
  --ink-500: #71717a; --brand: #fb923c; --brand-ink: #1a1207; --success: #4ade80;
  --danger: #f87171; --warning: #fbbf24;
  --brand-wash: rgba(251,146,60,.14); --success-wash: rgba(74,222,128,.14);
  --danger-wash: rgba(248,113,113,.14); --overlay: rgba(0,0,0,.60);
}
```

Dark mode is opt-in via `data-theme="dark"` on `<html>`; default is light. A theme toggle
lives in the top bar (ID `themeToggle`).

---

## 3. Component class names — `static/css/components.css` (owned by agent `components`)

Use exactly these class names. Do not invent alternatives.

```
.btn                       base button (inline-flex, gap 8, radius --r-control)
.btn--primary              brand fill, --brand bg / --brand-ink text
.btn--secondary            surface bg + 1px --line border
.btn--ghost                transparent bg, --ink-700 text
.btn--danger               --danger text / --danger-wash bg
.btn--sm                   height 32px
.btn--md                   height 40px (default)
.btn--lg                   height 48px
.btn__icon                 inline svg, 16px, flex none
.btn__label                the mutable text (JS mutates ONLY this)
.btn.is-loading            shows spinner, pointer-events none
.btn:disabled              opacity .45, cursor not-allowed

.icon-btn                  32x32 square icon-only button
.icon                      inline svg, 20px, stroke currentColor, 1.5px, fill none

.field                     text input / textarea wrapper
.input                     input, radius --r-field, border --line, bg --surface
.textarea                  textarea, same + min-height
.select                    native select
.label                     small uppercase-ish field label
.hint                      muted help text
.segmented                 segmented control container
.segmented__item           a segment (role=button / radio)
.segmented__item.is-active active segment (brand ink + --brand-wash bg)
.switch                    toggle switch
.badge                     small status chip (pill)
.badge--brand|--success|--danger|--neutral
.pill                      soft chip for metadata (bg --surface-2, 1px --line)
.card                      bordered surface, radius --r-card, shadow-card
.panel                     larger surface, radius --r-panel
.panel__header            flex row, space-between
.panel__title              h2/h3 in --font-display
.panel__body
.panel__footer
.eyebrow                   small muted uppercase label (kept from old UI)
.section-head              legacy alias of panel__header (keep class in templates too)

.empty-state               centred empty state block
.empty-state__icon
.empty-state__title
.empty-state__text
.empty-state__action

.toast-container           fixed stack, top-right
.toast                     one toast
.toast--success|--error|--info
.toast__icon
.toast__message
.toast__close

.skeleton                  loading placeholder block
.spinner                   16px rotating ring
.kbd                       inline keyboard hint chip
.progress                  progress bar track
.progress__bar             fill
.meter                     similarity meter track
.meter__fill
.meter__fill--high|--mid|--low
.tooltip                   tooltip bubble
.dropdown                  menu container
.dropdown__item

.text-gradient             REMOVED - do not use
```

Old class names that MUST NOT appear in new markup: `.glass-card`, `.primary-btn`,
`.secondary-btn`, `.ghost-btn`, `.text-input-area`, `.workspace-tab-btn`, `.tab-icon`,
`.tab-label`, `.search-input`, `.note-textarea`, `.meta-pill`, `.status-message`.

---

## 4. Element IDs (the JS contract)

All IDs below MUST exist exactly once in the rendered page. `main.js` caches them.

### Global chrome
```
rail, railToggle (mobile), topbar, themeToggle, modelBadge, ollamaDot, ollamaLabel,
ollamaStatus, sourcesToggle, sourcesDrawer, sourcesClose, sourcesOverlay,
knowledgeToggle, knowledgePopover, knowledgeStats, toastContainer
```

### Rail (mode switcher) — role=tablist
```
tabText, tabDocument, tabNotes, tabSearch, tabHistory   (buttons, role=tab)
panelText, panelDocument, panelNotes, panelSearch, panelHistory  (sections, role=tabpanel)
```
Panels are `aria-labelledby` their tab, tabs are `aria-controls` their panel.

### Translation settings bar (sits above Text/Document canvases)
```
sourceLanguage, targetLanguage, swapLanguagesBtn, settingsBar
```

### Text mode
```
textInput, charCount, wordCount, clearTextBtn, copySourceBtn, translateTextBtn,
translationAreaText, copyTranslationBtnText, downloadTranslationBtnText,
retryTranslationBtnText
```

### Document mode
```
sourceTitleFile, sourceStatus, copyOriginalBtn, prevPageBtn, pageNumber, nextPageBtn,
zoomOutBtn, zoomValue, zoomInBtn, fitWidthBtn, translatePageBtn, translateAllBtn,
addToNotesBtn, attachmentPreview, attachmentLoading
```

### Search mode
```
searchInput, searchBtn, searchScopeThis, searchScopeAll, searchResults, qaInput, qaBtn,
qaAnswer, qaSources
```

### Notes mode
```
notesList, noteTitle, noteBody, saveNoteBtn, deleteNoteBtn, notesSummary,
summarizeBtn, notesEmptyState
```

### History mode
```
historyPanel, historySearchInput, historyListView, historyStatsView, historyList,
historyStats, historyViewList, historyViewStats, clearHistoryBtn
```

### Sources drawer
```
fileInput, uploadCard, sourceFileName, sourcePageCount, sourceFileType, sourceChunks,
fileLibrary, fileLibraryList, fileLibraryRefresh
```

Legacy IDs that must be REMOVED from the page: `statusMessage`, `searchAllDocs`,
`searchScopeLabel`, `notesArea`, `notesTitle`, `historyViewToggle`, `historyViewIcon`,
`historyViewLabel`, `filePreviewSidebar`, `sidebar`, `sidebarOverlay`, `sidebarToggle`,
`closeSidebarBtn`, `sourceLanguage`/`targetLanguage` keep their IDs (they move to the
settings bar, they are not removed).

---

## 5. JS ownership — one file, one agent. Never edit another agent's file.

| file | owner | contents |
|---|---|---|
| `static/js/main.js` | **parent (me)** | element cache, mode switching glue, top-level wiring. Do NOT edit. |
| `static/js/navigation.js` | agent `nav` | `switchWorkspaceTab`, roving tabindex, arrow keys, `updateCharCount` |
| `static/js/ui.js` | agent `ui` | toast system, theme toggle, RTL application, `updateSourceMeta`, `renderFilePreview`, PDF toolbar |
| `static/js/translation.js` | agent `text` | translate text / page / all, button label handling, copy/download/retry |
| `static/js/notes.js` | agent `notes` | note cards, autosave, summary card → `/api/summary` |
| `static/js/history.js` | agent `history` | list/stats segmented control, search, delete, stats |
| `static/js/upload.js` | agent `sources` | upload, drag-over feedback, file library (`GET /api/files`) |
| `static/js/search.js` | agent `search` | NEW: knowledge search, Q&A, segmented scope, vector stats |
| `static/js/api.js` | agent `search` | keep existing; may ADD `listFiles()` and `getFileText()` |
| `static/js/utils.js` | agent `ui` | keep existing; may ADD helpers |
| `static/js/resize.js` | agent `text` | keep existing behaviour, retarget selectors if needed |

Global function names that `main.js` will call (must exist on `window`):
```
switchWorkspaceTab(mode)          navigation.js
updateCharCount()                 navigation.js
updateRTLState()                  ui.js
updateSourceMeta()                ui.js
renderFilePreview()               ui.js
showToast(message, type)          ui.js   (replaces showStatus)
toggleTheme()                     ui.js
translateTextMode()               translation.js
translateCurrentPage()            translation.js
translateAllPages()               translation.js
copyToClipboard(text)             utils.js (exists)
escapeHtml(value)                 utils.js (exists)
formatText(text)                  utils.js (exists)
loadSearchStats()                 search.js
runKnowledgeSearch()              search.js
runQaSearch()                     search.js
renderKnowledgeSearchResults(r)   search.js
renderVectorStats(stats)          search.js
getSearchScopeFilename()          search.js
updateSearchScopeState()          search.js
loadFileLibrary()                 upload.js
initNotesMode()                   notes.js
initHistoryMode()                 history.js
```

`showStatus(...)` is REMOVED — replace every call with `showToast(message, 'success'|'error'|'info')`.

---

## 6. Icon sprite — `static/css/icons.css` + inline `<svg>` in `base.html`

One sprite block at the top of `<body>` in `base.html`, `display:none`,
`width=0 height=0`, containing `<symbol id="i-NAME" viewBox="0 0 20 20">` with
`fill="none" stroke="currentColor" stroke-width="1.5"` paths.

Required symbol ids: `i-text`, `i-doc`, `i-note`, `i-search`, `i-clock`, `i-sparkle`,
`i-copy`, `i-download`, `i-trash`, `i-check`, `i-chevron-left`, `i-chevron-right`,
`i-chevron-down`, `i-plus`, `i-sun`, `i-moon`, `i-panel`, `i-close`, `i-upload`,
`i-zoom-in`, `i-zoom-out`, `i-fit`, `i-refresh`, `i-menu`, `i-file`, `i-warning`,
`i-arrow-right`, `i-arrow-swap`, `i-info`.

Usage: `<svg class="icon" aria-hidden="true"><use href="#i-copy"></use></svg>`.
`.icon` is defined in `icons.css` (20px, `stroke: currentColor`, `fill: none`).

---

## 7. Responsive rules (all agents must respect these)

- `>= 1100px` — full rail (232px) + canvas + optional sources drawer.
- `900–1099px` — rail collapses to icon-only (64px), labels hidden.
- `720–899px` — rail becomes an off-canvas drawer, toggled by `railToggle`; top bar keeps
  brand, model badge, theme toggle, sources toggle.
- `< 720px` — rail becomes a bottom-anchored drawer; the top bar keeps brand + model
  badge + theme toggle + sources toggle. **Navigation must never be `display:none`** —
  this is the bug the plan calls L3.
- No horizontal scroll at 390px. No clipped controls.

---

## 8. RTL rules

- `updateRTLState()` sets `dir` on: `#textInput`, `#translationAreaText`, `#translationArea`,
  `#qaAnswer`, `#qaSources`, `#searchResults`, note bodies, and toggles `.rtl` class.
- RTL content uses `font-family: var(--font-arabic)` and `text-align: start`.
- The chrome (rail, top bar, buttons) stays LTR — only content regions flip.
- The settings bar must visibly indicate that the target language is RTL
  (e.g. a small `.badge` reading "RTL" next to the target select, ID `rtlIndicator`).

---

## 9. Verification (each agent runs these before finishing)

```bash
cd /home/alfa/Myfile/works/translator
venv/bin/python -c "from src.app import app; print('ok')"   # backend still imports
venv/bin/python -m flask --app src.app routes | head -40    # endpoints unchanged
```

And the parent runs, at the end:
```bash
git diff --stat -- src/     # MUST be empty
```

Screenshots are taken by the parent via a headless browser; agents do not need to.
Agents MUST, however, verify their own files: no dangling `getElementById` target,
no reference to a removed ID from §4, no reference to a class name from §3's banned list.
