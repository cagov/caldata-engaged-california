/**
 * Canvas draw loop + DOM wiring for the "Who participated" participant-
 * funnel sketch. funnel-layout.js decides every position/color/number;
 * this file only draws what that module computes and drives the animation
 * clock — same pure-lib/render-loop split as the source Svelte component
 * (viz/src/components/ParticipantFunnelSelection.svelte in the main
 * EngagedCA/AI_Deliberations repo).
 *
 * Ported from Svelte 5 runes ($state/$derived/$effect) to plain mutable
 * variables — the animation already runs one requestAnimationFrame loop
 * (frame(), below) that reads and writes all of them each tick, so no
 * reactivity library is needed; DOM writes are simply guarded so they only
 * happen when the value driving them actually changed.
 */
(function () {
  "use strict";

  var FL = FunnelLayout;
  var data = FUNNEL_DATA;

  // -----------------------------------------------------------------------
  // DOM references
  // -----------------------------------------------------------------------
  var canvas = document.getElementById("funnel-canvas");
  var ctx = null;

  var headingEl = document.getElementById("heading");
  var phaseEl = document.getElementById("stage-phase");
  var titleEl = document.getElementById("stage-title");
  var subTextEl = document.getElementById("stage-sub-text");
  var infoIconEl = document.getElementById("info-icon");
  var infoTooltipEl = document.getElementById("info-tooltip");
  var stageCopyEl = document.getElementById("stage-copy");
  var statColEl = document.getElementById("stat-col");
  var statIconPeopleEl = document.getElementById("stat-icon-people");
  var statIconChatsEl = document.getElementById("stat-icon-chats");
  var statValueEl = document.getElementById("stat-value");
  var statCaptionEl = document.getElementById("stat-caption");

  var dimensionToggleEl = document.getElementById("dimension-toggle");
  var dimensionButtons = Array.prototype.slice.call(document.querySelectorAll("[data-dimension]"));
  var motionButtons = Array.prototype.slice.call(document.querySelectorAll("[data-motion]"));
  var playBtn = document.getElementById("play");
  var restartBtn = document.getElementById("restart");
  var loopBtn = document.getElementById("loop");
  var pillsEl = document.getElementById("stage-pills");
  var hintEl = document.getElementById("hint");

  // -----------------------------------------------------------------------
  // Selection info tooltip body — always ends on the export's own sample
  // caveat, so a claim broader than the raw survey sample is never left
  // unqualified even in comms-styled copy.
  // -----------------------------------------------------------------------
  var selectionInfoText =
    "Selection weighed factors like region, field of work, and other demographics to build a group broadly " +
    "representative of respondents — not a random sample of every survey taker. " +
    data.meta.sampleCaveat;
  infoTooltipEl.textContent = selectionInfoText;

  // -----------------------------------------------------------------------
  // Layout — computed once at load. `data` never changes at runtime, so
  // unlike the source component this has no reactive dependency to track.
  // -----------------------------------------------------------------------
  var layout = FL.buildFunnelCloud(data);
  var stages = FL.buildSelectionStages(data);
  var LAST_STAGE = FL.SELECTION_STAGE_COUNT - 1;

  pillsEl.innerHTML = "";
  var pillButtons = stages.map(function (s, i) {
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ec-button pill";
    btn.textContent = s.pill;
    btn.addEventListener("click", function () {
      jumpTo(i);
    });
    pillsEl.appendChild(btn);
    return btn;
  });

  var dimension = "region"; // "region" | "fieldOfWork"
  var motion = "orbit"; // "orbit" | "pulse"

  var categories, categoryColors, colorOf;
  function recolor() {
    categories = dimension === "region" ? data.regions : data.fieldOfWork;
    categoryColors = FL.assignCategoryColors(
      categories.map(function (c) {
        return c.name;
      }),
    );
    colorOf = {};
    categories.forEach(function (c, i) {
      colorOf[c.name] = categoryColors[i];
    });
  }
  recolor();

  // -----------------------------------------------------------------------
  // EC design-system colors — resolved from the CSS custom properties in
  // ec-tokens.css, not hardcoded a second time here. Canvas draw calls can't
  // read var(--…) directly, so this is the one place that gap gets bridged
  // (see readEcTokens below), seeded with the light-theme values as a
  // pre-paint fallback and refreshed by watchEcTokens. Only the 5 tokens
  // this sketch's canvas draw calls actually use are ported — the source's
  // ecCanvasTokens.ts resolves 9, but no ring outline or badge draws here.
  // -----------------------------------------------------------------------
  var ecTokens = {
    surface: "#ffffff",
    onSurface: "#1c2745",
    onSurfaceMuted: "#444444",
    nondata: "#3b3a48",
    dropped: "#d3d3d3",
  };
  var TOKEN_VARS = {
    surface: "--ec-surface",
    onSurface: "--ec-on-surface",
    onSurfaceMuted: "--ec-on-surface-muted",
    nondata: "--ec-nondata",
    dropped: "--ec-dropped",
  };

  /**
   * Deliberately NOT getComputedStyle(el).getPropertyValue('--ec-…') — every
   * semantic token in ec-tokens.css is itself defined as var(--ec-navy) etc,
   * and per the CSS Custom Properties spec, reading a custom property
   * directly returns its specified token stream, not a var()-substituted
   * value: getPropertyValue on a chained custom property gives back the
   * literal string "var(--ec-navy)", not "#1c2745". Substitution only
   * happens when a *standard* property (color, …) is computed. So this
   * assigns each token to a detached probe element's `color` and reads that
   * back instead, which the browser fully resolves down to an rgb() string.
   */
  function readEcTokens(el) {
    var probe = document.createElement("span");
    probe.style.position = "fixed";
    probe.style.visibility = "hidden";
    probe.style.pointerEvents = "none";
    (el.parentElement || document.body).appendChild(probe);
    var out = {};
    Object.keys(TOKEN_VARS).forEach(function (key) {
      probe.style.color = "var(" + TOKEN_VARS[key] + ")";
      out[key] = getComputedStyle(probe).color;
    });
    probe.remove();
    return out;
  }

  function watchEcTokens(el, cb) {
    function fire() {
      cb(readEcTokens(el));
    }
    fire();
    var media = matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", fire);
    var observer = new MutationObserver(fire);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return function () {
      media.removeEventListener("change", fire);
      observer.disconnect();
    };
  }

  // -----------------------------------------------------------------------
  // Viewport trim — the header's copy used to be drawn onto the canvas
  // itself (ctx.fillText); it's now real DOM above the canvas, so the
  // canvas element is shrunk by TOP_TRIM (see resize()) rather than left
  // with an empty band. Every draw call below keeps its original absolute
  // canvas-space coordinates (CLOUD_Y/GATHER_Y/CY, categoryLegend's
  // CANVAS.H - 58, …) — resize()'s transform shifts the *visible* window
  // over that same coordinate space instead of moving the coordinates
  // themselves.
  // -----------------------------------------------------------------------
  var TOP_TRIM = 120;
  // The bottom edge is trimmed too, reclaiming the dead space below the
  // category legend once every stage got vertically centered. Tuned to the
  // conversation ring's own size, not derived.
  var BOTTOM_TRIM = 56;
  var VIEW_TOP = TOP_TRIM;
  var VIEW_BOTTOM = FL.CANVAS.H - BOTTOM_TRIM;
  var VIEW_H = VIEW_BOTTOM - VIEW_TOP;
  // Bottom band reserved for the Participant/Facilitator key plus up to 2
  // category-legend rows — dot content centers above this band, not across
  // the whole viewport.
  var BAND_H = 100;
  var DOT_TOP = VIEW_TOP + 6;
  var DOT_BOTTOM = VIEW_BOTTOM - BAND_H;

  canvas.width = FL.CANVAS.W;
  canvas.height = VIEW_H;

  // Per-stage vertical offset that puts every stage's dot content (cloud,
  // gather, ring) on the same center line within [DOT_TOP, DOT_BOTTOM].
  var bands = FL.selectionStageBands(layout);
  var yShift = FL.selectionYShift(bands, DOT_TOP, DOT_BOTTOM);

  var DWELL_MS = 1900;
  var TRANSITION_MS = 2600;
  var ORBIT_SPEED = 0.2;
  var DRIFT_SPEED = 0.3;
  var TITLE_EASE_MS = 900;

  var renders = [];
  var clock = 0;
  var stage = 0;
  // Stays false while dots are still migrating into the final stage's ring,
  // so the ring-center title only fades in once they've actually landed.
  var ringReady = false;
  var prevStage = 0;
  var t = 1;
  var playing = true;
  var looping = true;
  var dwellLeft = DWELL_MS;
  var reduced = false;
  var rafId = 0;
  var lastTime = 0;
  // Eased 0-1 visibility of the ring-center headcount title.
  var titleK = 0;

  // The DOM header's own crossfade state, updated once a frame.
  var headerOpacity = 1;
  var headerStageIndex = -1; // -1 forces the first paint

  // Built once, not per frame — Path2D is immutable and every dot stamp
  // reuses this same instance under its own ctx.translate/scale.
  var PERSON = new Path2D(FL.PERSON_PATH);

  var WORD_FONT = "'Noto Sans', Arial, sans-serif";

  // Accepts both a literal "#rrggbb" (palette hex hues) and a resolved
  // "rgb(r, g, b)" string (the token bridge above).
  function toRGB(color) {
    if (color.charAt(0) === "#") {
      return [parseInt(color.slice(1, 3), 16), parseInt(color.slice(3, 5), 16), parseInt(color.slice(5, 7), 16)];
    }
    var m = color.match(/[\d.]+/g);
    return m ? [Number(m[0]), Number(m[1]), Number(m[2])] : [0, 0, 0];
  }
  var rgbCache = {};
  function rgb(color) {
    var v = rgbCache[color];
    if (!v) {
      v = toRGB(color);
      rgbCache[color] = v;
    }
    return v;
  }
  function lerp(a, b, k) {
    return a + (b - a) * k;
  }
  function mixColor(a, b, k) {
    return [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];
  }
  function css(c) {
    return "rgb(" + (c[0] | 0) + "," + (c[1] | 0) + "," + (c[2] | 0) + ")";
  }
  function easeInOut(x) {
    return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
  }

  function colorFor(categoryKey) {
    if (categoryKey === "__dropped") return rgb(ecTokens.dropped);
    return rgb(colorOf[categoryKey] || FL.DATA_VIZ_NEUTRAL_LIGHT);
  }

  // Stamps the shared PERSON path centered at (cx, cy), scaled so its own
  // height (PERSON_BOX.h) becomes `height` canvas px.
  function stampPerson(cx, cy, height) {
    if (!ctx) return;
    var s = height / FL.PERSON_BOX.h;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(s, s);
    ctx.translate(-FL.PERSON_BOX.cx, -FL.PERSON_BOX.cy);
    ctx.fill(PERSON);
    ctx.restore();
  }

  function targetFor(dot, sectionStage) {
    var g = FL.dotTarget(dot, sectionStage, dimension, layout.clusters, clock, DRIFT_SPEED, ORBIT_SPEED, motion);
    var dy = yShift[sectionStage] || 0;
    if (!dy) return g;
    var shifted = {};
    for (var k in g) shifted[k] = g[k];
    shifted.y = g.y + dy;
    if (g.viaY !== undefined) shifted.viaY = g.viaY + dy;
    return shifted;
  }

  function resetRenders() {
    renders = layout.dots.map(function (dot) {
      var g = targetFor(dot, stage);
      var c = colorFor(g.categoryKey);
      var p = g.person ? 1 : 0;
      return { pos: [g.x, g.y], from: [g.x, g.y], alpha: g.alpha, aFrom: g.alpha, r: g.r, rFrom: g.r, cNow: c, cFrom: c, delay: 0, person: p, pFrom: p };
    });
  }

  function place(render, g, lt) {
    if (g.viaX !== undefined && g.viaY !== undefined) {
      var u = 1 - lt;
      render.pos[0] = u * u * render.from[0] + 2 * u * lt * g.viaX + lt * lt * g.x;
      render.pos[1] = u * u * render.from[1] + 2 * u * lt * g.viaY + lt * lt * g.y;
    } else {
      render.pos[0] = lerp(render.from[0], g.x, lt);
      render.pos[1] = lerp(render.from[1], g.y, lt);
    }
  }

  var ringBottomY, legendTopY, keyRowY, dimensionTogglePct;

  function goTo(nextStage) {
    if (nextStage === stage && t >= 1) return;
    prevStage = stage;
    stage = nextStage;
    // The final stage holds indefinitely (see dwellFor) regardless of Loop,
    // but switch the toggle off on arrival so it doesn't keep promising a
    // loop that dwellFor's Infinity will never trigger.
    if (nextStage === LAST_STAGE) {
      looping = false;
      syncLoopButton();
    }
    t = reduced ? 1 : 0;
    ringReady = nextStage === LAST_STAGE && reduced;
    layout.dots.forEach(function (dot, i) {
      var r = renders[i];
      r.from = [r.pos[0], r.pos[1]];
      r.aFrom = r.alpha;
      r.rFrom = r.r;
      r.cFrom = r.cNow;
      r.pFrom = r.person;
      r.delay = (dot.kept ? 0 : 0.1) + Math.random() * (dot.kept ? 0.22 : 0.3);
    });
    if (reduced) snapValues();
    syncPills();
  }

  function snapValues() {
    layout.dots.forEach(function (dot, i) {
      var g = targetFor(dot, stage);
      var r = renders[i];
      r.pos = [g.x, g.y];
      r.alpha = g.alpha;
      r.r = g.r;
      r.cNow = colorFor(g.categoryKey);
      r.person = g.person ? 1 : 0;
    });
  }

  // The final "Conversations" stage holds forever once reached — clock and
  // orbit keep running (dwellLeft just never reaches 0), but auto-advance
  // and looping both stop there so the ring settles and the "scroll down"
  // prompt stays put.
  function dwellFor(s) {
    return s === LAST_STAGE ? Infinity : DWELL_MS;
  }

  function facilitators() {
    if (!ctx) return;
    var vis = stage === LAST_STAGE ? easeInOut(Math.max(0, (t - 0.45) / 0.55)) : 0;
    if (vis <= 0.01) return;

    var ringShift = yShift[LAST_STAGE] || 0;
    layout.clusters.forEach(function (cl) {
      var cy = cl.y + ringShift;
      ctx.globalAlpha = vis;
      ctx.beginPath();
      ctx.arc(cl.x, cy, 11, 0, Math.PI * 2);
      ctx.fillStyle = ecTokens.surface;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(cl.x, cy, 7.5, 0, Math.PI * 2);
      ctx.fillStyle = ecTokens.nondata;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(cl.x, cy, 3, 0, Math.PI * 2);
      ctx.fillStyle = ecTokens.surface;
      ctx.fill();
    });
    ctx.lineWidth = 1;

    // The Participant/Facilitator key — centered as one unit. Measure the
    // wider label first so the whole row (dot + gap + label + donut + gap +
    // label) can be centered together.
    ctx.globalAlpha = vis;
    ctx.font = "400 14px " + WORD_FONT; // DS --ec-text-caption
    var facilitatorWidth = ctx.measureText("Facilitator").width;
    var rowWidth = 125 + facilitatorWidth;
    var lx = (FL.CANVAS.W - rowWidth) / 2 + 5;
    var ly = keyRowY;

    ctx.fillStyle = ecTokens.onSurfaceMuted;
    ctx.beginPath();
    ctx.arc(lx, ly, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(lx + 108, ly, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(lx + 108, ly, 2.8, 0, Math.PI * 2);
    ctx.fillStyle = ecTokens.surface;
    ctx.fill();
    ctx.fillStyle = ecTokens.onSurfaceMuted;

    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText("Participant", lx + 12, ly);
    ctx.fillText("Facilitator", lx + 120, ly);

    ctx.globalAlpha = 1;
    ctx.textBaseline = "alphabetic";
  }

  function curtainCenterLabel() {
    if (!ctx || titleK <= 0.01) return;
    var maxClusterRc = Math.max.apply(
      null,
      layout.clusters.map(function (c) {
        return c.rc;
      }),
    );
    if (!isFinite(maxClusterRc)) maxClusterRc = 0;
    var freeRadius = Math.max(60, layout.ringRadius - maxClusterRc - 10);
    var maxWidth = freeRadius * 1.7;
    var lineHeight = 22;
    var gap = 6;

    var countLines = FL.wrapLabel(FL.fmt(layout.keptTotal) + " people in " + FL.fmt(layout.clusters.length) + " conversations", maxWidth, 8.9).slice(0, 2);
    var promptLines = FL.wrapLabel("Scroll down to see the power of the discussions", maxWidth, 7.8).slice(0, 2);
    var totalHeight = countLines.length * lineHeight + gap + promptLines.length * lineHeight;

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    var ringCenterY = FL.CY + (yShift[LAST_STAGE] || 0);
    var y = ringCenterY - totalHeight / 2 + lineHeight / 2;

    ctx.globalAlpha = titleK;
    ctx.font = "700 16px " + WORD_FONT;
    ctx.fillStyle = ecTokens.onSurface;
    countLines.forEach(function (line) {
      ctx.fillText(line, FL.CX, y);
      y += lineHeight;
    });

    y += gap;
    ctx.font = "400 14px " + WORD_FONT;
    ctx.fillStyle = ecTokens.onSurfaceMuted;
    promptLines.forEach(function (line) {
      ctx.fillText(line, FL.CX, y);
      y += lineHeight;
    });

    ctx.globalAlpha = 1;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
  }

  function categoryLegend() {
    if (!ctx) return;
    ctx.font = "400 14px " + WORD_FONT; // DS --ec-text-caption
    ctx.textBaseline = "middle";
    var SW = 9,
      GAP = 7,
      PAD = 22;
    var w = categories.map(function (c) {
      return SW + GAP + ctx.measureText(c.name).width + PAD;
    });

    var total = w.reduce(function (a, b) {
      return a + b;
    }, 0);
    var nRows = Math.max(1, Math.ceil(total / (FL.CANVAS.W - 90)));
    var target = total / nRows;
    var rows = [[]];
    var cur = 0;
    w.forEach(function (wd, i) {
      if (rows.length < nRows && cur + wd / 2 > target && rows[rows.length - 1].length) {
        rows.push([]);
        cur = 0;
      }
      rows[rows.length - 1].push(i);
      cur += wd;
    });

    // Left-aligned (mockup match) — every row starts at the same x=60
    // margin the header's own DOM copy uses (5.77% of CANVAS.W).
    //
    // Anchored bottom-up from the trimmed viewport's own bottom edge
    // (VIEW_BOTTOM): the *last* row sits a fixed 22px above VIEW_BOTTOM and
    // earlier rows stack upward from there, so a taller legend (more rows,
    // e.g. Field of work) grows into the reclaimed headroom above it.
    legendTopY = VIEW_BOTTOM - 22 - 24 * (rows.length - 1);
    var y = legendTopY;
    rows.forEach(function (row) {
      var x = 60;
      row.forEach(function (i) {
        ctx.beginPath();
        ctx.arc(x + SW / 2, y, SW / 2, 0, Math.PI * 2);
        ctx.fillStyle = categoryColors[i];
        ctx.fill();
        ctx.fillStyle = ecTokens.onSurfaceMuted;
        ctx.textAlign = "left";
        ctx.fillText(categories[i].name, x + SW + GAP, y);
        x += w[i];
      });
      y += 24;
    });
    ctx.textBaseline = "alphabetic";
  }

  function draw() {
    if (!ctx) return;
    ctx.clearRect(0, VIEW_TOP, FL.CANVAS.W, VIEW_H);
    ctx.fillStyle = ecTokens.surface;
    ctx.fillRect(0, VIEW_TOP, FL.CANVAS.W, VIEW_H);

    for (var i = 0; i < layout.dots.length; i++) {
      var r = renders[i];
      if (!r || r.alpha <= 0.008) continue;
      ctx.fillStyle = css(r.cNow);

      // p is this dot's own morph amount, staggered per-dot by the stage
      // transition. Crossfading the two marks by alpha, while the glyph's
      // own height also lerps from the dot's diameter up to its full person
      // height, is what makes a dot look like it's growing into a figure —
      // used only entering/leaving the Phase 2 stage.
      var p = r.person;
      if (p < 0.999) {
        ctx.globalAlpha = r.alpha * (1 - p);
        ctx.beginPath();
        ctx.arc(r.pos[0], r.pos[1], r.r, 0, Math.PI * 2);
        ctx.fill();
      }
      if (p > 0.001) {
        ctx.globalAlpha = r.alpha * p;
        stampPerson(r.pos[0], r.pos[1], lerp(2 * r.r, FL.personHeightFor(r.r), p));
      }
    }
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1;

    // categoryLegend() runs first — it sets legendTopY, which facilitators()
    // reads (for the key row's own y) in the same frame. Painting order is
    // otherwise unaffected: none of these three overlap on canvas.
    categoryLegend();
    updateDimensionTogglePosition();
    facilitators();
    curtainCenterLabel();
  }

  function updateDimensionTogglePosition() {
    // The Participant/Facilitator key's own y — centered in the gap between
    // the ring's bottom and the category legend's first row.
    var newRingBottomY = bands[LAST_STAGE].bottom + (yShift[LAST_STAGE] || 0);
    if (newRingBottomY !== ringBottomY || keyRowY === undefined) {
      ringBottomY = newRingBottomY;
    }
    var newKeyRowY = (ringBottomY + legendTopY) / 2;
    if (newKeyRowY === keyRowY) return;
    keyRowY = newKeyRowY;
    // .dimension-toggle's CSS `bottom` is a % of #stage's rendered height,
    // which tracks VIEW_H 1:1 — converting keyRowY into that percentage,
    // plus CSS translateY(50%), keeps the toggle level with the key row at
    // any window width.
    dimensionTogglePct = ((VIEW_BOTTOM - keyRowY) / VIEW_H) * 100;
    dimensionToggleEl.style.bottom = dimensionTogglePct + "%";
  }

  function updateHeaderDOM() {
    var cross = FL.headerCrossfade(t);
    headerOpacity = cross.opacity;
    var nextIndex = cross.useTo ? stage : prevStage;
    stageCopyEl.style.opacity = String(headerOpacity);
    statColEl.style.opacity = String(headerOpacity);
    if (nextIndex === headerStageIndex) return;
    headerStageIndex = nextIndex;
    var s = stages[headerStageIndex];
    phaseEl.textContent = s.phase;
    titleEl.textContent = s.title;
    subTextEl.textContent = s.sub;
    infoIconEl.hidden = !s.info;
    if (s.stat) {
      statColEl.hidden = false;
      var isPeople = s.stat.icon === "people";
      statIconPeopleEl.hidden = !isPeople;
      statIconChatsEl.hidden = isPeople;
      statValueEl.textContent = s.stat.value;
      statCaptionEl.textContent = s.stat.caption;
    } else {
      statColEl.hidden = true;
    }
  }

  function frame(now) {
    var dt = Math.min(now - lastTime, 50);
    lastTime = now;

    updateHeaderDOM();

    var titleTarget = stage === LAST_STAGE && ringReady ? 1 : 0;
    titleK += (titleTarget - titleK) * Math.min(1, dt / TITLE_EASE_MS);

    if (playing) {
      clock += dt / 1000;

      if (t < 1) {
        t = Math.min(1, t + dt / TRANSITION_MS);
        var span = 0.7;
        layout.dots.forEach(function (dot, i) {
          var g = targetFor(dot, stage);
          var r = renders[i];
          var lt = easeInOut(Math.max(0, Math.min(1, (t - r.delay) / span)));
          place(r, g, lt);
          r.alpha = lerp(r.aFrom, g.alpha, lt);
          r.r = lerp(r.rFrom, g.r, lt);
          r.cNow = mixColor(r.cFrom, colorFor(g.categoryKey), lt);
          r.person = lerp(r.pFrom, g.person ? 1 : 0, lt);
        });
        if (t >= 1) {
          dwellLeft = dwellFor(stage);
          if (stage === LAST_STAGE) ringReady = true;
        }
      } else {
        dwellLeft -= dt;
        if (dwellLeft <= 0) {
          if (stage < LAST_STAGE) goTo(stage + 1);
          else if (looping) goTo(0);
          else {
            playing = false;
            syncPlayButton();
          }
        }
      }
    }

    // The Phase 2 (gather) stage has no continuous drift/orbit of its own,
    // but this still needs to run: it's the only thing that re-reads
    // `dimension` while idle, so toggling Region/Field of work while
    // nothing else is transitioning still recolors immediately.
    if (t >= 1) {
      layout.dots.forEach(function (dot, i) {
        if (stage === LAST_STAGE && !dot.kept) return;
        var g = targetFor(dot, stage);
        renders[i].pos[0] = g.x;
        renders[i].pos[1] = g.y;
        renders[i].cNow = colorFor(g.categoryKey);
      });
    }

    draw();
    rafId = requestAnimationFrame(frame);
  }

  function restart() {
    clock = 0;
    stage = 0;
    prevStage = 0;
    t = 1;
    ringReady = false;
    resetRenders();
    dwellLeft = DWELL_MS;
    playing = true;
    syncPlayButton();
    syncPills();
  }

  function togglePlay() {
    playing = !playing;
    if (playing && t >= 1 && stage === LAST_STAGE && !looping) restart();
    syncPlayButton();
  }

  function jumpTo(s) {
    goTo(s);
    dwellLeft = dwellFor(stage);
  }

  function onKeydown(e) {
    if (e.key === " ") {
      e.preventDefault();
      togglePlay();
    } else if (e.key === "ArrowRight" && stage < LAST_STAGE) {
      jumpTo(stage + 1);
    } else if (e.key === "ArrowLeft" && stage > 0) {
      jumpTo(stage - 1);
    }
  }

  function resize() {
    if (!canvas) return;
    var cssWidth = canvas.clientWidth || FL.CANVAS.W;
    var scale = cssWidth / FL.CANVAS.W;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = FL.CANVAS.W * scale * dpr;
    canvas.height = VIEW_H * scale * dpr;
    canvas.style.height = VIEW_H * scale + "px";
    ctx = canvas.getContext("2d");
    // Shifts the visible window up by VIEW_TOP canvas-space px (in device
    // pixels) rather than translating every draw call's own coordinates —
    // see TOP_TRIM's comment above.
    if (ctx) ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, -VIEW_TOP * scale * dpr);
  }

  // -----------------------------------------------------------------------
  // Control wiring
  // -----------------------------------------------------------------------
  function syncPlayButton() {
    playBtn.textContent = playing ? "Pause" : "Play";
  }
  function syncLoopButton() {
    loopBtn.setAttribute("aria-pressed", String(looping));
  }
  function syncPills() {
    pillButtons.forEach(function (btn, i) {
      btn.setAttribute("aria-pressed", String(stage === i));
    });
  }
  function syncDimensionButtons() {
    dimensionButtons.forEach(function (btn) {
      btn.setAttribute("aria-pressed", String(btn.dataset.dimension === dimension));
    });
  }
  function syncMotionButtons() {
    motionButtons.forEach(function (btn) {
      btn.setAttribute("aria-pressed", String(btn.dataset.motion === motion));
    });
  }

  playBtn.addEventListener("click", togglePlay);
  restartBtn.addEventListener("click", restart);
  loopBtn.addEventListener("click", function () {
    looping = !looping;
    syncLoopButton();
  });
  // Kept in sync with `dimension`/`motion` on every toggle — the source
  // component's aria-label is a Svelte reactive expression over both, so a
  // screen-reader user re-reading the canvas gets a description matching
  // what's actually on screen, not just the state at first paint.
  function updateAriaLabel() {
    canvas.setAttribute(
      "aria-label",
      "Animation showing " +
        FL.fmt(layout.phase1Total) +
        " phase one participants, " +
        FL.fmt(layout.invitedTotal) +
        " of whom were invited to participate in discussions, funnelling down to " +
        layout.keptTotal +
        " who attended, who then separate into " +
        layout.clusters.length +
        " conversation groups arranged in a ring, colored by " +
        (dimension === "region" ? "region" : "field of work") +
        ". The phase 2 cohort is shown as a person figure, one per attendee, only as it gathers; the final " +
        "conversation stage shows each attendee as a plain dot, " +
        (motion === "orbit"
          ? "rotating steadily around its conversation's center"
          : "slowly rotating while drifting closer to and farther from its conversation's center, breathing in and out") +
        ".",
    );
  }

  dimensionButtons.forEach(function (btn) {
    btn.addEventListener("click", function () {
      dimension = btn.dataset.dimension;
      recolor();
      syncDimensionButtons();
      updateAriaLabel();
    });
  });
  motionButtons.forEach(function (btn) {
    btn.addEventListener("click", function () {
      motion = btn.dataset.motion;
      syncMotionButtons();
      updateAriaLabel();
    });
  });
  window.addEventListener("keydown", onKeydown);

  syncPlayButton();
  syncLoopButton();
  syncDimensionButtons();
  syncMotionButtons();
  syncPills();

  headingEl.textContent = FL.SECTION_HEADING;
  // Recolor the same N real phase 2 attendees by a different demographic —
  // the set of people highlighted never changes, only what distinguishes
  // them. Always ends on the export's own sample caveat, same as the info
  // tooltip above.
  hintEl.textContent =
    "Toggle between Region and Field of work to recolor the same " +
    layout.keptTotal +
    " real phase 2 attendees by a different demographic — the set of people highlighted never changes, only what " +
    "distinguishes them. " +
    data.meta.sampleCaveat;
  updateAriaLabel();

  // -----------------------------------------------------------------------
  // Boot
  // -----------------------------------------------------------------------
  reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  resize();
  window.addEventListener("resize", resize);
  watchEcTokens(canvas, function (tokens) {
    ecTokens = tokens;
  });
  restart();

  function start() {
    lastTime = performance.now();
    rafId = requestAnimationFrame(frame);
  }
  if (document.fonts) {
    document.fonts.ready.then(start);
  } else {
    start();
  }
})();
