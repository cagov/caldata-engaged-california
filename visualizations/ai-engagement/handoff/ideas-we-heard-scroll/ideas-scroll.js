"use strict";
/* =============================================================================
   ideas-scroll.js — the report-page scroll-story variant of the ideas cloud.

   Scroll mechanic, beat structure and ScrollTrigger wiring are ported
   unchanged from policy-ideas-whirl-v1.html (itself ported from the LA
   fires action-plan page's own inline script: Lenis + GSAP ScrollTrigger,
   three pinned beats, non-reversing on scroll-back). What's different from
   that sketch:

     1. Data contract: reads window.IDEAS_SCROLL_DATA (the report's OWN
        shipped /public/data/ai-report-ideas-cloud.json shape — poll/
        discussion/keptLayouts), not whirl-data.js's 337/27 split. The
        discussion items here have no `.sessions` field, so the hover
        tooltip shows votes only. DATA.keptLayouts itself is NOT used for
        finale positions — see FINALE_SCALE's comment for why (the
        centred/size-dependent line-height changes below invalidate it).
     2. Beat-1 arrival: words start on a ring around the measured copy
        plate (ideas-scroll-layout.js's ringHomePositions), not a central
        blob — see the "words start around the copy" note in the README.
     3. Long-tail hiding: 35% of the count===1 poll ideas are dropped
        (sampleTailKept), deterministically, before any layout runs.
     4. Edge feather: the poll cloud lays out on a field 18% larger than the
        visible 1400x820 box and fades out approaching that box's edge —
        see EDGE_BLEED below. The finale stays inside the field at full
        alpha; it's the published 27, always fully legible.
     5. Title case + centred, size-tightened lines: handled inside
        WL.buildWordRecord / WL.drawWord / the d3-cloud-multiline fork this
        bundle vendors (not upstream) — nothing beat-specific here, just a
        product of using this bundle's copy of whirl-layout.js.
   ============================================================================= */
