(function() {
  if (document.getElementById('mc-styles')) return;
  var ss = document.createElement('style');
  ss.id = 'mc-styles';
    ss.textContent = '.monitor-view .monitor-wrap .bars-cell{white-space:nowrap;min-width:150px;display:flex;align-items:center;gap:4px}.bars-cell .mc-bars{display:inline-flex;gap:2px;height:14px;align-items:flex-end}.bars-cell .mc-ms{flex-shrink:0;font-size:.75rem;font-weight:600}.bars-cell .mc-ms-down{color:#f55e6a}.bars-cell .mc-code{flex-shrink:0;font-size:.7rem;opacity:.6;margin-left:2px}.bars-cell .mc-code-down{color:#f55e6a;opacity:1}.bars-cell .mc-code-blocked{color:#d29922;opacity:1}.st-label.label-wait{color:#d29922}.st-label.label-pending{color:#8b949e}.st-label.label-unreachable{color:#f0883e}@media(max-width:640px){.monitor-view .monitor-wrap table{table-layout:fixed;min-width:0}.monitor-view .monitor-wrap td{padding:4px 5px;font-size:.7rem;overflow:hidden;text-overflow:ellipsis}.monitor-view .monitor-wrap .url-cell a{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.monitor-view .monitor-wrap .sec-cell{display:none}.monitor-view .monitor-wrap .bars-cell{min-width:70px}.monitor-view .monitor-wrap .name-cell{max-width:90px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}}@media(max-width:480px){.monitor-view{overflow-x:hidden}.monitor-view .monitor-wrap{overflow-x:hidden}.monitor-view .monitor-wrap table,.monitor-view .monitor-wrap tbody,.monitor-view .monitor-wrap thead,.monitor-view .monitor-wrap tr{display:block;width:100%}.monitor-view .monitor-wrap thead{display:none}.monitor-view .monitor-wrap tr{margin-bottom:6px;padding:6px 8px;background:var(--surface2,rgba(255,255,255,0.04));border-radius:6px;display:flex;flex-wrap:wrap;gap:2px 8px}.monitor-view .monitor-wrap td{display:inline-flex;align-items:center;gap:3px;padding:2px 0;font-size:.68rem;border:none;overflow:visible;text-overflow:clip}.monitor-view .monitor-wrap .st-cell{width:auto;flex-shrink:0}.monitor-view .monitor-wrap .name-cell{max-width:50%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex-shrink:1}.monitor-view .monitor-wrap .url-cell{display:none !important}.monitor-view .monitor-wrap .sec-cell{display:none !important}.monitor-view .monitor-wrap .bars-cell{min-width:0;width:auto;flex-shrink:1;white-space:nowrap;display:inline-flex}}';
  document.head.appendChild(ss);
  var ss2 = document.createElement('style');
  ss2.textContent = '.cc-badge{display:inline-block;padding:0 6px;margin-left:4px;border-radius:4px;background:var(--surface2,rgba(255,255,255,0.06));border:1px solid var(--border);font-size:.62rem;font-weight:600;color:var(--text);cursor:default;white-space:nowrap}.cc-global{opacity:.55;font-size:.68rem}.monitor-search-row select{padding:4px 8px;border-radius:4px;border:1px solid var(--border);background:var(--surface);color:var(--text);font-size:.75rem;max-width:150px}';
  document.head.appendChild(ss2);
  function mc_initToggle() {
    if (document.getElementById('monitorToggle')) return;
    var flBar = document.querySelector('.fl-bar');
    if (flBar) {
      var b = document.createElement('button');
      b.id = 'monitorToggle'; b.className = 'fl-nsfw-toggle';
      b.textContent = '\ud83d\udcca Monitor'; b.style.cssText = 'margin-left:6px';
      b.addEventListener('click', function(e) { e.stopPropagation(); toggleMonitor(); });
      flBar.appendChild(b);
    }
  }
  mc_initToggle();
  setTimeout(mc_initToggle, 600);
  setTimeout(mc_initToggle, 2500);
})();
var monitorActive = false;
var MONITOR_API_URLS = (typeof MONITOR_API_URLS !== 'undefined' && MONITOR_API_URLS)
  ? MONITOR_API_URLS
  : ((typeof MONITOR_API_URL !== 'undefined' && MONITOR_API_URL)
      ? [MONITOR_API_URL]
      : ['https://sakura-monitor.sakura-market.workers.dev/status']);
var MONITOR_API_URL = MONITOR_API_URLS[0];
var MONITOR_POLL_MS = 5 * 60 * 1000;
var monitorPollTimer = null;
var monitorApiData = null;
var monitorSearchTerm = '';
var monitorCountryFilter = '';
var monitorStatusFilter = '';
var monitorLimit = 200;
var CC_LABELS = { RU: '🇷🇺 Russia', IN: '🇮🇳 India', JP: '🇯🇵 Japan', PL: '🇵🇱 Poland', GB: '🇬🇧 United Kingdom', ID: '🇮🇩 Indonesia' };
var MAX_BARS = 24;
var MC_STATUS_BY_CHAR = { '0': 'up', '1': 'blocked', '2': 'down', '3': 'unreachable' };
var MC_COLORS = { up: '#3fb950', blocked: '#d29922', down: '#f55e6a', unreachable: '#f0883e', pending: '#444c56' };

