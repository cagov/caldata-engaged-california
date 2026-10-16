"use strict";
/* End-to-end check of handoff/ideas-we-heard-scroll/'s own output, same
 * method as whirl_sketch_render_check.js (that file's own header explains
 * the rasterize-and-compare approach — copied verbatim below, not
 * reimplemented): runs the bundle's reduced-motion path under Node with the
 * real fork + real Noto Sans, records every fillText() call, rasterizes each
 * drawn line and checks for any two lines sharing an ink pixel.
 *
 * A separate script, not a --file flag on whirl_sketch_render_check.js,
 * because that bundle is a single self-contained HTML file (one inline
 * IIFE, hardcoded element ids) and this one is five separate files loaded
 * in order with different ids (ideas-scroll-canvas, not narrative-canvas;
 * etc) — the two shims don't overlap enough to share.
 *
 * Usage: node ideas_scroll_render_check.js [--dir=<bundle dir>] [--png] [--wait=ms]
 * Deps: ./node_modules/canvas and ./fonts/NotoSans-*.ttf (both already here
 * for whirl_sketch_render_check.js).
 */
const fs = require("fs");
const path = require("path");
const ARG = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
    return m ? [m[1], m[2] === undefined ? true : m[2]] : [a, true];
  })
);
const BUNDLE = path.resolve(__dirname, ARG.dir || "../../handoff/ideas-we-heard-scroll");
const { Canvas, CanvasRenderingContext2D, registerFont } = require("canvas");
registerFont(__dirname + "/fonts/NotoSans-Regular.ttf", { family: "Noto Sans", weight: "400" });
registerFont(__dirname + "/fonts/NotoSans-Bold.ttf", { family: "Noto Sans", weight: "700" });

// ---- minimal DOM so the bundle's reduced-motion path runs ------------------
const style = () => new Proxy({}, { get() { return ""; }, set() { return true; } });
const classList = () => ({ add(){}, remove(){}, toggle(){}, contains(){ return false; } });
function el(tag) {
  const e = {
    tagName: tag, style: style(), classList: classList(), children: [],
    appendChild(c){ e.children.push(c); return c; },
    addEventListener(){}, querySelectorAll(){ return []; }, querySelector(){ return null; },
    getBoundingClientRect(){ return { left:0, top:0, width:1800, height:1000 }; },
    _attrs: {}, setAttribute(k,v){ this._attrs[k] = String(v); }, getAttribute(k){ return this._attrs[k] ?? null; },
    textContent: "", clientWidth: 1400,
    set innerHTML(v){}, get innerHTML(){ return ""; },
  };
  return e;
}
function realCanvas(w, h) {
  const c = new Canvas(w || 300, h || 150);
  c.style = style(); c.classList = classList(); c.addEventListener = () => {}; c.setAttribute = () => {};
  return c;
}
const wrappers = [el("section"), el("section"), el("section")]; // #narrative-wrapper-1/2/3
const copies = [el("div"), el("div"), el("div")]; // .narrative-copy inside each
const mainCanvas = realCanvas(1800, 1000);
const registry = {
  "ideas-scroll-canvas": mainCanvas,
  "ideas-scroll-legend": el("div"),
  "ideas-scroll-caption": el("div"),
  "ideas-scroll-tooltip": el("div"),
};
const els = {};
global.document = {
  getElementById(id){ return registry[id] || (els[id] = els[id] || el("div")); },
  querySelectorAll(sel){ return sel === ".narrative-wrapper" ? wrappers : sel === ".narrative-copy" ? copies : []; },
  // ideas-scroll.js's own querySelector use (measurePlateFieldRect) always
  // misses here, same as it would with getBoundingClientRect returning a
  // zeroed rect elsewhere in this shim — harmless for THIS check, which
  // only inspects the settled (t=1) draw state; ring-seeded home positions
  // never appear in that state (see ideas-scroll.js's own comment on why
  // words never move once arrived).
  querySelector(){ return null; },
  createElement(tag){ return tag === "canvas" ? realCanvas(1, 1) : el(tag); },
  addEventListener(){}, body: { style: {} },
  fonts: { ready: Promise.resolve(), load: () => Promise.resolve([]) },
};
global.window = global;
global.addEventListener = () => {};
global.innerWidth = 1800; global.innerHeight = 1000;
global.matchMedia = () => ({ matches: true }); // forces the reduced-motion (static) path
global.requestAnimationFrame = (fn) => setTimeout(fn, 16);
global.performance = global.performance || { now: () => Date.now() };

