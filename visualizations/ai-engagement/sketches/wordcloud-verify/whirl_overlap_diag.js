"use strict";
/* Pixel-level overlap diagnostic for sketches/policy-ideas-whirl-v1.html.
 *
 * Reproduces the sketch's exact word building + d3-cloud layout in Node with
 * the REAL Noto Sans files registered, then rasterizes every placed label
 * individually with a byte-for-byte copy of the sketch's drawWord(), and
 * counts pixel pairs whose ink intersects. For each overlapping pair it also
 * asks: do the overlapping pixels lie OUTSIDE the sprite box that
 * cloudSprite() reserved for one of the two words (i.e. ink the collision
 * mask never saw)?
 *
 * Usage: node /tmp/whirl_overlap_diag.js [--fixed] [--finaleW=N] [--finaleH=N]
 *          [--finaleScale=F] [--cloudW=N] [--cloudH=N] [--cloudScale=F] [--png=prefix]
 */
const fs = require('fs');
const { Canvas, registerFont } = require('canvas');
registerFont(__dirname + '/fonts/NotoSans-Regular.ttf', { family: 'Noto Sans', weight: '400' });
registerFont(__dirname + '/fonts/NotoSans-Bold.ttf', { family: 'Noto Sans', weight: '700' });
registerFont(__dirname + '/fonts/NotoSans-Bold.ttf', { family: 'Noto Sans', weight: 'bold' });

const DESIGN = require('path').join(__dirname, '..'); // the sketches/ folder
const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a); return m ? [m[1], m[2] === undefined ? true : m[2]] : [a, true];
}));
const ASIS = !!args.asis;            // verify sketches/d3-cloud-multiline.js exactly as shipped (no source patches)
const FIXED = !!args.fixed || ASIS;

