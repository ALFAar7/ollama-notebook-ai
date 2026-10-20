# Ollama Notebook — UI/UX Refactor Plan

**Branch:** `feat/refactor-ui`
**Scope:** Frontend only. No changes to `src/*.py`, no API contract changes, no changes to translation/RAG/history logic.
**Visual direction:** SOMA / Boto Social house style — light-first, warm neutral, editorial typography, restrained accent, no glassmorphism.

---

## 1. Audit — what is actually broken today

Everything below was verified against the running app (Flask on :5000, DOM inspection + screenshots at 1280px and 390px).

### 1.1 Layout defects (blocking)

| # | Defect | Evidence | Impact |
|---|---|---|---|
| L1 | `.translation-workspace` is `flex-direction: column`, not `row`. `static/css/translation.css` loads *after* `static/css/layout.css` and redefines the class. | computed `flex-direction: column`; source panel `w=926`, output panel `w=926` at `top=584` | The side-by-side "Source ⇄ Translation" workspace never renders. Output is pushed below the fold. This is the single biggest UX failure. |
| L2 | `.search-workspace` is a 3-child `flex-direction: row` containing `.search-panel`, `.qa-section`, `.search-side-panel`. | computed `row`, children widths `0, 0, 0` when hidden; screenshot shows the Q&A input crushed into a ~150px sliver overlapping the search bar | Search tab is visually broken: search bar, Q&A bar and stats rail compete horizontally. |
| L3 | On ≤768px both `.workspace-tabs-nav` and `.language-bar` are `display: none`. | computed `tabs: none`, `lang: none` at 390px | **Mobile users cannot switch tabs and cannot change target language at all.** They are locked in Text mode with a fixed target. |
| L4 | Header packs brand + 4 tabs + language pair + sidebar toggle into one 83px bar. | `header-bar` height 83px, screenshot | Cramped; no hierarchy; tab labels compete with the language pair. |
| L5 | `.sidebar` is a permanent 300px right rail on desktop; the header's sidebar toggle only toggles `.open`, which is only styled ≤900px. | `.sidebar.open` has no desktop rule; `.collapsed` is never toggled | The hamburger is a dead control on desktop. |

### 1.2 Dead / disconnected features (regressions vs. README)

| # | Defect | Evidence | Impact |
|---|---|---|---|
| D1 | **History is entirely unreachable.** `_history_mode.html` is never `{% include %}`d, and `initHistoryMode()` is never called. | `grep` → partial referenced nowhere; `initHistoryMode` has no caller | The `/api/history*` API and `static/js/history.js` (302 lines) are dead code. README documents a "History Mode" that does not exist in the UI. |
| D2 | **Summaries are unreachable.** `updateSummary()` targets `App.els.notesSummary`, but no element with that id exists in any template. | id audit: `notesSummary` absent | `/api/summary` is never called. README advertises "Auto-generated Summaries". |
| D3 | **File library unreachable.** `GET /api/files` returns the 10 most recent uploads, but no frontend code calls it. | `'/api/files' in js` → `False` | User must re-upload a document they already have. |
| D4 | `static/style.css` (713 lines) and `static/app.js` (675 lines) are **not linked** from `base.html` and contain a divergent second implementation of the whole UI. | `LINKED:` list contains only `static/css/*.css` | 1,388 lines of unmaintained duplicate code that drifts from the live one. |
| D5 | `templates/partials/_output.html` is never included and duplicates three ids already in `_text_mode.html` (`translationTitle`, `copyTranslationBtnText`, `translationAreaText`). | id duplication audit | Landmine: including it later silently breaks `getElementById` lookups. |
| D6 | `static/css/history.css` uses 7 variables that are **never defined** (`--border-color`, `--surface-primary`, `--surface-secondary`, `--text-primary`, `--accent-primary`, `--input-bg`, `--error`). | CSS var audit | Even if History were included it would render unstyled. |

### 1.3 Functional bugs in live code

