import json

INDEX_PATH = "index.html"

with open(INDEX_PATH, "r", encoding="utf-8") as f:
    html = f.read()

old_start = "// Try myvouch.es API first"
old_end = "fetch(VOUCHES_RAW + '?_=' + Date.now())"

while True:
    sidx = html.find(old_start)
    if sidx == -1: break
    eidx = html.find(old_end, sidx)
    if eidx == -1: break
    html = html[:sidx] + html[eidx:]
    print("Removed old myvouch.es insertion")

loading_marker = 'panel.innerHTML = \'<div class="panel active" style="padding:0;max-width:100%;"><div class="panel-empty"><h3>Loading Vouches...</h3></div></div>\';'
lid = html.find(loading_marker)
if lid == -1:
    print("Could not find loading marker")
    exit(1)

loading_line_end = html.find("\n", lid)

old_vouch_fetch = """    fetch(VOUCHES_RAW + '?_=' + Date.now())
      .then(function(r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
      .then(function(html) {
        if (mode !== 'vouches') return;

        let cssMatch = html.match(/<style>([\s\S]*?)<\/style>/);
        let css = cssMatch ? cssMatch[1] : '';

        css = '';

        let bodyMatch = html.match(/<body>([\s\S]*?)<\/body>/);
        let bodyContent = bodyMatch ? bodyMatch[1] : '';

        let scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
        let jsCode = scriptMatch ? scriptMatch[1] : '';

        jsCode = jsCode.replace(/function\s+render\s*\(/, 'function vouchesRender(');
        jsCode = jsCode.replace(/\brender\s*\(/g, 'vouchesRender(');

        jsCode = jsCode.replace(/function\s+load\s*\(/, 'function vouchesLoad(');
        jsCode = jsCode.replace(/\bload\s*\(/g, 'vouchesLoad(');

        jsCode = jsCode.replace(/fetch\s*\(\s*['"]vouches\.json['"]\s*\)/, "fetch('https://raw.githubusercontent.com/Sakuras-Hub/Sakuras-Hub/refs/heads/main/need%20for%20the%20website%20to%20work/vouches.json')");

        jsCode = jsCode.replace(/document\.getElementById\('(vouch-list|search|total-count|img-count|lightbox|lb-img|lb-vid)'\)/g, "document.querySelector('#vouches-root

        bodyContent = bodyContent.replace(/oninput="render\(\)"/, 'oninput="vouchesRender()"');

        bodyContent = bodyContent.replace(/\uFFFD/g, '\u00A9');
        bodyContent = bodyContent.replace(/&copy;/g, '\u00A9');

        css = css.replace(/\.container\s*\{[^}]*\}/g, '');

        css = css.replace(/\.hero\s*\{[^}]*\}/g, '');

        let vouchesHtml = '<div id="vouches-root">'
          + '<style>'
          + '#vouches-root{font-size:16px;line-height:1.6;font-family:"Inter",sans-serif;}'
          + '#vouches-root .hero-title,#vouches-root .hero-badge{display:none;}'
          + '#vouches-root .stats{display:flex;gap:12px;justify-content:center;flex-wrap:wrap;padding:6px 0 10px;}'
          + '#vouches-root .stats span{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:5px 12px;font-size:0.68rem;color:var(--muted);letter-spacing:1px;font-family:"Inter",sans-serif;}'
          + '#vouches-root .stats b{color:var(--accent);}'
          + '#vouches-root .search-wrap{max-width:100%;margin:0 auto;}'
          + '#vouches-root .search-wrap input{width:100%;padding:8px 12px;font-size:0.78rem;border-radius:var(--radius);min-height:36px;background:var(--surface);border:1px solid var(--border);color:var(--text);font-family:"Inter",sans-serif;outline:none;transition:border-color 0.2s,box-shadow 0.2s;}'
          + '#vouches-root .search-wrap input::placeholder{color:var(--muted2);}'
          + '#vouches-root .search-wrap input:focus{border-color:var(--accent);box-shadow:0 0 20px var(--accent-glow);}'
          + '#vouches-root .vouch-list{margin-top:14px;}'
           + '#vouches-root .vouch-card{background:rgba(17,15,28,0.82);border:1px solid var(--border);border-radius:13px;padding:14px;margin-bottom:10px;font-family:"Inter",sans-serif;position:relative;overflow:hidden;}'
           + '#vouches-root .vouch-card:hover{border-color:rgba(255,0,255,0.30);}'
          + '#vouches-root .vouch-card .meta{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;flex-wrap:wrap;gap:6px;position:relative;z-index:1;}'
          + '#vouches-root .vouch-card .author{font-size:0.82rem;font-weight:600;color:var(--text);position:relative;z-index:1;}'
          + '#vouches-root .vouch-card .author .badge{background:var(--accent);color:#fff;font-size:0.6rem;padding:2px 8px;border-radius:10px;margin-left:6px;letter-spacing:1px;}'
          + '#vouches-root .vouch-card .date{font-size:0.6rem;color:var(--muted2);letter-spacing:0.5px;text-transform:uppercase;position:relative;z-index:1;}'
          + '#vouches-root .vouch-card .target{font-size:0.72rem;color:var(--accent-text);font-weight:600;margin-bottom:8px;position:relative;z-index:1;}'
          + '#vouches-root .vouch-card .target::before{content:"→ ";opacity:0.6;}'
          + '#vouches-root .vouch-card .content{font-size:0.8rem;line-height:1.55;color:var(--text);margin-bottom:10px;white-space:pre-wrap;position:relative;z-index:1;}'
          + '#vouches-root .vouch-card .attachments{display:flex;gap:8px;flex-wrap:wrap;position:relative;z-index:1;}'
          + '#vouches-root .vouch-card .attachments a{display:block;border:1px solid var(--border);border-radius:6px;overflow:hidden;max-width:160px;transition:border-color 0.2s,box-shadow 0.2s;font-family:"Inter",sans-serif;}'
          + '#vouches-root .vouch-card .attachments a:hover{border-color:var(--accent);box-shadow:0 0 14px var(--accent-glow2);}'
          + '#vouches-root .vouch-card .attachments img,#vouches-root .vouch-card .attachments video{width:100%;display:block;max-height:140px;object-fit:cover;border-radius:4px;}'
          + '
          + '#vouches-root .vouch-card .attachments .file-link:hover{background:rgba(var(--accent-rgb),0.1);border-color:var(--accent);}'
          + '#vouches-root .vouch-card .issue-link{display:inline-block;margin-top:8px;color:var(--muted);font-size:0.68rem;text-decoration:none;transition:color 0.2s;position:relative;z-index:1;font-family:"Inter",sans-serif;}'
          + '#vouches-root .vouch-card .issue-link:hover{color:var(--accent);text-decoration:underline;}'
          + '#vouches-root .empty{text-align:center;padding:40px 16px;color:var(--muted);}'
          + '#vouches-root .empty h2{font-family:"Syne",sans-serif;font-weight:900;font-size:1.2rem;margin-bottom:8px;color:var(--text);}'
           + '#vouches-root .lightbox{display:none;position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(5,4,12,0.92);z-index:10000;justify-content:center;align-items:center;padding:24px;cursor:zoom-out;}'
          + '#vouches-root .lightbox.open{display:flex;}'
          + '#vouches-root .lightbox img,#vouches-root .lightbox video{max-width:100%;max-height:90vh;border-radius:8px;cursor:default;box-shadow:0 0 40px rgba(var(--accent-rgb),0.15);}'
          + '#vouches-root .loading{text-align:center;padding:40px 16px;color:var(--muted);font-size:0.82rem;letter-spacing:2px;}'
          + '#vouches-root .loading-dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--accent);margin:0 3px;animation:vouchBounce 1.2s infinite;box-shadow:0 0 8px var(--accent-glow);}'
          + '#vouches-root .loading-dot:nth-child(2){animation-delay:0.2s;}'
          + '#vouches-root .loading-dot:nth-child(3){animation-delay:0.4s;}'
          + '@keyframes vouchBounce{0%,80%,100%{transform:scale(0.6);opacity:0.5}40%{transform:scale(1.1);opacity:1}}'
          + '#vouches-root .footer{text-align:center;padding:20px 0 0;font-size:0.6rem;letter-spacing:2px;text-transform:uppercase;opacity:0.4;color:var(--muted2);}'
          + '@media(max-width:640px){'
          + '#vouches-root .vouch-card{padding:12px;}'
          + '#vouches-root .vouch-card .content{font-size:0.75rem;}'
          + '#vouches-root .vouch-card .author{font-size:0.78rem;}'
          + '#vouches-root .stats span{font-size:0.6rem;padding:4px 8px;}'
          + '#vouches-root .search-wrap input{font-size:0.72rem;padding:7px 10px;min-height:32px;}'
          + '#vouches-root .vouch-card .attachments a{max-width:100%;}'
          + '}</style>'
          + '<div class="info-card" style="padding:0;overflow:visible;background:transparent;border:none;box-shadow:none;">'
          + bodyContent
          + '</div>'
          + '</div>';

        panel.innerHTML = '<div class="panel active" style="padding:0;max-width:100%;">' + vouchesHtml + '</div>';

        let scriptEl = document.createElement('script');
        scriptEl.textContent = jsCode;
        document.body.appendChild(scriptEl);
        document.body.removeChild(scriptEl);
        updateHero("Sakura's Vouches", 'Customer Feedback');
      })
      .catch(function(err) {
        if (mode !== 'vouches') return;
        panel.innerHTML = '<div class="panel active"><div class="panel-empty"><h3>\u26a0\ufe0f Could not load Vouches</h3><p style="color:#ff6677;font-size:0.82rem;word-break:break-all">' + esc(err.message || String(err)) + '</p></div></div>';
      });"""