// ---- d3-cloud fork, optionally with the sprite-height fix applied -------
let cloudSrc = fs.readFileSync(`${DESIGN}/d3-cloud-multiline.js`, 'utf8');
if (FIXED && !ASIS) {
  const before = 'let h = Math.max(d.size << 1, Math.ceil(lines.length * lineHeightInternal * ratio));';
  if (!cloudSrc.includes(before)) throw new Error('sprite-height line not found; fork changed?');
  // Every line keeps the single-line envelope (1em above + 1em below its own
  // baseline); each extra line adds exactly one line-height.
  cloudSrc = cloudSrc.replace(before,
    'let h = Math.max(d.size << 1, Math.ceil(((lines.length - 1) * lineHeightInternal + (d.size << 1)) * ratio));');
}
// Seed patch (experiment for the "not the spiral look" question): let the
// caller pre-set each word's search START point instead of d3-cloud's own
// random point inside the central 50% box. The spiral search itself and the
// pixel-mask collision test are untouched.
if (!ASIS) {
  const before = 'd.x = (size[0] * (random() + .5)) >> 1;\n        d.y = (size[1] * (random() + .5)) >> 1;';
  if (!cloudSrc.includes(before)) throw new Error('start-point lines not found');
  cloudSrc = cloudSrc.replace(before,
    'if (d.seedX != null) { d.x = d.seedX | 0; d.y = d.seedY | 0; } else { d.x = (size[0] * (random() + .5)) >> 1; d.y = (size[1] * (random() + .5)) >> 1; }');
}
{ // snapshot the mask actually used at placement, in board coordinates
  const before = '            x += sw;\n          }\n          return true;';
  if (!cloudSrc.includes(before)) throw new Error('place() return not found');
  cloudSrc = cloudSrc.replace(before, '            x += sw;\n          }\n          tag.__mask = { sprite: tag.sprite.slice(), w32: tag.width >> 5, y0: tag.y0, y1: tag.y1, bx: tag.x, by: tag.y };\n          return true;');
}
const EXACT = !!args.exactSprite || ASIS;   // ASIS: shipped fork already draws at the exact size; render must use the floor anchor
if (EXACT && !ASIS){ // mask rasterized at the EXACT drawn size: same px, same float line height, same integer anchor
  cloudSrc = cloudSrc.replace('d.size = ~~fontSize.call(this, d, i);', 'd.size = +fontSize.call(this, d, i);');
  cloudSrc = cloudSrc.replace('~~((d.size + 1) / ratio) + "px "', '(d.size / ratio) + "px "');
  cloudSrc = cloudSrc.split('d.size << 1').join('Math.ceil(2 * d.size)');
  // sprite width: advance width + 1 is too tight once the padding stroke and glyph
  // overhang are counted; give every sprite explicit horizontal slack
  const wBefore = 'let w = (maxLineWidth + 1) * ratio;';
  if (!cloudSrc.includes(wBefore)) throw new Error('sprite width line not found');
  cloudSrc = cloudSrc.replace(wBefore, 'let w = (maxLineWidth + 1 + 2 * (d.padding || 0) + 4) * ratio;');
}
if (args.floatSprite){ // rasterize the mask at the exact fractional size instead of ~~size
  cloudSrc = cloudSrc.replace('d.size = ~~fontSize.call(this, d, i);', 'd.size = +fontSize.call(this, d, i);');
  cloudSrc = cloudSrc.replace('~~((d.size + 1) / ratio) + "px "', '((d.size + 1) / ratio) + "px "');
  cloudSrc = cloudSrc.split('d.size << 1').join('Math.ceil(2 * d.size)');
}
{ // spiral-loop guard: surface infinite/near-infinite searches instead of hanging
  const before = 'while (dxdy = s(t += dt)) {';
  if (!cloudSrc.includes(before)) throw new Error('spiral loop not found');
  cloudSrc = cloudSrc.replace(before, 'var __guard = 0; while (dxdy = s(t += dt)) { if (++__guard > 5e6) throw new Error("spiral guard: " + tag.text + " t=" + t + " start=" + startX + "," + startY + " size=" + size + " sprite " + tag.width + "x" + (tag.y1 - tag.y0) + " maxDelta=" + maxDelta + " dx,dy=" + dxdy);');
}
const LIB = `/tmp/d3-cloud-multiline-${FIXED ? 'FIXED' : 'CURRENT'}-${process.pid}.js`;
fs.writeFileSync(LIB, cloudSrc);
const cloudFactory = require(LIB);
process.on('exit', () => { try { fs.unlinkSync(LIB); } catch (e) {} });
if (Number.isNaN(+(args.cloudW||0)+ +(args.cloudH||0)+ +(args.finaleW||0)+ +(args.finaleH||0))) throw new Error('non-numeric size arg');
const SEED = args.seed || 'none';   // none | halton | interleave

// ---- data ----------------------------------------------------------------
global.window = global;
require(`${DESIGN}/whirl-data.js`);
const DATA = global.WHIRL_DATA;

