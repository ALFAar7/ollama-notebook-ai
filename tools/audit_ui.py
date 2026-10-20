#!/usr/bin/env python3
"""
Static audit for the UI refactor.

Checks, in order:
  1. Duplicate element ids in the templates.
  2. Dangling aria-* references (aria-labelledby / aria-controls / aria-describedby)
     pointing at ids that do not exist in the rendered template set.
  3. CSS custom properties used but never defined.
  4. getElementById('x') / querySelector('#x') targets that do not exist in the templates.
  5. Classes referenced in templates that no stylesheet defines.
  6. Banned legacy class names still present.

Usage:  venv/bin/python tools/audit_ui.py
Exit code 0 = clean, 1 = findings.
"""

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TEMPLATES = ROOT / "templates"
STATIC = ROOT / "static"

BANNED_CLASSES = {
    "glass-card", "primary-btn", "secondary-btn", "ghost-btn", "text-input-area",
    "workspace-tab-btn", "tab-icon", "tab-label", "search-input", "note-textarea",
    "meta-pill", "status-message", "text-gradient",
}

# Ids that are created at runtime by JS, not present in the markup.
RUNTIME_IDS = {
    "noteTitle", "noteBody", "saveNoteBtn", "deleteNoteBtn", "searchStats",
    "statusMessage", "searchAllDocs", "searchScopeLabel", "notesArea", "notesTitle",
    "historyViewToggle", "historyViewIcon", "historyViewLabel", "filePreviewSidebar",
    "sidebar", "sidebarOverlay", "sidebarToggle", "closeSidebarBtn",
}


def read(path):
    return path.read_text(encoding="utf-8", errors="replace")


def collect():
    template_files = sorted(TEMPLATES.rglob("*.html"))
    css_files = sorted((STATIC / "css").glob("*.css"))
    js_files = sorted((STATIC / "js").glob("*.js"))
    return template_files, css_files, js_files


def strip_jinja(text):
    """Remove Jinja blocks so their contents are not parsed as markup."""
    text = re.sub(r"\{%.*?%\}", " ", text, flags=re.S)
    text = re.sub(r"\{\{.*?\}\}", " ", text, flags=re.S)
    return text


def audit(template_files, css_files, js_files):
    findings = []

    # ---- ids defined in templates -------------------------------------
    defined_ids = set()
    id_locations = {}
    for path in template_files:
        text = strip_jinja(read(path))
        for match in re.finditer(r'\bid="([^"]+)"', text):
            element_id = match.group(1)
            defined_ids.add(element_id)
            id_locations.setdefault(element_id, []).append(path.name)

    for element_id, locations in sorted(id_locations.items()):
        if len(locations) > 1:
            findings.append(
                f"[duplicate-id] #{element_id} defined in: {', '.join(sorted(set(locations)))}"
            )

    # ---- aria references ----------------------------------------------
    for path in template_files:
        text = strip_jinja(read(path))
        for attr in ("aria-labelledby", "aria-controls", "aria-describedby", "aria-owns"):
            for match in re.finditer(rf'{attr}="([^"]+)"', text):
                for ref in match.group(1).split():
                    if ref not in defined_ids:
                        findings.append(
                            f"[dangling-aria] {path.name}: {attr}=\"{ref}\" -> no such id"
                        )

    # ---- css variables ------------------------------------------------
    defined_vars = set()
    fallback_vars = set()
    used_vars = {}
    for path in css_files:
        text = read(path)
        for match in re.finditer(r"(--[\w-]+)\s*:", text):
            defined_vars.add(match.group(1))
        # var(--x, fallback) is intentionally runtime-set (JS writes the property),
        # so a missing token definition there is not a defect.
        for match in re.finditer(r"var\(\s*(--[\w-]+)\s*,", text):
            fallback_vars.add(match.group(1))
        for match in re.finditer(r"var\(\s*(--[\w-]+)\s*\)", text):
            used_vars.setdefault(match.group(1), set()).add(path.name)

    for var, sources in sorted(used_vars.items()):
        if var not in defined_vars and var not in fallback_vars:
            findings.append(
                f"[undefined-css-var] {var} used in: {', '.join(sorted(sources))}"
            )

    # ---- js id references ---------------------------------------------
    for path in js_files:
        text = read(path)
        targets = set(re.findall(r"getElementById\(\s*['\"]([\w-]+)['\"]", text))
        targets |= set(re.findall(r"querySelector\(\s*['\"]#([\w-]+)['\"]", text))
        for target in sorted(targets):
            if target not in defined_ids and target not in RUNTIME_IDS:
                findings.append(
                    f"[missing-dom-id] {path.name}: references #{target} which no template defines"
                )

    # ---- template classes vs css --------------------------------------
    css_classes = set()
    for path in css_files:
        text = read(path)
        css_classes |= set(re.findall(r"\.([a-zA-Z][\w-]*)", text))

    used_classes = {}
    for path in template_files:
        text = strip_jinja(read(path))
        for match in re.finditer(r'class="([^"]+)"', text):
            for name in match.group(1).split():
                used_classes.setdefault(name, set()).add(path.name)

    for name, sources in sorted(used_classes.items()):
        if name not in css_classes:
            findings.append(
                f"[unstyled-class] .{name} used in: {', '.join(sorted(sources))} but no CSS defines it"
            )
        if name in BANNED_CLASSES:
            findings.append(f"[banned-class] .{name} used in: {', '.join(sorted(sources))}")

    return findings


def main():
    template_files, css_files, js_files = collect()
    findings = audit(template_files, css_files, js_files)

    print(f"templates: {len(template_files)}  css: {len(css_files)}  js: {len(js_files)}")
    if not findings:
        print("AUDIT CLEAN — no findings")
        return 0

    print(f"\n{len(findings)} finding(s):\n")
    for finding in findings:
        print(" ", finding)
    return 1


if __name__ == "__main__":
    sys.exit(main())
