"use strict";
/* Derive darker-for-text versions of the 8 DATA_VIZ_CAT_V2 hues (the region
 * legend palette): same hue family, lightness reduced in OKLCH until the
 * WCAG contrast against white is >= TARGET, chroma kept (so hues stay vivid
 * rather than going brown/grey). Then report pairwise OKLab distance so the
 * two purples (and the two blues) are demonstrably apart. Writes a swatch PNG.
 *
 *   node derive_text_palette.js            -> table + /tmp/whirl-palette.png
 */
const { Canvas } = require('canvas');
const fs = require('fs');

// ---- colour math (sRGB <-> OKLab/OKLCH, WCAG contrast) ----------------------
const hex2rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
const rgb2hex = rgb => '#' + rgb.map(v => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('');
const lin = c => c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
const unlin = c => c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
function rgb2oklab([r, g, b]){
  r = lin(r); g = lin(g); b = lin(b);
  const l = Math.cbrt(0.4122214708*r + 0.5363325363*g + 0.0514459929*b);
  const m = Math.cbrt(0.2119034982*r + 0.6806995451*g + 0.1073969566*b);
  const s = Math.cbrt(0.0883024619*r + 0.2817188376*g + 0.6299787005*b);
  return [0.2104542553*l + 0.7936177850*m - 0.0040720468*s, 1.9779984951*l - 2.4285922050*m + 0.4505937099*s, 0.0259040371*l + 0.7827717662*m - 0.8086757660*s];
}
function oklab2rgb([L, a, b]){
  const l = (L + 0.3963377774*a + 0.2158037573*b) ** 3, m = (L - 0.1055613458*a - 0.0638541728*b) ** 3, s = (L - 0.0894841775*a - 1.2914855480*b) ** 3;
  return [unlin(4.0767416621*l - 3.3077115913*m + 0.2309699292*s), unlin(-1.2684380046*l + 2.6097574011*m - 0.3413193965*s), unlin(-0.0041960863*l - 0.7034186147*m + 1.7076147010*s)];
}
const inGamut = rgb => rgb.every(v => v >= -0.002 && v <= 1.002);
const lum = rgb => 0.2126*lin(rgb[0]) + 0.7152*lin(rgb[1]) + 0.0722*lin(rgb[2]);
const contrast = hex => (1.05) / (lum(hex2rgb(hex)) + 0.05);
const toLCH = lab => [lab[0], Math.hypot(lab[1], lab[2]), Math.atan2(lab[2], lab[1]) * 180 / Math.PI];
const fromLCH = ([L, C, h]) => [L, C * Math.cos(h * Math.PI / 180), C * Math.sin(h * Math.PI / 180)];
const dE = (h1, h2) => { const a = rgb2oklab(hex2rgb(h1)), b = rgb2oklab(hex2rgb(h2)); return Math.hypot(a[0]-b[0], a[1]-b[1], a[2]-b[2]) * 100; };

/** Darken `hex` along constant hue until contrast >= target. `hueShift`
 * (degrees) and `chromaScale` let a hue be nudged apart from a neighbour. */
function darkenFor(hex, target, { hueShift = 0, chromaScale = 1, minL = 1, target: ownTarget } = {}){
  if (ownTarget) target = ownTarget;
  let [L, C, h] = toLCH(rgb2oklab(hex2rgb(hex)));
  h += hueShift; C *= chromaScale; L = Math.min(L, minL);
  for (let i = 0; i < 400; i++){
    let rgb = oklab2rgb(fromLCH([L, C, h]));
    let c = C; while (!inGamut(rgb) && c > 0.01){ c -= 0.005; rgb = oklab2rgb(fromLCH([L, c, h])); }
    const out = rgb2hex(rgb);
    if (contrast(out) >= target) return out;
    L -= 0.0025;
  }
  return hex;
}

const TARGET = +(process.argv[2] || 4.6);
const EIGHTH = process.argv[3] || 'light';   // light | navy | green | rose — what fills the 8th slot
// ---- the palette from the region legend: DATA_VIZ_CAT_V2[0..7] --------------
const V2 = [
  { name: 'teal (LA)',            src: '#53cab0' },
  { name: 'blue (Bay Area)',      src: '#65ade1' },
  { name: 'orchid (SoCal)',       src: '#c591da' },
  { name: 'orange (Sacramento)',  src: '#ee9930' },
  { name: 'dark purple (C. Valley)', src: '#6d4884' },
  { name: 'red (Far North)',      src: '#e45d48' },
  { name: 'olive (C. Coast)',     src: '#6c8043' },
  EIGHTH === 'green' ? { name: 'green (V2[8])',        src: '#75bc60' } :
  EIGHTH === 'rose'  ? { name: 'rose (V2[9])',         src: '#f2c3c7' } :
  EIGHTH === 'navy'  ? { name: 'light blue -> navy',   src: '#a9d4f2', nudge: { hueShift: -4, chromaScale: 1.3, minL: 0.42 } } :
                       { name: 'light blue',           src: '#a9d4f2' },
];
// current sketch colours (DATA_VIZ_CAT_V2_TEXT order = subtheme order 0..7)
const CURRENT = ['#427092', '#805e8e', '#5c6d39', '#368372', '#c24f3d', '#5d3d70', '#9b631f', '#856b6d'];
// which V2 hue each subtheme currently draws from (per palette.ts comments)
const SUBTHEME_SRC = ['#65ade1', '#c591da', '#6c8043', '#53cab0', '#e45d48', '#6d4884', '#ee9930', '#f2c3c7'];

// per-hue nudges: keep hues recognisable, push the purples apart, and make
// the light blue land somewhere the darkened Bay-Area blue is not
const NUDGE = {
  '#c591da': { hueShift: +12, chromaScale: 1.35 },   // orchid -> vivid magenta-plum
  '#6d4884': { hueShift: -12, chromaScale: 1.15 },   // dark purple -> deeper indigo-violet
  '#a9d4f2': { hueShift: -18, chromaScale: 0.85 },   // light blue -> steel/cyan slate
  '#65ade1': { hueShift: +6,  chromaScale: 1.2 },    // blue -> stronger azure
  '#6c8043': { target: 6.2, chromaScale: 1.1 },       // olive: deeper than the rest so it separates from orange and teal by lightness
  '#ee9930': { chromaScale: 1.2 },                  // orange on its own hue: amber drifts into the olive, redder drifts into the red
  '#53cab0': { hueShift: +14, chromaScale: 1.15 },  // teal toward cyan (higher OKLCH hue), away from the olive
};
const derived = V2.map(v => ({ ...v, text: darkenFor(v.src, TARGET, v.nudge || NUDGE[v.src] || {}) }));

console.log(`target contrast >= ${TARGET}:1 on white\n`);
console.log('hue                       source    text      contrast');
for (const d of derived) console.log(`${d.name.padEnd(25)} ${d.src}   ${d.text}   ${contrast(d.text).toFixed(2)}:1`);
console.log('\npairwise OKLab distance (x100) between derived text colours; < 12 would be hard to tell apart in body text');
const names = derived.map(d => d.name.split(' ')[0].padStart(11));
console.log(' '.repeat(12) + names.join(''));
let minPair = Infinity, minLabel = '';
derived.forEach((a, i) => {
  const row = derived.map((b, j) => { if (i === j) return '     -     '; const d = dE(a.text, b.text); if (i < j && d < minPair){ minPair = d; minLabel = `${a.name} / ${b.name}`; } return d.toFixed(0).padStart(11); });
  console.log(names[i] + ' ' + row.join(''));
});
console.log(`\nclosest pair: ${minLabel} at ${minPair.toFixed(1)}`);
console.log(`(current sketch purples #805e8e / #5d3d70 are ${dE('#805e8e', '#5d3d70').toFixed(1)} apart; current blue/teal ${dE('#427092','#368372').toFixed(1)})`);

// ---- swatch PNG: source | current | derived, with sample text ---------------
const W = 1500, ROW = 64, cv = new Canvas(W, ROW * (V2.length + 1) + 20), ctx = cv.getContext('2d');
ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
ctx.font = '600 15px sans-serif'; ctx.fillStyle = '#444';
['legend palette (DATA_VIZ_CAT_V2)', 'current sketch text colour', 'proposed text colour'].forEach((t, i) => ctx.fillText(t, 20 + i * 490, 26));
derived.forEach((d, i) => {
  const y = 40 + i * ROW;
  const cur = CURRENT[SUBTHEME_SRC.indexOf(d.src)] || '#999999';
  [[d.src, 20], [cur, 510], [d.text, 1000]].forEach(([c, x]) => {
    ctx.fillStyle = c; ctx.beginPath(); ctx.arc(x + 14, y + 30, 12, 0, Math.PI * 2); ctx.fill();
    ctx.font = '700 26px sans-serif'; ctx.fillText('Hold AI companies liable', x + 40, y + 28);
    ctx.font = '400 13px sans-serif'; ctx.fillText(`${c}  ${contrast(c).toFixed(2)}:1`, x + 40, y + 50);
  });
});
fs.writeFileSync(`/tmp/whirl-palette-${EIGHTH}.png`, cv.toBuffer('image/png'));
console.log(`\nswatch: /tmp/whirl-palette-${EIGHTH}.png`);
console.log('\nproposed, in V2 order:', JSON.stringify(derived.map(d => d.text)));