// ---- exact copies of the sketch's helpers --------------------------------
function mulberry32(a){ return function(){ a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const rand = mulberry32(20260826);
const W = 2400, H = 1300, FIELD = { top: 90, bottom: 70, side: 30 };
const fieldW = W - FIELD.side*2, fieldH = H - FIELD.top - FIELD.bottom;   // 2340 x 1140

const meas = new Canvas(10, 10).getContext('2d');
const measCache = new Map();
function fontStr(px, weight){ return `${weight||400} ${px}px 'Noto Sans', Arial, sans-serif`; }
function textWidth(text, px, weight){ const k = text+'|'+px+'|'+weight; let w = measCache.get(k); if (w === undefined){ meas.font = fontStr(px, weight); w = meas.measureText(text).width; measCache.set(k, w);} return w; }
function wrapTwoLines(text, px, weight, maxW){
  if (textWidth(text, px, weight) <= maxW) return [text];
  const words = text.split(' '); if (words.length === 1) return [text];
  let best = [text], bestMax = Infinity;
  for (let i = 1; i < words.length; i++){ const l1 = words.slice(0,i).join(' '), l2 = words.slice(i).join(' ');
    const w = Math.max(textWidth(l1,px,weight), textWidth(l2,px,weight)); if (w < bestMax){ bestMax = w; best = [l1,l2]; } }
  return best;
}
const MAX_COUNT = Math.max(...DATA.phase1.map(c => c.count));
const MAX_VOTES = Math.max(...DATA.phase2.map(c => c.votes));
const cloudScale = +(args.cloudScale || 1), finaleScale = +(args.finaleScale || 1);
const INT = !!args.intSizes;   // round font sizes to whole px so d3-cloud's ~~size matches what we draw
const rnd = v => INT ? Math.round(v) : v;
function phase1FontSize(n){ return rnd((11 + 26 * Math.pow(n/MAX_COUNT, 0.6)) * cloudScale); }
function phase2FontSize(v){ return rnd((17 + 29 * Math.sqrt(v/MAX_VOTES)) * finaleScale); }

let phase1 = DATA.phase1.slice();
if (args.synthN){ const n = +args.synthN; const out = []; for (let k = 0; k < n; k++) out.push({ ...phase1[k % phase1.length] }); phase1 = out; }
if (args.skew){ phase1 = phase1.map(c => ({ ...c })); const top = phase1.reduce((a, b) => a.count > b.count ? a : b); top.count = Math.round(top.count * +args.skew); }
const MAX_COUNT_S = Math.max(...phase1.map(c => c.count));
const words337 = phase1.map((c, i) => { const fontSize = rnd((11 + 26 * Math.pow(c.count/MAX_COUNT_S, 0.6)) * cloudScale);
  const lines = wrapTwoLines(c.label, fontSize, 400, fontSize*9.5);
  return { i, label: c.label, subtheme: c.subtheme, fontSize, lines, weight: 400, arrivalRand: rand() }; });
const words27 = DATA.phase2.map((c, i) => { const fontSize = phase2FontSize(c.votes);
  const lines = wrapTwoLines(c.label, fontSize, 700, fontSize*11);
  return { i, label: c.label, subtheme: c.subtheme, fontSize, lines, weight: 700 }; });
// consume the RNG exactly as the sketch does before layout (cloudHome, finaleDelay)
words337.forEach(() => { rand(); rand(); });
words27.forEach(() => rand());

// ---- seed policies ----------------------------------------------------------
function halton(i, base){ let f = 1, r = 0; while (i > 0){ f /= base; r += f * (i % base); i = Math.floor(i / base); } return r; }
/** Spread start points over the whole field with a low-discrepancy sequence,
 * assigned in size-descending order (d3-cloud's own placement order), so the
 * biggest words land far apart instead of all starting near the center. */
function seedHalton(items, width, height, inset){
  const order = items.slice().sort((a, b) => b.fontSize - a.fontSize);
  order.forEach((w, k) => { w.seedX = inset + halton(k + 1, 2) * (width - 2*inset); w.seedY = inset + halton(k + 1, 3) * (height - 2*inset); });
}
/** Same points, but choose the word->point assignment that maximizes the
 * minimum distance between any two same-subtheme words (cheap random search;
 * 27 items). Bigger words still get points first so the spread of size holds. */
function seedInterleave(items, width, height, inset, tries){
  const pts = items.map((_, k) => [inset + halton(k + 1, 2) * (width - 2*inset), inset + halton(k + 1, 3) * (height - 2*inset)]);
  let best = null, bestScore = -1;
  for (let t = 0; t < tries; t++){
    const perm = items.map((_, i) => i); for (let i = perm.length - 1; i > 0; i--){ const j = Math.floor(rand() * (i + 1)); [perm[i], perm[j]] = [perm[j], perm[i]]; }
    let minSame = Infinity;
    for (let a = 0; a < items.length; a++) for (let b = a + 1; b < items.length; b++){
      if (items[a].subtheme !== items[b].subtheme) continue;
      const pa = pts[perm[a]], pb = pts[perm[b]]; minSame = Math.min(minSame, Math.hypot(pa[0]-pb[0], pa[1]-pb[1])); }
    if (minSame > bestScore){ bestScore = minSame; best = perm.slice(); }
  }
  items.forEach((w, i) => { w.seedX = pts[best[i]][0]; w.seedY = pts[best[i]][1]; });
}
const SPREAD = +(args.seedSpread || 0.84);   // fraction of the field the seed points span (centered)
function layout(items, { width, height, padding, weight }){
  const inset = (1 - SPREAD) / 2 * Math.min(width, height);
  if (SEED === 'halton') seedHalton(items, width, height, inset);
  else if (SEED === 'interleave') seedInterleave(items, width, height, inset, 3000);
  else if (SEED === 'center') items.forEach(w => { w.seedX = width / 2; w.seedY = height / 2; });
  return new Promise(resolve => {
    cloudFactory().size([width, height]).words(items).padding(padding).rotate(() => 0)
      .font("'Noto Sans', Arial, sans-serif").fontWeight(weight).fontSize(d => d.fontSize).text(d => d.label)
      .random(rand).canvas(() => new Canvas(1, 1))
      .on('end', placed => resolve(placed)).start();
  });
}

// ---- rasterize one word exactly like drawWord(), into a tight bitmap ------
function rasterize(w, cx, cy){
  const fs_ = w.fontSize, lh = fs_*1.22, startY = -(w.lines.length-1)*lh/2;
  meas.font = fontStr(fs_, w.weight);
  const maxLineWidth = Math.max(...w.lines.map(l => meas.measureText(l).width));
  const anchorX = EXACT ? cx - Math.floor(maxLineWidth/2) : cx - maxLineWidth/2;
  const pad = 6;
  const x0 = Math.floor(anchorX - pad), y0 = Math.floor(cy + startY - fs_*1.1 - pad);
  const bw = Math.ceil(maxLineWidth + 2*pad + fs_*0.5), bh = Math.ceil((w.lines.length-1)*lh + fs_*1.6 + 2*pad);
  const c = new Canvas(bw, bh), ctx = c.getContext('2d');
  ctx.font = fontStr(fs_, w.weight); ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left'; ctx.fillStyle = '#000';
  w.lines.forEach((line, i) => ctx.fillText(line, anchorX - x0, cy + startY + i*lh - y0));
  const data = ctx.getImageData(0, 0, bw, bh).data;
  const alpha = new Uint8Array(bw*bh);
  let minx = bw, miny = bh, maxx = -1, maxy = -1;
  for (let p = 0; p < bw*bh; p++){ const a = data[p*4+3]; alpha[p] = a; if (a){ const x = p % bw, y = (p / bw) | 0; if (x<minx)minx=x; if (x>maxx)maxx=x; if (y<miny)miny=y; if (y>maxy)maxy=y; } }
  if (maxx >= bw-1 || maxy >= bh-1 || minx === 0 || miny === 0) console.warn('bitmap too tight for', w.label);
  return { x0, y0, bw, bh, alpha, ink: { x0: x0+minx, x1: x0+maxx, y0: y0+miny, y1: y0+maxy } };
}
// sprite box cloudSprite() reserved (analytic, mirrors the fork's own formula)
function maskBox(w, cx, cy){
  const size = ~~w.fontSize, lh = size*1.22, n = w.lines.length;
  const h = FIXED ? Math.max(size<<1, Math.ceil((n-1)*lh + (size<<1))) : Math.max(size<<1, Math.ceil(n*lh));
  return { top: cy - (h>>1), bottom: cy + (h>>1) };
}

function checkOverlaps(items, placed, width, height, name){
  const set = new Set(placed);
  const rows = placed.map(w => { const cx = w.x + width/2, cy = w.y + height/2; return { w, cx, cy, bm: rasterize(w, cx, cy), mb: maskBox(w, cx, cy) }; });
  const pairs = [];
  for (let a = 0; a < rows.length; a++) for (let b = a+1; b < rows.length; b++){
    const A = rows[a], B = rows[b];
    const ix0 = Math.max(A.bm.ink.x0, B.bm.ink.x0), ix1 = Math.min(A.bm.ink.x1, B.bm.ink.x1);
    const iy0 = Math.max(A.bm.ink.y0, B.bm.ink.y0), iy1 = Math.min(A.bm.ink.y1, B.bm.ink.y1);
    if (ix0 > ix1 || iy0 > iy1) continue;
    let any = 0, strong = 0, outsideA = 0, outsideB = 0, outsideEither = 0;
    for (let y = iy0; y <= iy1; y++) for (let x = ix0; x <= ix1; x++){
      const aa = A.bm.alpha[(y-A.bm.y0)*A.bm.bw + (x-A.bm.x0)], ab = B.bm.alpha[(y-B.bm.y0)*B.bm.bw + (x-B.bm.x0)];
      if (aa && ab){ any++; if (aa >= 128 && ab >= 128) strong++;
        const oa = y < A.mb.top || y >= A.mb.bottom, ob = y < B.mb.top || y >= B.mb.bottom;
        if (oa) outsideA++; if (ob) outsideB++; if (oa || ob) outsideEither++; }
    }
    if (any) pairs.push({ a: A.w, b: B.w, any, strong, outsideEither, aLines: A.w.lines.length, bLines: B.w.lines.length,
      where: `A(${A.cx.toFixed(0)},${A.cy.toFixed(0)},${A.w.fontSize.toFixed(2)}px) B(${B.cx.toFixed(0)},${B.cy.toFixed(0)},${B.w.fontSize.toFixed(2)}px) region x${ix0}-${ix1} y${iy0}-${iy1}` });
  }
  // mask ⊇ ink invariant, per word
  let uncoveredWords = 0, uncoveredPx = 0, maxAlpha = 0; const examples = [];
  for (const r of rows){
    const m = r.w.__mask; if (!m){ console.log('   (no mask snapshot for', r.w.label, ')'); continue; }
    const inMask = (x, y) => { const j = y - (m.by + m.y0); if (j < 0 || j >= (m.y1 - m.y0)) return false; const i = x - (m.bx - (m.w32 << 4)); if (i < 0 || i >= (m.w32 << 5)) return false; return (m.sprite[j * m.w32 + (i >> 5)] >>> (31 - (i & 31))) & 1; };
    let cnt = 0, wmax = 0, ex = null;
    for (let y = r.bm.ink.y0; y <= r.bm.ink.y1; y++) for (let x = r.bm.ink.x0; x <= r.bm.ink.x1; x++){
      const a = r.bm.alpha[(y - r.bm.y0) * r.bm.bw + (x - r.bm.x0)]; if (!a) continue;
      if (!inMask(x, y)){ cnt++; if (a > wmax){ wmax = a; ex = { x, y }; } }
    }
    if (cnt){ uncoveredWords++; uncoveredPx += cnt; maxAlpha = Math.max(maxAlpha, wmax);
      if (examples.length < 6){ const top = m.by + m.y0, bot = m.by + m.y1; const side = ex.y < top ? `above mask top by ${top - ex.y}` : ex.y >= bot ? `below mask bottom by ${ex.y - bot + 1}` : (ex.x < m.bx - (m.w32<<4) ? 'left of mask' : ex.x >= m.bx + (m.w32<<4) ? 'right of mask' : 'inside mask box (glyph gap)'); examples.push(`${cnt}px max-alpha ${wmax} [${r.w.lines.length}L ${r.w.fontSize.toFixed(2)}px] "${r.w.label.slice(0, 28)}" ${side}`); } }
  }
  console.log(`   INVARIANT mask⊇ink: ${uncoveredWords}/${rows.length} words have ink outside their own mask; ${uncoveredPx} px total; max alpha of an escaped pixel ${maxAlpha}`);
  for (const e of examples) console.log('     ' + e);
  // fill metrics
  let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity, inkArea = 0;
  for (const r of rows){ bx0 = Math.min(bx0, r.bm.ink.x0); by0 = Math.min(by0, r.bm.ink.y0); bx1 = Math.max(bx1, r.bm.ink.x1); by1 = Math.max(by1, r.bm.ink.y1);
    inkArea += (r.bm.ink.x1-r.bm.ink.x0+1)*(r.bm.ink.y1-r.bm.ink.y0+1); }
  const dropped = items.length - placed.length;
  const explained = pairs.filter(p => p.outsideEither === p.any).length;
  const twoLine = pairs.filter(p => p.aLines === 2 || p.bLines === 2).length;
  console.log(`\n== ${name}  field ${width}x${height}  ${ASIS ? '[SHIPPED sketches/d3-cloud-multiline.js, as-is]' : FIXED ? '[FIXED sprite height]' : '[current fork]'}`);
  console.log(`   placed ${placed.length}/${items.length}  dropped ${dropped}`);
  console.log(`   overlapping pairs: ${pairs.length} (any coverage)  |  ${pairs.filter(p=>p.strong).length} with both alphas >=128`);
  console.log(`   pairs involving a 2-line label: ${twoLine}/${pairs.length}`);
  console.log(`   pairs where EVERY overlapping pixel is outside one word's reserved sprite box: ${explained}/${pairs.length}`);
  console.log(`   content bbox ${bx1-bx0+1}x${by1-by0+1} = ${((bx1-bx0+1)*(by1-by0+1)/(width*height)*100).toFixed(0)}% of field;  ink-box area / field = ${(inkArea/(width*height)*100).toFixed(0)}%`);
  // "spiral look" metric: Spearman rank correlation between font size and
  // distance from the field center. Strongly negative = big words in the
  // middle, small words pushed out (the classic radiating cloud).
  const rank = arr => { const idx = arr.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]); const r = new Array(arr.length); idx.forEach(([, i], k) => r[i] = k); return r; };
  const sizes = rows.map(r => r.w.fontSize), dists = rows.map(r => Math.hypot((r.cx - width/2) / width, (r.cy - height/2) / height));
  const rs = rank(sizes), rd = rank(dists), n = rows.length, mean = (n - 1) / 2;
  let num = 0, da = 0, db = 0; for (let i = 0; i < n; i++){ num += (rs[i]-mean)*(rd[i]-mean); da += (rs[i]-mean)**2; db += (rd[i]-mean)**2; }
  console.log(`   size-vs-center-distance rank correlation: ${(num / Math.sqrt(da*db)).toFixed(2)}  (-1 = radiating/spiral look, 0 = sizes evenly mixed)`);
  // "don't put similar ideas together": same-subtheme vs cross-subtheme nearest neighbour
  const nearest = (i, same) => { let best = Infinity; for (let j = 0; j < rows.length; j++){ if (j === i) continue; if ((rows[j].w.subtheme === rows[i].w.subtheme) !== same) continue; best = Math.min(best, Math.hypot(rows[j].cx - rows[i].cx, rows[j].cy - rows[i].cy)); } return best; };
  const sameV = [], crossV = []; rows.forEach((_, i) => { const s = nearest(i, true), c = nearest(i, false); if (isFinite(s)) sameV.push(s); if (isFinite(c)) crossV.push(c); });
  const avg = a => a.reduce((x, y) => x + y, 0) / a.length;
  console.log(`   nearest neighbour: same-subtheme avg ${avg(sameV).toFixed(0)}px  vs cross-subtheme avg ${avg(crossV).toFixed(0)}px  (want same > cross); min same-subtheme ${Math.min(...sameV).toFixed(0)}px`);
  for (const p of pairs.slice(0, +(args.showPairs || 8))) console.log(`     ${p.any}px(${p.strong} strong) ${p.outsideEither===p.any?'CLIP':'????'}  [${p.aLines}L] "${p.a.label.slice(0,32)}"  x  [${p.bLines}L] "${p.b.label.slice(0,32)}"  ${p.where}`);
  if (pairs.length > +(args.showPairs || 8)) console.log(`     ... ${pairs.length-8} more`);
  if (args.png){
    const c = new Canvas(width, height), ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0,0,width,height);
    for (const r of rows){ ctx.fillStyle = DATA.subthemes[r.w.subtheme].color; ctx.font = fontStr(r.w.fontSize, r.w.weight); ctx.textBaseline='alphabetic'; ctx.textAlign='left';
      const mlw = Math.max(...r.w.lines.map(l => ctx.measureText(l).width)); const lh = r.w.fontSize*1.22, sy = -(r.w.lines.length-1)*lh/2;
      r.w.lines.forEach((l,i) => ctx.fillText(l, EXACT ? r.cx - Math.floor(mlw/2) : r.cx - mlw/2, r.cy + sy + i*lh)); }
    fs.writeFileSync(`${args.png}-${name}.png`, c.toBuffer('image/png'));
  }
  return { pairs, dropped };
}

