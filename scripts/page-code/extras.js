/* ============================================================
   Directory extras: fuzzy search, Ctrl/Cmd+K quick search,
   recently visited, shareable links (?cat= and ?q=) and a
   one-time safety tip.

   This file is the readable source. It is pasted into
   directory.html (between the EXTRAS markers) by:
       python scripts/tools/inject-extras.py
   It runs INSIDE the directory page's main script, so it can use
   that script's variables (sites, groups, labelGroups, el ...).
   Nothing here talks to a server. Everything stays in the
   visitor's own browser (localStorage keys: sakura-recents and
   sakura-tip-v1).
   ============================================================ */
var sakuraExtras = (function(){
  'use strict';

  var RECENT_KEY = 'sakura-recents';
  var RECENT_MAX = 8;
  var TIP_KEY = 'sakura-tip-v1';

  /* ---------- tiny helpers ---------- */
  function lsGet(k){ try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v){ try { localStorage.setItem(k, v); } catch (e) {} }
  function lsDel(k){ try { localStorage.removeItem(k); } catch (e) {} }
  function hostOf(u){ return String(getHost(u) || '').replace(/^www\./, ''); }
  function isMac(){ return /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent || ''); }
  function slugOf(label){
    return String(label || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }
  function visibleSite(s){ return !(s.nsfw && !unlocked); }

  /* ---------- url -> site lookup (rebuilt when the list changes) ---------- */
  var byUrl = {}, byUrlFor = null;
  function siteLookup(){
    if (byUrlFor === sites) return byUrl;
    byUrl = {};
    Object.keys(groups).forEach(function(sec){
      groups[sec].forEach(function(s){ byUrl[s.url] = s; });
    });
    byUrlFor = sites;
    return byUrl;
  }

  /* ============================================================
     1. Fuzzy search (Fuse.js, self-hosted in assets/vendor/)
        Plain substring always works; Fuse adds typo tolerance
        for words of 3+ letters. Falls back to substring only if
        Fuse did not load.
     ============================================================ */
  var fuse = null, fuseFor = null, tokenCache = {};

  function ensureFuse(){
    if (typeof Fuse === 'undefined' || !sites) return null;
    if (fuse && fuseFor === sites) return fuse;
    var docs = [];
    Object.keys(groups).forEach(function(sec){
      groups[sec].forEach(function(s){
        docs.push({
          s: s,
          name: String(s.name || ''),
          host: hostOf(s.url),
          tags: normalizeTags(s.tags).join(' '),
          section: sec
        });
      });
    });
    fuse = new Fuse(docs, {
      keys: [
        { name: 'name', weight: 0.6 },
        { name: 'host', weight: 0.2 },
        { name: 'tags', weight: 0.15 },
        { name: 'section', weight: 0.05 }
      ],
      threshold: 0.22,
      ignoreLocation: true,
      minMatchCharLength: 3,
      includeScore: true
    });
    fuseFor = sites;
    tokenCache = {};
    exactCache = {};
    return fuse;
  }

  /* Typo tolerance only kicks in when plain matching finds fewer than
     FUZZY_BELOW sites, so a normal search never fills up with near-misses. */
  var FUZZY_BELOW = 10, FUZZY_LIMIT = 60, exactCache = {};

  function exactCount(toks){
    var key = toks.join(' ');
    if (exactCache.hasOwnProperty(key)) return exactCache[key];
    var n = 0;
    Object.keys(groups).forEach(function(sec){
      groups[sec].forEach(function(s){
        var hay = haystack(s), ok = true;
        for (var i = 0; i < toks.length; i++) if (hay.indexOf(toks[i]) === -1) { ok = false; break; }
        if (ok) n++;
      });
    });
    exactCache[key] = n;
    return n;
  }

  /* url -> fuse score (0 best) for one word; cached per word. Null = no fuzzy. */
  function fuzzyFor(token, toks){
    if (token.length < 4) return null;
    if (exactCount(toks) >= FUZZY_BELOW) return null;
    if (tokenCache[token]) return tokenCache[token];
    var f = ensureFuse();
    if (!f) return null;
    var out = {};
    f.search(token, { limit: FUZZY_LIMIT }).forEach(function(r){ out[r.item.s.url] = r.score; });
    tokenCache[token] = out;
    return out;
  }

  function haystack(s){
    return (s.name + ' ' + normalizeTags(s.tags).join(' ') + ' ' + hostOf(s.url)).toLowerCase();
  }
  function tokensOf(q){
    return String(q || '').toLowerCase().trim().split(/\s+/).filter(Boolean);
  }

  /* every word must match, either as plain text or (when few results) fuzzily */
  function matches(s, q){
    var toks = tokensOf(q);
    if (!toks.length) return true;
    var hay = haystack(s);
    for (var i = 0; i < toks.length; i++) {
      if (hay.indexOf(toks[i]) !== -1) continue;
      var fz = fuzzyFor(toks[i], toks);
      if (!fz || fz[s.url] === undefined) return false;
    }
    return true;
  }

  /* lower = better: name starts with word, name contains it, anywhere, fuzzy */
  function relevance(s, toks){
    var name = String(s.name || '').toLowerCase(), hay = haystack(s), score = 0;
    for (var i = 0; i < toks.length; i++) {
      var t = toks[i];
      if (name.indexOf(t) === 0) score += 0;
      else if (name.indexOf(t) !== -1) score += 1;
      else if (hay.indexOf(t) !== -1) score += 2;
      else {
        var fz = fuzzyFor(t, toks);
        score += 3 + ((fz && fz[s.url] !== undefined) ? fz[s.url] : 1);
      }
    }
    return score;
  }
  function sortByRelevance(list, q){
    var toks = tokensOf(q);
    if (!toks.length) return list;
    var scored = list.map(function(s, i){ return { s: s, r: relevance(s, toks), i: i }; });
    scored.sort(function(a, b){ return a.r - b.r || a.i - b.i; });
    for (var k = 0; k < scored.length; k++) list[k] = scored[k].s;
    return list;
  }

  /* ============================================================
     2. Recently visited
        Only sites the visitor clicks are saved, only in this
        browser. Adult sites are never saved.
     ============================================================ */
  function readRecents(){
    try {
      var a = JSON.parse(lsGet(RECENT_KEY) || '[]');
      if (!Array.isArray(a)) return [];
      return a.filter(function(r){ return r && typeof r.u === 'string' && typeof r.n === 'string'; }).slice(0, RECENT_MAX);
    } catch (e) { return []; }
  }
  function addRecent(s){
    if (!s || !s.url || s.nsfw) return;
    var list = readRecents().filter(function(r){ return r.u !== s.url; });
    list.unshift({ u: s.url, n: s.name, t: Date.now() });
    lsSet(RECENT_KEY, JSON.stringify(list.slice(0, RECENT_MAX)));
    renderRecents();
  }
  function clearRecents(){ lsDel(RECENT_KEY); renderRecents(); }

  var recentsEl = document.getElementById('recentsBar');
  function renderRecents(){
    if (!recentsEl) return;
    var list = readRecents();
    if (!list.length || query) { recentsEl.hidden = true; recentsEl.innerHTML = ''; return; }
    var h = '<span class="rc-title">Recently visited</span><div class="rc-list">';
    list.forEach(function(r){
      var fav = getFaviconUrl(r.u);
      h += '<a class="rc-chip" href="' + esc(r.u) + '" target="_blank" rel="noopener noreferrer" data-u="' + esc(r.u) + '">' +
        (fav ? '<img src="' + esc(fav) + '" alt="" width="16" height="16" loading="lazy" decoding="async" referrerpolicy="no-referrer">' : '') +
        '<span>' + esc(r.n) + '</span></a>';
    });
    h += '</div><button type="button" class="rc-clear" id="rcClear">Clear</button>';
    recentsEl.innerHTML = h;
    recentsEl.hidden = false;
  }
  if (recentsEl) {
    recentsEl.addEventListener('click', function(e){
      var t = e.target;
      if (t && t.id === 'rcClear') { clearRecents(); toast('Recent list cleared'); return; }
      var a = t && t.closest ? t.closest('.rc-chip') : null;
      if (a) { var s = siteLookup()[a.getAttribute('data-u')]; if (s) addRecent(s); }
    });
  }
  function onGridVisit(e){
    var t = e.target;
    if (!t || !t.closest) return;
    if (t.closest('.preset-act')) return;               // star / report buttons
    var a = t.closest('a.preset-card');
    if (!a) return;
    var s = siteLookup()[a.getAttribute('href')];
    if (s) addRecent(s);
  }
  el.grid.addEventListener('click', onGridVisit);
  el.grid.addEventListener('auxclick', function(e){ if (e.button === 1) onGridVisit(e); });

  /* ============================================================
     3. Ctrl/Cmd + K quick search
     ============================================================ */
  var kp = null, kpInput = null, kpList = null, kpItems = [], kpIdx = 0, kpPrevFocus = null, kpOnline = null;

  function buildPalette(){
    if (kp) return;
    kp = document.createElement('div');
    kp.className = 'kp';
    kp.hidden = true;
    kp.innerHTML =
      '<div class="kp-box" role="dialog" aria-modal="true" aria-label="Quick search">' +
        '<div class="kp-top">' +
          '<input id="kpInput" type="text" role="combobox" aria-expanded="true" aria-controls="kpList" aria-autocomplete="list" ' +
            'placeholder="Search sites and categories…" autocomplete="off" autocorrect="off" spellcheck="false">' +
          '<kbd>Esc</kbd>' +
        '</div>' +
        '<ul id="kpList" role="listbox" aria-label="Results"></ul>' +
        '<div class="kp-foot"><span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>Enter</kbd> open</span><span><kbd>Esc</kbd> close</span></div>' +
      '</div>';
    document.body.appendChild(kp);
    kpInput = kp.querySelector('#kpInput');
    kpList = kp.querySelector('#kpList');

    kp.addEventListener('mousedown', function(e){ if (e.target === kp) closePalette(); });
    kpInput.addEventListener('input', function(){ kpIdx = 0; paintPalette(); });
    kpInput.addEventListener('keydown', function(e){
      if (e.key === 'ArrowDown') { e.preventDefault(); moveSel(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); moveSel(-1); }
      else if (e.key === 'Enter') { e.preventDefault(); chooseItem(kpIdx); }
      else if (e.key === 'Tab') { e.preventDefault(); }       // keep focus inside the dialog
      else if (e.key === 'Escape') { e.preventDefault(); closePalette(); }
    });
    kpList.addEventListener('mousemove', function(e){
      var li = e.target.closest ? e.target.closest('li[data-i]') : null;
      if (li) { var i = +li.getAttribute('data-i'); if (i !== kpIdx) { kpIdx = i; markSel(false); } }
    });
    kpList.addEventListener('click', function(e){
      var li = e.target.closest ? e.target.closest('li[data-i]') : null;
      if (li) chooseItem(+li.getAttribute('data-i'));
    });
  }

  function paletteItems(q){
    var items = [], toks = tokensOf(q);
    if (!toks.length) {
      readRecents().forEach(function(r){
        var s = siteLookup()[r.u];
        if (s && visibleSite(s)) items.push({ t: 'site', s: s, tag: 'Recent' });
      });
      Object.keys(favs).slice(0, 6).forEach(function(u){
        var s = siteLookup()[u];
        if (s && visibleSite(s) && !items.some(function(x){ return x.s && x.s.url === u; })) items.push({ t: 'site', s: s, tag: 'Favorite' });
      });
      labelGroups.forEach(function(lg){
        if (!(lg.nsfwOnly && !unlocked)) items.push({ t: 'cat', lg: lg });
      });
      return items.slice(0, 14);
    }
    var qs = toks.join(' ');
    labelGroups.forEach(function(lg){
      if (lg.nsfwOnly && !unlocked) return;
      var l = lg.label.toLowerCase();
      if (toks.every(function(t){ return l.indexOf(t) !== -1; })) items.push({ t: 'cat', lg: lg });
    });
    var found = [];
    Object.keys(groups).forEach(function(sec){
      groups[sec].forEach(function(s){ if (visibleSite(s) && matches(s, qs)) found.push(s); });
    });
    sortByRelevance(found, qs);
    found.slice(0, 20).forEach(function(s){ items.push({ t: 'site', s: s }); });
    if (!found.length) items.push({ t: 'suggest', q: q.trim() });
    return items.slice(0, 24);
  }

  function paintPalette(){
    var q = kpInput.value;
    kpItems = paletteItems(q);
    if (kpIdx >= kpItems.length) kpIdx = Math.max(0, kpItems.length - 1);
    var h = '';
    if (!kpItems.length) {
      h = '<li class="kp-empty" role="presentation">No matches for “' + esc(q) + '”. Try fewer letters.</li>';
    }
    kpItems.forEach(function(it, i){
      if (it.t === 'suggest') {
        h += '<li role="option" id="kp-o' + i + '" data-i="' + i + '" class="kp-item kp-cat"><span class="kp-ico">＋</span>' +
          '<span class="kp-main"><b>Suggest “' + esc(it.q.slice(0, 40)) + '” as a new site</b><small>Not in the directory yet? Tell me about it</small></span></li>';
      } else if (it.t === 'cat') {
        h += '<li role="option" id="kp-o' + i + '" data-i="' + i + '" class="kp-item kp-cat"><span class="kp-ico">📂</span>' +
          '<span class="kp-main"><b>' + esc(it.lg.label) + '</b><small>Category · ' + it.lg.total.toLocaleString() + ' sites</small></span></li>';
      } else {
        var s = it.s, dot = '';
        if (kpOnline && Object.keys(kpOnline).length) dot = '<i class="kp-dot' + (kpOnline[urlKey(s.url)] ? ' on' : '') + '" title="' + (kpOnline[urlKey(s.url)] ? 'Up' : 'Not confirmed up') + '"></i>';
        h += '<li role="option" id="kp-o' + i + '" data-i="' + i + '" class="kp-item">' +
          (getFaviconUrl(s.url) ? '<img src="' + esc(getFaviconUrl(s.url)) + '" alt="" width="20" height="20" loading="lazy" decoding="async" referrerpolicy="no-referrer">' : '<span class="kp-ico">🔗</span>') +
          '<span class="kp-main"><b>' + esc(s.name) + '</b><small>' + esc(hostOf(s.url)) + '</small></span>' +
          (isAvoidSite(s) ? '<span class="kp-badge warn">Risky</span>' : '') +
          (it.tag ? '<span class="kp-badge">' + it.tag + '</span>' : '') + dot + '</li>';
      }
    });
    kpList.innerHTML = h;
    markSel(true);
  }
  function markSel(scroll){
    var opts = kpList.querySelectorAll('li[data-i]');
    for (var i = 0; i < opts.length; i++) {
      var on = (+opts[i].getAttribute('data-i')) === kpIdx;
      opts[i].classList.toggle('sel', on);
      opts[i].setAttribute('aria-selected', on ? 'true' : 'false');
      if (on) {
        kpInput.setAttribute('aria-activedescendant', opts[i].id);
        if (scroll !== false && opts[i].scrollIntoView) opts[i].scrollIntoView({ block: 'nearest' });
      }
    }
  }
  function moveSel(d){
    if (!kpItems.length) return;
    kpIdx = (kpIdx + d + kpItems.length) % kpItems.length;
    markSel(true);
  }
  function chooseItem(i){
    var it = kpItems[i];
    if (!it) return;
    if (it.t === 'suggest') {
      closePalette();
      openSuggest(it.q);
      return;
    }
    if (it.t === 'site') {
      addRecent(it.s);
      closePalette();
      window.open(it.s.url, '_blank', 'noopener,noreferrer');
    } else {
      closePalette();
      var dirLink = document.querySelector('.nav-links a[data-view="directory"]');
      var dirView = document.getElementById('view-directory');
      if (dirLink && dirView && !dirView.classList.contains('show')) dirLink.click();
      activeTab = it.lg.label;
      renderTabs();
      renderGrid();
      var fb = document.getElementById('filterBar');
      if (fb && fb.scrollIntoView) fb.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
  }
  function openPalette(){
    if (!sites) { toast('The directory is still loading'); return; }
    buildPalette();
    kpPrevFocus = document.activeElement;
    kpOnline = (typeof onlineSet === 'function') ? onlineSet() : null;
    kp.hidden = false;
    document.documentElement.classList.add('kp-open');
    kpInput.value = '';
    kpIdx = 0;
    paintPalette();
    kpInput.focus();
  }
  function closePalette(){
    if (!kp || kp.hidden) return;
    kp.hidden = true;
    document.documentElement.classList.remove('kp-open');
    if (kpPrevFocus && kpPrevFocus.focus) { try { kpPrevFocus.focus(); } catch (e) {} }
  }
  document.addEventListener('keydown', function(e){
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && String(e.key).toLowerCase() === 'k') {
      e.preventDefault();
      if (kp && !kp.hidden) closePalette(); else openPalette();
    }
  });
  var kpBtn = document.getElementById('kpBtn');
  if (kpBtn) {
    kpBtn.innerHTML = '<kbd>' + (isMac() ? '⌘' : 'Ctrl') + '</kbd><kbd>K</kbd>';
    kpBtn.addEventListener('click', openPalette);
  }

  /* ============================================================
     4. Shareable links: ?cat=manga and ?q=naruto
     ============================================================ */
  var urlTimer = null, urlApplied = false;
  function syncUrl(){
    clearTimeout(urlTimer);
    urlTimer = setTimeout(function(){
      try {
        var p = new URLSearchParams();
        var lg = activeTab !== '__all__' ? findLabelGroup(activeTab) : null;
        if (lg && !lg.nsfwOnly) p.set('cat', slugOf(lg.label));
        var q = String(query || '').trim();
        if (q) p.set('q', q.slice(0, 80));
        var qs = p.toString();
        var next = location.pathname + (qs ? '?' + qs : '') + location.hash;
        if (next !== location.pathname + location.search + location.hash) history.replaceState(null, '', next);
      } catch (e) {}
    }, 350);
  }
  function applyUrl(){
    if (urlApplied) return;
    urlApplied = true;
    var p;
    try { p = new URLSearchParams(location.search); } catch (e) { return; }
    var cat = p.get('cat'), q = p.get('q'), did = false;
    if (cat) {
      for (var i = 0; i < labelGroups.length; i++) {
        if (slugOf(labelGroups[i].label) === cat && !(labelGroups[i].nsfwOnly && !unlocked)) {
          activeTab = labelGroups[i].label; did = true; break;
        }
      }
    }
    if (q) { q = q.slice(0, 80); el.search.value = q; query = q; did = true; }
    if (did) {
      renderTabs();
      renderGrid();
      var fb = document.getElementById('filterBar');
      var h = (location.hash || '').replace(/^#/, '');
      if (fb && fb.scrollIntoView && (!h || h === 'directory')) fb.scrollIntoView({ block: 'start' });
    }
  }

  /* ============================================================
     5. One-time safety tip (adblock + browser)
     ============================================================ */
  function maybeShowTip(){
    if (lsGet(TIP_KEY)) return;
    if (document.getElementById('safetyTip')) return;
    var d = document.createElement('aside');
    d.id = 'safetyTip';
    d.className = 'tip';
    d.setAttribute('role', 'note');
    d.innerHTML =
      '<button type="button" class="tip-x" aria-label="Dismiss tip">×</button>' +
      '<b>Before you open a site</b>' +
      '<p>Many free sites run aggressive ads. Use an ad blocker like <a href="https://ublockorigin.com/" target="_blank" rel="noopener noreferrer">uBlock Origin</a> ' +
      'in a browser like <a href="https://brave.com/" target="_blank" rel="noopener noreferrer">Brave</a> or Firefox, and never download “required” players or codecs.</p>' +
      '<a class="tip-more" href="#guides" data-view="guides">Read the safety guide</a>';
    document.body.appendChild(d);
    function dismiss(){ lsSet(TIP_KEY, '1'); d.remove(); }
    d.querySelector('.tip-x').addEventListener('click', dismiss);
    d.querySelector('.tip-more').addEventListener('click', function(){ lsSet(TIP_KEY, '1'); setTimeout(function(){ d.remove(); }, 0); });
  }

  /* ============================================================
     6. Report a problem with a site (flag button on each card)
        Sends a short report to the monitor worker, which posts it
        to the owner's Discord. If that fails, falls back to the
        old way: copy the text and open the Discord ticket page.
     ============================================================ */
  var REPORT_URL = String(MONITOR_API_URL || '').replace(/\/status\/?$/, '') + '/report';
  var rp = null, rpSite = null, rpPrevFocus = null, rpBusy = false;

  function buildReport(){
    if (rp) return;
    rp = document.createElement('div');
    rp.className = 'rp';
    rp.hidden = true;
    rp.innerHTML =
      '<form class="rp-box" role="dialog" aria-modal="true" aria-labelledby="rpTitle" novalidate>' +
        '<h2 id="rpTitle">Report a problem</h2>' +
        '<p class="rp-site" id="rpSite"></p>' +
        '<label for="rpReason">What is wrong?</label>' +
        '<select id="rpReason">' +
          '<option value="down">Broken link or site is down</option>' +
          '<option value="scam">Scam, malware or unsafe</option>' +
          '<option value="wrong">Wrong name, category or info</option>' +
          '<option value="other">Something else</option>' +
        '</select>' +
        '<label for="rpNote">Details <span>(optional, 200 characters)</span></label>' +
        '<textarea id="rpNote" maxlength="200" rows="3"></textarea>' +
        '<input type="text" id="rpWebsite" class="rp-hp" tabindex="-1" autocomplete="off" aria-hidden="true">' +
        '<p class="rp-msg" id="rpMsg" role="status"></p>' +
        '<div class="rp-actions"><button type="button" class="rp-cancel" id="rpCancel">Cancel</button>' +
        '<button type="submit" class="rp-send" id="rpSend">Send report</button></div>' +
      '</form>';
    document.body.appendChild(rp);
    rp.addEventListener('mousedown', function(e){ if (e.target === rp) closeReport(); });
    rp.querySelector('#rpCancel').addEventListener('click', closeReport);
    rp.querySelector('form').addEventListener('submit', function(e){ e.preventDefault(); sendReport(); });
    rp.addEventListener('keydown', function(e){
      if (e.key === 'Escape') { e.preventDefault(); closeReport(); return; }
      if (e.key !== 'Tab') return;
      var f = rp.querySelectorAll('select, textarea, button');
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
  }
  function openReport(url, name, opener){
    buildReport();
    rpSite = { url: url, name: name };
    rpPrevFocus = opener || document.activeElement;
    rp.querySelector('#rpSite').textContent = name || url;
    rp.querySelector('#rpReason').value = 'down';
    rp.querySelector('#rpNote').value = '';
    rp.querySelector('#rpWebsite').value = '';
    rp.querySelector('#rpMsg').textContent = '';
    rp.querySelector('#rpSend').disabled = false;
    rpBusy = false;
    rp.hidden = false;
    document.documentElement.classList.add('kp-open');
    rp.querySelector('#rpReason').focus();
  }
  function closeReport(){
    if (!rp || rp.hidden) return;
    rp.hidden = true;
    document.documentElement.classList.remove('kp-open');
    if (rpPrevFocus && rpPrevFocus.focus) { try { rpPrevFocus.focus(); } catch (e) {} }
  }
  function reportFallback(){
    var msg = 'Broken link: ' + (rpSite && rpSite.name) + ' ' + (rpSite && rpSite.url);
    try { if (navigator.clipboard) navigator.clipboard.writeText(msg); } catch (err) {}
    toast('Copied. Paste it in a Discord ticket.');
    closeReport();
    setTimeout(function(){ window.open(DISCORD_URL, '_blank', 'noopener'); }, 700);
  }
  function sendReport(){
    if (rpBusy || !rpSite) return;
    rpBusy = true;
    var btn = rp.querySelector('#rpSend'), msg = rp.querySelector('#rpMsg');
    btn.disabled = true;
    msg.textContent = 'Sending…';
    var body = JSON.stringify({
      url: rpSite.url,
      reason: rp.querySelector('#rpReason').value,
      note: rp.querySelector('#rpNote').value,
      website: rp.querySelector('#rpWebsite').value
    });
    var ctl = (typeof AbortController === 'function') ? new AbortController() : null;
    var timer = ctl ? setTimeout(function(){ ctl.abort(); }, 8000) : null;
    fetch(REPORT_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body, signal: ctl ? ctl.signal : undefined })
      .then(function(r){ if (timer) clearTimeout(timer); return r.json().catch(function(){ return {}; }).then(function(j){ return { status: r.status, j: j }; }); })
      .then(function(res){
        if (res.j && res.j.ok) { toast('Thanks, your report was sent'); closeReport(); return; }
        if (res.status === 429) { msg.textContent = 'Too many reports right now. Please try again later.'; rpBusy = false; btn.disabled = false; return; }
        reportFallback();
      })
      .catch(function(){ if (timer) clearTimeout(timer); reportFallback(); });
  }

  /* ============================================================
     7. Suggest a site (button under the search, palette, and the
        "nothing found" message). Posts to the worker's /suggest.
     ============================================================ */
  var SUGGEST_URL = String(MONITOR_API_URL || '').replace(/\/status\/?$/, '') + '/suggest';
  var sg = null, sgPrevFocus = null, sgBusy = false;

  function buildSuggest(){
    if (sg) return;
    var opts = '<option value="">Not sure</option>';
    labelGroups.forEach(function(lg){
      if (lg.nsfwOnly && !unlocked) return;
      opts += '<option value="' + esc(lg.label) + '">' + esc(lg.label) + '</option>';
    });
    sg = document.createElement('div');
    sg.className = 'rp';
    sg.hidden = true;
    sg.innerHTML =
      '<form class="rp-box" role="dialog" aria-modal="true" aria-labelledby="sgTitle" novalidate>' +
        '<h2 id="sgTitle">Suggest a site</h2>' +
        '<p class="rp-site">Know a good free site that is missing? Tell me and I will check it.</p>' +
        '<label for="sgUrl">Website address</label>' +
        '<input id="sgUrl" type="text" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="example.com">' +
        '<label for="sgName">Name <span>(optional)</span></label>' +
        '<input id="sgName" type="text" maxlength="80" autocomplete="off">' +
        '<label for="sgSection">Category <span>(optional)</span></label>' +
        '<select id="sgSection">' + opts + '</select>' +
        '<label for="sgNote">Anything I should know? <span>(optional, 200 characters)</span></label>' +
        '<textarea id="sgNote" maxlength="200" rows="2"></textarea>' +
        '<input type="text" id="sgWebsite" class="rp-hp" tabindex="-1" autocomplete="off" aria-hidden="true">' +
        '<p class="rp-msg" id="sgMsg" role="status"></p>' +
        '<div class="rp-actions"><button type="button" class="rp-cancel" id="sgCancel">Cancel</button>' +
        '<button type="submit" class="rp-send" id="sgSend">Send suggestion</button></div>' +
      '</form>';
    document.body.appendChild(sg);
    sg.addEventListener('mousedown', function(e){ if (e.target === sg) closeSuggest(); });
    sg.querySelector('#sgCancel').addEventListener('click', closeSuggest);
    sg.querySelector('form').addEventListener('submit', function(e){ e.preventDefault(); sendSuggest(); });
    sg.addEventListener('keydown', function(e){
      if (e.key === 'Escape') { e.preventDefault(); closeSuggest(); return; }
      if (e.key !== 'Tab') return;
      var f = sg.querySelectorAll('input:not(.rp-hp), select, textarea, button');
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
  }
  function looksLikeAddress(t){ return /^(https?:\/\/)?[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(String(t || '').trim()); }
  function openSuggest(prefill, opener){
    buildSuggest();
    sgPrevFocus = opener || document.activeElement;
    var p = String(prefill || '').trim();
    sg.querySelector('#sgUrl').value = looksLikeAddress(p) ? p : '';
    sg.querySelector('#sgName').value = (p && !looksLikeAddress(p)) ? p.slice(0, 80) : '';
    sg.querySelector('#sgSection').value = '';
    sg.querySelector('#sgNote').value = '';
    sg.querySelector('#sgWebsite').value = '';
    sg.querySelector('#sgMsg').textContent = '';
    sg.querySelector('#sgSend').disabled = false;
    sgBusy = false;
    sg.hidden = false;
    document.documentElement.classList.add('kp-open');
    sg.querySelector('#sgUrl').focus();
  }
  function closeSuggest(){
    if (!sg || sg.hidden) return;
    sg.hidden = true;
    document.documentElement.classList.remove('kp-open');
    if (sgPrevFocus && sgPrevFocus.focus) { try { sgPrevFocus.focus(); } catch (e) {} }
  }
  function suggestFallback(){
    var msg = 'Site suggestion: ' + sg.querySelector('#sgUrl').value.trim();
    try { if (navigator.clipboard) navigator.clipboard.writeText(msg); } catch (err) {}
    toast('Copied. Paste it in a Discord ticket.');
    closeSuggest();
    setTimeout(function(){ window.open(DISCORD_URL, '_blank', 'noopener'); }, 700);
  }
  function sendSuggest(){
    if (sgBusy) return;
    var url = sg.querySelector('#sgUrl').value.trim(), msg = sg.querySelector('#sgMsg'), btn = sg.querySelector('#sgSend');
    if (!looksLikeAddress(url)) { msg.textContent = 'Please enter a website address like example.com'; sg.querySelector('#sgUrl').focus(); return; }
    sgBusy = true; btn.disabled = true; msg.textContent = 'Sending…';
    var body = JSON.stringify({
      url: url,
      name: sg.querySelector('#sgName').value,
      section: sg.querySelector('#sgSection').value,
      note: sg.querySelector('#sgNote').value,
      website: sg.querySelector('#sgWebsite').value
    });
    var ctl = (typeof AbortController === 'function') ? new AbortController() : null;
    var timer = ctl ? setTimeout(function(){ ctl.abort(); }, 8000) : null;
    fetch(SUGGEST_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body, signal: ctl ? ctl.signal : undefined })
      .then(function(r){ if (timer) clearTimeout(timer); return r.json().catch(function(){ return {}; }).then(function(j){ return { status: r.status, j: j }; }); })
      .then(function(res){
        if (res.j && res.j.ok) { toast(res.j.exists ? 'That site is already in the directory' : 'Thanks! I will take a look'); closeSuggest(); return; }
        sgBusy = false; btn.disabled = false;
        if (res.status === 429) { msg.textContent = 'Too many suggestions right now. Please try again later.'; return; }
        if (res.status === 400) { msg.textContent = 'That does not look like a public website address.'; return; }
        suggestFallback();
      })
      .catch(function(){ if (timer) clearTimeout(timer); suggestFallback(); });
  }
  (function addSuggestButton(){
    if (!recentsEl || !recentsEl.parentNode || document.getElementById('sgBtn')) return;
    var b = document.createElement('button');
    b.type = 'button'; b.id = 'sgBtn'; b.className = 'sg-btn';
    b.textContent = '+ Suggest a site';
    b.addEventListener('click', function(){ openSuggest('', b); });
    recentsEl.parentNode.insertBefore(b, recentsEl);
  })();

  /* ---------- hooks called by the page ---------- */
  function onBuilt(){
    siteLookup();
    ensureFuse();
    applyUrl();
    renderRecents();
    setTimeout(maybeShowTip, 2500);
  }
  function afterRender(){
    renderRecents();
    syncUrl();
    var emp = el.grid.querySelector('.empty');
    if (emp && query && !emp.querySelector('.sg-inline')) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'sg-inline';
      b.textContent = 'Not listed? Suggest “' + String(query).slice(0, 40) + '”';
      b.addEventListener('click', function(){ openSuggest(query, b); });
      emp.appendChild(document.createElement('br'));
      emp.appendChild(b);
    }
  }

  return {
    matches: matches,
    sortByRelevance: sortByRelevance,
    onBuilt: onBuilt,
    afterRender: afterRender,
    open: openPalette,
    close: closePalette,
    openReport: openReport,
    openSuggest: openSuggest
  };
})();
/* EXTRAS:END */
