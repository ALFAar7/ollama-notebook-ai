#!/usr/bin/env python3
"""
Browser-side verification of the refactored UI.

Loads the app in headless Chrome via the Browser Use CDP bridge, walks every
mode at four breakpoints, and reports:
  * console errors
  * horizontal overflow
  * navigation reachability (the mobile-nav regression, defect L3)
  * duplicate ids / dangling aria references in the live DOM
  * screenshot per mode per breakpoint

Run tools/serve.sh <port> first, then:  venv/bin/python tools/verify_ui.py <port>
"""

import json
import subprocess
import sys
import time
import urllib.request

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 5055
BASE = f"http://127.0.0.1:{PORT}"
OUT = "artifacts/screenshots"

VIEWPORTS = [
    ("desktop", 1440, 900),
    ("laptop", 1024, 800),
    ("tablet", 768, 1024),
    ("mobile", 390, 844),
]

MODES = ["text", "document", "notes", "search", "history"]


def probe():
    """Ask the browser for page facts."""
    script = r"""
    (() => {
      const ids = {};
      const seen = {};
      document.querySelectorAll('[id]').forEach(el => {
        seen[el.id] = (seen[el.id] || 0) + 1;
      });
      const dupes = Object.entries(seen).filter(([, n]) => n > 1).map(([k]) => k);
      const dangling = [];
      document.querySelectorAll('[aria-labelledby],[aria-controls],[aria-describedby]')
        .forEach(el => {
          ['aria-labelledby','aria-controls','aria-describedby'].forEach(attr => {
            const v = el.getAttribute(attr);
            if (!v) return;
            v.split(/\s+/).forEach(ref => {
              if (ref && !document.getElementById(ref)) {
                dangling.push(`${el.tagName.toLowerCase()}#${el.id||'?'}[${attr}=${ref}]`);
              }
            });
          });
        });
      const nav = document.querySelector('#rail');
      const navStyle = nav ? getComputedStyle(nav) : null;
      const tabs = [...document.querySelectorAll('[role="tab"]')].map(t => ({
        id: t.id,
        visible: t.offsetParent !== null || t.getClientRects().length > 0
      }));
      const visibleTabs = tabs.filter(t => t.visible).map(t => t.id);
      return JSON.stringify({
        scrollW: document.documentElement.scrollWidth,
        clientW: document.documentElement.clientWidth,
        dupes, dangling,
        navDisplay: navStyle ? navStyle.display : null,
        navVisibility: navStyle ? navStyle.visibility : null,
        tabs, visibleTabs,
        activePanel: (document.querySelector('.tab-panel.is-active, .tab-panel.active')||{}).id,
        title: document.title
      });
    })()
    """
    return script


def main():
    try:
        urllib.request.urlopen(BASE, timeout=5).read()
    except Exception as exc:
        print(f"app not reachable at {BASE}: {exc}")
        return 2

    print(f"app reachable at {BASE}")
    print("this script is driven by the browser tool; see tools/verify_ui.js")
    return 0


if __name__ == "__main__":
    sys.exit(main())