function esc2(s) {
  if (s == null) return '';
  var d = document.createElement('div');
  d.textContent = String(s);
  return d.innerHTML;
}

function mc_toStatus(s) {
  var st = String(s.status || s.liveStatus || '').toLowerCase();
  if (st === 'ok' || st === 'up' || st === 'live') return 'up';
  if (st === 'dead' || st === 'down') return 'down';
  if (st === 'unreachable') return 'unreachable';
  if (st === 'pending' || st === 'waiting' || st === 'not checked yet') return 'pending';
  return 'blocked';
}

function mc_extractCode(s) {
  if (s.code != null) return parseInt(s.code, 10) || null;
  var m = s.detail ? String(s.detail).match(/HTTP (\d{3})/) : null;
  return m ? parseInt(m[1], 10) : null;
}

function mc_ensureStyles() {
  if (document.getElementById('mc-stats-styles')) return;
  var st = document.createElement('style');
  st.id = 'mc-stats-styles';
  st.textContent = [
    '.monitor-view{display:flex;flex-direction:column;gap:14px;margin-top:2px}',
    '.monitor-view .mc-tool{display:flex;flex-wrap:wrap;gap:8px;align-items:center}',
    '.monitor-view .mc-chips{display:flex;flex-wrap:wrap;gap:6px}',
    '.monitor-view .mc-chip{display:inline-flex;align-items:center;gap:6px;padding:6px 11px;border-radius:999px;border:1px solid var(--border,rgba(255,255,255,.12));background:rgba(255,255,255,.03);color:var(--muted,#9aa0b5);font:600 .72rem/1 Inter,sans-serif;cursor:pointer;transition:border-color .15s,background .15s,color .15s}',
    '.monitor-view .mc-chip:hover{border-color:rgba(var(--accent-rgb),.35);color:var(--text,#fff)}',
    '.monitor-view .mc-chip b{font-weight:800;font-size:.68rem;color:var(--text,#fff);font-variant-numeric:tabular-nums;opacity:.85}',
    '.monitor-view .mc-chip.is-on{background:rgba(var(--accent-rgb),.16);border-color:rgba(var(--accent-rgb),.5);color:#fff}',
    '.monitor-view .mc-search{flex:1 1 220px;min-width:150px;padding:8px 13px;border-radius:999px;border:1px solid var(--border,rgba(255,255,255,.12));background:rgba(0,0,0,.28);color:var(--text,#fff);font:500 .78rem Inter,sans-serif;outline:none;transition:border-color .15s,background .15s}',
    '.monitor-view .mc-search::placeholder{color:var(--muted2,#524d66)}',
    '.monitor-view .mc-search:focus{border-color:rgba(var(--accent-rgb),.55);background:rgba(0,0,0,.38)}',
    '.monitor-view .mc-select{padding:8px 11px;border-radius:999px;border:1px solid var(--border,rgba(255,255,255,.12));background:rgba(0,0,0,.28);color:var(--text,#fff);font:500 .76rem Inter,sans-serif;outline:none;cursor:pointer;max-width:180px}',
    '.monitor-view .mc-btn{padding:8px 15px;border-radius:999px;border:1px solid rgba(var(--accent-rgb),.32);background:rgba(var(--accent-rgb),.12);color:var(--accent-text,#ff88ff);font:700 .74rem Inter,sans-serif;cursor:pointer;transition:background .15s,border-color .15s;white-space:nowrap}',
    '.monitor-view .mc-btn:hover{background:rgba(var(--accent-rgb),.22);border-color:rgba(var(--accent-rgb),.55)}',
    '.monitor-view .mc-btn.mc-more{align-self:center}',
    '.monitor-view .mc-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px}',
    '.monitor-view .mc-card{position:relative;padding:13px 15px 12px;border:1px solid var(--border,rgba(255,255,255,.12));border-radius:var(--radius-lg,13px);background:linear-gradient(160deg,rgba(255,255,255,.055),rgba(255,255,255,.012));overflow:hidden}',
    '.monitor-view .mc-card:before{content:"";position:absolute;left:0;top:0;bottom:0;width:3px;background:rgba(255,255,255,.1)}',
    '.monitor-view .mc-card.mc-up-hi:before{background:#4cd989}',
    '.monitor-view .mc-card.mc-up-mid:before{background:#d29922}',
    '.monitor-view .mc-card.mc-up-lo:before{background:#f55e6a}',
    '.monitor-view .mc-card-l{font-size:.58rem;letter-spacing:.13em;text-transform:uppercase;color:var(--muted2,#524d66);font-weight:800}',
    '.monitor-view .mc-card-v{margin-top:6px;font-size:1.5rem;font-weight:800;line-height:1;letter-spacing:-.02em;font-variant-numeric:tabular-nums;color:inherit}',
    '.monitor-view .mc-card-s{margin-top:6px;font-size:.64rem;color:var(--muted,#9aa0b5);line-height:1.4}',
    '.monitor-view .mc-note{font-size:.68rem;color:var(--muted,#9aa0b5);line-height:1.55;margin:0;opacity:.85}',
    '.monitor-view .mc-sec{display:flex;flex-direction:column;gap:8px}',
    '.monitor-view .mc-sec-title{display:flex;align-items:center;gap:10px;font:800 .6rem/1 Inter,sans-serif;letter-spacing:.14em;text-transform:uppercase;color:var(--muted2,#524d66)}',
    '.monitor-view .mc-sec-title:after{content:"";flex:1;height:1px;background:var(--border,rgba(255,255,255,.12))}',
    '.monitor-view .mc-tbl-wrap{border:1px solid var(--border,rgba(255,255,255,.12));border-radius:var(--radius-lg,13px);background:rgba(10,9,20,.5);overflow:hidden}',
    '.monitor-view .mc-sites-wrap{max-height:72vh;overflow:auto}',
    '.monitor-view .mc-tbl{width:100%;border-collapse:collapse;font-size:.76rem}',
    '.monitor-view .mc-tbl thead th{position:sticky;top:0;z-index:2;padding:9px 12px;text-align:left;font:800 .57rem/1.3 Inter,sans-serif;letter-spacing:.12em;text-transform:uppercase;color:var(--muted2,#524d66);background:#100e1c;border-bottom:1px solid var(--border,rgba(255,255,255,.12));white-space:nowrap}',
    '.monitor-view .mc-tbl tbody td{padding:8px 12px;border-bottom:1px solid rgba(var(--accent-rgb),.07);vertical-align:middle}',
    '.monitor-view .mc-tbl tbody tr:last-child td{border-bottom:none}',
    '.monitor-view .mc-tbl tbody tr:hover td{background:rgba(var(--accent-rgb),.06)}',
    '.monitor-view .mc-nm{color:#fff;font-weight:600;max-width:340px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.monitor-view .mc-url a{display:inline-block;max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;vertical-align:bottom;color:var(--muted,#9aa0b5);font-size:.72rem;text-decoration:none}',
    '.monitor-view .mc-url a:hover{color:var(--accent-text,#ff88ff);text-decoration:underline}',
    '.monitor-view .mc-secname{color:var(--muted,#9aa0b5);font-size:.7rem;white-space:nowrap}',
    '.monitor-view .mc-sec-name{color:#fff;font-weight:600;white-space:nowrap}',
    '.monitor-view .mc-num{font-variant-numeric:tabular-nums;color:var(--muted,#9aa0b5)}',
    '.monitor-view .mc-pill{display:inline-flex;align-items:center;gap:5px;padding:3px 9px;border-radius:999px;font:800 .56rem/1 Inter,sans-serif;letter-spacing:.07em;border:1px solid transparent;white-space:nowrap}',
    '.monitor-view .mc-pill i{width:6px;height:6px;border-radius:50%;background:currentColor;box-shadow:0 0 7px currentColor}',
    '.monitor-view .mc-pill-up{color:#4cd989;background:rgba(76,217,137,.1);border-color:rgba(76,217,137,.3)}',
    '.monitor-view .mc-pill-down{color:#f55e6a;background:rgba(245,94,106,.1);border-color:rgba(245,94,106,.3)}',
    '.monitor-view .mc-pill-blocked{color:#d29922;background:rgba(210,153,34,.1);border-color:rgba(210,153,34,.3)}',
    '.monitor-view .mc-pill-unreachable{color:#f0883e;background:rgba(240,136,62,.1);border-color:rgba(240,136,62,.3)}',
    '.monitor-view .mc-pill-pending{color:#8b949e;background:rgba(139,148,158,.1);border-color:rgba(139,148,158,.28)}',
    '.monitor-view .mc-bars{display:inline-flex;align-items:flex-end;gap:2px;height:16px;margin-right:8px;vertical-align:middle}',
    '.monitor-view .mc-bar{width:4px;height:16px;border-radius:2px;opacity:.85;transition:transform .12s,opacity .12s}',
    '.monitor-view .mc-bars:hover .mc-bar{opacity:1}',
    '.monitor-view .mc-bar:hover{transform:scaleY(1.18)}',
    '.monitor-view .mc-ms{font-size:.74rem;font-weight:800;color:var(--text,#fff);font-variant-numeric:tabular-nums}',
    '.monitor-view .mc-ms-down{color:#f55e6a}',
    '.monitor-view .mc-code{font-size:.66rem;color:var(--muted2,#524d66);margin-left:6px;font-variant-numeric:tabular-nums}',
    '.monitor-view .mc-code-down{color:#f55e6a}',
    '.monitor-view .mc-code-blocked{color:#d29922}',
    '.monitor-view .mc-uptime{font-weight:800;font-variant-numeric:tabular-nums}',
    '.monitor-view .mc-uptime-sub{margin-left:5px;font-size:.62rem;color:var(--muted2,#524d66);font-variant-numeric:tabular-nums}',
    '.monitor-view .mc-mini{display:block;margin-top:6px;height:3px;border-radius:2px;background:rgba(255,255,255,.07);overflow:hidden;min-width:70px;max-width:120px}',
 '.monitor-view .mc-sec .mc-tbl tbody td{padding:6px 12px;font-size:.72rem}',
 '.monitor-view .mc-sec .mc-tbl-wrap{max-height:320px;overflow:auto}',
 '.monitor-view .mc-sec .mc-tbl thead th{position:static;top:auto}',
    '.monitor-view .mc-mini i{display:block;height:100%;border-radius:2px;transition:width .3s}',
    '.monitor-view .mc-empty{margin:0;padding:26px;text-align:center;color:var(--muted,#9aa0b5);font-size:.8rem}',
    '.monitor-view .mc-foot{display:flex;flex-wrap:wrap;gap:6px 16px;align-items:center;font-size:.68rem;color:var(--muted2,#524d66)}',
    '.monitor-view .mc-foot b{color:var(--muted,#9aa0b5);font-weight:700;font-variant-numeric:tabular-nums}',
    '@media(max-width:820px){.monitor-view .mc-tbl .mc-secname{display:none}.monitor-view .mc-nm{max-width:240px}}',
    '@media(max-width:640px){.monitor-view .mc-cards{grid-template-columns:repeat(auto-fit,minmax(118px,1fr))}.monitor-view .mc-card-v{font-size:1.28rem}.monitor-view .mc-tbl{font-size:.7rem}.monitor-view .mc-tbl thead th{padding:7px 7px;font-size:.52rem;letter-spacing:.08em}.monitor-view .mc-tbl tbody td{padding:6px 7px}.monitor-view .mc-url{display:none}.monitor-view .mc-nm{max-width:132px}.monitor-view .mc-search{flex:1 1 100%}.monitor-view .mc-sec .mc-tbl tbody td{padding:6px 7px;font-size:.68rem}.monitor-view .mc-sec .mc-tbl thead th{padding:7px 7px}.monitor-view .mc-sec .mc-tbl-wrap{max-height:260px}}',
    '@media(max-width:480px){.monitor-view .mc-nm{max-width:104px;font-size:.68rem}.monitor-view .mc-uptime-sub{display:none}.monitor-view .mc-pill{padding:3px 6px;font-size:.5rem;gap:4px}.monitor-view .mc-code{display:none}.monitor-view .mc-bars{gap:1px;margin-right:4px;height:13px}.monitor-view .mc-bar{width:3px;height:13px}.monitor-view .mc-ms{font-size:.68rem}.monitor-view .mc-sec .mc-tbl{font-size:.64rem}.monitor-view .mc-sec .mc-tbl thead th{padding:6px 5px;font-size:.48rem}.monitor-view .mc-sec .mc-tbl tbody td{padding:6px 5px}.monitor-view .mc-mini{min-width:44px;max-width:70px}}',
  ].join('');
  document.head.appendChild(st);
}

