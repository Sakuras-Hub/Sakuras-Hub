"""Paste the directory extras (fuzzy search, Ctrl+K search, recently visited,
shareable links, safety tip) into directory.html.

Run from the repo root, as many times as you like. It is safe to re-run after
you edit scripts/page-code/extras.js or extras.css: it replaces the old copy.

    python scripts/tools/inject-extras.py
"""
import re
import sys

PAGE = "directory.html"
JS_FILE = "scripts/page-code/extras.js"
CSS_FILE = "scripts/page-code/extras.css"

with open(PAGE, encoding="utf-8") as f:
    html = f.read()
with open(JS_FILE, encoding="utf-8") as f:
    js = f.read().rstrip() + "\n"
with open(CSS_FILE, encoding="utf-8") as f:
    css = f.read().rstrip() + "\n"

if not js.rstrip().endswith("/* EXTRAS:END */"):
    sys.exit("extras.js must end with the /* EXTRAS:END */ marker")


def must_replace(text, old, new, label):
    """Replace one exact piece of the page, once. Skips if already done."""
    if new in text:
        return text
    if text.count(old) != 1:
        sys.exit(f"Could not patch '{label}': expected 1 match, found {text.count(old)}. "
                 "The page changed; update this tool.")
    return text.replace(old, new)


# 1. Markup: the Ctrl+K button, the recently-visited bar, the Fuse.js script.
html = must_replace(
    html,
    '<input type="text" id="searchInput" placeholder="Search sites…  (press / to focus)" autocomplete="off" autocorrect="off" spellcheck="false">',
    '<input type="text" id="searchInput" placeholder="Search sites…  (press / to focus)" autocomplete="off" autocorrect="off" spellcheck="false">\n'
    '    <button type="button" id="kpBtn" class="kp-btn" aria-label="Open quick search"></button>',
    "search button",
)
html = must_replace(
    html,
    '  <div id="grid"></div>',
    '  <div id="recentsBar" hidden></div>\n  <div id="grid"></div>',
    "recents bar",
)
html = must_replace(
    html,
    "<script>\n(function(){\n'use strict';\n\n/* ---------- real site constants ---------- */",
    '<script src="assets/vendor/fuse.min.js"></script>\n'
    "<script>\n(function(){\n'use strict';\n\n/* ---------- real site constants ---------- */",
    "fuse script tag",
)

# 2. Hooks into the page's own functions.
html = must_replace(
    html,
    "    if (q && (s.name + ' ' + normalizeTags(s.tags).join(' ')).toLowerCase().indexOf(q) === -1) return false;",
    "    if (q && !sakuraExtras.matches(s, q)) return false;",
    "search match",
)
html = must_replace(
    html,
    "    if (sortMode === 'az') matched.sort(",
    "    if (q && sortMode !== 'az') sakuraExtras.sortByRelevance(matched, q);\n    if (sortMode === 'az') matched.sort(",
    "relevance sort",
)
html = must_replace(
    html,
    "  el.grid.innerHTML = html;\n}\n\nfunction applySearch(){",
    "  el.grid.innerHTML = html;\n  sakuraExtras.afterRender();\n}\n\nfunction applySearch(){",
    "after render hook",
)
html = must_replace(
    html,
    "  buildCountryMenu();\n  renderTabs();\n  renderGrid();\n}",
    "  buildCountryMenu();\n  renderTabs();\n  renderGrid();\n  sakuraExtras.onBuilt();\n}",
    "after build hook",
)

html = must_replace(
    html,
    "    } else {\n      var msg = 'Broken link: ' + b.getAttribute('data-name') + ' ' + url;",
    "    } else if (typeof sakuraExtras !== 'undefined' && sakuraExtras.openReport) {\n      sakuraExtras.openReport(url, b.getAttribute('data-name'), b);\n    } else {\n      var msg = 'Broken link: ' + b.getAttribute('data-name') + ' ' + url;",
    "report button",
)

# 3. The CSS block (replaced on every run).
css_block = ('<style id="extras-css">\n/* EXTRAS-CSS:START */\n' + css + '/* EXTRAS-CSS:END */\n</style>\n')
if "/* EXTRAS-CSS:START */" in html:
    html = re.sub(r'<style id="extras-css">.*?</style>\n', lambda m: css_block, html, count=1, flags=re.S)
else:
    html = html.replace("</head>", css_block + "</head>", 1)

# 4. The JS block (replaced on every run).
js_block = "/* EXTRAS:START */\n" + js
if "/* EXTRAS:START */" in html:
    html = re.sub(r"/\* EXTRAS:START \*/.*?/\* EXTRAS:END \*/\n", lambda m: js_block, html, count=1, flags=re.S)
else:
    anchor = "\ninitCountryDropdown();\ninitCategoryDropdown();"
    if html.count(anchor) != 1:
        sys.exit("Could not find where to insert the extras script.")
    html = html.replace(anchor, "\n" + js_block + anchor, 1)

with open(PAGE, "w", encoding="utf-8") as f:
    f.write(html)
print("directory.html updated with the extras.")
