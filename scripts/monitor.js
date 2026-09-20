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
var MONITOR_API_URL = 'https://sakura-monitor.fadded-market.workers.dev/status';
var MONITOR_POLL_MS = 5 * 60 * 1000;
var monitorPollTimer = null;
var monitorApiData = null;
var monitorSearchTerm = '';
var monitorCountryFilter = '';
var CC_LABELS = { RU: '🇷🇺 Russia', IN: '🇮🇳 India', JP: '🇯🇵 Japan', PL: '🇵🇱 Poland', GB: '🇬🇧 United Kingdom', ID: '🇮🇩 Indonesia' };
var MAX_BARS = 24;

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

function mc_seedHistory(initial, serverMs) {
  var edges = ['4m', '3m', '2m', '1m', '30s', 'now'];
  var hist = [];
  for (var i = 0; i < edges.length; i++) {
    hist.push({ label: edges[i], status: initial, ms: null });
  }
  hist.push({ label: 'now', status: initial, ms: (serverMs != null ? serverMs : null) });
  if (hist.length > MAX_BARS) hist = hist.slice(hist.length - MAX_BARS);
  return hist;
}

function mc_fmtMs(ms) {
  if (ms == null || isNaN(ms)) return '—';
  if (ms >= 1000) return (ms / 1000).toFixed(1) + 's';
  return Math.round(ms) + 'ms';
}

function mc_renderBars(st) {
var out = '';
  for (var i = 0; i < st.history.length; i++) {
    var h = st.history[i];
    var col = h.status === 'up' ? '#3fb950' : (h.status === 'down' ? '#f55e6a' : (h.status === 'unreachable' ? '#f0883e' : (h.status === 'pending' ? '#444c56' : '#d29922')));
    out += '<span style="display:inline-block;width:4px;height:10px;border-radius:2px;background:' + col + ';margin-right:2px"></span>';
  }
  return out;
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
    history: mc_seedHistory(initial, (s.ms != null ? s.ms : null)),
    staticStatus: initial,
    liveStatus: initial,
    code: mc_extractCode(s)
  };
}

function stopPolling() {
  if (monitorPollTimer) { clearInterval(monitorPollTimer); monitorPollTimer = null; }
}

