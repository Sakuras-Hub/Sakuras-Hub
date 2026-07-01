(function() {
  if (document.getElementById('mc-styles')) return;
  var ss = document.createElement('style');
  ss.id = 'mc-styles';
   ss.textContent = '..monitor-view .monitor-wrap .bars-cell{white-space:nowrap;min-width:150px;display:flex;align-items:center;gap:4px}.bars-cell .mc-bars{display:inline-flex;gap:2px;height:14px;align-items:flex-end}.bars-cell .mc-ms{flex-shrink:0;font-size:.75rem;font-weight:600}.bars-cell .mc-ms-down{color:#f55e6a}.bars-cell .mc-code{flex-shrink:0;font-size:.7rem;opacity:.6;margin-left:2px}.bars-cell .mc-code-down{color:#f55e6a;opacity:1}.bars-cell .mc-code-blocked{color:#d29922;opacity:1}';
  document.head.appendChild(ss);
  function mc_initToggle() {
    if (document.getElementById('monitorToggle')) return;
    var flBar = document.querySelector('.fl-bar');
    if (flBar) {
      var b = document.createElement('button');
      b.id = 'monitorToggle'; b.className = 'fl-nsfw-toggle';
      b.textContent = '\ud83d\udcca Monitor'; b.style.cssText = 'margin-left:6px';
      b.addEventListener('click', function(e) { e.stopPropagation(); toggleMonitor(); });
      flBar.appendChild(b); return;
    }
    var wr = document.querySelector('.tabbar-wrap');
    if (wr && !document.querySelector('#monTabBtn')) {
      var b = document.createElement('button');
      b.id = 'monTabBtn';
      b.textContent = '\ud83d\udcca Monitor';
      b.style.cssText = 'background:none;border:1px solid var(--border);color:var(--muted);padding:4px 10px;border-radius:6px;cursor:pointer;font-size:11px;font-weight:600;margin:6px 10px 6px auto;font-family:inherit';
      b.addEventListener('click', function() {
        if (document.querySelector('.monitor-view')) {
          var btn = document.getElementById('monitorToggle');
          if (btn) btn.click();
          return;
        }
        if (typeof mode !== 'undefined' && mode !== 'list') {
          var mt = document.getElementById('modeToggle');
          if (mt) mt.click();
        }
        var iv = setInterval(function() {
          if (document.querySelector('.fl-bar') || document.querySelector('.monitor-view')) {
            clearInterval(iv);
            if (!document.querySelector('.monitor-view')) {
              monitorActive = true;
              renderMonitorSection();
              var btn = document.getElementById('monitorToggle');
              if (btn) { btn.textContent = '\u2716 Close Monitor'; btn.classList.add('active'); }
            }
          }
        }, 100);
        setTimeout(function() { clearInterval(iv); }, 10000);
      });
      wr.appendChild(b);
    }
  }
  mc_initToggle();
  setTimeout(mc_initToggle, 600);
  setTimeout(mc_initToggle, 2500);
})();

var monitorActive = false;
var MAX_BARS = 24;
var PING_INTERVAL_MS = 600000;
var PROBE_TIMEOUT_MS = 20000;
var MAX_CONCURRENT = 30;
var monitorPingTimers = {};
var monitorPingState = {};
var monitorSearchTerm = '';
var mc_queue = [];
var mc_active = 0;

