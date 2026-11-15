// Runs axe-core (automatic accessibility checks) on every page in a simulated browser.
// Colour contrast cannot be checked without a real browser, so that rule is off here
// (the Lighthouse workflow covers it on the live site).
// Needs:  npm install --no-save jsdom@24 axe-core@4.10
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { JSDOM, VirtualConsole } = require('jsdom');
const axeSource = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const root = fileURLToPath(new URL('..', import.meta.url));
const info = JSON.parse(fs.readFileSync(root + 'need for the website to work/info.json', 'utf8'));
const small = info.filter((_, i) => i % 40 === 0).slice(0, 120);      // enough cards to test the markup, small enough for jsdom
const fuseSrc = fs.readFileSync(root + 'assets/vendor/fuse.min.js', 'utf8');

const pages = ['index.html', 'about.html', 'faq.html', 'donate.html', 'disclaimer.html', 'products.html', '404.html', 'offline.html', 'sections/index.html', 'sections/anime.html', 'directory.html'];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;

async function scan(page, afterLoad) {
  let html = fs.readFileSync(root + page, 'utf8');
  html = html.replace('<script src="assets/vendor/fuse.min.js"></script>', '<script>' + fuseSrc.replace(/<\/script/g, '<\\/script') + '</script>');
  const vc = new VirtualConsole();
  const dom = new JSDOM(html, {
    url: 'https://example.test/' + page, runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      w.HTMLCanvasElement.prototype.getContext = function () { return new Proxy({ createImageData: (a, b) => ({ data: new Uint8ClampedArray(Math.max(1, a * b * 4)) }) }, { get: (t, k) => (k in t ? t[k] : () => {}) }); };
      w.requestAnimationFrame = () => 0; w.scrollTo = () => {}; w.Element.prototype.scrollIntoView = function () {};
      w.matchMedia = w.matchMedia || (() => ({ matches: false, addEventListener() {}, addListener() {} }));
      w.fetch = (u) => String(u).includes('info.json') ? Promise.resolve({ ok: true, json: () => Promise.resolve(small) }) : Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve({}) });
    }
  });
  await wait(page === 'directory.html' ? 1200 : 400);
  if (afterLoad) await afterLoad(dom.window);
  dom.window.eval(axeSource);
  const res = await dom.window.axe.run(dom.window.document, { rules: { 'color-contrast': { enabled: false } }, resultTypes: ['violations'] });
  dom.window.close();
  return res.violations;
}

const BAD = new Set(['serious', 'critical', 'moderate']);

// self-check: the scanner must really catch problems, or a clean result means nothing
{
  const dom = new JSDOM('<!doctype html><html><body><img src="a.png"><button></button><input type="text"></body></html>', { runScripts: 'dangerously' });
  dom.window.eval(axeSource);
  const res = await dom.window.axe.run(dom.window.document, { rules: { 'color-contrast': { enabled: false } } });
  const ids = res.violations.map((v) => v.id);
  const caught = ['image-alt', 'button-name', 'label'].every((id) => ids.includes(id));
  console.log((caught ? '  ✓ ' : '  ✗ ') + 'scanner self-check: finds a missing alt, button name and label (' + ids.join(', ') + ')');
  if (!caught) { console.log('The accessibility scanner is not working.'); process.exit(1); }
  dom.window.close();
}
const runs = pages.map((p) => [p, null]);
runs.push(['directory.html', async (w) => { w.document.querySelector('#grid .preset-act[data-act="report"]').click(); }, 'directory.html (report dialog open)']);
runs.push(['directory.html', async (w) => { w.document.getElementById('sgBtn').click(); }, 'directory.html (suggest dialog open)']);
runs.push(['directory.html', async (w) => { w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true })); }, 'directory.html (Ctrl+K palette open)']);
for (const [page, after, label] of runs) {
  const v = (await scan(page, after)).filter((x) => BAD.has(x.impact));
  console.log((v.length ? '  ✗ ' : '  ✓ ') + (label || page) + (v.length ? ': ' + v.map((x) => `${x.id} (${x.impact}, ${x.nodes.length}x)`).join('; ') : ''));
  if (process.env.VERBOSE) v.forEach((x) => console.log('      ', x.id, x.help, x.nodes.slice(0, 2).map((n) => n.html.slice(0, 110)).join(' | ')));
  if (v.length) failed++;
}
console.log(failed ? `\n${failed} page(s) with accessibility problems` : '\nno serious accessibility problems found');
process.exit(failed ? 1 : 0);