| # | Defect | Evidence | Impact |
|---|---|---|---|
| B1 | **Character count is frozen at "0 characters".** `charCount` is not in the `ids` array in `main.js:cacheElements()`, so `App.els.charCount` is `undefined` and `updateCharCount()` no-ops. | id audit; live DOM shows `0 characters` after typing | Dead UI element. |
| B2 | **Buttons lose their icons permanently.** `translation.js` sets `btn.textContent = 'Translating...'`, which destroys the inline `<svg>`; the `finally` block sets `textContent = 'Translate'`, so the icon is gone after the first run. | `translateTextBtn.innerHTML` after first use | Buttons degrade visually the first time they are used. |
| B3 | **All user feedback is invisible.** `.status-message` is styled only in the unlinked legacy `static/style.css`. `showStatus()` therefore writes unstyled text into a static-flow `<div>` at the bottom of the page. The `.toast-container` exists but no toast is ever created by the live JS. | computed `statusPos: static`, `background: transparent` | Success/error feedback does not read as feedback. |
| B4 | **"Pages: &mdash;"** is written via `textContent`, so the HTML entity is rendered literally. | screenshot of sidebar | Cosmetic bug visible at all times. |
| B5 | **`modelBadge` is cached but no such element exists**, so `loadModels()` silently does nothing. The active Ollama model is never shown. | id audit; `cached but missing: ['modelBadge']` | Users cannot tell which model answers their request. |
| B6 | **Broken ARIA labelling.** Panels use `aria-labelledby="tabText" / "tabDocument" / "tabNotes" / "tabSearch"`, but the tab buttons have no `id` at all. `aria-describedby="sourceTitle"` points at a non-existent id (`sourceTitleFile` is the real one). | ARIA reference audit | Screen-reader users get unlabelled panels. |
| B7 | **Search scope semantics are inverted vs. the docs.** The checkbox is `checked` = "All documents", so with a document open the default is *All*, while the README states "This document (default, when a document is open)". | `main.js:updateSearchScopeState()` | Documented behaviour and actual behaviour disagree. |
| B8 | **Tab keyboard support missing.** `role="tablist"` is declared but there is no arrow-key navigation and no roving `tabindex`. | `navigation.js` | Keyboard users cannot move between tabs. |
| B9 | **RTL is half-implemented.** Only output containers flip to `dir="rtl"`. The source textarea, headers, layout order and page chrome stay LTR, and no Arabic-script font is loaded (Inter is Latin-only in the Google Fonts request). | `ui.js:updateRTLState()` | Kurdish/Persian/Arabic — three of seven target languages — get a mangled reading experience. |
| B10 | **RTL target selection is not reflected in the chrome.** Nothing indicates the output will be RTL before translating. | — | Users get surprised by a direction flip after a long wait. |

### 1.4 Design-language problems

- **Glassmorphism everywhere.** `backdrop-filter: blur(24px)` on every panel, header, and button, over a near-black gradient canvas (`#06060e` → `#0a0a14`). This is the opposite of the SOMA/Boto aesthetic (flat, warm, paper-like, high-contrast, quiet).
- **No typographic system.** One font family at 5 weights; display type, body type and UI type are the same voice. SOMA uses Space Grotesk for display and Inter for text; Boto uses a display face over Inter.
- **No real design tokens.** `variables.css` has 40 ad-hoc variables with no semantic layer (no `surface`/`fg`/`line`/`brand` roles), so every new component re-derives colours by hand. History CSS proves the cost.
- **Rainbow accent soup.** Purple gradient primary, cyan secondary, pink gradient, success green, danger red, plus an orange-ish `--gradient-warm` — five accents competing for one primary action.
- **Emoji as iconography** (📊 🗑️ 📝 📄 💡 🔍) mixed with hand-drawn inline SVG, at inconsistent sizes and weights.
- **No light mode.** `data-theme="dark"` is hard-coded in `<html>`; no toggle exists.
- **Rounded-pill everything.** 999px radius on buttons, pills, tabs and the language bar — nothing reads as a distinct surface.

---

## 2. Target design system

Adopted from the reference sites (tokens extracted from `soma.krd` and `boto.social` production CSS):

**SOMA** — light canvas, zinc neutrals, Space Grotesk display / Inter text / Cairo for Arabic script, orange accent, tight radii (`0.5rem` / `1rem`), generous whitespace, minimal shadow.
**Boto Social** — semantic token roles (`canvas` / `chrome` / `surface` / `ink` / `line` / `brand`), a defined radius scale (`shell 12 · card 14 · panel 20 · control 9 · field 10`), a warm cream chrome (`#f8f4e9`), a proper ink scale, and a first-class dark variant.

### 2.1 Colour