(function () {
  const DATA = window.IDEAS_SCROLL_DATA;
  const SUBTHEMES = DATA.subthemes; // [{ name, color }] — no short/full split in this data contract

  // ---- seeded RNG — same mulberry32 + seed as the sketches and the report's
  // own shipped module, so "deterministic" means the same thing everywhere
  // this data is drawn. -------------------------------------------------------
  function mulberry32(a) {
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const rand = mulberry32(20260826);
  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

  // ---- canvas / field geometry ------------------------------------------------
  // VISIBLE matches the report's own "wide" preset field (1400x820) — chosen
  // for familiarity, not because DATA.keptLayouts is reused: it can't be (see
  // the FINALE_SCALE comment below). EDGE_BLEED only widens the POLL cloud's
  // own layout field; the finale always lays out on VISIBLE at full size.
  const VISIBLE = { width: 1400, height: 820 };
  const EDGE_BLEED = 1.18;
  const POLL_FIELD = { width: Math.round(VISIBLE.width * EDGE_BLEED), height: Math.round(VISIBLE.height * EDGE_BLEED) };
  // The canvas's own coordinate system spans POLL_FIELD (the larger of the
  // two); VISIBLE sits centred inside it, inset by half the bleed margin on
  // each axis. Anything the poll cloud places in that margin is real, valid
  // canvas space — nothing is clipped by the browser. "Spills past the edge
  // and fades" means past VISIBLE's edge (feathered by edgeFeatherAlpha),
  // not past the physical canvas/viewport edge, which sits further out
  // still and is otherwise empty.
  const FINALE_INSET_X = (POLL_FIELD.width - VISIBLE.width) / 2;
  const FINALE_INSET_Y = (POLL_FIELD.height - VISIBLE.height) / 2;
  const CX = POLL_FIELD.width / 2,
    CY = POLL_FIELD.height / 2;

  const canvas = document.getElementById("ideas-scroll-canvas");
  let ctx = canvas.getContext("2d");
  const canvasFit = { scale: 1, offX: 0, offY: 0, dpr: 1 };
  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = { w: window.innerWidth, h: window.innerHeight };
    canvas.width = rect.w * dpr;
    canvas.height = rect.h * dpr;
    canvas.style.width = rect.w + "px";
    canvas.style.height = rect.h + "px";
    canvasFit.dpr = dpr;
    const scale = Math.min(rect.w / POLL_FIELD.width, rect.h / POLL_FIELD.height) * 0.94;
    canvasFit.scale = scale;
    canvasFit.offX = (rect.w - POLL_FIELD.width * scale) / 2;
    canvasFit.offY = (rect.h - POLL_FIELD.height * scale) / 2;
  }
  window.addEventListener("resize", resize);
  resize();

  const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const WL = window.WhirlLayout({ rand, cloud: () => d3.layout.cloud(), measureCtx: ctx });
  const ISL = window.IdeasScrollLayout({ rand, WL });

  // ---- long tail: hide 35% of the count===1 poll ideas, deterministically ---
  const TAIL_DROP = 0.35;
  const tailSample = ISL.sampleTailKept(DATA.poll, TAIL_DROP);
  const pollKept = tailSample.kept;
  console.log(
    `ideas-scroll: dropped ${tailSample.droppedCount} of ${tailSample.totalOnes} single-mention poll ideas ` +
      `(target ${(TAIL_DROP * 100).toFixed(0)}%); ${pollKept.length} of ${DATA.poll.length} poll ideas kept`
  );

  const MAX_COUNT = Math.max(...pollKept.map((c) => c.count));
  const MAX_VOTES = Math.max(...DATA.discussion.map((c) => c.votes));

  // Secondary rank-based fade for the lightest of the KEPT poll words — the
  // report's own shipped module does this (TAIL_MIN/TAIL_POW below match its
  // constants) on top of, not instead of, hiding some of the tail outright.
  // FADE_COUNT is scaled to keep the same PROPORTION of the kept list fading
  // as the shipped module's wide preset (45 of 135 kept = 1/3).
  const TAIL_MIN = 0.06,
    TAIL_POW = 1.6;
  const FADE_COUNT = Math.round(pollKept.length * (45 / 135));
  function tailRankAlpha(rankIndex, total) {
    const fadeStart = total - FADE_COUNT;
    if (FADE_COUNT <= 0 || rankIndex < fadeStart) return 1;
    const t = (rankIndex - fadeStart + 1) / FADE_COUNT;
    return lerp(1, TAIL_MIN, Math.pow(t, TAIL_POW));
  }

  // ---- word records -----------------------------------------------------------
  // pollKept is already sorted descending by count (DATA.poll's own order,
  // undisturbed by sampleTailKept's filter), so array index doubles as rank.
  function buildPollRecords() {
    return pollKept.map((c, i) => {
      const fontSize = ISL.phase1FontSize(c.count, MAX_COUNT);
      const rec = ISL.buildWordRecord(c, i, { fontSize, weight: 400, maxLineWidth: fontSize * 9.5 });
      return Object.assign(rec, { count: c.count, arrivalRand: rand(), tailAlpha: tailRankAlpha(i, pollKept.length) });
    });
  }

  // DATA.keptLayouts (the report's own saved finale arrangement) is NOT used
  // here, deliberately: it was verified non-overlapping under the OLD
  // left-aligned, fixed-1.22-line-height rendering. This fork's centred
  // lines + size-dependent line height (see whirl-layout.js's 2026-09-18
  // header note) move every glyph vertically and, for wrapped labels,
  // horizontally within its line — a real check confirms this: reusing the
  // saved x/y under the new rendering produced 9 overlapping line pairs at
  // full alpha in beat 3 (sketches/wordcloud-verify/ideas_scroll_render_check.js).
  // WL.applySavedFinale's own match check doesn't catch this because it only
  // compares label/lines/fontSize — none of which changed; only how a
  // matching record is DRAWN did. So: always compute fresh here. The engine
  // that lays out and the engine that draws are the same patched pair
  // (d3-cloud-multiline.js's cloudSprite + WL.drawWord), which is what
  // actually keeps this guarantee — a stale saved layout was never part of
  // that guarantee, just a cache of one prior, now-invalidated run of it.
  const FINALE_SCALE = 1.3;
  function buildDiscussionRecords(scale) {
    return DATA.discussion.map((c, i) => {
      const fontSize = ISL.phase2FontSize(c.votes, MAX_VOTES, scale);
      const rec = ISL.buildWordRecord(c, i, { fontSize, weight: 700, maxLineWidth: fontSize * 11, maxLineHeightHint: 6 });
      return Object.assign(rec, { votes: c.votes });
    });
  }

  let wordsPoll = buildPollRecords();
  let wordsDiscussion = buildDiscussionRecords(FINALE_SCALE);
  // per-word stagger across beat 1's 0-0.45 arrival window
  wordsPoll.forEach((w) => {
    w._arrivalDelay = w.arrivalRand * 0.75;
  });

  // ---- beat-1 arrival ring, around the measured copy plate --------------------
  // Measured once fonts + layout are settled (ensureFontsLoaded gates this —
  // see boot() at the bottom); converts the plate's on-screen (viewport) size
  // into field units by dividing out canvasFit.scale, since ring geometry is
  // computed in the same field-pixel space the cloud itself is laid out in.
  function measurePlateFieldRect(selector) {
    const el = document.querySelector(selector);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { width: r.width / canvasFit.scale, height: r.height / canvasFit.scale };
  }

  // ---- subtheme dissolve ring (beat 2 target) — unchanged from the sketch ---
  const GOLDEN_ANGLE = 2.399963229728653;
  const ringRX = (POLL_FIELD.width / 2) * 0.62;
  const ringRY = (POLL_FIELD.height / 2) * 0.62;
  const SUBTHEME_ANCHOR = SUBTHEMES.map((s, i) => {
    const angle = i * GOLDEN_ANGLE;
    return [CX + Math.cos(angle) * ringRX, CY + Math.sin(angle) * ringRY * 0.68];
  });

  // ---- d3-cloud runs ------------------------------------------------------------
  function layoutCloudFitted(items, opts) {
    let mult = 1;
    for (let k = 0; k < 12; k++, mult *= 0.96) {
      if (k > 0)
        items.forEach((w) => {
          w.fontSize = ISL.phase1FontSize(w.count, MAX_COUNT) * mult;
          w.lines = WL.wrapTwoLines(w.label, w.fontSize, 400, w.fontSize * 9.5);
          w.lineHeight = w.fontSize * WL.lineHeightFactor(w.fontSize);
          w.w = Math.max(...w.lines.map((l) => WL.textWidth(l, w.fontSize, 400))) + 6;
          w.h = w.lines.length * w.lineHeight + 4;
          delete w.sprite;
          delete w.x;
          delete w.y;
        });
      const placed = WL.layoutWithD3Cloud(items, opts);
      if (placed.length === items.length) {
        if (k > 0) console.log(`ideas-scroll: poll cloud needed a uniform ${mult.toFixed(3)}x to place all ${items.length}`);
        return placed;
      }
    }
    return WL.layoutWithD3Cloud(items, opts);
  }

  /** Returns { items, placed }: `items` is the FULL word-record array the
   * layout actually ran against (the one passed in, on the first-try path;
   * a freshly-rebuilt array on any shrink-and-retry path), `placed` the
   * subset that fit. Callers MUST use the returned `items`, not the one
   * they passed in — a retry rebuilds brand-new record objects at a smaller
   * font size (buildDiscussionRecords returns new objects, it doesn't
   * mutate in place), so `placed`'s members are never `===` any object in
   * the caller's original array once a retry has happened; checking
   * membership against the stale array would read every word as dropped.
   * No saved/kept layout path — see FINALE_SCALE's comment for why. */
  function layoutFinale(initialItems, opts) {
    let items = initialItems;
    let mult = 1;
    // 30 iterations of a 0.96 shrink, not the sketch's 10: this field
    // (1400x820) is under half the AREA of the original whirl's shared
    // field (2340x1140-ish), which is why the sketch's finale never needed
    // much shrinking at its 10-try budget. A real run here needed roughly
    // a 0.64x multiplier to place all 27 with zero drops (0.96^k = 0.64 at
    // k≈11) — 30 leaves a wide margin rather than re-tuning a magic number
    // for one field size.
    for (let k = 0; k < 30; k++, mult *= 0.96) {
      if (k > 0) items = buildDiscussionRecords(FINALE_SCALE * mult);
      let placed = WL.layoutFinaleBalanced(items, opts);
      if (placed.length === items.length) {
        if (k > 0) console.log(`ideas-scroll finale: needed a uniform ${mult.toFixed(3)}x to place all 27 (balanced)`);
        return { items, placed };
      }
      items.forEach((w) => {
        delete w.sprite;
        delete w.x;
        delete w.y;
      });
      placed = WL.layoutWithD3Cloud(items, opts);
      if (placed.length === items.length) {
        console.log(`ideas-scroll finale: balanced selection dropped labels at ${mult.toFixed(3)}x; using plain d3-cloud seeding`);
        return { items, placed };
      }
    }
    return { items, placed: WL.layoutWithD3Cloud(items, opts) };
  }

  let cloudHome = null; // [[x,y], ...] aligned to wordsPoll — the beat-1 ring start
  let cloudTarget = null; // the settled poll-cloud position
  let finalePos = null; // the settled finale position
  const finaleDelay = wordsDiscussion.map((w, i) => (i / wordsDiscussion.length) * 0.6 + rand() * 0.25);

  async function layoutWordClouds() {
    const [cloudPlaced, finaleResult] = await Promise.all([
      layoutCloudFitted(wordsPoll, { width: POLL_FIELD.width, height: POLL_FIELD.height, padding: 2, weight: 400 }),
      layoutFinale(wordsDiscussion, { width: VISIBLE.width, height: VISIBLE.height, padding: 2, weight: 700 }),
    ]);
    wordsDiscussion = finaleResult.items; // see layoutFinale's own comment — must use its returned items, not the array passed in
    const finalePlaced = finaleResult.placed;
    const cloudPlacedSet = new Set(cloudPlaced);
    const finalePlacedSet = new Set(finalePlaced);
    cloudTarget = wordsPoll.map((w) => (cloudPlacedSet.has(w) ? [w.x + POLL_FIELD.width / 2, w.y + POLL_FIELD.height / 2] : null));
    finalePos = wordsDiscussion.map((w) =>
      finalePlacedSet.has(w) ? [w.x + VISIBLE.width / 2 + FINALE_INSET_X, w.y + VISIBLE.height / 2 + FINALE_INSET_Y] : null
    );

    // Ring seeding happens AFTER the poll cloud settles: heavier words seed
    // nearer the ring's inner edge (see ringHomePositions), and "heavier"
    // there is read off each word's fontSize, which the fitted layout above
    // may have shrunk uniformly — using the post-layout fontSize keeps the
    // weighting consistent with what's actually drawn.
    const plateRect = measurePlateFieldRect("#narrative-wrapper-1 .narrative-copy") || { width: 0, height: 0 };
    cloudHome = ISL.ringHomePositions(wordsPoll, POLL_FIELD, plateRect);

    // Feather alpha is fixed per word at its SETTLED position — words never
    // move after arriving (see the sketch's "no ambient wobble" note this
    // fork keeps), so this is one value, not something recomputed per frame.
    wordsPoll.forEach((w, i) => {
      w.featherAlpha = cloudTarget[i] ? ISL.edgeFeatherAlpha(cloudTarget[i][0], cloudTarget[i][1], VISIBLE, POLL_FIELD) : 0;
    });

    devAssertions(
      wordsPoll.length - cloudPlaced.length,
      wordsDiscussion.length - finalePlaced.length
    );
  }

  // =============================================================================
  // Dev assertions — same checks as the sketches: nothing dropped, all
  // positions distinct, finale subthemes interleaved not clustered.
  // =============================================================================
  function devAssertions(cloudDropped, finaleDropped) {
    function distinctPositions(list) {
      const seen = new Set();
      const pts = list.filter(Boolean);
      for (const p of pts) seen.add(p[0].toFixed(1) + "," + p[1].toFixed(1));
      return seen.size === pts.length;
    }
    console.assert(distinctPositions(cloudTarget), "poll cloud: all kept words settle at distinct positions");
    console.assert(distinctPositions(finalePos), "finale: all 27 at distinct positions");
    console.assert(cloudDropped === 0, `poll cloud: expected 0 dropped labels, found ${cloudDropped}`);
    console.assert(finaleDropped === 0, `finale: expected 0 dropped labels, found ${finaleDropped}`);
    console.log(`ideas-scroll dev check: poll cloud dropped=${cloudDropped} of ${wordsPoll.length}, finale dropped=${finaleDropped} of ${wordsDiscussion.length}`);

    function nearestDist(i, sameSubOnly) {
      let best = Infinity;
      for (let j = 0; j < finalePos.length; j++) {
        if (j === i || !finalePos[j] || !finalePos[i]) continue;
        if (sameSubOnly && wordsDiscussion[j].subtheme !== wordsDiscussion[i].subtheme) continue;
        if (!sameSubOnly && wordsDiscussion[j].subtheme === wordsDiscussion[i].subtheme) continue;
        const dx = finalePos[j][0] - finalePos[i][0],
          dy = finalePos[j][1] - finalePos[i][1];
        best = Math.min(best, Math.hypot(dx, dy));
      }
      return Number.isFinite(best) ? best : null;
    }
    const sameVals = [],
      crossVals = [];
    wordsDiscussion.forEach((w, i) => {
      const s = nearestDist(i, true);
      if (s !== null) sameVals.push(s);
      const c = nearestDist(i, false);
      if (c !== null) crossVals.push(c);
    });
    const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
    if (sameVals.length && crossVals.length) {
      console.log(`ideas-scroll dev check: same-subtheme nearest avg=${avg(sameVals).toFixed(1)}px, cross-subtheme=${avg(crossVals).toFixed(1)}px`);
    }
  }

  // =============================================================================
  // Beat state + rendering
  // =============================================================================
  let clock = 0;
  let step1 = 0,
    step2 = 0;
  let activeStep = 0;
  let scrollBack = false;
  const completed = [false, false, false, false];
  function beatProgress(rawT) {
    return scrollBack ? 1 : rawT;
  }

  function drawWord(text_lines, x, y, fontSize, weight, color, alpha, scale) {
    WL.drawWord(ctx, text_lines, x, y, fontSize, weight, color, alpha, scale);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
  }

  const hitTargets = [];

  function render() {
    ctx.save();
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.setTransform(canvasFit.scale * canvasFit.dpr, 0, 0, canvasFit.scale * canvasFit.dpr, 0, 0);
    ctx.translate(canvasFit.offX / canvasFit.scale, canvasFit.offY / canvasFit.scale);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    hitTargets.length = 0;

    if (activeStep === 1) drawBeat1();
    else if (activeStep === 2) drawBeat2();
    else if (activeStep >= 3) drawBeat3();

    ctx.restore();
  }

  function drawBeat1() {
    const t = beatProgress(step1);
    const arrive = (w) => ease(clamp01((t - w._arrivalDelay * 0.6 - 0.02) / 0.5));
    wordsPoll.forEach((w, idx) => {
      if (!cloudTarget[idx] || !cloudHome[idx]) return;
      const a = arrive(w);
      if (a <= 0.01) return;
      const k = ease(a);
      const x = lerp(cloudHome[idx][0], cloudTarget[idx][0], k);
      const y = lerp(cloudHome[idx][1], cloudTarget[idx][1], k);
      const alpha = a * (w.featherAlpha != null ? w.featherAlpha : 1) * w.tailAlpha;
      drawWord(w.lines, x, y, w.fontSize, 400, SUBTHEMES[w.subtheme].color, alpha);
    });
  }

  function drawBeat2() {
    const t = beatProgress(step2);
    const dissolveT = clamp01(t / 0.85);
    const dEase = ease(dissolveT);
    wordsPoll.forEach((w, idx) => {
      const startPos = cloudTarget[idx];
      if (!startPos) return;
      const anchor = SUBTHEME_ANCHOR[w.subtheme];
      const x = lerp(startPos[0], anchor[0], dEase);
      const y = lerp(startPos[1], anchor[1], dEase);
      const scale = lerp(1, 0.12, dEase);
      const alpha = (1 - Math.pow(dissolveT, 2.4)) * (w.featherAlpha != null ? w.featherAlpha : 1) * w.tailAlpha;
      if (alpha > 0.01) drawWord(w.lines, x, y, w.fontSize, 400, SUBTHEMES[w.subtheme].color, alpha * 0.85, scale);
    });
    const f = clamp01((t - 0.55) / 0.45);
    wordsDiscussion.forEach((w, idx) => {
      if (!finalePos[idx]) return;
      const a = ease(clamp01((f - finaleDelay[idx] * 0.5) / 0.5));
      if (a <= 0.01) return;
      const scale = lerp(0.55, 1, a);
      const [x, y] = finalePos[idx];
      drawWord(w.lines, x, y, w.fontSize, 700, SUBTHEMES[w.subtheme].color, a, scale);
    });
  }

  function drawBeat3() {
    wordsDiscussion.forEach((w, idx) => {
      if (!finalePos[idx]) return;
      const [x, y] = finalePos[idx];
      drawWord(w.lines, x, y, w.fontSize, 700, SUBTHEMES[w.subtheme].color, 1);
      hitTargets.push({ x, y, w: w.w, h: w.h, word: w });
    });
  }

  // ---- hover (finale beat only) ------------------------------------------------
  const tooltipEl = document.getElementById("ideas-scroll-tooltip");
  document.addEventListener("mousemove", (e) => {
    if (activeStep < 3) {
      tooltipEl.classList.remove("visible");
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left - canvasFit.offX) / canvasFit.scale;
    const my = (e.clientY - rect.top - canvasFit.offY) / canvasFit.scale;
    const hit = hitTargets.find((h) => mx > h.x - h.w / 2 && mx < h.x + h.w / 2 && my > h.y - h.h / 2 && my < h.y + h.h / 2);
    if (hit) {
      const s = SUBTHEMES[hit.word.subtheme];
      // No `.sessions` field in this data contract (unlike the sketch's
      // whirl-data.js) — votes only.
      tooltipEl.innerHTML = `<b>${hit.word.label}</b>${hit.word.votes} votes<div class="sub">${s.name}</div>`;
      tooltipEl.style.left = e.clientX + "px";
      tooltipEl.style.top = e.clientY - 14 + "px";
      tooltipEl.classList.add("visible");
    } else {
      tooltipEl.classList.remove("visible");
    }
  });

  // ---- legend / caption ---------------------------------------------------------
  const legendEl = document.getElementById("ideas-scroll-legend");
  legendEl.innerHTML = SUBTHEMES.map((s) => `<span class="item"><span class="swatch" style="background:${s.color}"></span>${s.name}</span>`).join("");
  const captionEl = document.getElementById("ideas-scroll-caption");
  function setActiveStep(n) {
    activeStep = n;
    legendEl.classList.toggle("visible", n >= 1);
    captionEl.classList.toggle("visible", n >= 3);
  }

  // =============================================================================
  // Scroll wiring — unchanged from policy-ideas-whirl-v1.html (Lenis + GSAP
  // ScrollTrigger, three pinned beats, scrollBack freeze on re-entry). See
  // that file's own header comment for the fuller rationale; nothing about
  // this variant's own six changes touches scroll mechanics.
  // =============================================================================
  function boot() {
    if (REDUCED) {
      bootReduced();
      return;
    }
    gsap.registerPlugin(ScrollTrigger);
    ScrollTrigger.normalizeScroll(true);
    const lenis = new Lenis({ duration: 1.6, easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)) });
    function raf(time) {
      lenis.raf(time);
      requestAnimationFrame(raf);
    }
    requestAnimationFrame(raf);
    ScrollTrigger.scrollerProxy(document.body, {
      scrollTop(value) {
        return arguments.length ? lenis.scrollTo(value) : window.scrollY;
      },
      getBoundingClientRect() {
        return { top: 0, left: 0, width: innerWidth, height: innerHeight };
      },
      pinType: document.body.style.transform ? "transform" : "fixed",
    });

    let hideTimer = null;
    function showCanvas() {
      if (hideTimer) {
        clearTimeout(hideTimer);
        hideTimer = null;
      }
      canvas.style.opacity = 1;
    }
    function hideCanvas() {
      canvas.style.opacity = 0;
    }
    function hideCanvasSoon() {
      if (hideTimer) clearTimeout(hideTimer);
      hideTimer = setTimeout(() => {
        hideTimer = null;
        hideCanvas();
      }, 180);
    }

    const PIN_EXTEND = 1800;
    const SCRUB = 1.4;
    gsap.to(
      {},
      {
        scrollTrigger: {
          trigger: "#narrative-wrapper-1",
          start: "center center+=70",
          end: `+=${PIN_EXTEND}`,
          scrub: SCRUB,
          pin: true,
          anticipatePin: true,
          onUpdate(self) {
            setActiveStep(1);
            step1 = self.progress;
            if (step1 >= 1) completed[1] = true;
            render();
          },
          onEnter() {
            scrollBack = false;
            showCanvas();
            setActiveStep(1);
          },
          onLeave() {
            scrollBack = false;
            completed[1] = true;
          },
          onEnterBack() {
            scrollBack = completed[1];
            showCanvas();
            setActiveStep(1);
          },
          onLeaveBack() {
            scrollBack = completed[1];
            hideCanvasSoon();
          },
        },
      }
    );

    gsap.to(
      {},
      {
        scrollTrigger: {
          trigger: "#narrative-wrapper-2",
          start: "center center+=70",
          end: `+=${PIN_EXTEND}`,
          scrub: SCRUB,
          pin: true,
          anticipatePin: true,
          onUpdate(self) {
            setActiveStep(2);
            step2 = self.progress;
            if (step2 >= 1) completed[2] = true;
            render();
          },
          onEnter() {
            scrollBack = false;
            setActiveStep(2);
          },
          onLeave() {
            scrollBack = false;
            completed[2] = true;
          },
          onEnterBack() {
            scrollBack = completed[2];
            setActiveStep(2);
          },
          onLeaveBack() {
            scrollBack = completed[2];
          },
        },
      }
    );

    gsap.to(
      {},
      {
        scrollTrigger: {
          trigger: "#narrative-wrapper-3",
          start: "center center+=70",
          end: `+=${PIN_EXTEND}`,
          scrub: true,
          pin: false,
          onUpdate() {
            setActiveStep(3);
            render();
          },
          onEnter() {
            scrollBack = false;
            setActiveStep(3);
            completed[3] = true;
            render();
          },
          onLeave() {
            scrollBack = false;
            completed[3] = true;
          },
          onEnterBack() {
            scrollBack = completed[3];
            setActiveStep(3);
            render();
          },
          onLeaveBack() {
            scrollBack = completed[3];
          },
        },
      }
    );

    ["#narrative-wrapper-1", "#narrative-wrapper-2"].forEach((sel) => {
      const copy = document.querySelector(sel + " .narrative-copy");
      gsap.to(
        {},
        {
          scrollTrigger: {
            trigger: sel,
            start: "top bottom",
            end: "bottom top",
            scrub: true,
            onUpdate(self) {
              const t = self.progress;
              let o;
              if (t < 0.5) o = clamp01((t - 0) / 0.3);
              else o = clamp01(1 - (t - 0.7) / 0.3);
              copy.style.opacity = Math.max(0.06, o).toFixed(3);
            },
          },
        }
      );
    });

    let lastTime = performance.now();
    function tick(now) {
      const dt = (now - lastTime) / 1000;
      lastTime = now;
      clock += dt;
      if (activeStep >= 1) render();
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  function bootReduced() {
    document.querySelectorAll(".narrative-copy").forEach((el) => (el.style.opacity = 1));
    canvas.style.display = "none";
    const savedCtx = ctx;
    const savedFit = { ...canvasFit };
    document.querySelectorAll(".narrative-wrapper").forEach((el, i) => {
      const mini = document.createElement("canvas");
      mini.className = "ideas-scroll-static";
      mini.width = POLL_FIELD.width;
      mini.height = POLL_FIELD.height;
      el.style.height = "auto";
      el.appendChild(mini);

      ctx = mini.getContext("2d");
      canvasFit.scale = 1;
      canvasFit.offX = 0;
      canvasFit.offY = 0;
      canvasFit.dpr = 1;
      step1 = 1;
      step2 = 1;
      setActiveStep(i + 1);
      render();
    });
    ctx = savedCtx;
    Object.assign(canvasFit, savedFit);
    setActiveStep(3);
  }

  async function ensureFontsLoaded() {
    if (!document.fonts) return;
    await Promise.all([document.fonts.load("400 16px 'Noto Sans', Arial, sans-serif"), document.fonts.load("700 16px 'Noto Sans', Arial, sans-serif")]);
    await document.fonts.ready;
  }

  ensureFontsLoaded().then(layoutWordClouds).then(boot);
})();
