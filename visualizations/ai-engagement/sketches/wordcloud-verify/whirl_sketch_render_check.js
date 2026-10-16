"use strict";
/* End-to-end check of the SKETCH's own output: runs policy-ideas-whirl-v1.html's
 * inline script under Node (real canvas, real Noto Sans), lets its
 * reduced-motion path render the three beats at their finished state, records
 * every fillText() call the sketch actually makes, then rasterizes each drawn
 * line individually and checks for any two lines sharing an ink pixel.
 * No assumptions about RNG order or layout internals: whatever the sketch
 * draws is what gets checked.
 *
 * Usage: node whirl_sketch_render_check.js [--png]
 * Deps live in this folder: ./node_modules/canvas (npm i) and ./fonts/NotoSans-*.ttf.
 * --png writes /tmp/whirl-sketch-beat{1,2,3}.png (transparent background).
 */
const fs = require('fs');
const DESIGN = __dirname.replace(/\/wordcloud-verify$/, '');
// --file=<sketch.html> (default policy-ideas-whirl-v1.html); --static=<id> names the
// element the sketch appends its reduced-motion static canvases to (default: the
// whirl's three .narrative-wrapper sections)
const ARG = Object.fromEntries(process.argv.slice(2).map(a => { const m = /^--([^=]+)(?:=(.*))?$/.exec(a); return m ? [m[1], m[2] === undefined ? true : m[2]] : [a, true]; }));
const FILE = ARG.file || 'policy-ideas-whirl-v1.html', STATIC_ID = ARG.static || null;
const { Canvas, CanvasRenderingContext2D, registerFont } = require('canvas');
registerFont(__dirname + '/fonts/NotoSans-Regular.ttf', { family: 'Noto Sans', weight: '400' });
registerFont(__dirname + '/fonts/NotoSans-Bold.ttf', { family: 'Noto Sans', weight: '700' });

// ---- minimal DOM so the sketch's reduced-motion path runs ------------------
const style = () => new Proxy({}, { get(){ return ''; }, set(){ return true; } });
const classList = () => ({ add(){}, remove(){}, toggle(){}, contains(){ return false; } });
function el(tag){ const e = { tagName: tag, style: style(), classList: classList(), children: [], appendChild(c){ e.children.push(c); return c; },
  addEventListener(){}, querySelectorAll(){ return []; }, querySelector(){ return null; }, getBoundingClientRect(){ return { left:0, top:0, width:1800, height:1000 }; },
  _attrs: {}, setAttribute(k, v){ this._attrs[k] = String(v); }, getAttribute(k){ return this._attrs[k] ?? null; }, textContent: '', clientWidth: 1400,
  set innerHTML(v){}, get innerHTML(){ return ''; } }; return e; }
function realCanvas(w, h){ const c = new Canvas(w || 300, h || 150); c.style = style(); c.classList = classList(); c.addEventListener = () => {}; c.setAttribute = () => {}; return c; }
const wrappers = STATIC_ID ? [el('div')] : [el('section'), el('section'), el('section')];
const copies = [el('div'), el('div'), el('div')];
const mainCanvas = realCanvas(1800, 1000); mainCanvas.parentElement = { clientWidth: 1400 };
const registry = { 'narrative-canvas': mainCanvas, 'ideas-canvas': mainCanvas, legend: el('div'), caption: el('div'), tooltip: el('div') };
if (STATIC_ID) registry[STATIC_ID] = wrappers[0];
const els = {};
global.document = {
  getElementById(id){ return registry[id] || (els[id] = els[id] || el('div')); },
  querySelectorAll(sel){ return sel === '.narrative-wrapper' ? wrappers : sel === '.narrative-copy' ? copies : []; },
  querySelector(){ return null; }, createElement(tag){ return tag === 'canvas' ? realCanvas(1, 1) : el(tag); },
  addEventListener(){}, body: { style: {} }, fonts: { ready: Promise.resolve(), load: () => Promise.resolve([]) },
};
global.window = global; global.addEventListener = () => {}; global.innerWidth = 1800; global.innerHeight = 1000;
global.matchMedia = () => ({ matches: true }); global.requestAnimationFrame = fn => setTimeout(fn, 16);
if (ARG.opts){ global.__WHIRL_OPTS = Object.fromEntries(String(ARG.opts).split(',').map(kv => kv.split('='))); console.log('opts', global.__WHIRL_OPTS); }
require(`${DESIGN}/whirl-data.js`);
global.d3 = { layout: { cloud: require(`${DESIGN}/d3-cloud-multiline.js`) } };
require(`${DESIGN}/whirl-layout.js`); // sets window.WhirlLayout
try { require(`${DESIGN}/whirl-finale-layout.js`); console.log('loaded whirl-finale-layout.js (kept layouts):', Object.keys(window.WHIRL_FINALE_LAYOUTS).join(', ')); } catch (e) { /* none kept yet */ }