```
Light (default)                    Dark (opt-in toggle)
--canvas      #f8f7f4  (paper)     #0b0b0e
--chrome      #f8f4e9  (warm bar)  #08080a
--surface     #ffffff              #131317
--surface-2   #f4f4f5 (sunken)     #1b1b20
--line        #e4e4e7              #27272a
--line-strong #3f3f46              #3f3f46
--ink-950     #09090b              #fafafa
--ink-700     #3f3f46              #a1a1aa
--ink-500     #71717a              #71717a
--brand       #e8590c  (orange)    #fb923c
--brand-ink   #ffffff              #1a1207
--success     #15803d              #4ade80
--danger      #b91c1c              #f87171
```

One accent (brand orange). Success/danger are semantic status colours, not decorative accents. No gradients on text or buttons.

### 2.2 Type

```
--font-display  "Space Grotesk", "Inter", sans-serif   → headings, panel titles, brand
--font-sans     "Inter", system-ui, sans-serif          → body, UI, controls
--font-arabic   "Cairo", "Inter", sans-serif            → Arabic-script / RTL content
--font-mono     ui-monospace, "JetBrains Mono", monospace
```

Scale: 11 / 12 / 13 / 14 / 16 / 20 / 26 / 34. Display headings use `letter-spacing: -0.02em`. Body 1.5 line-height, prose 1.7.

### 2.3 Space, radius, elevation, motion

- Space scale: 2 / 4 / 8 / 12 / 16 / 24 / 32 / 48 (`--space-1..8`).
- Radii: `--r-control 9px · --r-field 10px · --r-card 14px · --r-panel 20px · --r-shell 12px`. Pills reserved for status chips and the segmented control only.
- Elevation: two levels only — `0 1px 2px rgba(0,0,0,.04)` for cards, `0 8px 24px rgba(0,0,0,.08)` for overlays. No glow, no coloured shadows.
- Motion: 120ms base, 200ms slow, `cubic-bezier(.4,0,.2,1)`. `prefers-reduced-motion` honoured globally.

---

## 3. Information architecture

The current single 83px header cannot hold navigation, language selection, and status. Split responsibilities across three regions.

```
┌───────────┬──────────────────────────────────────────────┐
│  RAIL     │  TOP BAR                                      │
│  232px    │  ┌ doc/context ·············· model · theme · status ┐
│           ├──────────────────────────────────────────────┤
│  ● Text   │                                              │
│  ● Doc    │            MAIN CANVAS                       │
│  ● Notes  │         (mode-specific)                     │
│  ● Search │                                              │
│  ● History│                                              │
│           │                                              │
│  Sources  │                                              │
│  card     │                                              │
└───────────┴──────────────────────────────────────────────┘
```

- **Left rail** (new): mode switcher, then contextual cards. Text/Document/Search/Notes/History all live here. Collapses to icon-only at ≤1100px, becomes a bottom bar / drawer on mobile.
- **Top bar** (slim, 56px): brand mark + wordmark, current context (file name / "New translation"), then right-aligned: active-model badge, Ollama status dot, theme toggle, sources toggle.
- **Language pair** moves out of the header into a dedicated **Translation settings bar** that sits directly above the Text/Document canvases — it is contextual to those modes, not global chrome.
- **Sources panel** becomes a right-hand drawer in every mode (not only Document), fed by a new file-library list backed by the already-existing `GET /api/files`.

### 3.1 Why a rail and not a header tab bar

The header tab bar is the direct cause of L3 (mobile loses navigation entirely) and L4 (cramped). A vertical rail converts horizontal pressure into vertical space, and its mobile collapse is a well-understood pattern (icon rail at ≤1100px, drawer at ≤720px) instead of "hide the navigation".

---

## 4. Screen specifications

### 4.1 Text mode

Two real columns — fixes L1.

```
┌ TRANSLATION SETTINGS ─────────────────────────────────────────┐
│  From [Auto detect ▾]  →  To [Persian ▾]     [⇄ Swap]         │
├─────────────────────────────┬──────────────────────────────────┤
│ SOURCE                      │ TRANSLATION                      │
│ ┌─────────────────────────┐ │ ┌──────────────────────────────┐ │
│ │ textarea                │ │ │ output (dir switches to rtl) │ │
│ │                         │ │ │                              │ │
│ └─────────────────────────┘ │ └──────────────────────────────┘ │
│ 412 words · 2,180 chars     │ [Copy] [Download .txt] [Retry]  │
│                   [Translate]│                                  │
└─────────────────────────────┴──────────────────────────────────┘
```

