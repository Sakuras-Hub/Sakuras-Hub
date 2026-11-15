// Loads directory.html in jsdom with the real site list and exercises the extras:
// fuzzy search, Ctrl+K palette, recently visited, shareable links, safety tip, report button.
// Needs:  npm install --no-save jsdom@24
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { JSDOM, VirtualConsole } = require('jsdom');
const root = fileURLToPath(new URL('..', import.meta.url));
const html0 = fs.readFileSync(root + 'directory.html', 'utf8');
const info = fs.readFileSync(root + 'need for the website to work/info.json', 'utf8');
const fuseSrc = fs.readFileSync(root + 'assets/vendor/fuse.min.js', 'utf8');
const html = html0.replace('<script src="assets/vendor/fuse.min.js"></script>', '<script>' + fuseSrc.replace(/<\/script/g, '<\\/script') + '</script>');

function load(url, fetchImpl) {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => errors.push(String((e.detail && e.detail.message) || e.message)));
  const dom = new JSDOM(html, {
    url, runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      w.HTMLCanvasElement.prototype.getContext = function () { return new Proxy({ createImageData: (a, b) => ({ data: new Uint8ClampedArray(Math.max(1, a * b * 4)) }) }, { get: (t, k) => (k in t ? t[k] : () => {}) }); };
      w.requestAnimationFrame = () => 0; w.scrollTo = () => {}; w.Element.prototype.scrollIntoView = function () {};
      w.open = (...a) => { w.__opened = a; return null; };
      w.fetch = fetchImpl || ((u) => String(u).includes('info.json')
        ? Promise.resolve({ ok: true, json: () => Promise.resolve(JSON.parse(info)) })
        : Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve({}) }));
    }
  });
  return { dom, errors };
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0; const ok = (c, m) => { console.log(c ? '  ✓' : '  ✗ FAIL:', m); if (!c) failed++; };

// Deep-link mode: run in a child process to keep memory low
if (process.argv[2] === 'deep') {
  const { dom, errors } = load(process.argv[3]); await wait(1500);
  const d = dom.window.document;
  console.log(JSON.stringify({ trigger: d.getElementById('catTrigger').textContent, search: d.getElementById('searchInput').value, cards: d.querySelectorAll('#grid a.preset-card').length, errors }));
  process.exit(0);
}

if (process.argv[2] === 'suggest') {
  const status = +process.argv[3]; const exists = process.argv[4] === 'exists'; const sent = [];
  const { dom } = load('https://example.test/directory', (u, opt) => {
    if (String(u).includes('info.json')) return Promise.resolve({ ok: true, json: () => Promise.resolve(JSON.parse(info)) });
    if (String(u).endsWith('/suggest')) { sent.push(JSON.parse(opt.body)); return Promise.resolve({ status, json: () => Promise.resolve({ ok: status === 200, exists }) }); }
    return Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve({}) });
  });
  await wait(1500);
  const w = dom.window, d = w.document;
  d.getElementById('sgBtn').click();
  const badFirst = process.argv[5] === 'bad';
  d.getElementById('sgUrl').value = badFirst ? 'not an address' : 'brandnewsite.org';
  d.getElementById('sgName').value = 'Brand New'; d.getElementById('sgNote').value = 'good one';
  d.querySelector('#sgTitle').closest('form').dispatchEvent(new w.Event('submit', { cancelable: true, bubbles: true }));
  await wait(1200);
  console.log(JSON.stringify({ sent, closed: d.getElementById('sgTitle').closest('.rp').hidden, opened: w.__opened || null, msg: d.getElementById('sgMsg').textContent }));
  process.exit(0);
}

if (process.argv[2] === 'report') {
  const status = +process.argv[3]; const sent = [];
  const { dom } = load('https://example.test/directory', (u, opt) => {
    if (String(u).includes('info.json')) return Promise.resolve({ ok: true, json: () => Promise.resolve(JSON.parse(info)) });
    if (String(u).endsWith('/report')) { sent.push(JSON.parse(opt.body)); return Promise.resolve({ status, json: () => Promise.resolve({ ok: status === 200 }) }); }
    return Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve({}) });
  });
  await wait(1500);
  const w = dom.window, d = w.document;
  d.querySelector('#grid .preset-act[data-act="report"]').dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
  d.getElementById('rpReason').value = 'scam'; d.getElementById('rpNote').value = 'looks fake';
  d.querySelector('.rp-box').dispatchEvent(new w.Event('submit', { cancelable: true, bubbles: true }));
  await wait(1200);
  console.log(JSON.stringify({ sent, closed: d.querySelector('.rp').hidden, opened: w.__opened || null, msg: d.getElementById('rpMsg').textContent }));
  process.exit(0);
}

const { dom, errors } = load('https://example.test/directory'); await wait(1500);
const w = dom.window, d = w.document;
const cards = () => d.querySelectorAll('#grid a.preset-card').length;
const total = cards();
ok(total > 1000, `directory renders ${total} cards`);
ok(typeof w.Fuse === 'function', 'Fuse.js loaded from assets/vendor');
const s = d.getElementById('searchInput');
const type = async (v) => { s.value = v; s.dispatchEvent(new w.Event('input')); await wait(400); };
await type('mangafyre'); ok(cards() > 0 && cards() < 50, `typo "mangafyre" still finds sites (${cards()})`);
await type('manga'); ok(cards() > 50, `plain "manga" finds many (${cards()}), fuzzy does not flood it`);
await type('zzqqxx'); ok(cards() === 0 && !!d.querySelector('#grid .empty'), 'nonsense query shows the empty message');
ok(!!d.querySelector('#grid .empty .sg-inline'), 'empty search offers "Suggest this site"');
await type('anime'); await wait(600); ok(w.location.search === '?q=anime', 'search is mirrored into the URL (?q=anime)');
await type(''); await wait(500); ok(w.location.search === '', 'URL is clean again after clearing');

