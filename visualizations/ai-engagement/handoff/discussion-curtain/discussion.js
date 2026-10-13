/**
 * Canvas draw loop + DOM wiring for "Behind the curtain" — tab 1 of "The
 * power of the discussion" prototype. discussion-layout.js decides every
 * position/color/number; this file only draws what that module computes
 * and handles hover/click interaction on the ring.
 *
 * Unlike the sibling participant-funnel handoff, there is no stage
 * animation here at all: the ring is always in its one resting state (the
 * source component's own header comment calls this out — "the ring is
 * seeded already-assembled at mount... there is no funnel-in to animate
 * from"). Ported from Svelte 5 runes to plain mutable variables, same as
 * that sibling handoff.
 */
(function () {
  "use strict";

  var DL = DiscussionLayout;
  var funnelData = FUNNEL_DATA;
  var roomsData = ROOMS_DATA;

  // Hardcoded to the DS's "white surface" values (viz/src/App.svelte's
  // .viz-root.white-surface override) — this prototype's reference mockups
  // are white-only, so unlike the funnel handoff there's no light/dark
  // token bridge here at all. index.html additionally sets
  // `<html data-theme="light">` so ec-tokens.css's own OS-dark-mode block
  // never applies, and discussion.css re-pins --ec-surface/--ec-surface-alt
  // to white (the light theme's own defaults are cream/white).
  var SURFACE = "#ffffff";
  var INK = "#1c2745"; // --ec-navy, also --ec-emphasis on the white surface
  var ACCENT = "#1c2745"; // --ec-emphasis
  var GRAY = "#444444"; // --ec-text-dark / --ec-on-surface-muted
  var NEUTRAL = "#3b3a48"; // --ec-nondata
  var HAIRLINE = "#d4d4d7"; // --ec-border
  var OUTLINE = "#8c8c8c"; // --ec-graphic-hairline (same value light/dark)
  var WORD_FONT = "'Noto Sans', Arial, sans-serif";

  // -----------------------------------------------------------------------
  // DOM references
  // -----------------------------------------------------------------------
  var canvas = document.getElementById("discussion-canvas");
  var ctx = null;
  var stageEl = document.getElementById("stage");

  var headingEl = document.getElementById("heading");
  var phaseEl = document.getElementById("stage-phase");
  var titleEl = document.getElementById("stage-title");
  var subTextEl = document.getElementById("stage-sub-text");
  var statIconChatsEl = document.getElementById("stat-icon-chats");
  var statValueEl = document.getElementById("stat-value");
  var statCaptionEl = document.getElementById("stat-caption");

  var dimensionButtons = Array.prototype.slice.call(document.querySelectorAll("[data-dimension]"));
  var motionButtons = Array.prototype.slice.call(document.querySelectorAll("[data-motion]"));
  var hotspotLayer = document.getElementById("hotspot-layer");
  var leaderSvg = document.getElementById("peek-leader");
  var leaderPath = document.getElementById("peek-leader-path");
  var peekPanelEl = document.getElementById("peek-panel");
  var hintEl = document.getElementById("hint");

  // -----------------------------------------------------------------------
  // Layout — computed once at load; neither export changes at runtime.
  // -----------------------------------------------------------------------
  var ring = DL.buildDiscussionRing(funnelData);
  var view = DL.buildCurtainView(ring.clusters.length);

  headingEl.textContent = DL.DISCUSSION_HEADING;
  phaseEl.textContent = view.phase;
  titleEl.textContent = view.title;
  subTextEl.textContent = view.sub;
  statValueEl.textContent = view.stat.value;
  statCaptionEl.textContent = view.stat.caption;
  statIconChatsEl.hidden = false; // the only stat icon this tab ever shows

  // attendeesByCluster: this tab's ring dots ARE the real attendee list
  // (buildDiscussionRing never models dropped dots — see that function's
  // own comment), so a cluster's attendees are just its own dots, no
  // separate derivation needed the way the source's dot-scan does.
  var attendeesByCluster = {};
  ring.dots.forEach(function (dot) {
    var list = attendeesByCluster[dot.group] || (attendeesByCluster[dot.group] = []);
    list.push({ region: dot.region, fieldOfWork: dot.fieldOfWork });
  });
  function attendeesFor(clusterIndex) {
    return attendeesByCluster[clusterIndex] || [];
  }

  // No insights.json (see discussion-data.js's header comment / README.md)
  // — every peek uses its placeholder exchange. Pass your own
  // overridesBySessionNumber here (kept only in your own untracked copy of
  // this file — never commit real response text) if you hand-author real
  // quotes locally.
  var conversationPeeks = DL.buildConversationPeeks(ring.clusters, roomsData.sessions, attendeesFor, null);

  var dimension = "region"; // "region" | "fieldOfWork"
  var motion = "orbit"; // "orbit" | "pulse"

  var categories, categoryColors, colorOf;
  function recolor() {
    categories = dimension === "region" ? funnelData.regions : funnelData.fieldOfWork;
    categoryColors = DL.assignCategoryColors(
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

  function colorFor(categoryKey) {
    return colorOf[categoryKey] || DL.DATA_VIZ_NEUTRAL_LIGHT;
  }

  // -----------------------------------------------------------------------
  // Viewport trim — same TOP_TRIM technique as the funnel handoff: the
  // header is real DOM above the canvas, so the canvas element itself is
  // shortened and resize()'s transform slides the *visible* window over the
  // unchanged coordinate space.
  // -----------------------------------------------------------------------
  var TOP_TRIM = 100;
  var VIEW_H = DL.CANVAS.H - TOP_TRIM;
  function vFrac(y) {
    return (y - TOP_TRIM) / VIEW_H;
  }

  // The right-hand panel's own width, as a fraction of #stage — both the
  // peek card and categoryLegend()'s row-wrap reservation key off this.
  var SIDEBAR_WIDTH_FRAC = 0.38;

  canvas.width = DL.CANVAS.W;
  canvas.height = VIEW_H;

  var ORBIT_SPEED = 0.2;
  var HOVER_EASE_MS = 180;
  var TITLE_EASE_MS = 900;

  var clock = 0;
  var clusterClock = ring.clusters.map(function () {
    return 0;
  });
  var hoverK = 0;
  var titleK = 0;
  var rafId = 0;
  var lastTime = 0;
  var reduced = false;

  var hoveredPeekIndex = null;
  var pinnedPeekIndex = null;
  function activePeekIndex() {
    return hoveredPeekIndex !== null ? hoveredPeekIndex : pinnedPeekIndex;
  }

  // -----------------------------------------------------------------------
  // Ring position for a kept dot, shifted left to leave room for the peek
  // panel — same [ox - RING_SHIFT_X, oy] the source's dotTarget applies at
  // its stage 5/6.
  // -----------------------------------------------------------------------
  function ringPosition(dot, cluster) {
    var pos = DL.orbitPosition(dot, cluster, clock, ORBIT_SPEED, motion);
    return [pos[0] - DL.RING_SHIFT_X, pos[1]];
  }
  function clusterCenter(cluster) {
    return [cluster.x - DL.RING_SHIFT_X, cluster.y];
  }

  function facilitators() {
    if (!ctx) return;
    var active = activePeekIndex();
    var peekHighlightActive = active !== null;

    ring.clusters.forEach(function (cl, clusterIndex) {
      var dimmed = peekHighlightActive && clusterIndex !== active;
      var mult = dimmed ? lerp(1, 0.15, hoverK) : 1;
      ctx.globalAlpha = mult;
      var center = clusterCenter(cl);
      var cx = center[0],
        cy = center[1];

      if (peekHighlightActive && clusterIndex === active) {
        var outlineR =
          motion === "pulse" ? (cl.rc + 4) * (1 + DL.PULSE_AMPLITUDE * Math.sin(((clusterClock[clusterIndex] || 0) / cl.pulsePeriod) * Math.PI * 2 + cl.pulsePhase)) : cl.rc + 4;
        ctx.globalAlpha = hoverK;
        ctx.beginPath();
        ctx.arc(cx, cy, outlineR, 0, Math.PI * 2);
        ctx.strokeStyle = OUTLINE;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      ctx.globalAlpha = mult;
      ctx.beginPath();
      ctx.arc(cx, cy, 11, 0, Math.PI * 2);
      ctx.fillStyle = SURFACE;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(cx, cy, 7.5, 0, Math.PI * 2);
      ctx.fillStyle = NEUTRAL;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(cx, cy, 3, 0, Math.PI * 2);
      ctx.fillStyle = SURFACE;
      ctx.fill();
    });
    ctx.lineWidth = 1;

    ctx.globalAlpha = 1;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.font = "400 14px " + WORD_FONT;
    // Fixed at x=300 — clear of both the dimension toggle (left) and the
    // peek panel's left edge (CANVAS.W * (1 - SIDEBAR_WIDTH_FRAC) ≈ 645)
    // with margin to spare. See discussion-layout.js's source-repo
    // equivalent comment for why this isn't computed from either neighbor's
    // own width.
    var lx = 300;
    var ly = DL.CANVAS.H - 108;
    ctx.fillStyle = GRAY;
    ctx.beginPath();
    ctx.arc(lx, ly, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(lx + 108, ly, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(lx + 108, ly, 2.8, 0, Math.PI * 2);
    ctx.fillStyle = SURFACE;
    ctx.fill();
    ctx.fillStyle = GRAY;
    ctx.fillText("Participant", lx + 12, ly);
    ctx.fillText("Facilitator", lx + 120, ly);

    if (peekHighlightActive) {
      var ly2 = DL.CANVAS.H - 84;
      ctx.globalAlpha = hoverK;
      ctx.beginPath();
      ctx.arc(lx, ly2, 4, 0, Math.PI * 2);
      ctx.fillStyle = GRAY;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(lx, ly2, 8, 0, Math.PI * 2);
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = GRAY;
      ctx.fillText("Outlined: the open conversation", lx + 14, ly2);
    }

    ctx.globalAlpha = 1;
    ctx.textBaseline = "alphabetic";
  }

  function conversationBadges() {
    if (!ctx) return;
    var active = activePeekIndex();
    ring.clusters.forEach(function (cl, clusterIndex) {
      var peek = conversationPeeks[clusterIndex];
      var isActive = active === clusterIndex;
      var center = clusterCenter(cl);
      var ccx = center[0],
        ccy = center[1];
      var bx = ccx + Math.cos(-Math.PI / 4) * (cl.rc + 10);
      var by = ccy + Math.sin(-Math.PI / 4) * (cl.rc + 10);

      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(bx, by, 10, 0, Math.PI * 2);
      ctx.fillStyle = isActive ? ACCENT : SURFACE;
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = isActive ? ACCENT : HAIRLINE;
      ctx.stroke();

      ctx.fillStyle = isActive ? SURFACE : GRAY;
      ctx.font = "700 11px " + WORD_FONT;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String((peek && peek.sessionNumber) || clusterIndex + 1), bx, by);
    });
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
  }

  function curtainCenterLabel() {
    if (!ctx || titleK <= 0.01) return;
    var cx = DL.CX - DL.RING_SHIFT_X;
    var cy = DL.CY;
    var maxClusterRc = Math.max.apply(
      null,
      ring.clusters.map(function (c) {
        return c.rc;
      }),
    );
    var freeRadius = Math.max(60, ring.ringRadius - maxClusterRc - 10);
    var maxWidth = freeRadius * 1.7;
    var lineHeight = 22;
    var gap = 6;

    var countLines = DL.wrapLabel(DL.fmt(ring.keptTotal) + " people in " + DL.fmt(ring.clusters.length) + " conversations", maxWidth, 8.9).slice(0, 2);
    var promptLines = DL.wrapLabel("Open one to see how a conversation unfolded", maxWidth, 7.8).slice(0, 2);
    var totalHeight = countLines.length * lineHeight + gap + promptLines.length * lineHeight;

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    var y = cy - totalHeight / 2 + lineHeight / 2;

    ctx.globalAlpha = titleK;
    ctx.font = "700 16px " + WORD_FONT;
    ctx.fillStyle = INK;
    countLines.forEach(function (line) {
      ctx.fillText(line, cx, y);
      y += lineHeight;
    });

    y += gap;
    ctx.font = "400 14px " + WORD_FONT;
    ctx.fillStyle = GRAY;
    ctx.globalAlpha = titleK * (1 - hoverK);
    promptLines.forEach(function (line) {
      ctx.fillText(line, cx, y);
      y += lineHeight;
    });

    ctx.globalAlpha = 1;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
  }

  function categoryLegend() {
    if (!ctx) return;
    ctx.font = "400 14px " + WORD_FONT;
    ctx.textBaseline = "middle";
    var SW = 9,
      GAP = 7,
      PAD = 22;
    var w = categories.map(function (c) {
      return SW + GAP + ctx.measureText(c.name).width + PAD;
    });

    // The peek panel can appear on any hover, so this reserves its width
    // unconditionally rather than reflowing the legend's row layout every
    // time a peek opens/closes — see the source repo's identical comment.
    var freeWidth = DL.CANVAS.W * (1 - SIDEBAR_WIDTH_FRAC);

    var total = w.reduce(function (a, b) {
      return a + b;
    }, 0);
    var nRows = Math.max(1, Math.ceil(total / (freeWidth - 90)));
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

    var y = DL.CANVAS.H - 58;
    rows.forEach(function (row) {
      var rowWidth = row.reduce(function (a, i) {
        return a + w[i];
      }, 0);
      var x = (freeWidth - (rowWidth - PAD)) / 2;
      row.forEach(function (i) {
        ctx.beginPath();
        ctx.arc(x + SW / 2, y, SW / 2, 0, Math.PI * 2);
        ctx.fillStyle = categoryColors[i];
        ctx.fill();
        ctx.fillStyle = GRAY;
        ctx.textAlign = "left";
        ctx.fillText(categories[i].name, x + SW + GAP, y);
        x += w[i];
      });
      y += 24;
    });
    ctx.textBaseline = "alphabetic";
  }

  function lerp(a, b, k) {
    return a + (b - a) * k;
  }

  function draw() {
    if (!ctx) return;
    ctx.clearRect(0, TOP_TRIM, DL.CANVAS.W, VIEW_H);
    ctx.fillStyle = SURFACE;
    ctx.fillRect(0, TOP_TRIM, DL.CANVAS.W, VIEW_H);

    var active = activePeekIndex();
    var peekActive = active !== null;
    for (var i = 0; i < ring.dots.length; i++) {
      var dot = ring.dots[i];
      var cluster = ring.clusters[dot.group];
      var pos = ringPosition(dot, cluster);
      var dimmed = peekActive && dot.group !== active;
      var mult = dimmed ? lerp(1, 0.15, hoverK) : 1;
      ctx.fillStyle = colorFor(dot[dimension]);
      ctx.globalAlpha = mult;
      ctx.beginPath();
      ctx.arc(pos[0], pos[1], 6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1;

    facilitators();
    conversationBadges();
    curtainCenterLabel();
    categoryLegend();
  }

  // -----------------------------------------------------------------------
  // Peek hotspots, leader line, and panel
  // -----------------------------------------------------------------------
  // Built once — a cluster's own (x, y, rc) never changes (only the dots
  // orbiting inside it do), so unlike updatePeekUI() below, this never
  // needs to re-run. Kept in its own array (not just hotspotLayer.children)
  // so syncHotspotAriaPressed() below can index it directly.
  var hotspotButtons = [];
  function buildHotspots() {
    hotspotLayer.innerHTML = "";
    hotspotButtons = ring.clusters.map(function (cluster, ci) {
      var peek = conversationPeeks[ci];
      var center = clusterCenter(cluster);
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "peek-hotspot";
      btn.style.left = (center[0] / DL.CANVAS.W) * 100 + "%";
      btn.style.top = vFrac(center[1]) * 100 + "%";
      btn.style.width = ((2 * cluster.rc) / DL.CANVAS.W) * 100 + "%";
      btn.style.height = ((2 * cluster.rc) / VIEW_H) * 100 + "%";
      btn.setAttribute("aria-label", "Conversation " + ((peek && peek.sessionNumber) || ci + 1) + ", " + (peek ? peek.attendeeCount : 0) + " people, " + (peek ? peek.dateLabel : ""));
      btn.setAttribute("aria-pressed", "false");
      btn.addEventListener("pointerenter", function () {
        setPeekHover(ci);
      });
      btn.addEventListener("pointerleave", clearPeekHover);
      btn.addEventListener("focus", function () {
        setPeekHover(ci);
      });
      btn.addEventListener("blur", clearPeekHover);
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        togglePeekPin(ci);
      });
      hotspotLayer.appendChild(btn);
      return btn;
    });
  }

  // Called on every hover/pin change instead of rebuilding the buttons —
  // recreating them mid-interaction (the original version of this port)
  // detached the very button the pointer was over, breaking hover/click
  // handling. Only the attribute changes; DOM nodes and their listeners
  // stay put.
  function syncHotspotAriaPressed() {
    hotspotButtons.forEach(function (btn, ci) {
      btn.setAttribute("aria-pressed", String(pinnedPeekIndex === ci));
    });
  }

  function setPeekHover(index) {
    hoveredPeekIndex = index;
    updatePeekUI();
  }
  function clearPeekHover() {
    hoveredPeekIndex = null;
    updatePeekUI();
  }
  function togglePeekPin(index) {
    pinnedPeekIndex = pinnedPeekIndex === index ? null : index;
    updatePeekUI();
  }

  function speakerColor(turn) {
    return colorFor(turn[dimension]);
  }

  function renderPeekCard(peek, pinned) {
    var turnsHtml = peek.turns
      .map(function (turn) {
        return (
          '<li><div class="peek-quote-row"><svg class="peek-quote-icon" viewBox="0 0 45 45" fill="none" aria-hidden="true">' +
          '<path d="M29.4813 19.2386C29.4813 19.4508 29.397 19.6543 29.2469 19.8043C29.0969 19.9543 28.8934 20.0386 28.6812 20.0386H15.8813C15.6691 20.0386 15.4656 19.9543 15.3156 19.8043C15.1655 19.6543 15.0813 19.4508 15.0813 19.2386C15.0813 19.0264 15.1655 18.823 15.3156 18.6729C15.4656 18.5229 15.6691 18.4386 15.8813 18.4386H28.6812C28.8934 18.4386 29.0969 18.5229 29.2469 18.6729C29.397 18.823 29.4813 19.0264 29.4813 19.2386ZM28.6812 24.8386H15.8813C15.6691 24.8386 15.4656 24.9229 15.3156 25.0729C15.1655 25.223 15.0813 25.4264 15.0813 25.6386C15.0813 25.8508 15.1655 26.0543 15.3156 26.2043C15.4656 26.3543 15.6691 26.4386 15.8813 26.4386H28.6812C28.8934 26.4386 29.0969 26.3543 29.2469 26.2043C29.397 26.0543 29.4813 25.8508 29.4813 25.6386C29.4813 25.4264 29.397 25.223 29.2469 25.0729C29.0969 24.9229 28.8934 24.8386 28.6812 24.8386ZM42.2812 22.4386C42.2819 25.9204 41.3736 29.3421 39.6461 32.3652C37.9186 35.3882 35.4318 37.908 32.4317 39.6751C29.4317 41.4422 26.0222 42.3955 22.5407 42.4406C19.0592 42.4858 15.6262 41.6213 12.5813 39.9326L5.44325 42.3126C5.02038 42.4536 4.56659 42.4741 4.13274 42.3717C3.69889 42.2693 3.30213 42.0481 2.98693 41.7329C2.67172 41.4177 2.45053 41.021 2.34815 40.5871C2.24576 40.1533 2.26623 39.6995 2.40725 39.2766L4.78725 32.1386C3.30777 29.4685 2.45912 26.4952 2.30632 23.4464C2.15353 20.3976 2.70064 17.3543 3.90575 14.5497C5.11085 11.745 6.94197 9.25347 9.25881 7.26586C11.5756 5.27824 14.3167 3.84734 17.272 3.08278C20.2273 2.31823 23.3184 2.2403 26.3085 2.85497C29.2985 3.46964 32.1082 4.76061 34.5223 6.62895C36.9363 8.49729 38.8907 10.8934 40.2356 13.6338C41.5805 16.3742 42.2802 19.386 42.2812 22.4386ZM40.6813 22.4386C40.6804 19.6161 40.0302 16.8316 38.781 14.3006C37.5318 11.7696 35.7171 9.55988 33.4772 7.84245C31.2373 6.12503 28.6324 4.94591 25.8639 4.39634C23.0954 3.84677 20.2376 3.94148 17.5116 4.67313C14.7856 5.40478 12.2644 6.75377 10.1431 8.61572C8.0219 10.4777 6.35744 12.8027 5.27854 15.4108C4.19965 18.019 3.73524 20.8404 3.92125 23.6568C4.10726 26.4732 4.9387 29.209 6.35125 31.6526C6.40794 31.7507 6.44314 31.8598 6.45452 31.9725C6.4659 32.0853 6.4532 32.1991 6.41725 32.3066L3.92525 39.7826C3.87824 39.9236 3.87142 40.0748 3.90555 40.2194C3.93968 40.3641 4.01341 40.4963 4.11848 40.6014C4.22354 40.7065 4.3558 40.7802 4.50041 40.8143C4.64503 40.8484 4.79629 40.8416 4.93725 40.7946L12.4133 38.3026C12.495 38.2747 12.5809 38.2606 12.6673 38.2606C12.8077 38.2613 12.9455 38.2985 13.0673 38.3686C15.8644 39.9868 19.0384 40.8398 22.2699 40.8418C25.5014 40.8438 28.6765 39.9947 31.4756 38.3799C34.2748 36.7652 36.5993 34.4417 38.2153 31.6432C39.8313 28.8448 40.6818 25.6701 40.6813 22.4386Z" fill="currentColor"/></svg>' +
          '<p class="peek-text">“' + escapeHtml(turn.text) + '”</p></div>' +
          '<p class="peek-byline"><span class="speaker-dot" style="background:' + speakerColor(turn) + '" aria-hidden="true"></span>' + escapeHtml(turn.byline) + "</p></li>"
        );
      })
      .join("");

    var allPlaceholder = peek.turns.every(function (t) {
      return t.isPlaceholder;
    });
    var footerHtml = peek.linkedConceptName
      ? '<div class="peek-turned-into"><p class="turned-into-label">This turned into:</p>' +
        '<p class="turned-into-concept"><span class="concept-kicker">Policy concept</span>' +
        escapeHtml(peek.linkedConceptName) +
        "</p></div>"
      : '<p class="peek-caption">These conversations helped shape the policy concepts identified in Phase 2.</p>';

    return (
      '<div class="ec-card"><div class="peek-card">' +
      '<button type="button" class="peek-header" id="peek-toggle" aria-expanded="' + pinned + '">' +
      '<span class="peek-title">Conversation ' +
      (peek.sessionNumber || peek.clusterIndex + 1) +
      '</span><span class="ec-glyph" style="--size:18px"><svg width="9" height="9" viewBox="0 0 16 16" fill="none" aria-hidden="true">' +
      (pinned ? '<path d="M3 10l5-5 5 5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' : '<path d="M3 6l5 5 5-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>') +
      "</svg></span></button>" +
      '<ul class="peek-turns">' +
      turnsHtml +
      "</ul>" +
      '<div class="peek-footer"><p class="peek-meta">' +
      peek.attendeeCount +
      " people · " +
      peek.dateLabel +
      (allPlaceholder ? ' <span class="ec-status-pill" style="--tone: var(--ec-on-surface-muted)">Placeholder conversation</span>' : "") +
      "</p>" +
      footerHtml +
      "</div></div></div>"
    );
  }

  function escapeHtml(s) {
    var div = document.createElement("div");
    div.textContent = s;
    return div.innerHTML;
  }

  function updatePeekUI() {
    syncHotspotAriaPressed();
    var active = activePeekIndex();
    var peek = active !== null ? conversationPeeks[active] : null;

    if (!peek) {
      peekPanelEl.classList.remove("visible");
      peekPanelEl.setAttribute("inert", "");
      peekPanelEl.innerHTML = "";
      leaderSvg.style.display = "none";
      return;
    }

    var pinned = pinnedPeekIndex === active;
    peekPanelEl.innerHTML = renderPeekCard(peek, pinned);
    peekPanelEl.classList.add("visible");
    peekPanelEl.removeAttribute("inert");
    var toggleBtn = document.getElementById("peek-toggle");
    if (toggleBtn) {
      toggleBtn.addEventListener("click", function () {
        togglePeekPin(active);
      });
    }

    // Vertical placement: centered on the cluster's own y, clamped inside
    // the stage, measured against the panel's actual rendered height (only
    // known after the innerHTML write above) — same approach as the
    // source's peekPanelFrac, using offsetHeight instead of a bound
    // clientHeight.
    var cluster = ring.clusters[peek.clusterIndex];
    var stageHeightPx = stageEl.clientHeight || 1;
    var panelHeightPx = peekPanelEl.offsetHeight || 0.3 * stageHeightPx;
    var heightFrac = panelHeightPx / stageHeightPx;
    var desiredTop = vFrac(cluster.y) - heightFrac / 2;
    var top = Math.min(Math.max(desiredTop, 0.16), 1 - heightFrac - 0.12);
    peekPanelEl.style.top = top * 100 + "%";

    // Leader line from the cluster's own edge to the panel's vertical
    // center.
    var center = clusterCenter(cluster);
    var x1 = center[0] + cluster.rc + 8;
    var y1 = center[1];
    var x2 = DL.CANVAS.W * (1 - SIDEBAR_WIDTH_FRAC);
    var y2 = TOP_TRIM + (top + heightFrac / 2) * VIEW_H;
    leaderPath.setAttribute("d", "M " + x1 + " " + y1 + " Q " + (x1 + x2) / 2 + " " + y1 + " " + x2 + " " + y2);
    leaderSvg.setAttribute("viewBox", "0 " + TOP_TRIM + " " + DL.CANVAS.W + " " + VIEW_H);
    leaderSvg.style.display = "block";
  }

  function onWindowClick(e) {
    if (pinnedPeekIndex === null) return;
    if (peekPanelEl.contains(e.target)) return;
    pinnedPeekIndex = null;
    updatePeekUI();
  }

  function onKeydown(e) {
    if (e.key === "Escape" && pinnedPeekIndex !== null) {
      pinnedPeekIndex = null;
      updatePeekUI();
    }
  }

  // -----------------------------------------------------------------------
  // Animation loop
  // -----------------------------------------------------------------------
  function isClusterDimmed(clusterIndex) {
    var active = activePeekIndex();
    return active !== null && clusterIndex !== active;
  }

  function frame(now) {
    var dt = Math.min(now - lastTime, 50);
    lastTime = now;

    var active = activePeekIndex();
    var hoverTarget = active !== null ? 1 : 0;
    hoverK += (hoverTarget - hoverK) * Math.min(1, dt / HOVER_EASE_MS);

    // titleK ramps to 1 once on load (ringReady starts true — there is no
    // funnel-in transition to wait for) and stays there.
    titleK += (1 - titleK) * Math.min(1, dt / TITLE_EASE_MS);

    clock += dt / 1000;
    ring.clusters.forEach(function (_, i) {
      var activity = isClusterDimmed(i) ? lerp(1, 0, hoverK) : 1;
      clusterClock[i] = (clusterClock[i] || 0) + (dt / 1000) * activity;
    });

    draw();
    rafId = requestAnimationFrame(frame);
  }

  function resize() {
    if (!canvas) return;
    var cssWidth = canvas.clientWidth || DL.CANVAS.W;
    var scale = cssWidth / DL.CANVAS.W;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = DL.CANVAS.W * scale * dpr;
    canvas.height = VIEW_H * scale * dpr;
    canvas.style.height = VIEW_H * scale + "px";
    ctx = canvas.getContext("2d");
    ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, -TOP_TRIM * scale * dpr);
  }

  // -----------------------------------------------------------------------
  // Control wiring
  // -----------------------------------------------------------------------
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
  function updateAriaLabel() {
    canvas.setAttribute(
      "aria-label",
      "Animation showing " +
        DL.fmt(ring.keptTotal) +
        " phase 2 attendees seated in their " +
        DL.fmt(ring.clusters.length) +
        " real conversation groups, arranged in a ring and colored by " +
        (dimension === "region" ? "region" : "field of work") +
        ". Hover or focus a conversation to open a placeholder chat from that room, colored by the same " +
        (motion === "orbit" ? "steadily rotating" : "slowly rotating, breathing") +
        " motion the ring itself uses.",
    );
  }

  dimensionButtons.forEach(function (btn) {
    btn.addEventListener("click", function () {
      dimension = btn.dataset.dimension;
      recolor();
      syncDimensionButtons();
      updateAriaLabel();
      if (activePeekIndex() !== null) updatePeekUI(); // recolor the open peek's speaker dots too
    });
  });
  motionButtons.forEach(function (btn) {
    btn.addEventListener("click", function () {
      motion = btn.dataset.motion;
      syncMotionButtons();
      updateAriaLabel();
    });
  });
  window.addEventListener("click", onWindowClick);
  window.addEventListener("keydown", onKeydown);
  window.addEventListener("resize", resize);

  syncDimensionButtons();
  syncMotionButtons();
  updateAriaLabel();
  hintEl.textContent =
    "Toggle between Region and Field of work to recolor the same " +
    ring.keptTotal +
    " real phase 2 attendees by a different demographic — the set of people highlighted never changes, only what " +
    "distinguishes them. " +
    funnelData.meta.sampleCaveat +
    " " +
    roomsData.meta.sampleCaveat;

  // -----------------------------------------------------------------------
  // Boot
  // -----------------------------------------------------------------------
  reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduced) {
    titleK = 1; // skip the fade-in; every other visual here is already static
  }
  resize();
  buildHotspots();
  updatePeekUI();

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