new_vouch_fetch = """    // Try myvouch.es API first; fallback to VOUCHES_RAW
    var myVouchApi = 'https://myvouch.es/api/vouches/fadded';
    var myVouchUsed = false;
    fetch(myVouchApi + '?_=' + Date.now(), { headers: { 'Accept': 'application/json' } })
      .then(function(r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function(jd) {
        if (mode !== 'vouches') return;
        if (jd && jd.data && jd.data.length) {
          myVouchUsed = true;
          renderMyVouches(jd.data);
        }
      })
      .catch(function() {});

    fetch(VOUCHES_RAW + '?_=' + Date.now())
      .then(function(r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
      .then(function(html) {
        if (mode !== 'vouches') return;
        if (myVouchUsed) return;

        let cssMatch = html.match(/<style>([\s\S]*?)<\/style>/);
        let css = cssMatch ? cssMatch[1] : '';

        css = '';

        let bodyMatch = html.match(/<body>([\s\S]*?)<\/body>/);
        let bodyContent = bodyMatch ? bodyMatch[1] : '';

        let scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
        let jsCode = scriptMatch ? scriptMatch[1] : '';

        jsCode = jsCode.replace(/function\s+render\s*\(/, 'function vouchesRender(');
        jsCode = jsCode.replace(/\brender\s*\(/g, 'vouchesRender(');

        jsCode = jsCode.replace(/function\s+load\s*\(/, 'function vouchesLoad(');
        jsCode = jsCode.replace(/\bload\s*\(/g, 'vouchesLoad(');

        jsCode = jsCode.replace(/fetch\s*\(\s*['"]vouches\.json['"]\s*\)/, "fetch('https://raw.githubusercontent.com/Sakuras-Hub/Sakuras-Hub/refs/heads/main/need%20for%20the%20website%20to%20work/vouches.json')");

        jsCode = jsCode.replace(/document\.getElementById\('(vouch-list|search|total-count|img-count|lightbox|lb-img|lb-vid)'\)/g, "document.querySelector('#vouches-root

        bodyContent = bodyContent.replace(/oninput="render\(\)"/, 'oninput="vouchesRender()"');

        bodyContent = bodyContent.replace(/\uFFFD/g, '\u00A9');
        bodyContent = bodyContent.replace(/&copy;/g, '\u00A9');

        css = css.replace(/\.container\s*\{[^}]*\}/g, '');

        css = css.replace(/\.hero\s*\{[^}]*\}/g, '');

        let vouchesHtml = '<div id="vouches-root">'
          + '<style>'
          + '#vouches-root{font-size:16px;line-height:1.6;font-family:"Inter",sans-serif;}'
          + '#vouches-root .hero-title,#vouches-root .hero-badge{display:none;}'
          + '#vouches-root .stats{display:flex;gap:12px;justify-content:center;flex-wrap:wrap;padding:6px 0 10px;}'
          + '#vouches-root .stats span{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:5px 12px;font-size:0.68rem;color:var(--muted);letter-spacing:1px;font-family:"Inter",sans-serif;}'
          + '#vouches-root .stats b{color:var(--accent);}'
          + '#vouches-root .search-wrap{max-width:100%;margin:0 auto;}'
          + '#vouches-root .search-wrap input{width:100%;padding:8px 12px;font-size:0.78rem;border-radius:var(--radius);min-height:36px;background:var(--surface);border:1px solid var(--border);color:var(--text);font-family:"Inter",sans-serif;outline:none;transition:border-color 0.2s,box-shadow 0.2s;}'
          + '#vouches-root .search-wrap input::placeholder{color:var(--muted2);}'
          + '#vouches-root .search-wrap input:focus{border-color:var(--accent);box-shadow:0 0 20px var(--accent-glow);}'
          + '#vouches-root .vouch-list{margin-top:14px;}'
           + '#vouches-root .vouch-card{background:rgba(17,15,28,0.82);border:1px solid var(--border);border-radius:13px;padding:14px;margin-bottom:10px;font-family:"Inter",sans-serif;position:relative;overflow:hidden;}'
           + '#vouches-root .vouch-card:hover{border-color:rgba(255,0,255,0.30);}'
          + '#vouches-root .vouch-card .meta{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;flex-wrap:wrap;gap:6px;position:relative;z-index:1;}'
          + '#vouches-root .vouch-card .author{font-size:0.82rem;font-weight:600;color:var(--text);position:relative;z-index:1;}'
          + '#vouches-root .vouch-card .author .badge{background:var(--accent);color:#fff;font-size:0.6rem;padding:2px 8px;border-radius:10px;margin-left:6px;letter-spacing:1px;}'
          + '#vouches-root .vouch-card .date{font-size:0.6rem;color:var(--muted2);letter-spacing:0.5px;text-transform:uppercase;position:relative;z-index:1;}'
          + '#vouches-root .vouch-card .target{font-size:0.72rem;color:var(--accent-text);font-weight:600;margin-bottom:8px;position:relative;z-index:1;}'
          + '#vouches-root .vouch-card .target::before{content:"\u2192 ";opacity:0.6;}'
          + '#vouches-root .vouch-card .content{font-size:0.8rem;line-height:1.55;color:var(--text);margin-bottom:10px;white-space:pre-wrap;position:relative;z-index:1;}'
          + '#vouches-root .vouch-card .attachments{display:flex;gap:8px;flex-wrap:wrap;position:relative;z-index:1;}'
          + '#vouches-root .vouch-card .attachments a{display:block;border:1px solid var(--border);border-radius:6px;overflow:hidden;max-width:160px;transition:border-color 0.2s,box-shadow 0.2s;font-family:"Inter",sans-serif;}'
          + '#vouches-root .vouch-card .attachments a:hover{border-color:var(--accent);box-shadow:0 0 14px var(--accent-glow2);}'
          + '#vouches-root .vouch-card .attachments img,#vouches-root .vouch-card .attachments video{width:100%;display:block;max-height:140px;object-fit:cover;border-radius:4px;}'
          + '
          + '#vouches-root .vouch-card .attachments .file-link:hover{background:rgba(var(--accent-rgb),0.1);border-color:var(--accent);}'
          + '#vouches-root .vouch-card .issue-link{display:inline-block;margin-top:8px;color:var(--muted);font-size:0.68rem;text-decoration:none;transition:color 0.2s;position:relative;z-index:1;font-family:"Inter",sans-serif;}'
          + '#vouches-root .vouch-card .issue-link:hover{color:var(--accent);text-decoration:underline;}'
          + '#vouches-root .empty{text-align:center;padding:40px 16px;color:var(--muted);}'
          + '#vouches-root .empty h2{font-family:"Syne",sans-serif;font-weight:900;font-size:1.2rem;margin-bottom:8px;color:var(--text);}'
           + '#vouches-root .lightbox{display:none;position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(5,4,12,0.92);z-index:10000;justify-content:center;align-items:center;padding:24px;cursor:zoom-out;}'
          + '#vouches-root .lightbox.open{display:flex;}'
          + '#vouches-root .lightbox img,#vouches-root .lightbox video{max-width:100%;max-height:90vh;border-radius:8px;cursor:default;box-shadow:0 0 40px rgba(var(--accent-rgb),0.15);}'
          + '#vouches-root .loading{text-align:center;padding:40px 16px;color:var(--muted);font-size:0.82rem;letter-spacing:2px;}'
          + '#vouches-root .loading-dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--accent);margin:0 3px;animation:vouchBounce 1.2s infinite;box-shadow:0 0 8px var(--accent-glow);}'
          + '#vouches-root .loading-dot:nth-child(2){animation-delay:0.2s;}'
          + '#vouches-root .loading-dot:nth-child(3){animation-delay:0.4s;}'
          + '@keyframes vouchBounce{0%,80%,100%{transform:scale(0.6);opacity:0.5}40%{transform:scale(1.1);opacity:1}}'
          + '#vouches-root .footer{text-align:center;padding:20px 0 0;font-size:0.6rem;letter-spacing:2px;text-transform:uppercase;opacity:0.4;color:var(--muted2);}'
          + '@media(max-width:640px){'
          + '#vouches-root .vouch-card{padding:12px;}'
          + '#vouches-root .vouch-card .content{font-size:0.75rem;}'
          + '#vouches-root .vouch-card .author{font-size:0.78rem;}'
          + '#vouches-root .stats span{font-size:0.6rem;padding:4px 8px;}'
          + '#vouches-root .search-wrap input{font-size:0.72rem;padding:7px 10px;min-height:32px;}'
          + '#vouches-root .vouch-card .attachments a{max-width:100%;}'
          + '}</style>'
          + '<div class="info-card" style="padding:0;overflow:visible;background:transparent;border:none;box-shadow:none;">'
          + bodyContent
          + '</div>'
          + '</div>';

        panel.innerHTML = '<div class="panel active" style="padding:0;max-width:100%;">' + vouchesHtml + '</div>';

        let scriptEl = document.createElement('script');
        scriptEl.textContent = jsCode;
        document.body.appendChild(scriptEl);
        document.body.removeChild(scriptEl);
        updateHero("Sakura's Vouches", 'Customer Feedback');
      })
      .catch(function(err) {
        if (mode !== 'vouches') return;
        panel.innerHTML = '<div class="panel active"><div class="panel-empty"><h3>\u26a0\ufe0f Could not load Vouches</h3><p style="color:#ff6677;font-size:0.82rem;word-break:break-all">' + esc(err.message || String(err)) + '</p></div></div>';
      });"""