d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));
const kp = d.querySelector('.kp'); ok(kp && !kp.hidden, 'Ctrl+K opens the palette');
const ki = d.getElementById('kpInput'); ki.value = 'manga'; ki.dispatchEvent(new w.Event('input'));
ok(d.querySelectorAll('#kpList li').length > 3, 'palette lists results');
ok(ki.getAttribute('aria-activedescendant'), 'palette announces the active option (a11y)');
ki.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
ki.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
ok(kp.hidden && Array.isArray(w.__opened) && w.__opened[1] === '_blank' && /noopener/.test(w.__opened[2]), 'Enter opens the site in a new tab with noopener');
ok(JSON.parse(w.localStorage.getItem('sakura-recents') || '[]').length === 1, 'visited site saved to Recently visited');
ok(!d.getElementById('recentsBar').hidden && d.querySelectorAll('#recentsBar .rc-chip').length === 1, 'Recently visited bar shows it');
d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));
d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); ki.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
ok(kp.hidden, 'Escape closes the palette');

await wait(2200); ok(!!d.getElementById('safetyTip'), 'safety tip appears');
d.querySelector('#safetyTip .tip-x').click(); ok(w.localStorage.getItem('sakura-tip-v1') === '1' && !d.getElementById('safetyTip'), 'tip can be dismissed and stays dismissed');

// report button -> modal -> worker
const btn = d.querySelector('#grid .preset-act[data-act="report"]'); ok(!!btn, 'cards have a report button');
btn.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
const rp = d.querySelector('.rp'); ok(rp && !rp.hidden, 'report button opens the report dialog');
ok(!!rp.querySelector('#rpReason') && !!rp.querySelector('.rp-hp'), 'dialog has reason picker and spam trap');
ok(!!d.getElementById('sgBtn'), 'Suggest a site button is on the page');
const errs = errors.slice(); ok(errs.length === 0, 'no script errors on the page' + (errs.length ? ': ' + errs[0] : ''));
dom.window.close();

// report goes to the worker; on failure it falls back to the Discord ticket (child processes keep memory low)
function reportRun(status) {
  const p = spawnSync(process.execPath, [fileURLToPath(import.meta.url), 'report', String(status)], { encoding: 'utf8' });
  try { return JSON.parse(p.stdout.trim().split('\n').pop()); } catch (e) { return { sent: [], closed: false, opened: null, msg: 'child failed: ' + (p.stderr || '').slice(-200) }; }
}
let r = reportRun(200);
ok(r.sent.length === 1 && r.sent[0].reason === 'scam' && r.sent[0].note === 'looks fake' && r.sent[0].url, 'report is sent to /report with reason, note and url');
ok(r.closed && !r.opened, 'success closes the dialog, no Discord ticket opened');
r = reportRun(503);
ok(r.closed && r.opened, 'worker unavailable -> falls back to the Discord ticket');
r = reportRun(429);
ok(!r.closed && /Too many/.test(r.msg), 'rate-limited -> polite message, dialog stays open');


// suggest a site
function suggestRun(status, exists, bad) {
  const p = spawnSync(process.execPath, [fileURLToPath(import.meta.url), 'suggest', String(status), exists ? 'exists' : 'new', bad ? 'bad' : 'good'], { encoding: 'utf8' });
  try { return JSON.parse(p.stdout.trim().split('\n').pop()); } catch (e) { return { sent: [], closed: false, opened: null, msg: 'child failed: ' + (p.stderr || '').slice(-200) }; }
}
r = suggestRun(200, false, false);
ok(r.sent.length === 1 && r.sent[0].url === 'brandnewsite.org' && r.sent[0].name === 'Brand New' && r.closed && !r.opened, 'suggestion is sent to /suggest and the dialog closes');
r = suggestRun(200, true, false); ok(r.closed && r.sent.length === 1, 'already-listed answer closes the dialog');
r = suggestRun(200, false, true); ok(!r.closed && r.sent.length === 0 && /website address/.test(r.msg), 'a non-address is stopped before anything is sent');
r = suggestRun(400, false, false); ok(!r.closed && /public website/.test(r.msg), 'server says invalid -> clear message, dialog stays open');
r = suggestRun(429, false, false); ok(!r.closed && /Too many/.test(r.msg), 'rate limited -> polite message');
r = suggestRun(503, false, false); ok(r.closed && r.opened, 'worker unavailable -> falls back to the Discord ticket');

// deep links in child processes
for (const [q, check, label] of [
  ['?cat=manga&q=fire', (o) => /Manga/.test(o.trigger) && o.search === 'fire', 'deep link ?cat=manga&q=fire'],
  ['?cat=hentai', (o) => /All categories/.test(o.trigger), 'adult category deep link ignored while locked'],
  ['?cat=nope', (o) => /All categories/.test(o.trigger) && o.cards > 1000, 'unknown category ignored'],
  ['?q=%3Cscript%3Ealert(1)%3C%2Fscript%3E', (o) => o.cards === 0 && o.errors.length === 0, 'script in ?q= is harmless']
]) {
  const p = spawnSync(process.execPath, [fileURLToPath(import.meta.url), 'deep', 'https://example.test/directory' + q], { encoding: 'utf8' });
  let o = {}; try { o = JSON.parse(p.stdout.trim().split('\n').pop()); } catch (e) {}
  ok(check(o), label);
}
console.log(failed ? `\n${failed} FAILED` : '\nall passed'); process.exit(failed ? 1 : 0);
