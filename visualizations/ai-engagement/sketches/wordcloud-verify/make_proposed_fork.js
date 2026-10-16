// Applies the three correctness patches + the optional seed hook to the sketch's
// d3-cloud fork and writes the result next to a unified diff. Does NOT touch sketches/.
const fs = require('fs');
const SRC = require('path').join(__dirname, '..', 'd3-cloud-multiline.js');
let s = fs.readFileSync(SRC, 'utf8');
function rep(before, after, why){ if (!s.includes(before)) throw new Error('not found: ' + why); s = s.replace(before, after); }
// 1. sprite height: each line keeps a full 1em above + 1em below its own baseline
rep('let h = Math.max(d.size << 1, Math.ceil(lines.length * lineHeightInternal * ratio));',
    '// PATCH 1 (sprite height): the old 1.22em-per-line box left only 0.61em above the\n    // first baseline; Noto Sans ascenders reach 0.765em, so the top of every 2-line\n    // label was never in the collision mask. Now: one line-height per extra line,\n    // plus the single-line 2em envelope (1em above the first baseline, 1em below the last).\n    let h = Math.max(Math.ceil(2 * d.size), Math.ceil(((lines.length - 1) * lineHeightInternal + 2 * d.size) * ratio));', 'height');
// 2. exact size: mask drawn at the same fractional px as the app draws (upstream used ~~size then size+1)
rep('d.size = ~~fontSize.call(this, d, i);', 'd.size = +fontSize.call(this, d, i); // PATCH 2: keep the fractional size; the mask must be drawn at exactly the size the app draws', 'size');
rep('c.font = d.style + " " + d.weight + " " + ~~((d.size + 1) / ratio) + "px " + d.font;',
    'c.font = d.style + " " + d.weight + " " + (d.size / ratio) + "px " + d.font; // PATCH 2: exact px, not ~~size+1 (that made mask glyphs ~3% wider than drawn ones, so letters drifted off their own mask)', 'font');
// 3. sprite width slack: advance width + 1 was too tight for the padding stroke + glyph overhang
rep('let w = (maxLineWidth + 1) * ratio;', 'let w = (maxLineWidth + 1 + 2 * (d.padding || 0) + 4) * ratio; // PATCH 3: room for the padding stroke and right-side glyph overhang', 'width');
// 4. seed hook (look, not correctness): honor a caller-provided search start point
rep('d.x = (size[0] * (random() + .5)) >> 1;\n        d.y = (size[1] * (random() + .5)) >> 1;',
    '// PATCH 4 (optional): caller-provided search start point, so the layout\'s texture is\n        // set by where words START looking (e.g. a spread-out low-discrepancy set), not by\n        // d3-cloud\'s default random point in the central 50% box.\n        if (d.seedX != null) { d.x = d.seedX | 0; d.y = d.seedY | 0; }\n        else { d.x = (size[0] * (random() + .5)) >> 1; d.y = (size[1] * (random() + .5)) >> 1; }', 'seed');
// 5. guard: a NaN/undefined size makes the spiral loop never terminate
rep('cloud.start = function() {', 'cloud.start = function() {\n    if (!(size[0] > 0 && size[1] > 0)) throw new Error("d3-cloud: size must be two positive numbers, got " + size); // PATCH 5: NaN size = infinite spiral', 'guard');
fs.writeFileSync('/tmp/d3-cloud-multiline-proposed.js', s);
console.log('written /tmp/d3-cloud-multiline-proposed.js');