global.d3 = { layout: { cloud: require(path.join(BUNDLE, "d3-cloud-multiline.js")) } };
require(path.join(BUNDLE, "whirl-layout.js")); // sets window.WhirlLayout
require(path.join(BUNDLE, "ideas-scroll-layout.js")); // sets window.IdeasScrollLayout
require(path.join(BUNDLE, "ideas-scroll-data.js")); // sets window.IDEAS_SCROLL_DATA

// ---- record every fillText the bundle performs, per target (mini) canvas --
const calls = new Map();
const origFill = CanvasRenderingContext2D.prototype.fillText;
CanvasRenderingContext2D.prototype.fillText = function (text, x, y) {
  if (wrappers.some((w) => w.children.includes(this.canvas))) {
    if (!calls.has(this.canvas)) calls.set(this.canvas, []);
    calls.get(this.canvas).push({ text, x, y, font: this.font, align: this.textAlign, base: this.textBaseline });
  }
  return origFill.apply(this, arguments);
};

require(path.join(BUNDLE, "ideas-scroll.js")); // runs immediately: ensureFontsLoaded().then(layoutWordClouds).then(boot)

setTimeout(() => {
  const groups = [...calls.entries()];
  console.log(`recorded fillText on ${groups.length} beat canvases`);
  const meas = new Canvas(10, 10).getContext("2d");
  // ---- rasterize-and-compare, verbatim from whirl_sketch_render_check.js ----
  function rasterize(c) {
    meas.font = c.font;
    const m = meas.measureText(c.text);
    const x0 = Math.floor(c.x - m.actualBoundingBoxLeft - 3), y0 = Math.floor(c.y - m.actualBoundingBoxAscent - 3);
    const bw = Math.ceil(m.actualBoundingBoxLeft + m.actualBoundingBoxRight + 7), bh = Math.ceil(m.actualBoundingBoxAscent + m.actualBoundingBoxDescent + 7);
    const cv = new Canvas(bw, bh), ctx = cv.getContext("2d");
    ctx.font = c.font; ctx.textAlign = c.align; ctx.textBaseline = c.base; ctx.fillStyle = "#000";
    ctx.fillText(c.text, c.x - x0, c.y - y0);
    const d = ctx.getImageData(0, 0, bw, bh).data, a = new Uint8Array(bw * bh);
    let mx0 = bw, my0 = bh, mx1 = -1, my1 = -1;
    for (let p = 0; p < bw * bh; p++) {
      a[p] = d[p * 4 + 3];
      if (a[p]) {
        const x = p % bw, y = (p / bw) | 0;
        if (x < mx0) mx0 = x; if (x > mx1) mx1 = x; if (y < my0) my0 = y; if (y > my1) my1 = y;
      }
    }
    return { c, x0, y0, bw, a, ink: { x0: x0 + mx0, x1: x0 + mx1, y0: y0 + my0, y1: y0 + my1 } };
  }
  let anyOverlap = false;
  groups.forEach(([canvas, list], gi) => {
    const items = list.map(rasterize);
    let pairs = 0, strong = 0; const ex = [];
    for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
      const A = items[i], B = items[j];
      const ix0 = Math.max(A.ink.x0, B.ink.x0), ix1 = Math.min(A.ink.x1, B.ink.x1), iy0 = Math.max(A.ink.y0, B.ink.y0), iy1 = Math.min(A.ink.y1, B.ink.y1);
      if (ix0 > ix1 || iy0 > iy1) continue;
      let any = 0, st = 0;
      for (let y = iy0; y <= iy1; y++) for (let x = ix0; x <= ix1; x++) {
        const aa = A.a[(y - A.y0) * A.bw + (x - A.x0)], ab = B.a[(y - B.y0) * B.bw + (x - B.x0)];
        if (aa && ab) { any++; if (aa >= 128 && ab >= 128) st++; }
      }
      if (any) { pairs++; if (st) strong++; if (ex.length < 5) ex.push(`${any}px(${st} strong) "${A.c.text.slice(0, 30)}" x "${B.c.text.slice(0, 30)}"`); }
    }
    if (pairs) anyOverlap = true;
    const name = gi === 0 ? "beat 1 (poll cloud, arrived)" : gi === 1 ? "beat 2 (dissolve end + finale fading up)" : "beat 3 (finale, static)";
    console.log(`== ${name}: ${list.length} drawn lines, overlapping line pairs: ${pairs} (any coverage), ${strong} with both alphas >=128`);
    ex.forEach((e) => console.log("     " + e));
    if (ARG.png) fs.writeFileSync(`/tmp/ideas-scroll-canvas${gi + 1}.png`, canvas.toBuffer("image/png"));
  });
  console.log(anyOverlap ? "FAIL: overlapping ink found" : "PASS: zero overlap across all beats");
  process.exit(anyOverlap ? 1 : 0);
}, +(ARG.wait || 3000));
