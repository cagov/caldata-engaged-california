"use strict";
/* Keep a finale-layout-picker run as whirl-finale-layout.js — including runs
 * the picker refuses to keep because a label was dropped — by re-running it in
 * headless Chrome (finale-keep-runner.html: same engine, same seed, Chrome's
 * own rasterizer, which is what the picker showed on screen; Node's canvas
 * rasterizes glyph masks slightly differently and picks another candidate).
 *
 * The runner shrinks the text at the run's positions, box-places any dropped
 * label into a gap, and scales the result to the whirl field. This script then
 * pixel-verifies both fields with node-canvas (an independent rasterizer, so a
 * conservative second opinion), renders previews, and writes the file.
 *
 * Usage (from sketches/wordcloud-verify):
 *   node keep_finale_from_chrome.js --seed=33 --mult=0.38 --text=0.9 [--pack=dense]
 *        [--area=<fraction>] [--png] [--dry] [--out=../whirl-finale-layout.js]
 *        [--chrome="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const DESIGN = path.resolve(__dirname, '..');
const ARG = Object.fromEntries(process.argv.slice(2).map(a => { const m = /^--([^=]+)(?:=(.*))?$/.exec(a); return m ? [m[1], m[2] === undefined ? true : m[2]] : [a, true]; }));
const SEED = +(ARG.seed || 33), MULT = +(ARG.mult || 0.38), TEXT = +(ARG.text || 0.9), PACK = ARG.pack || 'dense';
const CHROME = ARG.chrome || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = ARG.out ? path.resolve(ARG.out) : path.join(DESIGN, 'whirl-finale-layout.js');

// ---- 1. run the layout in Chrome ----------------------------------------------
const q = new URLSearchParams({ seed: SEED, mult: MULT, text: TEXT, pack: PACK });
if (ARG.area) q.set('area', ARG.area);
const url = `file://${path.join(__dirname, 'finale-keep-runner.html')}?${q}`;
console.log('running in headless Chrome:', url);
const dom = execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--virtual-time-budget=90000', '--timeout=120000', '--dump-dom', url],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 });
const m = /<pre id="out">([\s\S]*?)<\/pre>/.exec(dom);
if (!m || !m[1].trim()) { console.error('runner produced no output (fonts or CDN unreachable? run with a network connection)'); process.exit(1); }
const unescape = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const res = JSON.parse(unescape(m[1]));
for (const line of res.log) console.log('  ' + line);
if (!res.ok){ console.error(res.error); process.exit(1); }
const layouts = res.layouts;

// ---- 2. pixel-verify with node-canvas ------------------------------------------
const { Canvas, registerFont } = require('canvas');
registerFont(path.join(__dirname, 'fonts/NotoSans-Regular.ttf'), { family: 'Noto Sans', weight: '400' });
registerFont(path.join(__dirname, 'fonts/NotoSans-Bold.ttf'), { family: 'Noto Sans', weight: '700' });
global.window = global;
require(`${DESIGN}/whirl-data.js`);
require(`${DESIGN}/whirl-layout.js`);
const SUBTHEMES = window.WHIRL_DATA.subthemes;
const WL = window.WhirlLayout({ rand: Math.random, cloud: () => null, measureCtx: new Canvas(10, 10).getContext('2d') });

function rasterMask(w, W, H){
  const c = new Canvas(W, H), ctx = c.getContext('2d');
  WL.drawWord(ctx, w.lines, w.x + W / 2, w.y + H / 2, w.fontSize, 700, '#000', 1);
  const d = ctx.getImageData(0, 0, W, H).data;
  const bits = new Uint8Array(W * H);
  let n = 0, x0 = W, x1 = 0, y0 = H, y1 = 0;
  for (let i = 0; i < W * H; i++) if (d[i * 4 + 3] > 0){ bits[i] = 1; n++; const x = i % W, y = (i / W) | 0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return { bits, n, x0, x1, y0, y1 };
}
function verify(list, W, H, name){
  const masks = list.map(w => rasterMask(w, W, H));
  let bad = 0, clipped = 0;
  for (const mk of masks) if (mk.n === 0 || mk.x0 <= 0 || mk.y0 <= 0 || mk.x1 >= W - 1 || mk.y1 >= H - 1) clipped++;
  for (let i = 0; i < masks.length; i++) for (let j = i + 1; j < masks.length; j++){
    const a = masks[i], b = masks[j];
    if (a.x1 < b.x0 || b.x1 < a.x0 || a.y1 < b.y0 || b.y1 < a.y0) continue;
    let shared = 0;
    for (let y = Math.max(a.y0, b.y0); y <= Math.min(a.y1, b.y1); y++) for (let x = Math.max(a.x0, b.x0); x <= Math.min(a.x1, b.x1); x++) if (a.bits[y * W + x] && b.bits[y * W + x]) shared++;
    if (shared){ bad++; console.error(`  ${name}: "${list[i].label.slice(0, 32)}" / "${list[j].label.slice(0, 32)}" share ${shared} ink px`); }
  }
  console.log(`${name}: ${list.length} labels, ${bad} overlapping pair(s), ${clipped} touching the field edge`);
  return bad === 0 && clipped === 0;
}
let allOk = true;
for (const [key, L] of Object.entries(layouts)){
  const ok = verify(L.items, L.field.w, L.field.h, `${L.presetKey} ${key} x${L.fontMultiplier}`);
  allOk = allOk && ok;
  if (ARG.png){
    const c = new Canvas(L.field.w, L.field.h), ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, L.field.w, L.field.h);
    for (const w of L.items) WL.drawWord(ctx, w.lines, w.x + L.field.w / 2, w.y + L.field.h / 2, w.fontSize, 700, SUBTHEMES[w.subtheme].color, 1);
    const file = `/tmp/finale-${L.presetKey}.png`; fs.writeFileSync(file, c.toBuffer('image/png')); console.log('wrote', file);
  }
}
if (!allOk){ console.error('verification failed — not writing'); process.exit(1); }
if (ARG.dry){ console.log('dry run — not writing'); process.exit(0); }

// ---- 3. write (same shape the picker downloads) ---------------------------------
const js = `// Generated by sketches/wordcloud-verify/keep_finale_from_chrome.js on ${new Date().toISOString()} — do not hand-edit.\n`
  + `//   node keep_finale_from_chrome.js --seed=${SEED} --mult=${MULT} --text=${TEXT} --pack=${PACK}${ARG.area ? ` --area=${ARG.area}` : ''}\n`
  + `// One kept Phase 2 layout per field; the sketches use it when field, labels, line breaks and font sizes match.\n`
  + `// The whirl entry is the inline entry scaled uniformly, so both sketches show the same arrangement.\n`
  + `window.WHIRL_FINALE_LAYOUTS = ${JSON.stringify(layouts, null, 1)};\n`;
fs.writeFileSync(OUT, js);
console.log('wrote', OUT);