function esc2(s) { return (typeof esc === 'function') ? esc(s) : String(s).replace(/[&<>"']/g, function(c){return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];}); }

function mc_initialStatus(s) {
  if (s.status === 'ok') return 'up';
  if (s.status === 'dead') return 'down';
  return 'blocked';
}

function mc_seedHistory(initial, serverMs) {
  var hist = [];
  var n = Math.max(6, Math.min(MAX_BARS, 12));
  for (var i = 0; i < n; i++) {
    hist.push({ status: initial, ms: (i === n - 1) ? serverMs : null });
  }
  return hist;
}

function mc_fmtMs(ms) {
  if (ms == null) return '\u2014';
  if (ms >= 1000) return (ms / 1000).toFixed(1) + 's';
  return ms + 'ms';
}

function mc_fmtCode(s) {
  if (s.status === 'blocked') return 'BLOCKED';
  if (s.detail) {
    var m = s.detail.match(/HTTP (\d{3})/);
    if (m) return (s.status === 'dead' ? '\u2717' : '\u2713') + m[1];
    if (s.status !== 'dead') return '\u2713' + s.detail.slice(0, 6);
  }
  return s.status === 'dead' ? 'DOWN' : '';
}

function mc_codeCls(s) {
  if (s.status === 'ok') return 'mc-code';
  if (s.status === 'dead') return 'mc-code mc-code-down';
  return 'mc-code mc-code-blocked';
}

function mc_barClass(st) {
  if (st === 'up') return 'up';
  if (st === 'down') return 'down';
  if (st === 'blocked') return 'blocked';
  return '';
}

function mc_renderBars(slug) {
  var st = monitorPingState[slug];
  if (!st) return '';
  var out = '';
  st.history.forEach(function(h, idx) {
    var isNew = (idx === st.history.length - 1) && st.justUpdated;
    out += '<div class="mc-bar ' + mc_barClass(h.status) + (isNew ? ' new' : '') + '"></div>';
  });
  return out;
}

function mc_updateCardDOM(slug) {
  var row = document.querySelector('tr[data-slug="' + slug + '"]');
  if (!row) return;
  var st = monitorPingState[slug];
  if (!st) return;
  var last = st.history[st.history.length - 1];
  var msEl = row.querySelector('.mc-ms');
  var barsEl = row.querySelector('.mc-bars');
  if (msEl) {
    msEl.textContent = mc_fmtMs(last.ms);
    msEl.className = last.status === 'down' ? 'mc-ms mc-ms-down' : 'mc-ms';
  }
  if (barsEl) { barsEl.innerHTML = mc_renderBars(slug); }
  if (st.liveStatus) {
    var dot = row.querySelector('.st-dot');
    var label = row.querySelector('.st-label');
    if (dot) dot.textContent = st.liveStatus === 'up' ? '\ud83d\udfe2' : '\ud83d\udd34';
    if (label) {
      label.textContent = st.liveStatus === 'up' ? 'UP' : 'DOWN';
      label.className = 'st-label ' + (st.liveStatus === 'up' ? 'label-up' : 'label-down');
    }
  }
}

function mc_probe(url) {
  return new Promise(function(resolve) {
    var t0 = performance.now();
    var done = false;
    var elements = [];

    function cleanup() {
      elements.forEach(function(el) {
        if (el.parentNode) el.parentNode.removeChild(el);
      });
      elements = [];
    }

    var timer = setTimeout(function() {
      if (!done) { done = true; cleanup(); resolve(null); }
    }, PROBE_TIMEOUT_MS);

    function win() {
      if (done) return;
      done = true; clearTimeout(timer); cleanup();
      resolve({ ok: true, ms: Math.round(performance.now() - t0) });
    }

    var httpsUrl = url.replace(/^http:/, 'https:');
    var isHttp = url.indexOf('http:') === 0;

    fetch(httpsUrl, { mode: 'no-cors', cache: 'no-store' }).then(win).catch(function(){});
    fetch(httpsUrl, { mode: 'no-cors', method: 'HEAD', cache: 'no-store' }).then(win).catch(function(){});
    if (isHttp) {
      fetch(url, { mode: 'no-cors', cache: 'no-store' }).then(win).catch(function(){});
    }

    var base = url.replace(/\/?$/, '/');
    var img = new Image();
    img.onload = win;
    img.onerror = function(){};
    img.src = base + 'favicon.ico?cb=' + Date.now();

    [httpsUrl, isHttp ? url : null].forEach(function(s) {
      if (!s) return;
      var el = document.createElement('script');
      el.onload = win;
      el.onerror = function(){};
      el.src = s + '?cb=' + Date.now();
      document.head.appendChild(el);
      elements.push(el);
    });
  });
}

function mc_drain() {
  while (mc_active < MAX_CONCURRENT && mc_queue.length > 0) {
    var slug = mc_queue.shift();
    mc_active++;
    mc_pingOnce(slug);
  }
}

function mc_pingOnce(slug) {
  var st = monitorPingState[slug];
  if (!st) { mc_active--; mc_drain(); return; }
  if (!monitorActive || !document.querySelector('tr[data-slug="' + slug + '"]')) {
    mc_active--; mc_drain(); return;
  }

  mc_probe(st.url).then(function(r) {
    mc_active--;
    if (r && r.ok) {
      st.history.push({ status: 'up', ms: r.ms });
      if (st.history.length > MAX_BARS) st.history.shift();
      st.justUpdated = true;
      st.liveStatus = 'up';
      mc_updateCardDOM(slug);
    }
    monitorPingTimers[slug] = setTimeout(function() {
      mc_queue.push(slug);
      mc_drain();
    }, PING_INTERVAL_MS + Math.floor(Math.random() * 1500));
    mc_drain();
  });
}

function mc_startPinging(slugList) {
  slugList.forEach(function(slug) {
    if (!monitorPingTimers[slug]) mc_queue.push(slug);
  });
  mc_drain();
}

function mc_stopAllPinging() {
  Object.keys(monitorPingTimers).forEach(function(slug) {
    clearTimeout(monitorPingTimers[slug]);
  });
  monitorPingTimers = {};
  mc_queue = [];
}

function monitorSearchInput(val) {
  monitorSearchTerm = (val || '').toLowerCase();
  renderMonitorSection(true);
}

function renderMonitorSection(preserveState) {
  try {
    if (typeof MONITOR_DATA === 'undefined') { console.warn('MONITOR_DATA not defined'); return; }
    var d = MONITOR_DATA;
    if (!d || !d.sites) { console.warn('MONITOR_DATA invalid'); return; }

    var p = document.getElementById('panels');
    if (!p) { console.warn('panels not found'); return; }

    var panel = p.querySelector('.panel.active');
    if (!panel) { console.warn('no active panel'); return; }

    var sections = panel.querySelectorAll('.fl-section');
    sections.forEach(function(s) { s.style.display = 'none'; });

    if (!preserveState) mc_stopAllPinging();

    var existing = panel.querySelector('.monitor-view');
    if (existing) existing.remove();

    var showAll = (typeof listShowNSFW !== 'undefined' && listShowNSFW);
    var catFilter = (typeof listFilter !== 'undefined' && listFilter && listFilter !== 'all') ? listFilter : null;
    var hiddenNSFW = 0;
    var visibleCount = 0;
    var totalDown = 0;
    var totalBlocked = 0;
    var visibleSlugs = [];

    var rows = '';
    d.sites.forEach(function(s) {
      if (!showAll && s.nsfw) { hiddenNSFW++; return; }
      if (catFilter && s.section !== catFilter) return;
      if (monitorSearchTerm && s.name.toLowerCase().indexOf(monitorSearchTerm) === -1 && s.url.toLowerCase().indexOf(monitorSearchTerm) === -1) return;
      visibleCount++;
      if (s.status === 'dead') totalDown++;
      if (s.status === 'blocked') totalBlocked++;

      var slug = s.slug || s.name.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (!monitorPingState[slug]) {
        var initial = mc_initialStatus(s);
        monitorPingState[slug] = { url: s.url, history: mc_seedHistory(initial, s.ms), justUpdated: false, staticStatus: initial, liveStatus: null };
      }
      visibleSlugs.push(slug);

      var st = monitorPingState[slug];
      var last = st.history[st.history.length - 1];
      var msText = mc_fmtMs(last.ms);
      var msCls = last.status === 'down' ? 'mc-ms mc-ms-down' : 'mc-ms';
      var codeText = mc_fmtCode(s);
      var codeCls = mc_codeCls(s);
      var shortUrl = s.url.length > 60 ? s.url.slice(0, 60) + '...' : s.url;

      var dot, cls, label;
      if (s.status === 'ok') { dot = '\ud83d\udfe2'; cls = 'label-up'; label = 'UP'; }
      else if (s.status === 'dead') { dot = '\ud83d\udd34'; cls = 'label-down'; label = 'DOWN'; }
      else { dot = '\ud83d\udfe1'; cls = 'label-blocked'; label = 'BLOCKED'; }

      rows += '<tr data-slug="' + slug + '">';
      rows += '<td class="st-cell"><span class="st-dot">' + dot + '</span><span class="st-label ' + cls + '">' + label + '</span></td>';
      rows += '<td class="name-cell">' + esc2(s.name) + (s.nsfw ? ' <span style="font-size:0.65rem;opacity:0.5">\ud83d\udd1e</span>' : '') + '</td>';
      rows += '<td class="url-cell"><a href="' + s.url + '" target="_blank">' + esc2(shortUrl) + '</a></td>';
      rows += '<td class="sec-cell">' + esc2(s.section || '') + '</td>';
      rows += '<td class="bars-cell"><span class="mc-bars">' + mc_renderBars(slug) + '</span><span class="' + msCls + '">' + msText + '</span><span class="' + codeCls + '">' + codeText + '</span></td>';
      rows += '</tr>';
    });

    var mv = '<div class="monitor-view">';
    mv += '<div class="monitor-stats">';
    mv += '<span class="monitor-stat stat-up">\ud83d\udfe2 ' + (visibleCount - totalDown - totalBlocked) + ' Up</span>';
    mv += '<span class="monitor-stat stat-down">\ud83d\udd34 ' + totalDown + ' Down</span>';
    mv += '<span class="monitor-stat stat-blocked">\ud83d\udfe1 ' + totalBlocked + ' Blocked</span>';
    mv += '<span class="monitor-stat stat-total">\ud83d\udccb ' + visibleCount + ' Total</span>';
    if (hiddenNSFW > 0) {
      mv += '<span class="monitor-stat" style="color:var(--muted2);border-color:var(--border);background:var(--surface)">\ud83d\udd1e ' + hiddenNSFW + ' hidden</span>';
    }
    mv += '</div>';
    mv += '<div class="monitor-search-row"><input type="text" placeholder="Search sites..." oninput="monitorSearchInput(this.value)" value="' + esc2(monitorSearchTerm) + '"></div>';
    mv += '<div class="monitor-wrap">';
    mv += '<table><thead><tr>';
    mv += '<th>Status</th><th>Site</th><th>URL</th><th>Section</th><th>Website Down Dectector</th>';
    mv += '</tr></thead><tbody>' + rows + '</tbody></table></div>';
    mv += '<div class="monitor-updated">\u23f1 Last checked: ' + d.updated + '</div>';
    mv += '</div>';

    panel.insertAdjacentHTML('beforeend', mv);
    mc_startPinging(visibleSlugs);
    console.log('Monitor view rendered: ' + visibleCount + ' sites' + (hiddenNSFW ? ' (' + hiddenNSFW + ' NSFW hidden)' : ''));
  } catch(e) {
    console.warn('Monitor error:', e.message || e);
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
      mc_stopAllPinging();
      mv.remove();
      var sections = panel.querySelectorAll('.fl-section');
      sections.forEach(function(s) { s.style.display = ''; });
      btn.textContent = '\ud83d\udcca Monitor';
      btn.classList.remove('active');
    } else {
      monitorActive = true;
      renderMonitorSection();
      btn.textContent = '\u2716 Close Monitor';
      btn.classList.add('active');
    }
  } catch(e) {
    console.warn('toggleMonitor error:', e.message || e);
  }
}