/** Real probe history from the worker (oldest first); a single bar when there is none. */
function mc_history(s, fallback) {
  var h = (s && typeof s.history === 'string') ? s.history : '';
  var out = [];
  for (var i = 0; i < h.length && out.length < MAX_BARS; i++) out.push(MC_STATUS_BY_CHAR[h[i]] || 'down');
  if (!out.length) out.push(fallback || 'pending');
  return out;
}

/** Uptime over the worker's probe window; null when the site has no recorded history. */
function mc_uptime(s) {
  if (s && s.uptime && typeof s.uptime.pct === 'number') return s.uptime;
  var h = (s && typeof s.history === 'string') ? s.history : '';
  if (!h) return null;
  var up = 0;
  for (var i = 0; i < h.length; i++) if (h[i] === '0') up++;
  return { pct: Math.round(up / h.length * 1000) / 10, up: up, total: h.length };
}

function mc_fmtMs(ms) {
  if (ms == null || isNaN(ms)) return '—';
  if (ms >= 1000) return (ms / 1000).toFixed(1) + 's';
  return Math.round(ms) + 'ms';
}

function mc_renderBars(hist) {
  var out = '';
  for (var i = 0; i < hist.length; i++) {
    var st = hist[i];
    out += '<span class="mc-bar" style="background:' + (MC_COLORS[st] || MC_COLORS.pending) + '" title="' + esc2(st) + '"></span>';
  }
  return out;
}