function fetchMonitorData(showToast) {
  if (!MONITOR_API_URL) {
    if (showToast) toast('Monitor API not configured — see SETUP.md', '#f59e0b');
    return Promise.resolve(false);
  }
  return fetch(MONITOR_API_URL + '?_=' + Date.now(), { cache: 'no-store' })
    .then(function(r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(function(d) {
      if (!d || !d.sites || !d.sites.length) throw new Error('empty payload');
      monitorApiData = d;
      if (monitorActive) renderMonitorSection(true);
      return true;
    })
    .catch(function(err) {
      console.warn('Monitor API failed:', err && err.message ? err.message : err);
      if (showToast) toast('Monitor API unreachable — showing cached data', '#f59e0b');
      monitorApiData = null;
      if (monitorActive) renderMonitorSection(true);
      return false;
    });
}

function monitorSearchInput(val) {
  monitorSearchTerm = String(val || '').toLowerCase().trim();
  if (monitorActive) renderMonitorSection(true);
}

function monitorCountryInput(val) {
  monitorCountryFilter = String(val || '');
  if (monitorActive) renderMonitorSection(true);
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
    var up = 0, down = 0, blocked = 0, unreachable = 0, pending = 0, shown = 0, hiddenNSFW = 0;

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
      shown++;

var st = mc_toStatus(s);
      var state = mc_buildState(s);
      if (st === 'up') up++; else if (st === 'blocked') blocked++; else if (st === 'unreachable') unreachable++; else if (st === 'pending') pending++; else down++;

      var last = state.history[state.history.length - 1];
      var msText = mc_fmtMs(last.ms);
      var msCls = 'mc-ms' + (state.liveStatus === 'down' ? ' mc-ms-down' : '');
      var code = state.code;
      var codeText, codeCls;
      if (st === 'blocked' || st === 'unreachable') { codeText = '⚠'; codeCls = 'mc-code mc-code-blocked'; }
      else if (code != null) { codeText = (code >= 400 ? '✗' : '✓') + code; codeCls = 'mc-code' + (code >= 400 ? ' mc-code-down' : ''); }
      else { codeText = '—'; codeCls = 'mc-code'; }

      var dot = st === 'up' ? '🟢' : (st === 'blocked' ? '🟡' : (st === 'unreachable' ? '🟠' : (st === 'pending' ? '⚪' : '🔴')));
      var cls = st === 'up' ? 'label-up' : (st === 'blocked' ? 'label-blocked' : (st === 'unreachable' ? 'label-unreachable' : (st === 'pending' ? 'label-pending' : 'label-down')));
      var label = st === 'up' ? 'LIVE' : (st === 'blocked' ? 'BLOCKED' : (st === 'unreachable' ? 'UNREACHABLE' : (st === 'pending' ? 'PENDING' : 'DEAD')));
      var shortUrl = s.url.length > 60 ? s.url.slice(0, 60) + '…' : s.url;

      rows += '<tr>';
      rows += '<td style="text-align:center"><span class="st-dot">' + dot + '</span><span class="st-label ' + cls + '">' + label + '</span></td>';
      rows += '<td class="name-cell">' + esc2(s.name) + (s.nsfw ? ' <span style="font-size:.65rem;opacity:.5">🔞</span>' : '') + mc_countryBadge(s) + '</td>';
      rows += '<td class="url-cell"><a href="' + s.url + '" target="_blank" rel="noopener">' + esc2(shortUrl) + '</a></td>';
      rows += '<td class="sec-cell">' + esc2(s.section || '—') + '</td>';
      rows += '<td class="bars-cell"><span class="mc-bars">' + mc_renderBars(state) + '</span> <span class="' + msCls + '">' + msText + '</span> <span class="' + codeCls + '">' + codeText + '</span></td>';
      rows += '</tr>';
    });

    var updated = source.updated ? String(source.updated) : 'unknown';

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

    var mv = '<div class="monitor-view">';
    mv += '<div class="monitor-stats">';
    mv += '<span class="monitor-stat stat-up">🟢 ' + up + ' Up</span>';
    mv += '<span class="monitor-stat stat-down">🔴 ' + down + ' Down</span>';
    mv += '<span class="monitor-stat stat-blocked">🟡 ' + blocked + ' Blocked</span>';
    mv += '<span class="monitor-stat">🟠 ' + unreachable + ' Unreachable</span>';
    mv += '<span class="monitor-stat">⚪ ' + pending + ' Pending</span>';
    mv += '<span class="monitor-stat stat-total">📋 ' + shown + ' Shown</span>';
    if (hiddenNSFW > 0) mv += '<span class="monitor-stat">🔞 ' + hiddenNSFW + ' hidden</span>';
    mv += '</div>';
    mv += '<div class="monitor-search-row"><select onchange="monitorCountryInput(this.value)" style="margin-right:6px">' + ccOptions + '</select><input type="text" placeholder="Search sites…" value="' + esc2(monitorSearchTerm) + '" oninput="monitorSearchInput(this.value)">';
    mv += '<button onclick="mc_requeueAll()" style="margin-left:6px;padding:4px 10px;border-radius:4px;border:1px solid var(--border);background:var(--surface);color:var(--text);cursor:pointer;font-size:.75rem">⟳ Re-check</button></div>';
    mv += '<div class="monitor-wrap"><table><thead><tr><th>Status</th><th>Site</th><th>URL</th><th>Section</th><th>Response</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
    mv += '<div class="monitor-updated">🕐 Last checked: ' + esc2(updated) + '</div>';
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