- Split is a CSS grid `1fr 1fr` with a 1px `--line` divider and a draggable splitter (persisted).
- Word + character count live next to the source, both live-updating (fixes B1).
- Output panel gains **Copy / Download .txt / Retry** — download is genuinely useful for a reading/translation tool and needs no backend.
- Output action buttons are disabled (not hidden) until there is output, with a tooltip reason.
- The whole card is keyboard-scoped: `Ctrl/Cmd+Enter` translates, `Ctrl/Cmd+Shift+C` copies.

### 4.2 Document mode

```
┌ TRANSLATION SETTINGS ─────────────────────────────────────────┐
│  From [Auto detect ▾]  →  To [Persian ▾]                      │
├─────────────────────────────┬──────────────────────────────────┤
│ ● book.pdf · 214 pages      │ TRANSLATION · page 12 of 214     │
│ [◀] [12] [▶]   [Zoom − 100% + Fit] │ [Copy] [Retry]            │
│ ┌─────────────────────────┐ │ ┌──────────────────────────────┐ │
│ │  PDF preview (iframe)   │ │ │ page translation             │ │
│ │                         │ │ │                              │ │
│ └─────────────────────────┘ │ └──────────────────────────────┘ │
│  [Translate page] [Translate all]  [Add to notes]             │
└─────────────────────────────┴──────────────────────────────────┘
```

- Document header strip: filename, page count, page navigation, zoom cluster, and the *source status* (processing / ready / N chunks indexed).
- `Translate all` becomes an explicit, heavier action with a progress affordance (the backend returns the full text at once — the UI states that plainly rather than implying per-page progress it cannot show).
- "Add to notes" writes the current translation into the Notes mode, closing the D2 loop.

### 4.3 Notes mode

Currently a bare textarea in a full-width card with a Save button.

- Notes are **cards** (title, body, source attribution: file + page + language pair, timestamp), not one textarea.
- Autosave with a debounce, plus explicit "saved" state. `localStorage` key is preserved (`notebook-note`) for backwards compatibility, and the existing note is migrated into the first card.
- A **Summary card** pinned at the top: `Summarize current translation` button → `POST /api/summary` → renders into the card. This finally surfaces the dead endpoint (fixes D2) and gives notes a purpose.
- RTL notes get `dir="rtl"` and the Arabic font stack.

### 4.4 Search mode

Fixes L2 by moving to a two-column grid, with Q&A **below** the search bar in the same column, and the vector-store stats collapsed into a small popover card in the top bar.

```
┌ KNOWLEDGE ────────────────────────────┐ ┌ ┐
│ [ Search your documents…        ] 🔍│ │ │
│ Scope: [ This document | All ]      │ │ │
├─────────────────────────────────────┤ │ │
│ result card                          │ │ │
│  book.pdf · p.12 · match 87%         │ │ │
│  …translated passage…                │ │ │
├─────────────────────────────────────┤ │ │
│ ASK ABOUT YOUR DOCUMENTS              │ │ │
│ [ Ask a question…                ] Ask│ │ │
│ answer + citations                   │ │ │
└─────────────────────────────────────┘ ┘ ┘
```

- **Scope becomes a segmented control** (This document / All documents), replacing the inverted checkbox. Default = "This document" when a document is open — matching the README (fixes B7).
- Result cards show source, page, similarity meter, and a Copy action.
- The vector-store panel becomes a small "Knowledge base · 2,230 chunks" popover in the top bar instead of a permanent 260px rail.

### 4.5 History mode (newly reachable)

- Included as a real panel; `initHistoryMode()` wired to the rail.
- **List / Stats** becomes a segmented control in the panel header (replacing the emoji toggle button).
- Each entry card: mode icon (SVG, not emoji), relative timestamp, language pair chips, file + page, source/translation preview, Copy source / Copy translation / Delete.
- Search input with debounced server-side `?q=` search (the API already supports it).
- The unused `GET /api/history/stats` powers the Stats view: total translations, characters translated, mode breakdown, top language pairs.
- `history.css` is rewritten against the new tokens (fixes D6).

### 4.6 Sources (right drawer, all modes)

