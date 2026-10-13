/* whirl-layout.js — the word-cloud layout engine shared by
 * policy-ideas-whirl-v1.html and ideas-we-heard-inline-v1.html.
 *
 * Extracted verbatim from policy-ideas-whirl-v1.html on 2026-09-17 so both
 * sketches lay out, seed, select and DRAW words identically (the overlap
 * guarantee depends on drawWord matching the fork's mask exactly — see
 * drawWord below). Plain script: sets window.WhirlLayout, a factory:
 *
 *   const WL = WhirlLayout({ rand, cloud: () => d3.layout.cloud(), measureCtx });
 *   WL.wrapTwoLines / WL.textWidth / WL.fontStr
 *   WL.layoutWithD3Cloud(items, { width, height, padding, weight })
 *   WL.layoutFinaleBalanced(items, { width, height, padding, weight })
 *   WL.drawWord(ctx, lines, x, y, fontSize, weight, color, alpha, scale)
 *   WL.titleCase(text) / WL.lineHeightFactor(fontSize)
 *
 * Items need: label, lines (array of strings), fontSize, subtheme, w, h
 * (box width/height used by the finale seeding + selection). d3-cloud adds
 * x, y (relative to the field CENTRE).
 *
 * 2026-09-18 fork for handoff/ideas-we-heard-scroll/ (the report-page scroll
 * variant): added titleCase() and lineHeightFactor(), centred drawWord()
 * lines (was left-aligned), and normalised the applySavedFinale() label
 * lookup — see each change's own comment. The two sketches above still load
 * their own untouched copy of this file; this one is not shared with them.
 */
