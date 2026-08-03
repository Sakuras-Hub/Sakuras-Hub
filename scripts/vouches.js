function renderVouchesMode() {
  try {
    let tw = document.querySelector('.tabbar-wrap');
    if (tw) tw.style.display = 'none';
    let vt = document.getElementById('vouchesToggle');
    if (vt) vt.textContent = '\u2715 Close Vouches';
    let panel = document.getElementById('panels');
    if (!panel) return;

    panel.innerHTML = '<div class="panel active" style="padding:0;max-width:100%;"><div class="panel-empty"><h3>Loading Vouches...</h3></div></div>';

    Promise.all([fetchBotVouches(), fetchLegacyVouches()]).then(function(results) {
      if (mode !== 'vouches') return;
      renderVouchCards(results[0].concat(results[1]));
    }).catch(function() {
      if (mode !== 'vouches') return;
      renderVouchCards([]);
    });
  } catch (err) {
    console.error('renderVouchesMode error:', err);
    let p = document.getElementById('panels');
    if (p) p.innerHTML = '<div class="panel active"><div class="panel-empty"><h3>\u26a0\ufe0f Error loading Vouches</h3><p style="color:#ff6677;font-size:0.82rem">' + esc(err.message || String(err)) + '</p></div></div>';
  }
}

function fetchBotVouches() {
  return fetch(VOUCHES_RAW + '?_=' + Date.now(), { headers: { 'Accept': 'application/json' } })
    .then(function(r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(function(data) {
      var out = [];
      var list = Array.isArray(data) ? data : (data ? [data] : []);
      list.forEach(function(v) {
        if (!v || !v.id) return;
        out.push({
          id: '#' + v.id,
          name: v.buyer_name || 'Anonymous',
          stars: parseInt(v.rating, 10) || 0,
          content: v.review || '',
          date: v.date || '',
          proof: v.proof_url || ''
        });
      });
      return out;
    })
    .catch(function() { return []; });
}

function fetchLegacyVouches() {
  return fetch('https://myvouch.es/api/vouches/fadded?_=' + Date.now(), { headers: { 'Accept': 'application/json' } })
    .then(function(r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(function(jd) {
      var out = [];
      if (jd && jd.data && jd.data.length) {
        jd.data.forEach(function(v) {
          var proof = '';
          if (v.proof) {
            proof = v.proof.indexOf('http') === 0 ? v.proof : 'https://myvouch.es' + v.proof;
          }
          out.push({
            id: '#' + (v.vouch_number || ''),
            name: v.platform_username || 'Anonymous',
            stars: parseInt(v.stars, 10) || 0,
            content: v.content || '',
            date: v.date || '',
            proof: proof
          });
        });
      }
      return out;
    })
    .catch(function() { return []; });
}

function renderVouchCards(data) {
  try {
    var panel = document.getElementById('panels');
    if (!panel) return;
    if (!data || !data.length) {
      panel.innerHTML = '<div class="panel active"><div class="panel-empty"><h3>\u26a0\ufe0f No vouches yet</h3></div></div>';
      return;
    }
    var total = data.length;
    var stars5 = 0, stars4 = 0;
    data.forEach(function(v) {
      if (v.stars >= 5) stars5++;
      else if (v.stars >= 4) stars4++;
    });

    var cards = '';
    data.forEach(function(v) {
      var starsHtml = '';
      for (var i = 0; i < 5; i++) {
        starsHtml += i < v.stars ? '\u2b50' : '\u2606';
      }
      var proofHtml = '';
      if (v.proof) {
        var pUrl = v.proof;
        if (pUrl.match(/\.(mp4|webm|mov)$/i)) {
          proofHtml = '<a href="' + pUrl + '" target="_blank" rel="noopener"><video src="' + pUrl + '" preload="metadata" controlslist="nodownload"></video></a>';
        } else {
          proofHtml = '<a href="' + pUrl + '" target="_blank" rel="noopener"><img src="' + pUrl + '" loading="lazy" alt="Proof"></a>';
        }
      }
      cards += '<div class="vouch-card">';
      cards += '<div class="meta">';
      cards += '<div class="author">' + esc(v.name) + ' <span class="badge">' + v.id + '</span></div>';
      cards += '<div class="date">' + esc(v.date || '') + '</div>';
      cards += '</div>';
      cards += '<div class="content">' + starsHtml + '\n' + esc(v.content || '') + '</div>';
      if (proofHtml) {
        cards += '<div class="attachments">' + proofHtml + '</div>';
      }
      cards += '</div>';
    });

    var vhtml = '<div id="vouches-root">'
      + '<style>'
      + '#vouches-root{font-size:16px;line-height:1.6;font-family:"Inter",sans-serif;}'
      + '#vouches-root .hero-title,#vouches-root .hero-badge{display:none;}'
      + '#vouches-root .stats{display:flex;gap:12px;justify-content:center;flex-wrap:wrap;padding:6px 0 10px;}'
      + '#vouches-root .stats span{background:var(--surface);border:1px solid var(--border);border-radius:999px;padding:7px 16px;font-size:0.7rem;color:var(--muted);letter-spacing:1px;font-family:"Inter",sans-serif;box-shadow:inset 0 1px 0 rgba(255,255,255,0.07);}'
      + '#vouches-root .stats b{color:var(--accent);}'
      + '#vouches-root .search-wrap{max-width:100%;margin:0 auto;}'
      + '#vouches-root .search-wrap input{width:100%;padding:10px 16px;font-size:0.8rem;border-radius:999px;min-height:44px;background:var(--surface);border:1px solid var(--border);color:var(--text);font-family:"Inter",sans-serif;outline:none;transition:border-color 0.2s,box-shadow 0.2s;box-shadow:inset 0 1px 0 rgba(255,255,255,0.06);}'
      + '#vouches-root .search-wrap input::placeholder{color:var(--muted2);}'
      + '#vouches-root .search-wrap input:focus{border-color:rgba(255,0,255,0.5);box-shadow:inset 0 1px 0 rgba(255,255,255,0.06),0 0 0 4px rgba(var(--accent-rgb),0.12);}'
      + '#vouches-root .vouch-list{margin-top:14px;}'
      + '#vouches-root .vouch-card{background:linear-gradient(180deg,rgba(255,255,255,0.075),rgba(255,255,255,0.035));border:1px solid var(--border);border-radius:20px;padding:16px;margin-bottom:12px;font-family:"Inter",sans-serif;position:relative;overflow:hidden;box-shadow:var(--shadow-card),inset 0 1px 0 rgba(255,255,255,0.08);transition:border-color .25s,box-shadow .25s,transform .25s;}'
      + '#vouches-root .vouch-card:hover{border-color:rgba(255,0,255,0.30);box-shadow:var(--shadow-hover),inset 0 1px 0 rgba(255,255,255,0.10),0 0 0 1px rgba(var(--accent-rgb),0.10);transform:translateY(-2px);}'
      + '#vouches-root .vouch-card .meta{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;flex-wrap:wrap;gap:6px;}'
      + '#vouches-root .vouch-card .author{font-size:0.82rem;font-weight:600;color:var(--text);}'
      + '#vouches-root .vouch-card .author .badge{background:var(--accent);color:#fff;font-size:0.6rem;padding:3px 10px;border-radius:999px;margin-left:6px;letter-spacing:1px;}'
      + '#vouches-root .vouch-card .date{font-size:0.6rem;color:var(--muted2);letter-spacing:0.5px;text-transform:uppercase;}'
      + '#vouches-root .vouch-card .target{font-size:0.72rem;color:var(--accent-text);font-weight:600;margin-bottom:8px;}'
      + '#vouches-root .vouch-card .target::before{content:"\u2192 ";opacity:0.6;}'
      + '#vouches-root .vouch-card .content{font-size:0.8rem;line-height:1.55;color:var(--text);margin-bottom:10px;white-space:pre-wrap;}'
      + '#vouches-root .vouch-card .attachments{display:flex;gap:8px;flex-wrap:wrap;}'
      + '#vouches-root .vouch-card .attachments a{display:block;border:1px solid var(--border);border-radius:14px;overflow:hidden;max-width:160px;box-shadow:inset 0 1px 0 rgba(255,255,255,0.06);}'
      + '#vouches-root .vouch-card .attachments a:hover{border-color:var(--accent);box-shadow:0 0 14px var(--accent-glow2);}'
      + '#vouches-root .vouch-card .attachments img,#vouches-root .vouch-card .attachments video{width:100%;display:block;max-height:140px;object-fit:cover;border-radius:10px;}'
      + '#vouches-root .footer{text-align:center;padding:20px 0 0;font-size:0.6rem;letter-spacing:2px;text-transform:uppercase;opacity:0.4;color:var(--muted2);}'
      + '@media(max-width:640px){'
      + '#vouches-root .vouch-card{padding:12px;}'
      + '#vouches-root .vouch-card .content{font-size:0.75rem;}'
      + '#vouches-root .vouch-card .author{font-size:0.78rem;}'
      + '#vouches-root .stats span{font-size:0.6rem;padding:4px 8px;}'
      + '#vouches-root .search-wrap input{font-size:0.72rem;padding:7px 10px;min-height:32px;}'
      + '#vouches-root .vouch-card .attachments a{max-width:100%;}'
      + '}</style>'
      + '<div class="stats">'
      + '<span>Total <b>' + total + '</b></span>'
      + '<span>\u2b50 5\u2605 <b>' + stars5 + '</b></span>'
      + '<span>\u2b50 4\u2605 <b>' + stars4 + '</b></span>'
      + '</div>'
      + '<div class="vouch-list">' + cards + '</div>'
      + '</div>';

    panel.innerHTML = '<div class="panel active" style="padding:0;max-width:100%;">' + vhtml + '</div>';
    updateHero('Vouches', 'Customer Feedback');
  } catch(e) {
    console.warn('renderVouchCards error:', e);
    var p = document.getElementById('panels');
    if (p) p.innerHTML = '<div class="panel active"><div class="panel-empty"><h3>\u26a0\ufe0f Error</h3><p style="color:#ff6677;font-size:0.82rem">' + esc(e.message || String(e)) + '</p></div></div>';
  }
}