function mc_pctCls(pct) {
  if (pct == null) return '';
  if (pct >= 99) return 'mc-up-hi';
  if (pct >= 90) return 'mc-up-mid';
  return 'mc-up-lo';
}

function mc_uptimeCell(u) {
  if (!u) return '<span class="mc-uptime" style="opacity:.4">—</span>';
  return '<span class="mc-uptime ' + mc_pctCls(u.pct) + '" title="' + esc2(u.up + ' of ' + u.total + ' probes up') + '">' +
    u.pct.toFixed(1) + '%</span><span class="mc-uptime-sub">' + u.up + '/' + u.total + '</span>';
}

function mc_card(label, value, sub, cls) {
  return '<div class="mc-card ' + (cls || '') + '"><div class="mc-card-l">' + esc2(label) + '</div>' +
    '<div class="mc-card-v">' + value + '</div>' +
    (sub ? '<div class="mc-card-s">' + esc2(sub) + '</div>' : '') + '</div>';
}

function mc_sectionPct(v) {
  if (!v || !v.checks) return null;
  return Math.round(v.upChecks / v.checks * 1000) / 10;
}

function mc_sectionTable(secStats) {
  var names = [];
  for (var k in secStats) if (secStats[k].total > 0) names.push(k);
  if (!names.length) return '';
  names.sort(function(a, b) {
    var pa = mc_sectionPct(secStats[a]);
    var pb = mc_sectionPct(secStats[b]);
    if (pa !== pb) return (pa == null ? 101 : pa) - (pb == null ? 101 : pb);
    return secStats[b].total - secStats[a].total;
  });
  var html = '<div class="mc-sec"><div class="mc-sec-title">Section health</div>' +
    '<div class="mc-tbl-wrap"><table class="mc-tbl"><thead><tr><th>Section</th><th class="mc-num">Sites</th>' +
    '<th class="mc-num">Up</th><th class="mc-num">Failing</th>' +
    '<th title="Share of recorded probes that came back up. The small number beside it is how many of its sites have been probed so far.">Uptime</th>' +
    '</tr></thead><tbody>';
  for (var i = 0; i < names.length; i++) {
    var v = secStats[names[i]];
    var failing = v.down + v.blocked + v.unreachable;
    var pct = mc_sectionPct(v);
    var color = pct == null ? 'rgba(255,255,255,.12)' : (pct >= 99 ? '#4cd989' : (pct >= 90 ? '#d29922' : '#f55e6a'));
    html += '<tr><td class="mc-sec-name">' + esc2(names[i]) + '</td>' +
      '<td class="mc-num">' + v.total + '</td>' +
      '<td class="mc-num" style="color:#4cd989">' + v.up + '</td>' +
      '<td class="mc-num"' + (failing ? ' style="color:#f55e6a"' : '') + '>' + failing + '</td>' +
      '<td>' + (pct == null
        ? '<span class="mc-uptime" style="opacity:.35">—</span><span class="mc-uptime-sub" title="The sweep has not reached this section yet, so there is nothing to average">' + v.probed + '/' + v.total + '</span>'
        : '<span class="mc-uptime ' + mc_pctCls(pct) + '" title="' + esc2(v.upChecks + ' of ' + v.checks + ' probes up') + '">' + pct.toFixed(1) + '%</span>' +
          '<span class="mc-uptime-sub" title="' + esc2(v.probed + ' of ' + v.total + ' sites probed so far') + '">' + v.probed + '/' + v.total + '</span>') +
        '<span class="mc-mini"><i style="width:' + (pct == null ? 0 : pct) + '%;background:' + color + '"></i></span></td></tr>';
  }
  return html + '</tbody></table></div></div>';
}