- Drop zone (drag & drop) + Browse button, with real drag-over feedback (fixes the `.dragging` vs `.dragover` class mismatch in the current CSS).
- Current source card: filename, type badge (PDF/DOCX/TXT), size, page count, chunks indexed.
- **File library** list from `GET /api/files` (fixes D3) — click to load an existing upload without re-uploading.
- Ollama status card with the active model name and the configured endpoint (fixes B5), plus a Retry check.

---

## 5. Component inventory

New `static/css/` layout, all against the token layer:

| File | Contents |
|---|---|
| `tokens.css` | Colour, type, space, radius, shadow, motion, z-index — light + dark |
| `base.css` | Reset, page shell, typography, focus ring, scrollbars, utilities |
| `components.css` | Button (primary/secondary/ghost/danger, sm/md/lg, loading), input, textarea, select, segmented control, switch, badge/pill, card, panel, tooltip, dropdown menu, toast, modal, skeleton, empty state, spinner, kbd hint, progress bar, similarity meter |
| `layout.css` | Rail, top bar, canvas, grid split, splitter, drawer, responsive rules |
| `workspace.css` | Text / Document / Search / Notes / History specific surfaces |
| `icons.css` | Single inline-SVG sprite: file, search, note, clock, sparkle, copy, download, trash, check, chevrons, plus, sun, moon, panel, close |

**Iconography:** one inline SVG sprite sheet, 20×20, 1.5px stroke, `currentColor`. All emoji removed.

**Buttons:** one `.btn` base. Variants: `--primary` (brand fill), `--secondary` (surface + line), `--ghost` (transparent), `--danger`. Sizes `--sm 32px / --md 40px / --lg 48px`. Loading state swaps an internal spinner for the label *without* destroying the icon (fixes B2) — the label lives in a `<span class="btn__label">` and only that span is mutated.

**Feedback:** `showStatus()` is replaced by a real toast system in `#toastContainer` — top-right, stacked, 4s auto-dismiss, error toasts persist until dismissed, `role="status"` / `role="alert"` respectively. The dead `.status-message` path is removed (fixes B3).

**Empty states:** one component, four variants (no-source, no-output, no-results, no-history) — icon, one-line title, one-line explanation, and a single primary action. No two-line marketing copy.

---

## 6. Files to change

### Templates
```
templates/base.html              new shell, token CSS links, rail + top bar, sprite
templates/index.html             include the history panel, canvas structure
templates/partials/_header.html  → replaced by _topbar.html (slim) + _rail.html
templates/partials/_sidebar.html → _sources.html (right drawer)
templates/partials/_text_mode.html      two-column grid, settings bar, word count
templates/partials/_attachment_mode.html page/zoom cluster, source strip
templates/partials/_rag_mode.html        stacked search + Q&A, segmented scope
templates/partials/_notes.html           note cards + summary card
templates/partials/_history_mode.html    wired in, list/stats segmented control
templates/partials/_output.html          DELETED (duplicate ids, unused)
```

### Styles
```
static/css/variables.css   → tokens.css   (rewrite, semantic + light/dark)
static/css/base.css        (rewrite)
static/css/components.css  (rewrite)
static/css/layout.css      (rewrite — fixes L1/L2/L3/L5)
static/css/header.css      → folded into layout.css
static/css/sidebar.css     → folded into layout.css (drawer) + workspace.css (card)
static/css/panels.css      → components.css
static/css/previews.css    (keep PDF viewer + resize, restyle)
static/css/translation.css (rewrite, grid-based)
static/css/notes.css       (rewrite)
static/css/status.css      (rewrite, toast system)
static/css/history.css     (rewrite against tokens — fixes D6)
static/style.css           DELETED (unlinked legacy, 713 lines)
```

### Scripts (UI wiring only — no API, no logic changes)
```
static/js/main.js       element cache fixed (charCount, modelBadge, toasts), rail/topbar wiring
static/js/navigation.js real tab semantics: ids, roving tabindex, arrow keys
static/js/ui.js         toast system, vector-stat popover, RTL application
static/js/translation.js button label handling, word count, copy/download/retry
static/js/upload.js     drag-over class fix, source card updates, file library
static/js/notes.js      note cards, autosave, summary card → /api/summary
static/js/history.js    wire init, list/stats segmented control, delete confirm
static/js/resize.js     keep; retarget to new splitter + preview
static/app.js           DELETED (unlinked legacy, 675 lines)
```

