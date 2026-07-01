import json
import os

INDEX_PATH = "index.html"
STATUS_JSON_PATH = "status/status.json"

if not os.path.exists(STATUS_JSON_PATH):
    print("No status data found, skipping injection")
    exit(0)

with open(STATUS_JSON_PATH, "r", encoding="utf-8") as f:
    status = json.load(f)

with open(INDEX_PATH, "r", encoding="utf-8") as f:
    html = f.read()

css_code = """
  .monitor-view { margin-top: 0; }
  .monitor-view .monitor-stats { display: flex; gap: 10px; margin: 14px 0 18px; flex-wrap: wrap; }
  .monitor-view .monitor-stat {
    padding: 8px 18px; border-radius: var(--radius-lg); font-size: 0.82rem;
    font-weight: 600; letter-spacing: 0.5px; border: 1px solid var(--border);
    background: var(--surface);
  }
  .monitor-view .monitor-stat.stat-up { color: #3fb950; }
  .monitor-view .monitor-stat.stat-down { color: #f55e6a; }
  .monitor-view .monitor-stat.stat-blocked { color: #d29922; }
  .monitor-view .monitor-stat.stat-total { color: var(--muted); }
  .monitor-view .monitor-wrap {
    background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg);
    overflow-x: auto;
  }
  .monitor-view .monitor-wrap table {
    width: 100%; border-collapse: collapse; font-size: 0.78rem; min-width: 600px;
  }
  .monitor-view .monitor-wrap th {
    padding: 8px 10px; text-align: left; border-bottom: 1px solid var(--border);
    color: var(--muted); font-weight: 600; white-space: nowrap;
    background: rgba(0,0,0,0.2); font-family: 'Inter', sans-serif;
  }
  .monitor-view .monitor-wrap td {
    padding: 6px 10px; border-bottom: 1px solid var(--border);
  }
  .monitor-view .monitor-wrap tr:hover td { background: rgba(255,0,255,0.03); }
  .monitor-view .monitor-wrap .st-cell { white-space: nowrap; }
  .monitor-view .monitor-wrap .st-cell .st-dot { font-size: 0.85rem; }
  .monitor-view .monitor-wrap .st-cell .st-label { font-size: 0.7rem; font-weight: 600; margin-left: 3px; }
  .monitor-view .monitor-wrap .st-cell .st-label.label-up { color: #3fb950; }
  .monitor-view .monitor-wrap .st-cell .st-label.label-down { color: #f55e6a; }
  .monitor-view .monitor-wrap .st-cell .st-label.label-blocked { color: #d29922; }
  .monitor-view .monitor-wrap .name-cell { color: var(--accent-text); }
  .monitor-view .monitor-wrap .url-cell a { color: var(--muted); text-decoration: none; }
  .monitor-view .monitor-wrap .url-cell a:hover { color: var(--accent-text); }
  .monitor-view .monitor-wrap .sec-cell { color: var(--muted); }
  .monitor-view .monitor-wrap .det-cell { color: var(--muted2); font-size: 0.72rem; }
  .monitor-view .monitor-updated { margin-top: 10px; color: var(--muted2); font-size: 0.72rem; text-align: right; }
"""

fl_sec_css = "  .fl-section-header::after {"
if fl_sec_css in html:
    css_insert = html.find(fl_sec_css) + len(fl_sec_css)
    brace_depth = 0
    for i in range(css_insert, len(html)):
        if html[i] == '{': brace_depth += 1
        elif html[i] == '}':
            if brace_depth == 0:
                css_insert = i + 1
                break
            brace_depth -= 1

    if ".monitor-view" not in html:
        html = html[:css_insert] + "\n" + css_code + html[css_insert:]
        print("Added monitor CSS")
else:
    print("Could not find fl-section-header CSS")
    exit(1)

var_insertion_marker = "let listShowNSFW = false;"
vidx = html.find(var_insertion_marker)
if vidx == -1:
    print("Could not find variable declarations")
    exit(1)

vline_end = html.find("\n", vidx)
monitor_json_str = json.dumps(status, indent=2, ensure_ascii=False)
monitor_var = "\nvar MONITOR_DATA = " + monitor_json_str + ";\n"

