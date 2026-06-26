# Desktop Layout Refactor

## Goal
Auto-activate full-width single-column layout on desktop (≥1080px) with a collapsible sidebar.

## Layout (Desktop ≥1080px)
1. Top: Notebook source content (textarea + translate button) — full width
2. Middle: Source document and translation side-by-side, each 50% width
3. Bottom: Study notes section (summary + textarea)

## Affected Files
- `templates/index.html` — restructure DOM order/layout
- `static/style.css` — desktop media query + collapsible sidebar styles
- `static/app.js` — minor DOM reference updates

## Tasks

### 1. restructure HTML
- Move text notebook source to top of main pane
- Create side-by-side grid container for source document (left) and translation (right)
- Move study notes below the side-by-side section
- Add collapsible sidebar toggle button, visible only on desktop

### 2. desktop CSS (≥1080px)
```css
/* New layout */
.desktop-layout {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 18px;
}

.sidebar {
  /* Collapsible: translate off-screen or display:none by default on desktop */
  position: fixed;
  top: 0; right: 0; bottom: 0;
  width: 320px;
  transform: translateX(100%);
  transition: transform 0.25s ease;
  z-index: 100;
}
.sidebar.open { transform: translateX(0); }

/* Toggle button */
#sidebarToggle {
  position: fixed;
  top: 16px; right: 16px;
  z-index: 101;
  display: none; /* shown via media query */
}
@media (min-width: 1080px) {
  .notebook-grid { grid-template-columns: 1fr; }
  #sidebarToggle { display: block; }
}
```

### 3. preserved mobile behavior
- Keep current compact two-column layout below 1080px
- no sidebar toggle on mobile
- notes remain in sidebar unless desktop is active

### 4. JS updates
- Add sidebar toggle handler: toggle `.open` on sidebar
- Ensure `updateRTLState` targets moved notes elements
- No changes to translation/summary APIs

## Open Decisions (marked out of scope)
- None

## Validation
- Resize viewport: layout switches at exactly 1080px
- Sidebar toggle opens/closes sidebar on desktop
- Mobile layout unchanged
- Translation and summary still function after DOM move
- RTL with Persian applies to moved notes section