setTimeout(() => { console.error('WATCHDOG: exiting'); process.exit(2); }, 90000).unref();
(async () => {
  const cW = +(args.cloudW || fieldW), cH = +(args.cloudH || fieldH);
  const fW = +(args.finaleW || fieldW), fH = +(args.finaleH || fieldH);
  let cW_ = cW, cH_ = cH, cloudPlaced;
  if (args.autoField){
    // scan field scale (aspect fixed) upward until nothing drops; report density
    let inkArea = 0; for (const w of words337){ meas.font = fontStr(w.fontSize, 400); const mlw = Math.max(...w.lines.map(l => meas.measureText(l).width)); inkArea += (mlw + 2) * ((w.lines.length - 1) * w.fontSize * 1.22 + w.fontSize); }
    let scale = Math.sqrt(inkArea / 0.75 / (cW * cH));
    for (let iter = 0; iter < 40; iter++, scale *= 1.04){
      cW_ = Math.round(cW * scale), cH_ = Math.round(cH * scale);
      words337.forEach(w => { delete w.sprite; delete w.seedX; delete w.seedY; });
      cloudPlaced = await layout(words337, { width: cW_, height: cH_, padding: +(args.cloudPad || (ASIS ? 2 : 1)), weight: 400 });
      console.log(`   autoField try ${cW_}x${cH_}: dropped ${words337.length - cloudPlaced.length}  (ink-box area / field = ${(inkArea/(cW_*cH_)*100).toFixed(0)}%)`);
      if (cloudPlaced.length === words337.length) break;
    }
  } else {
  console.time("layout-cloud"); cloudPlaced = await layout(words337, { width: cW, height: cH, padding: +(args.cloudPad || (ASIS ? 2 : 1)), weight: 400 }); }
  console.timeEnd("layout-cloud"); console.time("layout-finale"); const finalePlaced = await layout(words27, { width: fW, height: fH, padding: 2, weight: 700 }); console.timeEnd("layout-finale");
  console.time("check-cloud"); checkOverlaps(words337, cloudPlaced, cW_, cH_, "cloud"+words337.length); console.timeEnd("check-cloud");
  console.time("check-finale"); checkOverlaps(words27, finalePlaced, fW, fH, "finale27"); console.timeEnd("check-finale");
  process.exit(0); // d3-cloud's timer can keep the process alive otherwise
})();