while True:
    oidx = html.find("var MONITOR_DATA = ")
    if oidx == -1:
        break
    osemi = html.find(";\n", oidx)
    if osemi == -1:
        osemi = html.find(";", oidx)
    if osemi != -1:
        html = html[:oidx] + html[osemi+1:]
        print("Removed old MONITOR_DATA")

html = html[:vline_end+1] + monitor_var + html[vline_end+1:]
print("Added MONITOR_DATA variable")

for pat in ["var monitorActive", "function renderMonitorSection", "async function renderMonitorSection", "function toggleMonitor"]:
    while True:
        fidx = html.find(pat)
        if fidx == -1:
            break
        depth, started, fend = 0, False, fidx
        for i in range(fidx, len(html)):
            if html[i] == '{':
                depth += 1
                started = True
            elif html[i] == '}':
                depth -= 1
                if started and depth == 0:
                    fend = i + 1
                    break
        html = html[:fidx] + html[fend:]
        print("Removed old " + pat)

call_marker = "renderMonitorSection();"
while True:
    cidx = html.find(call_marker)
    if cidx == -1:
        break
    html = html[:cidx] + html[cidx + len(call_marker):]
    print("Removed old renderMonitorSection() call")

for old_pat in ["if (!document.getElementById('monitorToggle'))", "// Add monitor button"]:
    while True:
        oidx = html.find(old_pat)
        if oidx == -1:
            break
        line_end = html.find("\n", oidx)
        html = html[:oidx] + html[line_end+1:]
        print("Removed old monitor button code")

pin = html.find("panel.innerHTML = html;")
if pin != -1:
    call_code = """

    var flBar = panel.querySelector('.fl-bar');
    if (flBar && !document.getElementById('monitorToggle')) {
      var mtBtn = document.createElement('button');
      mtBtn.id = 'monitorToggle';
      mtBtn.className = 'fl-nsfw-toggle';
      mtBtn.textContent = '\\ud83d\\udcca Monitor';
      mtBtn.style.cssText = 'margin-left:6px';
      mtBtn.addEventListener('click', function(e) { e.stopPropagation(); toggleMonitor(); });
      var nsfwToggle = flBar.querySelector('#listNsfwToggle');
      if (nsfwToggle) {
        flBar.insertBefore(mtBtn, nsfwToggle.nextSibling);
        nsfwToggle.addEventListener('click', function(ev) {
          if (monitorActive) {
            ev.stopImmediatePropagation();
            listShowNSFW = !listShowNSFW;
            this.textContent = listShowNSFW ? '\\ud83d\\udd1e Hide NSFW' : '\\ud83d\\udd1e Show NSFW';
            this.classList.toggle('active', listShowNSFW);
            renderMonitorSection();
          }
        });
      } else {
        flBar.appendChild(mtBtn);
      }
      var catMenu = flBar.querySelector('#flCategory .fl-dd-menu');
      if (catMenu) {
        catMenu.addEventListener('click', function(ev) {
          if (monitorActive) {
            var item = ev.target.closest('.fl-dd-item');
            if (!item) return;
            ev.stopImmediatePropagation();
            listFilter = item.dataset.value;
            catMenu.querySelectorAll('.fl-dd-item').forEach(function(el) { el.classList.toggle('selected', el === item); });
            var trig = flBar.querySelector('#flCategory .fl-trigger');
            if (trig) trig.textContent = item.textContent;
            var dd = flBar.querySelector('#flCategory');
            if (dd) dd.classList.remove('open');
            renderMonitorSection();
          }
        });
      }
    }
    if (monitorActive) {
      renderMonitorSection();
      var bt = document.getElementById('monitorToggle');
      if (bt) { bt.textContent = '\\u2716 Close Monitor'; bt.classList.add('active'); }
      if (listFilter && listFilter !== 'all') {
        var selItem = document.querySelector('.fl-dd-item.selected');
        var trig = document.querySelector('#flCategory .fl-trigger');
        if (trig && selItem) trig.textContent = selItem.textContent;
      }
    }
"""
    after_line = html.find("\n", pin)
    html = html[:after_line] + call_code + html[after_line:]
    print("Added monitor button + handler")

with open(INDEX_PATH, "w", encoding="utf-8") as f:
    f.write(html)

print("Done")