function mc_siteSlug(s) {
  return String(s.slug || '').toLowerCase() || String(s.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function mc_countryCodes(s) {
  var c = s && s.countries;
  if (!c || !c.length) return [];
  return c.filter(function(x) { return x && typeof x === 'string'; });
}

function mc_countryLabel(s) {
  var codes = mc_countryCodes(s);
  if (!codes.length) return 'Global';
  return codes.map(function(c) { return CC_LABELS[c] || c; }).join(', ');
}

function mc_countryBadge(s) {
  var codes = mc_countryCodes(s);
  if (!codes.length) return '';
  return ' <span class="cc-badge" title="' + esc2(mc_countryLabel(s)) + '">' + codes.map(function(c) { return CC_LABELS[c] ? (CC_LABELS[c].split(' ')[0] + ' ' + c) : c; }).join(' ') + '</span>';
}

function mc_buildState(s) {
  var initial = mc_toStatus(s);
  return {
    url: s.url,
    history: mc_history(s, initial),
    staticStatus: initial,
    liveStatus: initial,
    code: mc_extractCode(s)
  };
}

function stopPolling() {
  if (monitorPollTimer) { clearInterval(monitorPollTimer); monitorPollTimer = null; }
}

function fetchMonitorData(showToast) {
  var urls = MONITOR_API_URLS || [];
  if (!urls.length) {
    if (showToast) toast('Monitor API not configured — see SETUP.md', '#f59e0b');
    return Promise.resolve(false);
  }
  return Promise.all(urls.map(function(u) {
    return fetch(u + '?_=' + Date.now(), { cache: 'no-store' })
      .then(function(r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .catch(function(err) {
        console.warn('Monitor API failed:', u, err && err.message ? err.message : err);
        return null;
      });
  })).then(function(results) {
    var ok = results.filter(Boolean);
    if (!ok.length) throw new Error('all endpoints failed');
    var merged = { sites: [], removed: [], updated: ok[0].updated, historyWindow: ok[0].historyWindow };
    var seen = {};
    var removedSeen = {};
    ok.forEach(function(d) {
      if (d.updated && (!merged.updated || d.updated > merged.updated)) merged.updated = d.updated;
      if (d.historyWindow && !merged.historyWindow) merged.historyWindow = d.historyWindow;
      (d.sites || []).forEach(function(s) {
        var slug = mc_siteSlug(s);
        if (!slug || seen[slug]) return;
        seen[slug] = true;
        merged.sites.push(s);
      });
      (d.removed || []).forEach(function(r) {
        var slug = mc_siteSlug(r);
        if (!slug || removedSeen[slug]) return;
        removedSeen[slug] = true;
        merged.removed.push(r);
      });
    });
    monitorApiData = merged;
    if (monitorActive) renderMonitorSection(true);
    return true;
  }).catch(function(err) {
    console.warn('Monitor API failed:', err && err.message ? err.message : err);
    if (showToast) toast('Monitor API unreachable — showing cached data', '#f59e0b');
    monitorApiData = null;
    if (monitorActive) renderMonitorSection(true);
    return false;
  });
}

function monitorSearchInput(val) {
  monitorSearchTerm = String(val || '').toLowerCase().trim();
  monitorLimit = 200;
  if (monitorActive) renderMonitorSection(true);
  var el = document.querySelector('.monitor-view .mc-search');
  if (el) {
    el.focus();
    var n = el.value.length;
    try { el.setSelectionRange(n, n); } catch (e) {}
  }
}

function monitorCountryInput(val) {
  monitorCountryFilter = String(val || '');
  monitorLimit = 200;
  if (monitorActive) renderMonitorSection(true);
}

function monitorStatusInput(val) {
  monitorStatusFilter = String(val || '');
  monitorLimit = 200;
  if (monitorActive) renderMonitorSection(true);
}

function monitorMore() {
  if (!monitorActive) return;
  monitorLimit += 200;
  renderMonitorSection(true);
}

function mc_requeueAll() {
  if (!monitorActive) return;
  fetchMonitorData(true);
}

function renderMonitorSection(preserveState) {
  try {
    var p = document.getElementById('panels');
    if (!p) return;
    var panel = p.querySelector('.panel.active');
    if (!panel) return;

    var sections = panel.querySelectorAll('.fl-section');
    sections.forEach(function(s) { s.style.display = 'none'; });

    if (!preserveState) stopPolling();

    var existing = panel.querySelector('.monitor-view');
    if (existing) existing.remove();

    mc_ensureStyles();

    var source = monitorApiData || ((typeof MONITOR_DATA !== 'undefined' && MONITOR_DATA) ? MONITOR_DATA : null);
    var showAll = (typeof listShowNSFW !== 'undefined' && listShowNSFW);
    var catFilter = (typeof listFilter !== 'undefined' && listFilter && listFilter !== 'all') ? listFilter : null;

    if (!source) {
      panel.insertAdjacentHTML('beforeend',
        '<div class="monitor-view"><div class="monitor-wrap"><p style="padding:24px;color:var(--muted);font-size:.8rem;text-align:center">No monitor data. Deploy the Worker and set MONITOR_API_URL (see SETUP.md).</p></div></div>');
      return;
    }

    var sites = (source.sites || []).slice();
    var sortRank = { down: 0, blocked: 1, unreachable: 2, up: 3, pending: 4 };
    sites.sort(function(a, b) {
      var ra = sortRank[mc_toStatus(a)] != null ? sortRank[mc_toStatus(a)] : 5;
      var rb = sortRank[mc_toStatus(b)] != null ? sortRank[mc_toStatus(b)] : 5;
      if (ra !== rb) return ra - rb;
      var ca = mc_countryCodes(a).join(',');
      var cb = mc_countryCodes(b).join(',');
      if (ca !== cb) return ca.localeCompare(cb);
      return String(a.name || '').localeCompare(String(b.name || ''));
    });

    var seen = {};
    var rows = '';
    var baseCounts = { up: 0, down: 0, blocked: 0, unreachable: 0, pending: 0 };
    var matched = 0, rendered = 0, hiddenNSFW = 0;
    var secStats = {}, totalChecks = 0, totalUpChecks = 0, msSum = 0, msCount = 0, probedSites = 0;

    sites.forEach(function(s) {
      if (!s || !s.url || !s.name) return;
      var slug = mc_siteSlug(s);
      if (seen[slug]) return;
      seen[slug] = true;
      if (!showAll && s.nsfw) { hiddenNSFW++; return; }
      if (catFilter && s.section !== catFilter) return;
      if (monitorCountryFilter) {
        var codes = mc_countryCodes(s);
        var ccOk = monitorCountryFilter === '__global__' ? codes.length === 0 : codes.indexOf(monitorCountryFilter) !== -1;
        if (!ccOk) return;
      }
      var nameL = String(s.name).toLowerCase();
      var urlL = String(s.url).toLowerCase();
      if (monitorSearchTerm && nameL.indexOf(monitorSearchTerm) === -1 && urlL.indexOf(monitorSearchTerm) === -1) return;
      matched++;

      var st = mc_toStatus(s);
      var state = mc_buildState(s);
      var uptimeStat = mc_uptime(s);
      var avgMs = (s.avgMs != null ? s.avgMs : (s.ms != null ? s.ms : null));

      if (baseCounts[st] != null) baseCounts[st]++;
      if (uptimeStat) { totalChecks += uptimeStat.total; totalUpChecks += uptimeStat.up; probedSites++; }
      if (avgMs != null) { msSum += avgMs; msCount++; }

      var secKey = s.section || 'Uncategorised';
      var sv = secStats[secKey];
      if (!sv) sv = secStats[secKey] = { total: 0, up: 0, down: 0, blocked: 0, unreachable: 0, pending: 0, checks: 0, upChecks: 0, probed: 0 };
      sv.total++;
      sv[st]++;
      if (uptimeStat) { sv.checks += uptimeStat.total; sv.upChecks += uptimeStat.up; sv.probed++; }

      var isFailing = (st === 'down' || st === 'blocked' || st === 'unreachable');
      if (monitorStatusFilter === 'up' && st !== 'up') return;
      if (monitorStatusFilter === 'failing' && !isFailing) return;
      if (monitorStatusFilter === 'pending' && st !== 'pending') return;
      if (rendered >= monitorLimit) return;
      rendered++;

      var msText = mc_fmtMs(avgMs);
      var msCls = 'mc-ms' + (st === 'down' ? ' mc-ms-down' : '');
      var code = state.code;
      var codeText, codeCls;
      if (st === 'blocked' || st === 'unreachable') { codeText = '⚠'; codeCls = 'mc-code mc-code-blocked'; }
      else if (code != null) { codeText = (code >= 400 ? '✗' : '✓') + code; codeCls = 'mc-code' + (code >= 400 ? ' mc-code-down' : ''); }
      else { codeText = '—'; codeCls = 'mc-code'; }

      var label = st === 'up' ? 'LIVE' : (st === 'blocked' ? 'BLOCKED' : (st === 'unreachable' ? 'UNREACHABLE' : (st === 'pending' ? 'PENDING' : 'DEAD')));
      var shortUrl = s.url.length > 60 ? s.url.slice(0, 60) + '…' : s.url;
      var flapBadge = s.flapping ? ' <span class="cc-badge" title="Keeps flipping between live/dead — pending confirmation">flapping</span>' : '';

      rows += '<tr>';
      rows += '<td><span class="mc-pill mc-pill-' + st + '"><i></i>' + label + '</span></td>';
      rows += '<td class="mc-nm">' + esc2(s.name) + flapBadge + (s.nsfw ? ' <span style="font-size:.65rem;opacity:.5">🔞</span>' : '') + mc_countryBadge(s) + '</td>';
      rows += '<td class="mc-url"><a href="' + s.url + '" target="_blank" rel="noopener">' + esc2(shortUrl) + '</a></td>';
      rows += '<td class="mc-secname">' + esc2(s.section || '—') + '</td>';
      rows += '<td>' + mc_uptimeCell(uptimeStat) + '</td>';
      rows += '<td><span class="mc-bars">' + mc_renderBars(state.history) + '</span> <span class="' + msCls + '">' + msText + '</span> <span class="' + codeCls + '">' + codeText + '</span></td>';
      rows += '</tr>';
    });

    var updated = source.updated ? String(source.updated) : 'unknown';
    var overallPct = totalChecks ? Math.round(totalUpChecks / totalChecks * 1000) / 10 : null;
    var avgMsAll = msCount ? Math.round(msSum / msCount) : null;
    var failing = baseCounts.down + baseCounts.blocked + baseCounts.unreachable;

    var ccOptions = '<option value="">🌍 All countries</option><option value="__global__">🌐 Global</option>';
    var ccSeen = {};
    sites.forEach(function(s) {
      var codes = mc_countryCodes(s);
      for (var i = 0; i < codes.length; i++) {
        if (!ccSeen[codes[i]]) { ccSeen[codes[i]] = true; ccOptions += '<option value="' + esc2(codes[i]) + '">' + esc2(CC_LABELS[codes[i]] || codes[i]) + '</option>'; }
      }
    });
    if (monitorCountryFilter) {
      var ccRx = new RegExp('value="' + monitorCountryFilter.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '"');
      ccOptions = ccOptions.replace(ccRx, 'value="' + monitorCountryFilter + '" selected');
    }

    var chip = function(val, label, n) {
      return '<button type="button" class="mc-chip' + (monitorStatusFilter === val ? ' is-on' : '') +
        '" onclick="monitorStatusInput(\'' + val + '\')">' + esc2(label) + '<b>' + n + '</b></button>';
    };
    var mv = '<div class="monitor-view">';
    mv += '<div class="mc-tool">' +
      '<div class="mc-chips">' + chip('', 'All', matched) + chip('up', 'Live', baseCounts.up) +
      chip('failing', 'Failing', failing) + chip('pending', 'Pending', baseCounts.pending) + '</div>' +
      '<input class="mc-search" type="search" placeholder="Search name or URL…" value="' + esc2(monitorSearchTerm) + '" oninput="monitorSearchInput(this.value)">' +
      '<select class="mc-select" onchange="monitorCountryInput(this.value)">' + ccOptions + '</select>' +
      '<button type="button" class="mc-btn" onclick="mc_requeueAll()">⟳ Refresh</button>' +
      '</div>';
    mv += '<div class="mc-cards">';
    mv += mc_card('Uptime', overallPct == null ? '—' : overallPct.toFixed(1) + '%',
      overallPct == null ? 'no probes recorded yet' : probedSites + ' of ' + matched + ' sites probed',
      overallPct == null ? '' : mc_pctCls(overallPct));
    mv += mc_card('Avg response', mc_fmtMs(avgMsAll), 'across ' + msCount + ' sites', '');
    mv += mc_card('Up', String(baseCounts.up), 'of ' + matched + ' sites', baseCounts.up ? 'mc-up-hi' : '');
    mv += mc_card('Failing', String(failing),
      baseCounts.down + ' dead · ' + baseCounts.blocked + ' blocked · ' + baseCounts.unreachable + ' unreachable',
      failing ? 'mc-up-lo' : '');
    mv += mc_card('Pending', String(baseCounts.pending), 'waiting for first sweep', '');
    mv += '</div>';
    mv += '<div class="mc-note">Every 2 min the worker probes the next 20 sites, so a full pass takes about 10 hours. ' +
      'Uptime counts only recorded probes, so sections fill in as the sweep reaches them.</div>';
    if (!matched) {
      mv += '<div class="mc-tbl-wrap"><p class="mc-empty">No sites match this filter.</p></div>';
    } else {
      mv += '<div class="mc-sec"><div class="mc-sec-title">Sites</div><div class="mc-tbl-wrap mc-sites-wrap">' +
        '<table class="mc-tbl"><thead><tr><th>Status</th><th>Site</th><th class="mc-url">URL</th>' +
        '<th class="mc-secname">Section</th><th>Uptime</th><th>Checks</th></tr></thead>' +
        '<tbody>' + rows + '</tbody></table></div></div>';
      if (matched > rendered) {
        mv += '<button type="button" class="mc-btn mc-more" onclick="monitorMore()">Show ' + Math.min(200, matched - rendered) + ' more · ' + (matched - rendered) + ' left</button>';
      }
    }
    mv += mc_sectionTable(secStats);
    mv += '<div class="mc-foot"><span>Showing <b>' + rendered + '</b> of <b>' + matched + '</b> sites</span>' +
      '<span>Last sweep <b>' + esc2(updated) + '</b></span>' +
      (hiddenNSFW > 0 ? '<span>🔞 ' + hiddenNSFW + ' hidden</span>' : '') +
      (source.removed && source.removed.length ? '<span>' + source.removed.length + ' removed (dead 21+ days)</span>' : '') +
      '</div>';
    mv += '</div>';

    panel.insertAdjacentHTML('beforeend', mv);

    if (monitorActive) {
      if (!monitorPollTimer && MONITOR_API_URL) {
        monitorPollTimer = setInterval(function() { fetchMonitorData(false); }, MONITOR_POLL_MS);
      }
      if (!monitorApiData && MONITOR_API_URL) fetchMonitorData(false);
    }
  } catch (e) {
    console.warn('renderMonitorSection error:', e && e.message ? e.message : e);
  }
}

function toggleMonitor() {
  try {
    var p = document.getElementById('panels');
    if (!p) return;
    var panel = p.querySelector('.panel.active');
    if (!panel) return;
    var mv = panel.querySelector('.monitor-view');
    var btn = document.getElementById('monitorToggle');
    if (!btn) return;

    if (mv) {
      monitorActive = false;
      stopPolling();
      mv.remove();
      var sections = panel.querySelectorAll('.fl-section');
      sections.forEach(function(s) { s.style.display = ''; });
      btn.textContent = '📊 Monitor';
      btn.classList.remove('active');
    } else {
      monitorActive = true;
      renderMonitorSection();
      btn.textContent = '✖ Close Monitor';
      btn.classList.add('active');
    }
  } catch (e) {
    console.warn('toggleMonitor error:', e && e.message ? e.message : e);
  }
}