(function(){
  "use strict";
  window.WhirlLayout = function WhirlLayout({ rand, cloud, measureCtx }){
  const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;

  // ---- text measurement / wrapping ------------------------------------------
  const measCache = new Map();
  function fontStr(px, weight){ return `${weight||400} ${px}px 'Noto Sans', Arial, sans-serif`; }
  function textWidth(text, px, weight){
    const key = text + '|' + px + '|' + weight;
    let w = measCache.get(key);
    if (w === undefined){
      measureCtx.font = fontStr(px, weight);
      w = measureCtx.measureText(text).width;
      measCache.set(key, w);
    }
    return w;
  }
  // ---- title case (this fork only) -----------------------------------------
  // AP-style: capitalise the first and last word and every word not in the
  // lowercase list below; preserve any token that is ALREADY all-caps (AI,
  // US, CEO, DMV — the source labels are sentence-cased by whirl_data.py, so
  // an all-caps token here is always a deliberate acronym, never shouting);
  // never touch anything after an apostrophe (Workers' Rights, it's).
  const TITLE_CASE_LOWER = new Set(['a','an','and','as','at','but','by','for','in','nor','of','on','or','per','the','to','up','vs','via']);
  function titleCaseWord(word, isEdge){
    const m = /^(\W*)([A-Za-z][A-Za-z'’]*)(\W*)$/.exec(word);
    if (!m) return word; // punctuation-only token — leave as-is
    const [, lead, core, trail] = m;
    const apos = core.search(/['’]/);
    const base = apos === -1 ? core : core.slice(0, apos);
    const rest = apos === -1 ? '' : core.slice(apos); // untouched, apostrophe onward
    if (base === base.toUpperCase() && /[A-Z]/.test(base)) return lead + base + rest + trail; // already all-caps: leave (AI, US, CEO)
    if (!isEdge && TITLE_CASE_LOWER.has(base.toLowerCase())) return lead + base.toLowerCase() + rest + trail;
    return lead + base.charAt(0).toUpperCase() + base.slice(1).toLowerCase() + rest + trail;
  }
  function titleCase(text){
    const words = text.split(' ');
    return words.map((w, i) => titleCaseWord(w, i === 0 || i === words.length - 1)).join(' ');
  }

  // ---- size-dependent line height (this fork only) --------------------------
  // 1.22 (the fork's original constant) at the smallest labels, ramping down
  // to ~1.02 by the largest — tight lines read fine at large display sizes
  // but 1.22 is what keeps the smallest, most numerous labels legible.
  const LH_SMALL = { size: 14, factor: 1.22 };
  const LH_LARGE = { size: 40, factor: 1.02 };
  function lineHeightFactor(fontSize){
    if (fontSize <= LH_SMALL.size) return LH_SMALL.factor;
    if (fontSize >= LH_LARGE.size) return LH_LARGE.factor;
    const t = (fontSize - LH_SMALL.size) / (LH_LARGE.size - LH_SMALL.size);
    return LH_SMALL.factor + (LH_LARGE.factor - LH_SMALL.factor) * t;
  }

  /** Wraps onto at most two lines, splitting at whichever single space
   * best balances the two resulting widths. Never splits a single word. */
  function wrapTwoLines(text, px, weight, maxW){
    if (textWidth(text, px, weight) <= maxW) return [text];
    const words = text.split(' ');
    if (words.length === 1) return [text];
    let best = [text], bestMax = Infinity;
    for (let i = 1; i < words.length; i++){
      const l1 = words.slice(0,i).join(' '), l2 = words.slice(i).join(' ');
      const w = Math.max(textWidth(l1,px,weight), textWidth(l2,px,weight));
      if (w < bestMax){ bestMax = w; best = [l1,l2]; }
    }
    return best;
  }

  // ---- search start points ("seeds") --------------------------------------
  // d3-cloud's spiral is a SEARCH path, not a layout: each word spirals out
  // from its own start point until it finds a free spot. Stock d3-cloud
  // starts every word at a random point in the central half of the field,
  // and since words are placed largest-first that is what produces the
  // radiating big-in-the-middle look and, for the sparse finale, large
  // gaps. The fork's PATCH 4 honours a caller-set d.seedX/d.seedY instead.
  //
  // Halton sequence: deterministic, evenly spread, non-grid points (write k
  // in base 2 / base 3, reverse the digits, read as a fraction). Any prefix
  // is evenly spread, so the first (largest) words land far apart.
  function halton(i, base){
    let f = 1, r = 0;
    while (i > 0){ f /= base; r += f * (i % base); i = Math.floor(i / base); }
    return r;
  }
  /** Finale seeding: Halton points over a small central patch of the field
   * (FINALE_SEED_SPREAD of its short side), then choose WHICH word gets
   * WHICH point by random search, maximising the minimum distance between
   * any two same-subtheme words — "don't put similar ideas together" as a
   * hard objective rather than an emergent property.
   *
   * Why a SMALL spread: seeds spread over the whole field (tried at 84%)
   * left the 27 floating with large pockets between them — each word
   * settles at the first free spot near its own seed, so far-apart seeds
   * mean far-apart words. Seeds packed near the centre make every word
   * spiral out from the same neighbourhood and pack against the ones
   * already placed: a dense, centre-heavy cloud (accepted look). The tiny
   * spread still fixes each word's DIRECTION out of the centre, which is
   * what keeps same-subtheme words apart: min same-subtheme distance was
   * 281px at spread 0.1 vs 111px with every seed at the exact centre.
   * Deterministic (uses the seeded rand). Only the finale is seeded; the
   * 337-cloud keeps d3-cloud's default starts (that layout reads well). */
  const FINALE_SEED_SPREAD = 0.1;
  // The FINALE_LARGE_N biggest labels get a wider seed spread. They are
  // placed first (d3-cloud places largest-first) and so form the skeleton
  // everything else packs around; from the tight central patch the 2nd and
  // 3rd biggest inevitably wrapped around the 1st, and when two of them
  // shared a subtheme (the two big blue ones) they sat on top of each other
  // in every candidate. Spread seeds for the skeleton words, tight seeds for
  // the fillers; the assignment search below keeps large words on large
  // points and small on small, and maximises same-subtheme distance within
  // that.
  const FINALE_LARGE_N = 6;
  // SKELETON_MARGIN must exceed the slack between a label's box (w.w x w.h)
  // and the collision mask d3-cloud actually tests: the mask keeps ~0.75em
  // of blank rows under the last line (upstream never trims trailing rows)
  // and its width rounds up to a multiple of 32px, so for ~58px labels the
  // mask is ~27px taller and up to ~16px wider per side than the box. With
  // an 18px margin the third skeleton word still collided at its seed and
  // drifted 250px; 48px clears it.
  // SKELETON_MARGIN: clear space asked for between skeleton boxes. Correction
  // (2026-09-17): blank rows/columns in a d3-cloud mask are zero bits and
  // never collide, so the margin does NOT need to cover the sprite's rounding
  // slack (an earlier comment here said it did — the drift it was blamed for
  // was really the bounds rule fixed by the fork's PATCH 6). It is now purely
  // a design gap between the big words; the padding stroke handles contact.
  const SKELETON_TRIES = 1500, SKELETON_MARGIN = 28, SKELETON_INSET = 0.04, SKELETON_SAME_SUBTHEME_EM = 5;
  /** Finale seeding in two tiers.
   *
   * SKELETON — the FINALE_LARGE_N biggest labels. d3-cloud places largest-
   * first and accepts a word at its seed on the very first spiral probe if
   * nothing is there, so if these boxes are chosen to be pairwise
   * non-overlapping (with margin) every skeleton word lands EXACTLY on its
   * seed, zero drift. That makes their arrangement designable: this search
   * draws random non-overlapping arrangements and keeps the one with the
   * least size-weighted same-subtheme crowding, best left/right + top/bottom
   * mass balance, and a mild pull toward the centre. Seeding these from
   * spread-out points and hoping the spiral kept them apart did not work:
   * labels ~900px wide in a 2340px field drift by hundreds of px as soon as
   * a seed spot collides with an earlier word, and the two largest same-
   * subtheme ideas kept landing on top of each other.
   *
   * FILLERS — everything else, seeded in a small central patch
   * (FINALE_SEED_SPREAD of the short side) so they spiral out from the same
   * neighbourhood and pack into the gaps between skeleton words: a dense,
   * centre-heavy cloud. Deterministic (seeded rand). Only the finale is
   * seeded; the 337-cloud keeps d3-cloud's default starts. */
  function seedFinaleInterleaved(items, width, height, largeN, margin){
    // Fallbacks when the field is too small for the skeleton (e.g. the
    // picker's "layout area" pulled well below 1): halve the margin, then
    // shrink the skeleton to 3 words, then to none (every word a filler,
    // seeded into holes from the centre). Each step keeps the guarantee —
    // only where words START searching changes.
    if (largeN === undefined) largeN = FINALE_LARGE_N;
    if (margin === undefined) margin = SKELETON_MARGIN;
    const bySize = items.map((w, i) => i).sort((a, b) => items[b].fontSize - items[a].fontSize);
    const skel = bySize.slice(0, largeN), fill = bySize.slice(largeN);
    const fmax = items[bySize[0]].fontSize;

    // -- skeleton: random non-overlapping arrangements, keep the best-scored
    const ix = SKELETON_INSET * width, iy = SKELETON_INSET * height;
    let bestSkel = largeN === 0 ? [] : null, bestSkelScore = Infinity;
    for (let t = 0; t < SKELETON_TRIES && largeN > 0; t++){
      const pos = []; let ok = true;
      for (const wi of skel){
        const w = items[wi]; let placed = false;
        for (let a = 0; a < 40 && !placed; a++){
          const cx = ix + w.w/2 + rand() * (width - 2*ix - w.w), cy = iy + w.h/2 + rand() * (height - 2*iy - w.h);
          let clash = false;
          for (let j = 0; j < pos.length; j++){
            const o = items[skel[j]], p = pos[j];
            if (Math.abs(cx - p[0]) < (w.w + o.w)/2 + margin && Math.abs(cy - p[1]) < (w.h + o.h)/2 + margin){ clash = true; break; }
          }
          if (!clash){ pos.push([cx, cy]); placed = true; }
        }
        if (!placed){ ok = false; break; }
      }
      if (!ok) continue;
      // score: same-subtheme crowding (size-weighted box-gap shortfall) + mass imbalance + centre pull
      let crowd = 0, L = 0, R = 0, T = 0, B = 0, pull = 0;
      for (let a = 0; a < skel.length; a++){
        const A = items[skel[a]], pa = pos[a], area = A.w * A.h;
        const lf = clamp01((width/2 - (pa[0] - A.w/2)) / A.w), tf = clamp01((height/2 - (pa[1] - A.h/2)) / A.h);
        L += area*lf; R += area*(1-lf); T += area*tf; B += area*(1-tf);
        pull += Math.hypot((pa[0] - width/2) / width, (pa[1] - height/2) / height);
        for (let b = a + 1; b < skel.length; b++){
          const Bw = items[skel[b]], pb = pos[b];
          if (A.subtheme !== Bw.subtheme) continue;
          const gap = Math.max(Math.abs(pa[0]-pb[0]) - (A.w + Bw.w)/2, Math.abs(pa[1]-pb[1]) - (A.h + Bw.h)/2);
          // well beyond the selector's "touching" threshold: two big same-colour
          // ideas one above the other with a single small line between them
          // still read as stacked, so ask for ~5 font-heights of clear space
          const need = SKELETON_SAME_SUBTHEME_EM * Math.max(A.fontSize, Bw.fontSize);
          if (gap < need) crowd += (A.fontSize*Bw.fontSize)/(fmax*fmax) * (1 - gap/need);
        }
      }
      const score = 3*crowd + (Math.abs(L-R)/((L+R) || 1) + Math.abs(T-B)/((T+B) || 1)) + 0.6 * pull / (skel.length || 1);
      if (score < bestSkelScore){ bestSkelScore = score; bestSkel = pos; }
    }
    if (!bestSkel){
      if (margin > 8) return seedFinaleInterleaved(items, width, height, largeN, Math.floor(margin / 2));
      if (largeN > 3) return seedFinaleInterleaved(items, width, height, 3, SKELETON_MARGIN);
      if (largeN > 0) return seedFinaleInterleaved(items, width, height, 0, SKELETON_MARGIN);
      throw new Error('finale seeding: field too small for the labels');
    }
    skel.forEach((wi, k) => { items[wi].seedX = bestSkel[k][0]; items[wi].seedY = bestSkel[k][1]; });

    // -- fillers: seed each one at the centre of the DEEPEST remaining hole,
    //    largest filler first. Coarse occupancy grid over the field (skeleton
    //    boxes + fillers seeded so far, plus the field border), distance
    //    transform by BFS, take the empty cell farthest from anything, then
    //    mark the filler's box there and repeat. Seeding all fillers in one
    //    central patch (the previous approach) left voids between skeleton
    //    words that no spiral happened to reach. Among the deepest cells,
    //    prefer the one farthest from same-subtheme words already seeded.
    const CELL = 20, gw = Math.ceil(width / CELL), gh = Math.ceil(height / CELL);
    const occ = new Uint8Array(gw * gh);
    const markBox = (cx, cy, bw, bh, pad) => {
      const x0 = Math.max(0, Math.floor((cx - bw/2 - pad) / CELL)), x1 = Math.min(gw - 1, Math.floor((cx + bw/2 + pad) / CELL));
      const y0 = Math.max(0, Math.floor((cy - bh/2 - pad) / CELL)), y1 = Math.min(gh - 1, Math.floor((cy + bh/2 + pad) / CELL));
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) occ[y * gw + x] = 1;
    };
    skel.forEach((wi, k) => markBox(bestSkel[k][0], bestSkel[k][1], items[wi].w, items[wi].h, 8));
    const seeded = skel.map((wi, k) => ({ x: bestSkel[k][0], y: bestSkel[k][1], sub: items[wi].subtheme }));
    const dist = new Int32Array(gw * gh), queue = new Int32Array(gw * gh);
    function distanceTransform(){
      let qh = 0, qt = 0;
      for (let i = 0; i < gw * gh; i++){
        const x = i % gw, y = (i / gw) | 0;
        if (occ[i] || x === 0 || y === 0 || x === gw - 1 || y === gh - 1){ dist[i] = 0; queue[qt++] = i; } else dist[i] = -1;
      }
      while (qh < qt){
        const i = queue[qh++], x = i % gw, y = (i / gw) | 0, d = dist[i] + 1;
        if (x > 0 && dist[i-1] < 0){ dist[i-1] = d; queue[qt++] = i-1; }
        if (x < gw-1 && dist[i+1] < 0){ dist[i+1] = d; queue[qt++] = i+1; }
        if (y > 0 && dist[i-gw] < 0){ dist[i-gw] = d; queue[qt++] = i-gw; }
        if (y < gh-1 && dist[i+gw] < 0){ dist[i+gw] = d; queue[qt++] = i+gw; }
      }
    }
    for (const wi of fill){
      const w = items[wi];
      distanceTransform();
      let maxD = 0; for (let i = 0; i < gw * gh; i++) if (dist[i] > maxD) maxD = dist[i];
      // candidate cells: the deepest ones; pick the farthest from same-subtheme words
      let bestI = -1, bestSep = -1;
      for (let i = 0; i < gw * gh; i++){
        if (dist[i] < maxD * 0.8) continue;
        const cx = (i % gw + 0.5) * CELL, cy = (((i / gw) | 0) + 0.5) * CELL;
        let sep = Infinity;
        for (const s of seeded) if (s.sub === w.subtheme) sep = Math.min(sep, Math.hypot(s.x - cx, s.y - cy));
        const score = Math.min(sep, 6 * w.fontSize) + dist[i] * CELL * 0.5; // prefer separation, tie-break on depth
        if (score > bestSep){ bestSep = score; bestI = i; }
      }
      let cx = (bestI % gw + 0.5) * CELL, cy = (((bestI / gw) | 0) + 0.5) * CELL;
      // keep the filler's own box inside the field
      cx = Math.min(Math.max(cx, ix + w.w/2), width - ix - w.w/2);
      cy = Math.min(Math.max(cy, iy + w.h/2), height - iy - w.h/2);
      w.seedX = cx; w.seedY = cy;
      markBox(cx, cy, w.w, w.h, 6);
      seeded.push({ x: cx, y: cy, sub: w.subtheme });
    }
  }

  /** One d3-cloud run, synchronous. d3-cloud's start() completes its whole
   * placement loop inside the first step() when timeInterval is Infinity
   * (the default), firing 'end' before start() returns — so this can return
   * the placed subset directly. Mutates each item in place (x, y relative
   * to the field CENTRE — d3-cloud's own convention). */
  function runCloudLayoutSync(items, { width, height, padding, weight, keepSprites }){
    let placed = null;
    cloud()
      .keepSprites(!!keepSprites)
      .size([width, height])
      .words(items)
      .padding(padding)
      .rotate(() => 0)
      .font("'Noto Sans', Arial, sans-serif") // byte-for-byte the same string fontStr() uses to draw — see ensureFontsLoaded's comment for why that match matters
      .fontWeight(weight)
      .fontSize(d => d.fontSize)
      .text(d => d.label)
      .random(rand)
      .on('end', (p) => { placed = p; })
      .start();
    if (!placed) throw new Error('d3-cloud did not complete synchronously (timeInterval must stay Infinity)');
    return placed;
  }

  function layoutWithD3Cloud(items, opts){
    const placed = runCloudLayoutSync(items, opts);
    const dropped = items.length - placed.length;
    if (dropped > 0){
      console.warn(`layoutWithD3Cloud: ${dropped} of ${items.length} labels didn't fit at their intended size and were dropped from this layout.`);
    }
    return placed;
  }

  // ---- finale: pick the best of several candidate layouts ------------------
  // The browser's rasterizer differs slightly from the Node one the offline
  // checks run on, so the exact arrangement can't be chosen offline; it is
  // chosen HERE, at load, from FINALE_CANDIDATES independent runs. Each run
  // reseeds (a different Halton assignment) and d3-cloud's own random spiral
  // direction differs too. Zero-overlap holds for every candidate by
  // construction, so this selection is purely about the look:
  //  - 0 dropped labels (hard);
  //  - balanced ink mass left/right and top/bottom of the field centre (the
  //    complaint was "the left feels sparser");
  //  - same-subtheme labels not touching, weighted by their sizes, so two
  //    large same-colour ideas sitting on top of each other rules a
  //    candidate out whenever any alternative exists (the seed-level
  //    interleave can't guarantee this: the two biggest words are placed
  //    first and both spiral out from the centre regardless of seeds).
  // Then the chosen layout is shifted RIGIDLY so its bounding box is centred
  // in the field: every word moves by the same integer offset, which cannot
  // create an overlap.
  const FINALE_CANDIDATES = 32;
  // Two same-subtheme labels count as "touching" when the gap between their
  // boxes is under SAME_SUBTHEME_GAP_EM times the larger of their font sizes
  // (floor SAME_SUBTHEME_GAP_MIN px). Proportional, not fixed: two 60px
  // labels 30px apart read as stacked on top of each other even though two
  // 22px labels 30px apart read as separate.
  const SAME_SUBTHEME_GAP_EM = 2.0, SAME_SUBTHEME_GAP_MIN = 24;
  function finaleCandidateMetrics(items, placed, width, height){
    const set = new Set(placed);
    const boxes = items.map(w => set.has(w) ? { w, cx: w.x + width/2, cy: w.y + height/2, hw: w.w/2, hh: w.h/2 } : null).filter(Boolean);
    let L = 0, R = 0, T = 0, B = 0, x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const b of boxes){
      const area = 4*b.hw*b.hh, bx0 = b.cx - b.hw, bx1 = b.cx + b.hw, by0 = b.cy - b.hh, by1 = b.cy + b.hh;
      const leftFrac = clamp01((width/2 - bx0) / (bx1 - bx0)), topFrac = clamp01((height/2 - by0) / (by1 - by0));
      L += area*leftFrac; R += area*(1-leftFrac); T += area*topFrac; B += area*(1-topFrac);
      x0 = Math.min(x0, bx0); x1 = Math.max(x1, bx1); y0 = Math.min(y0, by0); y1 = Math.max(y1, by1);
    }
    const imbalance = Math.abs(L-R)/(L+R) + Math.abs(T-B)/(T+B);
    const fmax = Math.max(...items.map(w => w.fontSize));
    let touching = 0, worstPair = null;
    for (let i = 0; i < boxes.length; i++) for (let j = i+1; j < boxes.length; j++){
      const a = boxes[i], b = boxes[j];
      if (a.w.subtheme !== b.w.subtheme) continue;
      const gap = Math.max(Math.abs(a.cx-b.cx) - (a.hw+b.hw), Math.abs(a.cy-b.cy) - (a.hh+b.hh));
      const need = Math.max(SAME_SUBTHEME_GAP_MIN, SAME_SUBTHEME_GAP_EM * Math.max(a.w.fontSize, b.w.fontSize));
      if (gap < need){
        const wgt = (a.w.fontSize*b.w.fontSize)/(fmax*fmax);
        touching += wgt;
        if (!worstPair || wgt > worstPair.wgt) worstPair = { wgt, a: a.w.label, b: b.w.label };
      }
    }
    // largest empty pocket inside the content bbox: coarse occupancy grid,
    // largest all-empty square by DP; reported as its side in px
    const CELL = 20, gw = Math.ceil(width / CELL), gh = Math.ceil(height / CELL), occ = new Uint8Array(gw * gh);
    for (const b of boxes){
      const cx0 = Math.max(0, Math.floor((b.cx - b.hw) / CELL)), cx1 = Math.min(gw - 1, Math.floor((b.cx + b.hw) / CELL));
      const cy0 = Math.max(0, Math.floor((b.cy - b.hh) / CELL)), cy1 = Math.min(gh - 1, Math.floor((b.cy + b.hh) / CELL));
      for (let y = cy0; y <= cy1; y++) for (let x = cx0; x <= cx1; x++) occ[y * gw + x] = 1;
    }
    const gx0 = Math.ceil(x0 / CELL), gx1 = Math.floor(x1 / CELL) - 1, gy0 = Math.ceil(y0 / CELL), gy1 = Math.floor(y1 / CELL) - 1;
    const sq = new Int16Array(gw * gh); let maxSq = 0;
    for (let y = gy0; y <= gy1; y++) for (let x = gx0; x <= gx1; x++){
      const i = y * gw + x; if (occ[i]) { sq[i] = 0; continue; }
      const up = y > gy0 ? sq[i - gw] : 0, left = x > gx0 ? sq[i - 1] : 0, diag = (y > gy0 && x > gx0) ? sq[i - gw - 1] : 0;
      sq[i] = 1 + Math.min(up, left, diag); if (sq[i] > maxSq) maxSq = sq[i];
    }
    const hole = maxSq * CELL;
    return { dropped: items.length - placed.length, imbalance, touching, worstPair, hole,
             // weights: the skeleton already keeps the big same-subtheme pairs
             // apart, so `touching` here is mostly small fillers — weight it
             // below the two things the eye reads first at a glance: an empty
             // pocket, and one side heavier than the other.
             score: 3*imbalance + 1*touching + 6*(hole / height), bbox: { x0, y0, x1, y1 } };
  }
  /** Seeds for `pack: 'dense'`: every word starts at the field centre with a
   * small jitter, so each one spirals out and stops at the first free spot
   * against the words already placed — d3-cloud's classic compact cloud,
   * largest in the middle. Roughly 30% denser than the designed skeleton +
   * hole-filling seeding (which parks each filler in the MIDDLE of a hole
   * and so leaves air around it): the 27 place at 1.69x the base size in the
   * whirl field this way vs. dropping labels at 1.5x the designed way. The
   * best-of-N selection still picks by balance / same-subtheme crowding /
   * largest pocket. */
  function seedFinaleDense(items, width, height){
    const jitter = 0.02 * Math.min(width, height);
    items.forEach(w => { w.seedX = width/2 + (rand() - 0.5) * 2 * jitter; w.seedY = height/2 + (rand() - 0.5) * 2 * jitter; });
    // Big-word column (2026-09-17, "put the red between the blue themes"):
    // the FINALE_LARGE_N largest words are seeded as a vertical stack through
    // the centre, each new word going to the side whose outermost word has a
    // DIFFERENT subtheme (ties: the shorter side), so two same-colour big
    // words always have another colour between them — the largest word sits
    // at the centre, the largest red beside it, the second blue beyond the
    // red, and so on. Seeds are computed from the box heights, so a word
    // placed earlier (they place largest-first) leaves exactly the slot a
    // later, smaller word is seeded into; d3-cloud accepts a free seed on
    // its first probe, so the column lands as designed and the fillers pack
    // around it.
    const bySize = items.slice().sort((a, b) => b.fontSize - a.fontSize);
    const centre = bySize[0], GAP = 8;
    const above = [], below = []; // from the centre outward
    const heightOf = stack => stack.reduce((t, w) => t + w.h + GAP, 0);
    const outer = stack => stack.length ? stack[stack.length - 1] : centre;
    // Fill the two sides alternately; each slot takes the LARGEST remaining
    // word whose subtheme differs from that side's outermost word (falling
    // back to the largest remaining if none). So with a blue centre the red
    // takes the first slot above, the second blue is pushed to the slot
    // beyond it, etc. Slots never overlap, so every word lands on its seed
    // regardless of the largest-first placement order.
    // The column is capped at ~84% of the field height (42% per side from the
    // centre): in a short field (the inline sketch's 1400x820) six stacked
    // two-line words used almost all of it and a wide 7th word had nowhere
    // left to go — a dropped label. Words that don't fit the column keep
    // their centre seed and pack like fillers.
    const remaining = bySize.slice(1, FINALE_LARGE_N);
    const sides = [above, below];
    const capPerSide = 0.42 * height - centre.h/2;
    for (let si = 0; remaining.length && si < 2 * FINALE_LARGE_N; si++){
      const side = sides[si % 2];
      let idx = remaining.findIndex(w => w.subtheme !== outer(side).subtheme);
      if (idx < 0) idx = 0;
      const w = remaining[idx];
      if (heightOf(side) + GAP + w.h > capPerSide){ // this side is full; try the other, then give up on the column
        if (heightOf(sides[(si + 1) % 2]) + GAP + w.h > capPerSide) break;
        continue;
      }
      remaining.splice(idx, 1);
      const off = centre.h/2 + heightOf(side) + GAP + w.h/2;
      w.seedX = width/2 + (rand() - 0.5) * jitter;
      w.seedY = height/2 + (side === above ? -off : off);
      side.push(w);
    }
  }
  /** True when the two largest labels that share a subtheme sit closer than
   * SAME_SUBTHEME_GAP_EM of the larger font (box gap). Used as a hard rule
   * in the candidate selection: a layout that keeps them apart beats any
   * that stacks them, whatever the other metrics say. */
  function biggestSamePairTouches(items, placed, width, height){
    const bySize = placed.slice().sort((a, b) => b.fontSize - a.fontSize);
    for (let i = 0; i < bySize.length; i++){
      const a = bySize[i], b = bySize.find((w, j) => j > i && w.subtheme === a.subtheme);
      if (!b) continue;
      const gap = Math.max(Math.abs(a.x - b.x) - (a.w + b.w)/2, Math.abs(a.y - b.y) - (a.h + b.h)/2);
      return gap < Math.max(SAME_SUBTHEME_GAP_MIN, SAME_SUBTHEME_GAP_EM * a.fontSize);
    }
    return false;
  }
  /** Same-colour touching pairs in a placed layout (box gap under the
   * SAME_SUBTHEME_GAP rule), heaviest first: [{a, b, wgt}]. */
  function touchingPairs(items, placed, fmax){
    const out = [];
    for (let i = 0; i < placed.length; i++) for (let j = i + 1; j < placed.length; j++){
      const a = placed[i], b = placed[j]; if (a.subtheme !== b.subtheme) continue;
      const gap = Math.max(Math.abs(a.x - b.x) - (a.w + b.w)/2, Math.abs(a.y - b.y) - (a.h + b.h)/2);
      const need = Math.max(SAME_SUBTHEME_GAP_MIN, SAME_SUBTHEME_GAP_EM * Math.max(a.fontSize, b.fontSize));
      if (gap < need) out.push({ a, b, wgt: (a.fontSize * b.fontSize) / (fmax * fmax) });
    }
    return out.sort((p, q) => q.wgt - p.wgt);
  }
  /** Repair pass (2026-09-17, "put the pink above the olive"): the chosen
   * candidate's same-colour touching pairs are taken worst-first; for each,
   * every OTHER word is pinned by seeding it exactly where it is (a free seed
   * is accepted on the first probe, so pinned words land back on their own
   * spots) and the SMALLER word of the pair is re-seeded at a handful of
   * alternative spots (mirrored across the centre, the four mid-side points,
   * mirrored across the larger word). Each attempt is one cheap re-layout
   * with cached sprites; it is accepted only if every label still places and
   * the size-weighted touching total goes down. Words the spiral cannot
   * relocate without a drop are left where they are. Runs BEFORE the rigid
   * centring shift, so pinned seeds are always inside the field. */
  function repairSameSubthemeAdjacency(items, best, runOpts){
    const { width, height } = runOpts;
    const fmax = Math.max(...items.map(w => w.fontSize));
    const apply = pos => items.forEach((w, i) => { w.x = pos[i][0]; w.y = pos[i][1]; });
    const total = pairs => pairs.reduce((t, p) => t + p.wgt, 0);
    let pos = best.pos.map(p => p.slice()), moved = 0, attempts = 0;
    apply(pos);
    let pairs = touchingPairs(items, items, fmax);
    const stuck = new Set();
    for (let pass = 0; pass < 12 && pairs.length; pass++){
      const pair = pairs.find(p => !stuck.has(p.a) && !stuck.has(p.b) && !stuck.has(p.a.label + '|' + p.b.label));
      if (!pair) break;
      const mover = pair.a.fontSize <= pair.b.fontSize ? pair.a : pair.b, other = mover === pair.a ? pair.b : pair.a;
      const cx = mover.x + width/2, cy = mover.y + height/2, ox = other.x + width/2, oy = other.y + height/2;
      const tries = [
        [width - cx, height - cy], [2*ox - cx, 2*oy - cy], [cx, height - cy], [width - cx, cy],
        [width/2, height*0.15], [width/2, height*0.85], [width*0.15, height/2], [width*0.85, height/2],
      ];
      // swap partners: different colour, similar box, not the other half of
      // the pair — exchanging two like-sized words is what "put the pink above
      // the olive" literally is, and it works where a wide word has no other
      // free slot. Nearest in size first, up to 6.
      const partners = items.filter(w => w !== mover && w !== other && w.subtheme !== mover.subtheme
          && Math.abs(w.w - mover.w) / mover.w < 0.4 && Math.abs(w.h - mover.h) / mover.h < 0.4)
        .sort((p, q) => Math.abs(p.w - mover.w) - Math.abs(q.w - mover.w)).slice(0, 6);
      const before = total(pairs);
      let bestTry = null;
      const attempt = (setSeeds) => {
        attempts++;
        items.forEach((w, i) => { delete w.x; delete w.y; w.seedX = pos[i][0] + width/2; w.seedY = pos[i][1] + height/2; });
        setSeeds();
        const placed = runCloudLayoutSync(items, runOpts);
        if (placed.length !== items.length) return;
        const after = total(touchingPairs(items, items, fmax));
        if (after < before - 1e-9 && (!bestTry || after < bestTry.after)) bestTry = { after, pos: items.map(w => [w.x, w.y]) };
      };
      for (const [tx, ty] of tries) attempt(() => {
        mover.seedX = Math.min(Math.max(tx, mover.w/2 + 4), width - mover.w/2 - 4);
        mover.seedY = Math.min(Math.max(ty, mover.h/2 + 4), height - mover.h/2 - 4);
      });
      for (const partner of partners) attempt(() => {
        const pi = items.indexOf(partner), mi = items.indexOf(mover);
        mover.seedX = pos[pi][0] + width/2; mover.seedY = pos[pi][1] + height/2;
        partner.seedX = pos[mi][0] + width/2; partner.seedY = pos[mi][1] + height/2;
      });
      if (bestTry){ pos = bestTry.pos; moved++; apply(pos); pairs = touchingPairs(items, items, fmax); }
      else { stuck.add(pair.a.label + '|' + pair.b.label); apply(pos); }
    }
    apply(pos);
    // recompute the metrics for the repaired layout
    const m = finaleCandidateMetrics(items, items, width, height);
    m.k = best.k; m.pos = pos; m.seeds = best.seeds; m.bigPairTouch = biggestSamePairTouches(items, items, width, height);
    m.repair = { moved, attempts, touchingBefore: best.touching, touchingAfter: m.touching };
    console.log(`whirl finale repair: moved ${moved} word(s) in ${attempts} re-layouts; same-subtheme touching ${best.touching.toFixed(2)} -> ${m.touching.toFixed(2)}`);
    return m;
  }
  /** opts.pack: 'designed' (default — skeleton + hole-filling fillers) or 'dense'. */
  function layoutFinaleBalanced(items, opts){
    const { width, height } = opts;
    const seed = opts.pack === 'dense' ? seedFinaleDense : seedFinaleInterleaved;
    let best = null, fewestDrops = null;
    // sprites are kept across candidates (fork PATCH 8): same words, same
    // sizes, only the start points differ. Cleared once at the end.
    const runOpts = Object.assign({}, opts, { keepSprites: true });
    for (let k = 0; k < FINALE_CANDIDATES; k++){
      items.forEach(w => { delete w.x; delete w.y; });
      seed(items, width, height);
      const placed = runCloudLayoutSync(items, runOpts);
      const m = finaleCandidateMetrics(items, placed, width, height);
      m.k = k; m.pos = items.map(w => placed.includes(w) ? [w.x, w.y] : null); m.seeds = items.map(w => [w.seedX, w.seedY]);
      m.bigPairTouch = biggestSamePairTouches(items, placed, width, height);
      if (!fewestDrops || m.dropped < fewestDrops.dropped) fewestDrops = m;
      if (m.dropped === 0){
        // hard rule first (the two largest same-subtheme labels apart), score second
        const better = !best || (best.bigPairTouch && !m.bigPairTouch) || (best.bigPairTouch === m.bigPairTouch && m.score < best.score);
        if (better) best = m;
      }
    }
    if (!best){
      console.warn(`layoutFinaleBalanced: no candidate placed all ${items.length} labels; using the one with fewest drops (${fewestDrops.dropped}).`);
      best = fewestDrops;
    }
    if (best.dropped === 0 && opts.repair !== false) best = repairSameSubthemeAdjacency(items, best, runOpts);
    items.forEach(w => { delete w.sprite; });
    // rigid, integer shift so the bounding box is centred in the field
    const dx = Math.round(width/2 - (best.bbox.x0 + best.bbox.x1)/2);
    const dy = Math.round(height/2 - (best.bbox.y0 + best.bbox.y1)/2);
    items.forEach((w, i) => { const p = best.pos[i]; if (p){ w.x = p[0] + dx; w.y = p[1] + dy; } });
    best.shift = [dx, dy];
    console.log(`whirl finale (${opts.pack || 'designed'} packing): picked candidate ${best.k}/${FINALE_CANDIDATES} — biggest same-colour pair ${best.bigPairTouch ? 'TOUCHING (no candidate avoided it)' : 'apart'}, L/R+T/B mass imbalance ${best.imbalance.toFixed(3)}, same-subtheme touching weight ${best.touching.toFixed(2)}, largest empty pocket ${best.hole}px square${best.worstPair ? ` (worst: "${best.worstPair.a.slice(0,30)}" / "${best.worstPair.b.slice(0,30)}")` : ''}, centring shift ${dx},${dy}px`);
    if (best.worstPair){ // dev: where the worst same-subtheme pair was seeded vs where it landed (field coords)
      const show = (w, i) => `"${w.label.slice(0,24)}" seed(${best.seeds[i][0]|0},${best.seeds[i][1]|0}) → at(${(w.x + width/2)|0},${(w.y + height/2)|0}) box ${w.w|0}x${w.h|0}`;
      items.map((w, i) => i).sort((a, b) => items[b].fontSize - items[a].fontSize).slice(0, FINALE_LARGE_N)
        .forEach(i => console.log('   skeleton ' + show(items[i], i) + ` sub${items[i].subtheme}`));
    }
    lastFinale = { candidate: best.k, candidates: FINALE_CANDIDATES, pack: opts.pack || 'designed', bigPairTouch: best.bigPairTouch, dropped: best.dropped, imbalance: best.imbalance,
                   touching: best.touching, hole: best.hole, shift: best.shift, worstPair: best.worstPair };
    return items.filter((w, i) => best.pos[i]);
  }
  let lastFinale = null; // metrics of the most recent layoutFinaleBalanced() pick (read by the layout picker)

  // ---- drawing ------------------------------------------------------------------
  /** Renders at the EXACT anchor the fork's cloudSprite() rasterized the
   * collision mask at: textBaseline 'alphabetic' (canvas default, what
   * cloudSprite uses), each line's baseline at y + startY + i*lh with the
   * same lineHeight formula (lineHeightFactor(fontSize), matching the fork's
   * own d.lineHeight — see PATCH 10) and line-count centring.
   *
   * 2026-09-18 (this fork only): each line is now individually CENTRED
   * within the sprite's fixed width (maxLineWidth), not left-aligned to a
   * single shared anchor — matching PATCH 9 in this fork's copy of
   * d3-cloud-multiline.js's cloudSprite(). Both sides still anchor the
   * sprite/mask's overall box at x - Math.floor(maxLineWidth/2) (d3-cloud's
   * x is an integer, so this keeps every glyph on the pixel phase the mask
   * was built at); only where a shorter line sits INSIDE that box changed.
   * Any deviation between this function and cloudSprite() draws ink the
   * mask never covered — the class of bug that produced this project's
   * residual overlaps. Leaves textAlign/textBaseline as set. */
  function drawWord(ctx, text_lines, x, y, fontSize, weight, color, alpha, scale){
    if (alpha <= 0.008) return;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.font = fontStr(fontSize*(scale||1), weight);
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    const lineWidths = text_lines.map(l => ctx.measureText(l).width);
    const maxLineWidth = Math.max(...lineWidths);
    const anchorX = x - Math.floor(maxLineWidth/2);
    const lh = fontSize*(scale||1)*lineHeightFactor(fontSize*(scale||1));
    const startY = -(text_lines.length-1)*lh/2;
    text_lines.forEach((line, i) => {
      const lineAnchorX = anchorX + Math.floor((maxLineWidth - lineWidths[i]) / 2); // PATCH 9 counterpart — see comment above
      ctx.fillText(line, lineAnchorX, y + startY + i*lh);
    });
  }

  /** Apply a saved finale layout (see finale-layout-picker-v1.html) to `items`
   * if it was made for the same field, the same labels and the same font
   * sizes; returns true when applied. Positions were produced by this same
   * engine in a browser, so drawing them is the layout it verified. */
  /** Width of a fixed probe string in the font actually in use — stored with a
   * kept layout and compared on load, so positions computed with Noto Sans
   * are never applied when a fallback font (Arial, system-ui) is rendering:
   * different glyph widths would put ink where the kept layout's masks were
   * not. Tolerance 0.75px absorbs sub-pixel measurement noise between
   * browsers. */
  function fontProbe(){ return Math.round(textWidth('Hold AI companies liable for harm they cause', 40, 700) * 100) / 100; }
  function applySavedFinale(saved, items, width, height){
    if (!saved || !saved.field || saved.field.w !== width || saved.field.h !== height) return false;
    if (saved.fontProbe != null && Math.abs(saved.fontProbe - fontProbe()) > 0.75){
      console.warn(`kept finale layout skipped: font mismatch (probe ${fontProbe()} vs saved ${saved.fontProbe}) — is Noto Sans loaded?`);
      return false;
    }
    if (!Array.isArray(saved.items) || saved.items.length !== items.length) return false;
    // Matched by NORMALISED (lower-cased) label, not the raw string — this
    // fork's items carry title-cased labels (see titleCase() above), and a
    // kept layout saved before or after that casing change must still match
    // on identity, not on capitalisation. Assumes labels are unique after
    // lower-casing, true for both the 337 Phase 1 concepts and the 27
    // Phase 2 ideas today.
    const byLabel = new Map(saved.items.map(s => [s.label.toLowerCase(), s]));
    for (const w of items){
      const s = byLabel.get(w.label.toLowerCase());
      if (!s || Math.abs(s.fontSize - w.fontSize) > 0.01 || s.lines.join('\n').toLowerCase() !== w.lines.join('\n').toLowerCase()) return false;
    }
    for (const w of items){ const s = byLabel.get(w.label.toLowerCase()); w.x = s.x; w.y = s.y; }
    lastFinale = Object.assign({ fromSaved: true }, saved.metrics || {});
    return true;
  }
  return { fontStr, textWidth, wrapTwoLines, titleCase, lineHeightFactor, halton, seedFinaleInterleaved, seedFinaleDense, runCloudLayoutSync,
           layoutWithD3Cloud, finaleCandidateMetrics, layoutFinaleBalanced, drawWord, applySavedFinale, fontProbe,
           FINALE_CANDIDATES, FINALE_LARGE_N, get lastFinale(){ return lastFinale; } };
  };
})();