**Explicitly untouched:** `src/app.py`, `src/routes.py`, `src/ollama.py`, `src/rag_pipeline.py`, `src/history.py`, `src/vector_store.py`, `src/ingestion.py`, `src/chunking.py`, `src/embedding.py`, `src/text_utils.py`, `src/pdf_utils.py`, `src/file_utils.py`, `src/misc.py`.

**Contract preserved:** every existing endpoint keeps its current path, method, request body and response shape. No new backend endpoints. `GET /api/files` and `POST /api/summary` — both already implemented — are simply called from the UI for the first time.

---

## 7. Execution order

| Step | Work | Verify |
|---|---|---|
| 1 | `tokens.css` + `base.css` + `components.css` + `icons.css`; delete legacy files | Page renders in new skin; nothing unstyled |
| 2 | `base.html`, `_rail.html`, `_topbar.html`, `index.html` | Rail + top bar; modes switch; responsive at 1280/900/390 |
| 3 | Text mode grid + settings bar + word count + copy/download | L1 fixed; B1, B2 fixed; Ctrl+Enter works |
| 4 | Toast system; `showStatus` callers | B3 fixed; feedback visible for success and error |
| 5 | Document mode: page cluster, zoom, source strip, translate actions | Paging, zoom, fit, resize all still work; PDF iframe intact |
| 6 | Search mode restack + segmented scope + result cards | L2 fixed; B7 fixed; search + Q&A both usable |
| 7 | Notes mode: cards, autosave, summary card | D2 fixed — `/api/summary` now returns visible output |
| 8 | History mode: include, wire `initHistoryMode`, restyle, list/stats | D1, D6 fixed; entries list, search, delete, stats render |
| 9 | Sources drawer + file library (`/api/files`) | D3 fixed; existing upload re-loadable without re-upload |
| 10 | A11y pass: ids, ARIA refs, roving tabindex, arrow keys, focus management | No dangling `aria-labelledby`/`aria-controls`; axe-style check clean |
| 11 | RTL pass: `dir` on source + output + notes + history; Arabic font stack | Kurdish/Persian/Arabic read correctly |
| 12 | Responsive + motion pass; final screenshots at 1440/1024/768/390 | No horizontal scroll; no clipped controls |

Steps 1–4 are the largest visual delta; 5–9 restore features the README already promises.

---

## 8. Verification plan

1. **App boots** — `python app.py`, `GET /` returns 200, `/api/health` ok.
2. **Console clean** — zero JS errors on load and on every mode switch.
3. **Per-mode walkthrough** at 1440 / 1024 / 768 / 390 px, with screenshots.
4. **No dangling references** — script re-runs the id/ARIA/CSS-var audits used in this plan and must report zero.
5. **No orphan selectors** — every class used in templates exists in CSS, and every CSS class is either used or in a documented `unused` list.
6. **Feature re-enabled** — History lists real entries from `GET /api/history`; summary returns real text; file library lists real uploads.
7. **Backend untouched** — `git diff --stat -- src/` is empty.
8. **Regression sweep** — upload, page nav, zoom, fit, resize, translate, copy, search, ask, notes, history delete all still work against the live Ollama endpoint.

---

## 9. Risks

| Risk | Mitigation |
|---|---|
| Big visual diff makes review hard | Land the token layer first as its own commit so the rest reads as "restyled" rather than "rewritten". |
| Rewriting 12 CSS files risks regressions in the PDF viewer / resizer | `previews.css` and `resize.js` behaviour is preserved deliberately; verify zoom/fit/drag/reset/arrow-keys explicitly in step 5. |
| Deleting `static/style.css` / `static/app.js` may break a path not linked from `base.html` | Confirm zero references repo-wide before deleting; they are already unreachable. |
| History/Notes/summary were "working" for nobody — surfacing them may expose backend rough edges | Surface them, but fail soft: each card shows an inline error state rather than throwing. |
| Ollama is unreachable in this environment (`OLLAMA_URL` default is a LAN IP) | Verify layout with the real endpoints where possible; for translation paths, exercise the request/response shape with a stubbed payload so the UI contract is proven. |

---

## 10. Out of scope

- Backend, API, models, prompts, RAG, chunking, history storage format.
- New features beyond surfacing existing ones (file library, summaries, history).
- Authentication / multi-user.
- A component framework or build step — plain Jinja + CSS + vanilla JS, as today.