// ---- record every fillText the sketch performs, per target canvas ---------
const calls = new Map(); // canvas -> [{text,x,y,font}]
const origFill = CanvasRenderingContext2D.prototype.fillText;
CanvasRenderingContext2D.prototype.fillText = function(text, x, y){
  // Only the per-beat canvases bootReduced() appends to the three sections.
  // d3-cloud's own sprite-sheet canvases also call fillText, under a
  // translate(), so their raw arguments are meaningless here.
  if (wrappers.some(w => w.children.includes(this.canvas))){
    if (!calls.has(this.canvas)) calls.set(this.canvas, []);
    calls.get(this.canvas).push({ text, x, y, font: this.font, align: this.textAlign, base: this.textBaseline });
  }
  return origFill.apply(this, arguments);
};

const html = fs.readFileSync(`${DESIGN}/${FILE}`, 'utf8');
// the sketch's main IIFE is the LAST inline <script>; earlier inline scripts
// are the cache-busting data loaders (document.write), which must not run here
// (matched as a whole line, since the whirl's own comments mention "<script>")
const opens = [...html.matchAll(/^<script>\s*$/gm)];
const lastOpen = opens[opens.length - 1].index;
const inline = html.slice(lastOpen + '<script>'.length, html.indexOf('</script>', lastOpen));
fs.writeFileSync('/tmp/whirl_sketch_inline.js', inline);
require('/tmp/whirl_sketch_inline.js');

setTimeout(() => {
  const groups = [...calls.entries()];
  console.log(`recorded fillText on ${groups.length} beat canvases`);
  const meas = new Canvas(10, 10).getContext('2d');
  function rasterize(c){
    meas.font = c.font; const m = meas.measureText(c.text);
    const x0 = Math.floor(c.x - m.actualBoundingBoxLeft - 3), y0 = Math.floor(c.y - m.actualBoundingBoxAscent - 3);
    const bw = Math.ceil(m.actualBoundingBoxLeft + m.actualBoundingBoxRight + 7), bh = Math.ceil(m.actualBoundingBoxAscent + m.actualBoundingBoxDescent + 7);
    const cv = new Canvas(bw, bh), ctx = cv.getContext('2d'); ctx.font = c.font; ctx.textAlign = c.align; ctx.textBaseline = c.base; ctx.fillStyle = '#000';
    ctx.fillText(c.text, c.x - x0, c.y - y0);
    const d = ctx.getImageData(0, 0, bw, bh).data, a = new Uint8Array(bw * bh);
    let mx0 = bw, my0 = bh, mx1 = -1, my1 = -1;
    for (let p = 0; p < bw * bh; p++){ a[p] = d[p * 4 + 3]; if (a[p]){ const x = p % bw, y = (p / bw) | 0; if (x < mx0) mx0 = x; if (x > mx1) mx1 = x; if (y < my0) my0 = y; if (y > my1) my1 = y; } }
    return { c, x0, y0, bw, a, ink: { x0: x0 + mx0, x1: x0 + mx1, y0: y0 + my0, y1: y0 + my1 } };
  }
  groups.forEach(([canvas, list], gi) => {
    const items = list.map(rasterize); let pairs = 0, strong = 0; const ex = [];
    for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++){
      const A = items[i], B = items[j];
      const ix0 = Math.max(A.ink.x0, B.ink.x0), ix1 = Math.min(A.ink.x1, B.ink.x1), iy0 = Math.max(A.ink.y0, B.ink.y0), iy1 = Math.min(A.ink.y1, B.ink.y1);
      if (ix0 > ix1 || iy0 > iy1) continue;
      let any = 0, st = 0;
      for (let y = iy0; y <= iy1; y++) for (let x = ix0; x <= ix1; x++){ const aa = A.a[(y - A.y0) * A.bw + (x - A.x0)], ab = B.a[(y - B.y0) * B.bw + (x - B.x0)]; if (aa && ab){ any++; if (aa >= 128 && ab >= 128) st++; } }
      if (any){ pairs++; if (st) strong++; if (ex.length < 5) ex.push(`${any}px(${st} strong) "${A.c.text.slice(0, 30)}" x "${B.c.text.slice(0, 30)}"`); }
    }
    const name = STATIC_ID ? `static canvas ${gi + 1}` : gi === 0 ? 'beat 1 (337 cloud, arrived)' : gi === 1 ? 'beat 2 (dissolve end + finale fading up)' : 'beat 3 (finale, static)';
    console.log(`== ${name}: ${list.length} drawn lines, overlapping line pairs: ${pairs} (any coverage), ${strong} with both alphas >=128`);
    ex.forEach(e => console.log('     ' + e));
    if (process.argv.includes('--png')) fs.writeFileSync(`/tmp/${FILE.replace(/\.html$/, '')}${ARG.opts ? '-' + String(ARG.opts).replace(/[^a-z0-9]+/gi, '_') : ''}-canvas${gi + 1}.png`, canvas.toBuffer('image/png'));
  });
  process.exit(0);
}, +(ARG.wait || 3000));