if old_vouch_fetch not in html:
    print("Could not match original fetch code - checking for differences...")
    idx = html.find("fetch(VOUCHES_RAW + '?_=' + Date.now())")
    if idx >= 0:
        print(f"Found at offset {idx}")
        print(repr(html[idx:idx+50]))
    exit(1)

html = html.replace(old_vouch_fetch, new_vouch_fetch, 1)
print("Patched renderVouchesMode with myvouch.es API + flag guard")

if "function renderMyVouches" not in html:
    ld_call = html.find("loadData();")
    if ld_call == -1:
        print("Could not find loadData()")
        exit(1)

    my_vouches_func = """
function renderMyVouches(data) {
  try {
    if (!data || !data.length) throw new Error('No data');
    var panel = document.getElementById('panels');
    if (!panel) return;
    var total = data.length;
    var stars5 = 0, stars4 = 0;
    data.forEach(function(v) {
      var s = parseInt(v.stars, 10) || 0;
      if (s >= 5) stars5++;
      else if (s >= 4) stars4++;
    });
    var cards = '';
    data.forEach(function(v) {
      var s = parseInt(v.stars, 10) || 0;
      var starsHtml = '';
      for (var i = 0; i < 5; i++) starsHtml += i < s ? '\u2b50' : '\u2606';
      var proofHtml = '';
      if (v.proof) {
        var pUrl = 'https://myvouch.es' + v.proof;
        if (v.proof.match(/\\.(mp4|webm|mov)$/i)) {
          proofHtml = '<a href="' + pUrl + '" target="_blank"><video src="' + pUrl + '" preload="metadata" controlslist="nodownload"></video></a>';
        } else {
          proofHtml = '<a href="' + pUrl + '" target="_blank"><img src="' + pUrl + '" loading="lazy" alt="Proof"></a>';
        }
      }
      var avatarUrl = v.platform_avatar ? 'https://myvouch.es' + v.platform_avatar : '';
      cards += '<div class="vouch-card">';
      cards += '<div class="meta">';
      cards += '<div class="author">' + (avatarUrl ? '<img src="' + avatarUrl + '" style="width:20px;height:20px;border-radius:50%;vertical-align:middle;margin-right:6px" alt="">' : '') + esc(v.platform_username || 'Anonymous') + ' <span class="badge">#' + v.vouch_number + '</span></div>';
      cards += '<div class="date">' + esc(v.date || '') + '</div>';
      cards += '</div>';
      cards += '<div class="target">Fadded</div>';
      cards += '<div class="content">' + starsHtml + '\\n' + esc(v.content || '') + '</div>';
      if (proofHtml) cards += '<div class="attachments">' + proofHtml + '</div>';
      cards += '</div>';
    });
    var vhtml = '<div id="vouches-root">'
      + '<style>#vouches-root{font-size:16px;line-height:1.6;font-family:"Inter",sans-serif;}'
      + '#vouches-root .hero-title,#vouches-root .hero-badge{display:none;}'
      + '#vouches-root .stats{display:flex;gap:12px;justify-content:center;flex-wrap:wrap;padding:6px 0 10px;}'
      + '#vouches-root .stats span{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:5px 12px;font-size:0.68rem;color:var(--muted);letter-spacing:1px;font-family:"Inter",sans-serif;}'
      + '#vouches-root .stats b{color:var(--accent);}'
      + '#vouches-root .vouch-list{margin-top:14px;}'
      + '#vouches-root .vouch-card{background:rgba(17,15,28,0.82);border:1px solid var(--border);border-radius:13px;padding:14px;margin-bottom:10px;font-family:"Inter",sans-serif;position:relative;overflow:hidden;}'
      + '#vouches-root .vouch-card:hover{border-color:rgba(255,0,255,0.30);}'
      + '#vouches-root .vouch-card .meta{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;flex-wrap:wrap;gap:6px;}'
      + '#vouches-root .vouch-card .author{font-size:0.82rem;font-weight:600;color:var(--text);}'
      + '#vouches-root .vouch-card .author .badge{background:var(--accent);color:#fff;font-size:0.6rem;padding:2px 8px;border-radius:10px;margin-left:6px;letter-spacing:1px;}'
      + '#vouches-root .vouch-card .date{font-size:0.6rem;color:var(--muted2);letter-spacing:0.5px;text-transform:uppercase;}'
      + '#vouches-root .vouch-card .target{font-size:0.72rem;color:var(--accent-text);font-weight:600;margin-bottom:8px;}'
      + '#vouches-root .vouch-card .target::before{content:"\u2192 ";opacity:0.6;}'
      + '#vouches-root .vouch-card .content{font-size:0.8rem;line-height:1.55;color:var(--text);margin-bottom:10px;white-space:pre-wrap;}'
      + '#vouches-root .vouch-card .attachments{display:flex;gap:8px;flex-wrap:wrap;}'
      + '#vouches-root .vouch-card .attachments a{display:block;border:1px solid var(--border);border-radius:6px;overflow:hidden;max-width:160px;}'
      + '#vouches-root .vouch-card .attachments a:hover{border-color:var(--accent);box-shadow:0 0 14px var(--accent-glow2);}'
      + '#vouches-root .vouch-card .attachments img,#vouches-root .vouch-card .attachments video{width:100%;display:block;max-height:140px;object-fit:cover;border-radius:4px;}'
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
      + '<div class="footer">Fadded\u2019s Vouches \u00b7 Powered by MyVouches</div>'
      + '</div>';
    panel.innerHTML = '<div class="panel active" style="padding:0;max-width:100%;">' + vhtml + '</div>';
    updateHero("Fadded's Vouches", 'Customer Feedback');
  } catch(e) {
    console.warn('renderMyVouches error:', e);
    var p = document.getElementById('panels');
    if (p) p.innerHTML = '<div class="panel active"><div class="panel-empty"><h3>\u26a0\ufe0f Error</h3><p style="color:#ff6677;font-size:0.82rem">' + esc(e.message || String(e)) + '</p></div></div>';
  }
}
"""
    html = html[:ld_call] + my_vouches_func + "\n" + html[ld_call:]
    print("Added renderMyVouches function")
else:
    print("renderMyVouches already exists")

with open(INDEX_PATH, "w", encoding="utf-8") as f:
    f.write(html)

print("Done")
