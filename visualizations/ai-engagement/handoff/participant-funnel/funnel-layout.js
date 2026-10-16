/**
 * Pure, DOM-free layout + copy for the "Who participated" participant-funnel
 * sketch. No canvas/DOM calls anywhere in this file — funnel.js only draws
 * and animates what this module computes, same split as the original.
 *
 * Ported from (all under viz/src/lib/ in the main EngagedCA/AI_Deliberations
 * repo): funnelCloud.ts, funnelSection.ts, personGlyph.ts, labels.ts
 * (wrapLabel only), palette.ts (assignCategoryColors + one ramp).
 *
 * This is a cut-down port, not the full source: funnelCloud.ts's dotTarget()
 * is shared by four different prototypes and has 8 stages (0-7); this sketch
 * only ever needs 4 of them ([0, 2, 3, 4] in the original's numbering —
 * Phase 1 cloud / invited-vs-dropped split / gather / conversation ring), so
 * they're renumbered 0-3 here and the other stages, RING_SHIFT_X, and the
 * dev-only palette A/B toggle are dropped entirely. See README.md's "What
 * was simplified" section for the full list and why each is safe to drop.
 *
 * Uses `var FunnelLayout = { ... }` (a single global object), not ES module
 * exports — this sketch is meant to run by double-clicking index.html, and
 * `<script type="module">` (like `fetch()`) is blocked by CORS on `file://`
 * URLs in every major browser. Switch to real modules once this is served
 * over http(s).
 */
var FunnelLayout = (function () {
  "use strict";

  /**
   * @typedef {Object} FunnelCategory
   * @property {string} name
   * @property {number} surveyCount
   * @property {number} attendCount
   *
   * @typedef {Object} FunnelAttendee
   * @property {string} region
   * @property {string} fieldOfWork
   *
   * @typedef {Object} FunnelSession
   * @property {string} date
   * @property {FunnelAttendee[]} attendees
   *
   * @typedef {Object} FunnelInvited
   * @property {string} name
   * @property {number} count
   *
   * @typedef {Object} FunnelData
   * @property {{generated: string, sourceHashes: Object, sampleCaveat: string}} meta
   * @property {number} phase1Total
   * @property {FunnelCategory[]} regions
   * @property {FunnelCategory[]} fieldOfWork
   * @property {FunnelSession[]} sessions
   * @property {FunnelInvited[]} invitedByRegion
   * @property {number} invitedTotal
   */

  // ---------------------------------------------------------------------
  // personGlyph.ts — verbatim
  // ---------------------------------------------------------------------

  /** The glyph's one <path>, copied verbatim from
   * design/noun_person_8354641.svg's 1200x1200 viewBox. */
  var PERSON_PATH =
    "m362.48 350.02c0-63 25.031-123.42 69.562-167.95 44.578-44.531 104.95-69.562 167.95-69.562s123.37 25.031 167.95 69.562c44.531 44.531 69.562 104.95 69.562 167.95 0 62.953-25.031 123.37-69.562 167.9-44.578 44.578-104.95 69.562-167.95 69.562s-123.37-24.984-167.95-69.562c-44.531-44.531-69.562-104.95-69.562-167.9zm272.02 262.5h-69c-94.266 0.09375-184.6 37.594-251.26 104.25-66.609 66.656-104.11 156.98-104.25 251.26 0.046874 37.453 25.641 70.031 62.016 78.984 107.25 26.953 217.4 40.547 327.98 40.5 110.58 0.046876 220.74-13.547 327.98-40.5 36.375-8.9531 61.969-41.531 62.016-78.984-0.14063-94.266-37.641-184.6-104.25-251.26-66.656-66.656-156.98-104.16-251.26-104.25z";

  /** The path's own bounding box, measured directly from its coordinates
   * (not the 1200x1200 viewBox, which has generous margin on every side) —
   * so scale-then-translate happens around the glyph's true center, landing
   * exactly on (600, 600) with no extra offset. */
  var PERSON_BOX = { x: 209.99, y: 112.5, w: 780.02, h: 974.99, cx: 600, cy: 600 };

  /** How much taller than a dot's diameter the person glyph is drawn — tuned
   * against the real 14-session layout's tightest seat spacing (see
   * SEAT_SPACING below). Raising this needs the overlap invariants
   * re-checked, not just a visual eyeball. */
  var PERSON_SCALE = 1.55;

  /** The glyph's height, in canvas px, for a dot that would otherwise be
   * drawn at radius `r`. */
  function personHeightFor(r) {
    return PERSON_SCALE * 2 * r;
  }

  /** The glyph's width at the same size, preserving PERSON_BOX's aspect ratio. */
  function personWidthFor(r) {
    return personHeightFor(r) * (PERSON_BOX.w / PERSON_BOX.h);
  }

  // ---------------------------------------------------------------------
  // labels.ts — wrapLabel only (computeLabelBandWidths is Beeswarm-only)
  // ---------------------------------------------------------------------

  /** Greedily wrap `text` into lines no wider than `maxWidthPx`, estimating
   * each line's width as `line.length * charWidthPx` (no DOM measurement
   * available in pure/testable code — close enough for canvas labels and
   * never under-estimates badly enough to overflow in practice). A single
   * word wider than the limit is never split — it gets its own line. */
  function wrapLabel(text, maxWidthPx, charWidthPx) {
    var words = text.split(" ");
    var lines = [];
    var current = "";
    for (var i = 0; i < words.length; i++) {
      var word = words[i];
      var candidate = current ? current + " " + word : word;
      if (current && candidate.length * charWidthPx > maxWidthPx) {
        lines.push(current);
        current = word;
      } else {
        current = candidate;
      }
    }
    if (current) lines.push(current);
    return lines;
  }

  // ---------------------------------------------------------------------
  // palette.ts — assignCategoryColors + the one ramp this sketch uses.
  // The original's dev-only Engaged/ODI A/B toggle (paletteVersion,
  // DATA_VIZ_CAT_OLD, DATA_VIZ_CAT_V2) is dropped — the source marks it
  // "Dev only ... remove once the palette review is settled." This keeps
  // the ramp order that was the default ("Engaged").
  // ---------------------------------------------------------------------

  /** The EC design-system's "Data Viz" categorical hues, in the "Engaged"
   * assignment order (the sketch's default before the now-removed A/B
   * toggle). */
  var DATA_VIZ_CAT = [
    "#53cab0",
    "#65ade1",
    "#c591da",
    "#ee9930",
    "#6d4884",
    "#e45d48",
    "#6c8043",
    "#a9d4f2",
    "#75bc60",
    "#f2c3c7",
  ];

  /** Overflow beyond DATA_VIZ_CAT's 10 primary hues — spent only once a
   * segment has more substantive categories than that (Field of work's 11
   * needs a single extra). */
  var DATA_VIZ_CAT_LIGHTER = [
    "#7fa1c2",
    "#f4cea1",
    "#a395d5",
    "#eca995",
    "#98decd",
    "#ecac67",
    "#abccde",
    "#75bc60",
    "#c591da",
  ];

  /** Non-substantive answer buckets share this neutral instead of spending a
   * categorical hue — see isNonAnswer below. */
  var DATA_VIZ_NEUTRAL_LIGHT = "#bcbbc1";

  // "I don't want to say" is a refusal, not a blank; "(not stated)" is the
  // export's fill-in for a missing raw value. Both are non-substantive:
  // color-by-demographic views render them neutral so they don't compete
  // with real categories or consume a hue, but they still get their own
  // legend row.
  var NON_ANSWER = { "(not stated)": true, "I don't want to say": true };

  function isNonAnswer(value) {
    return !!NON_ANSWER[value];
  }

  /** Assigns one color per entry in `values` (a segment's display
   * categories, in their existing order). Non-answer entries get
   * DATA_VIZ_NEUTRAL_LIGHT; every other entry takes the next unused color
   * from DATA_VIZ_CAT, then DATA_VIZ_CAT_LIGHTER once that ramp is spent. */
  function assignCategoryColors(values) {
    var ramp = DATA_VIZ_CAT.concat(DATA_VIZ_CAT_LIGHTER);
    var cursor = 0;
    return values.map(function (value) {
      if (isNonAnswer(value)) return DATA_VIZ_NEUTRAL_LIGHT;
      var color = ramp[cursor % ramp.length];
      cursor++;
      return color;
    });
  }

  // ---------------------------------------------------------------------
  // funnelCloud.ts — layout math, ported with dotTarget's 8 stages
  // collapsed to the 4 this sketch actually uses.
  // ---------------------------------------------------------------------

  function mulberry32(a) {
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function gauss(rand) {
    var u = 0,
      v = 0;
    while (u === 0) u = rand();
    while (v === 0) v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  /** Fisher-Yates, seeded — same shuffle the reference sketch uses to
   * de-correlate category assignment from dot index. */
  function shuffle(arr, rand) {
    var out = arr.slice();
    for (var i = out.length - 1; i > 0; i--) {
      var j = Math.floor(rand() * (i + 1));
      var tmp = out[i];
      out[i] = out[j];
      out[j] = tmp;
    }
    return out;
  }

  /** Draws `total` category assignments proportional to each category's
   * count, then shuffles — "expand into a bag, shuffle." */
  function proportionalDraw(counts, rand) {
    var bag = [];
    for (var i = 0; i < counts.length; i++) {
      for (var k = 0; k < counts[i].count; k++) bag.push(counts[i].name);
    }
    return shuffle(bag, rand);
  }

  var CANVAS = { W: 1040, H: 812 };
  var CX = CANVAS.W / 2;
  var CLOUD_Y = 285;
  var GATHER_Y = 505;
  var NECK_Y = 455;
  var CY = 435;
  var BLOBS = 9;

  // Each cluster's own internal seat pitch — see funnelCloud.ts's SEAT_SPACING
  // comment in the source repo for the full derivation. 20 keeps every
  // cluster clear of its neighbors with room to spare at the real 14-session
  // layout; don't raise it without re-checking the overlap invariants
  // (viz/tests/funnelCloud.test.ts in the source repo).
  var SEAT_SPACING = 20;

  /** The dot radius drawn at stages 0-1 (cloud) and 4 (ring) — canvas px. */
  var DOT_SIZE = 3.4;

  // Pulse mode's tuning — a slow shared rotation plus radial breathing, in
  // place of orbit mode's steady spin.
  var PULSE_AMPLITUDE = 0.08; // +/-8% of a seat's own orbit radius
  var PULSE_ROTATE_FRACTION = 0.08; // vs. orbit mode's full rotation rate
  var PULSE_PERIOD_BASE = 8.8; // seconds per breath, before per-cluster jitter
  var PULSE_PERIOD_JITTER = 0.3; // +/-15% around PULSE_PERIOD_BASE

  // A two-ring cluster's inner and outer seats rotate at different rates, so
  // at some point in every orbit they land at the same angle. The gap
  // between rings has to clear a stacked pair's full glyph height (not a
  // dot's), or that moment reads as one seat swallowing another.
  var RING_GAP = personHeightFor(6) + 8;

  /** Deterministic given the same FunnelData — pinned so the cloud's shape
   * doesn't reshuffle on every reload. */
  var SEED = 20250825;

  function buildBlobs(rand) {
    var blobs = [];
    for (var i = 0; i < BLOBS; i++) {
      var a = rand() * Math.PI * 2;
      var rr = Math.sqrt(rand());
      blobs.push({
        x: CX + Math.cos(a) * rr * 300,
        y: CLOUD_Y + Math.sin(a) * rr * 96,
        sx: 78 + rand() * 118,
        sy: 36 + rand() * 46,
      });
    }
    return blobs;
  }

  function packed(n, cx, cy, radius) {
    var out = [];
    for (var i = 0; i < n; i++) {
      var r = radius * Math.sqrt((i + 0.5) / n);
      var a = i * 2.39996323;
      out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
    return out;
  }

  function orbitRings(n) {
    var single = Math.max(20, (n * SEAT_SPACING) / (2 * Math.PI));
    if (single <= 46) return [{ r: single, count: n, rate: 1 }];
    var inner = Math.max(3, Math.round(n * 0.35));
    var rIn = Math.max(20, (inner * SEAT_SPACING) / (2 * Math.PI));
    return [
      { r: rIn, count: inner, rate: 1.4 },
      { r: rIn + RING_GAP, count: n - inner, rate: 1 },
    ];
  }

  /**
   * Builds the full deterministic dot/cluster layout from a FunnelData
   * export. Every kept dot carries one real attendee's actual (region,
   * fieldOfWork) pair, straight from FunnelSession.attendees — with two
   * segmentation dimensions, sampling region and field of work
   * independently for the 103 kept dots would produce two different subsets
   * (one whose region distribution is real, one whose field-of-work
   * distribution is real), so toggling the color dimension would look like
   * it swapped out who "attended." Only the ~2600 dropped dots (never real
   * individuals) get region and field of work drawn independently,
   * proportional to the survey counts remaining after subtracting the real
   * attendees out of each category.
   *
   * @param {FunnelData} data
   */
  function buildFunnelCloud(data) {
    var rand = mulberry32(SEED);

    var attendCountByRegion = {};
    data.regions.forEach(function (r) {
      attendCountByRegion[r.name] = r.attendCount;
    });

    var droppedRegionCounts = data.regions.map(function (r) {
      return { name: r.name, count: r.surveyCount - r.attendCount };
    });
    var droppedFieldOfWorkCounts = data.fieldOfWork.map(function (f) {
      return { name: f.name, count: f.surveyCount - f.attendCount };
    });

    var keptTotal = data.sessions.reduce(function (sum, s) {
      return sum + s.attendees.length;
    }, 0);

    var droppedRegions = proportionalDraw(droppedRegionCounts, rand);
    var droppedFieldOfWork = proportionalDraw(droppedFieldOfWorkCounts, rand);

    // Blobs, cloud jitter, and fall targets are assigned to every dot
    // uniformly — a dot's category never affects where it sits in the
    // crowd, only what color it takes.
    var blobs = buildBlobs(rand);
    var dots = [];
    for (var i = 0; i < data.phase1Total; i++) {
      var b = blobs[i % BLOBS];
      var bx = clamp(b.x + gauss(rand) * b.sx, 70, CANVAS.W - 70);
      var by = clamp(b.y + gauss(rand) * b.sy, 152, 432);
      dots.push({
        cloud: {
          x: bx,
          y: by,
          ax: 7 + rand() * 15,
          ay: 5 + rand() * 11,
          fx: 0.25 + rand() * 0.55,
          fy: 0.2 + rand() * 0.5,
          px: rand() * Math.PI * 2,
          py: rand() * Math.PI * 2,
        },
        fall: [bx + gauss(rand) * 60, CANVAS.H + 70 + rand() * 180],
        neck: [CX + gauss(rand) * 16, NECK_Y],
        gather: [0, 0],
        kept: false,
        invited: false,
        region: "",
        fieldOfWork: "",
        group: -1,
        orbit: null,
      });
    }

    // Assign the dropped dots' categories first (independent draws), then
    // overwrite the leftover slots with real attendees below.
    var droppedCursor = 0;
    var allIndices = [];
    for (var idx = 0; idx < data.phase1Total; idx++) allIndices.push(idx);
    var keptIndices = shuffle(allIndices, rand).slice(0, keptTotal);
    var keptSet = {};
    keptIndices.forEach(function (k) {
      keptSet[k] = true;
    });
    for (var d = 0; d < data.phase1Total; d++) {
      if (keptSet[d]) continue;
      dots[d].region = droppedRegions[droppedCursor];
      dots[d].fieldOfWork = droppedFieldOfWork[droppedCursor];
      droppedCursor++;
    }

    // Sessions come pre-sorted chronologically; that order becomes ring
    // position, earliest at the top, clockwise.
    var clusters = data.sessions.map(function (s, g) {
      var rings = orbitRings(s.attendees.length);
      var maxR = Math.max.apply(
        null,
        rings.map(function (r) {
          return r.r;
        }),
      );
      return {
        n: s.attendees.length,
        rings: rings,
        rc: maxR + 7,
        ang: -Math.PI / 2 + g * ((Math.PI * 2) / data.sessions.length),
        x: 0,
        y: 0,
        date: s.date,
        pulsePhase: rand() * Math.PI * 2,
        pulsePeriod: PULSE_PERIOD_BASE * (1 - PULSE_PERIOD_JITTER / 2 + rand() * PULSE_PERIOD_JITTER),
      };
    });
    var maxRc = Math.max.apply(
      null,
      clusters.map(function (c) {
        return c.rc;
      }),
    );
    var ringRadius = Math.min(214, Math.max(150, (data.sessions.length * (2 * maxRc + 24)) / (2 * Math.PI)));
    clusters.forEach(function (cl) {
      cl.x = CX + Math.cos(cl.ang) * ringRadius;
      cl.y = CY + Math.sin(cl.ang) * ringRadius;
    });

    // Seat every real attendee: claim one kept dot per attendee, in
    // shuffled kept-index order, and give it that attendee's real category
    // pair plus its real orbit seat.
    var keptCursor = 0;
    var flatKeptOrder = [];
    data.sessions.forEach(function (s, g) {
      var rings = clusters[g].rings;
      var seatCursor = 0;
      rings.forEach(function (ring) {
        for (var k = 0; k < ring.count; k++, seatCursor++) {
          var dotIdx = keptIndices[keptCursor++];
          var attendee = s.attendees[seatCursor];
          dots[dotIdx].kept = true;
          dots[dotIdx].region = attendee.region;
          dots[dotIdx].fieldOfWork = attendee.fieldOfWork;
          dots[dotIdx].group = g;
          dots[dotIdx].orbit = {
            r: ring.r,
            rate: ring.rate,
            a0: clusters[g].ang + Math.PI + (seatCursor / ring.count) * Math.PI * 2,
          };
          flatKeptOrder.push(dotIdx);
        }
      });
    });

    // Hand out phase 2 gather positions in ring order (grouped by which
    // cluster a dot lands in), so the funnel bloom fans out cleanly even
    // though membership is fixed by real data.
    var gatherPositions = packed(keptTotal, CX, GATHER_Y, 7 * Math.sqrt(keptTotal) * 2.5);
    var seatsByAngle = gatherPositions
      .map(function (p) {
        var a = Math.atan2(p[1] - GATHER_Y, p[0] - CX) + Math.PI / 2;
        if (a < 0) a += Math.PI * 2;
        return { p: p, a: a };
      })
      .sort(function (u, v) {
        return u.a - v.a;
      });
    flatKeptOrder.forEach(function (dotIdx, k) {
      dots[dotIdx].gather = seatsByAngle[k].p;
    });

    // Every kept dot was necessarily invited; extend "invited" to a
    // proportional draw of dropped dots per region, sized to that region's
    // invited quota (already floored at its real attendCount) minus the
    // attendees already counted via `kept`. Must run last, after every
    // earlier draw that consumes `rand` — otherwise the cloud's
    // deterministic shape reshuffles.
    var invitedQuotaByRegion = {};
    data.invitedByRegion.forEach(function (r) {
      invitedQuotaByRegion[r.name] = r.count;
    });
    var droppedIndicesByRegion = {};
    dots.forEach(function (dot, i) {
      if (dot.kept) {
        dot.invited = true;
        return;
      }
      if (!droppedIndicesByRegion[dot.region]) droppedIndicesByRegion[dot.region] = [];
      droppedIndicesByRegion[dot.region].push(i);
    });
    Object.keys(droppedIndicesByRegion).forEach(function (region) {
      var indices = droppedIndicesByRegion[region];
      var extra = Math.max(0, (invitedQuotaByRegion[region] || 0) - (attendCountByRegion[region] || 0));
      shuffle(indices, rand)
        .slice(0, extra)
        .forEach(function (i) {
          dots[i].invited = true;
        });
    });

    return {
      dots: dots,
      clusters: clusters,
      ringRadius: ringRadius,
      phase1Total: data.phase1Total,
      keptTotal: keptTotal,
      invitedTotal: data.invitedTotal,
    };
  }

  function cloudPosition(dot, clock, driftSpeed) {
    return [
      dot.cloud.x + Math.sin(clock * dot.cloud.fx * driftSpeed * 3 + dot.cloud.px) * dot.cloud.ax,
      dot.cloud.y + Math.cos(clock * dot.cloud.fy * driftSpeed * 3 + dot.cloud.py) * dot.cloud.ay,
    ];
  }

  /** "orbit" (default) is the steady rotation. "pulse" is the alternative:
   * the same seats rotate at only PULSE_ROTATE_FRACTION of that speed while
   * their distance from the cluster center breathes in and out by
   * +/-PULSE_AMPLITUDE, in sync across every dot in the cluster (driven by
   * the cluster's own pulsePhase/pulsePeriod), so a whole conversation reads
   * as one slowly breathing body rather than a spinning ring. */
  function orbitPosition(dot, cluster, clock, orbitSpeed, mode) {
    if (!dot.orbit) return [cluster.x, cluster.y];
    if (mode === "pulse") {
      var a = dot.orbit.a0 + clock * orbitSpeed * dot.orbit.rate * PULSE_ROTATE_FRACTION;
      var breathe = 1 + PULSE_AMPLITUDE * Math.sin((clock / cluster.pulsePeriod) * Math.PI * 2 + cluster.pulsePhase);
      var r = dot.orbit.r * breathe;
      return [cluster.x + Math.cos(a) * r, cluster.y + Math.sin(a) * r];
    }
    var a2 = dot.orbit.a0 + clock * orbitSpeed * dot.orbit.rate;
    return [cluster.x + Math.cos(a2) * dot.orbit.r, cluster.y + Math.sin(a2) * dot.orbit.r];
  }

  /**
   * This sketch's own 4-stage numbering — 0 Phase 1 (cloud), 1 Selected
   * (invited-bright / dropped-dim split), 2 Phase 2 (gather, person
   * glyphs), 3 Conversations (orbit ring). Collapsed from the source
   * repo's shared 8-stage dotTarget() (funnelCloud.ts), which this sketch
   * only ever entered at its stages [0, 2, 3, 4] — see this file's header
   * comment for why the other 4 stages and the stage2Tier param don't need
   * to exist here.
   */
  function dotTarget(dot, stage, dimension, clusters, clock, driftSpeed, orbitSpeed, motionMode) {
    var category = dot[dimension];
    var cloud = cloudPosition(dot, clock, driftSpeed);
    var cloudX = cloud[0],
      cloudY = cloud[1];

    if (stage === 0) {
      return { x: cloudX, y: cloudY, r: DOT_SIZE, alpha: 0.62, categoryKey: category, person: false };
    }
    if (stage === 1) {
      var bright = dot.invited;
      return bright
        ? { x: cloudX, y: cloudY, r: DOT_SIZE, alpha: 1, categoryKey: category, person: false }
        : { x: cloudX, y: cloudY, r: DOT_SIZE, alpha: 0.1, categoryKey: "__dropped", person: false };
    }
    if (stage === 2) {
      return dot.kept
        ? {
            x: dot.gather[0],
            y: dot.gather[1],
            viaX: dot.neck[0],
            viaY: dot.neck[1],
            r: 7,
            alpha: 1,
            categoryKey: category,
            person: true,
          }
        : { x: dot.fall[0], y: dot.fall[1], r: DOT_SIZE, alpha: 0, categoryKey: "__dropped", person: false };
    }
    if (stage === 3) {
      if (!dot.kept || dot.group < 0) {
        return { x: dot.fall[0], y: dot.fall[1], r: DOT_SIZE, alpha: 0, categoryKey: "__dropped", person: false };
      }
      var pos = orbitPosition(dot, clusters[dot.group], clock, orbitSpeed, motionMode);
      return { x: pos[0], y: pos[1], r: 6, alpha: 1, categoryKey: category, person: false };
    }
    // Unreachable for any valid stage (0-3) — kept as a defined fallback
    // rather than a thrown error so an out-of-range stage degrades the same
    // way instead of crashing the animation loop.
    return { x: dot.fall[0], y: dot.fall[1], r: DOT_SIZE, alpha: 0, categoryKey: "__dropped", person: false };
  }

  // ---------------------------------------------------------------------
  // funnelSection.ts — stage copy, timing, and vertical-centering math.
  // ---------------------------------------------------------------------

  var SECTION_HEADING = "Who participated";

  /** Comms-rounded thousands separator, e.g. 2678 -> "2,678" — shared by
   * every hero stat and canvas label, so the same number never reads two
   * different ways in one pane. */
  function fmt(n) {
    return n.toLocaleString("en-US");
  }

  /**
   * Every hero number and sub-line here traces to funnel-data.js:
   *
   *   Phase 1        phase1Total   demographics export rows with a stated REGION
   *   Selected       invitedTotal  sortition Invited count, floored per-region at attendCount
   *   Phase 2        keptTotal     attendee demographics export row count (sessions' attendees)
   *   Conversations  sessions.length  distinct SESSION_DATE values
   *
   * @param {FunnelData} data
   */
  function buildSelectionStages(data) {
    var keptTotal = data.sessions.reduce(function (sum, s) {
      return sum + s.attendees.length;
    }, 0);
    return [
      {
        pill: "1 · Phase 1",
        phase: "Phase 1",
        title: "Broad listening",
        sub: "Californians responded to our open survey on AI",
        info: false,
        stat: { icon: "people", value: fmt(data.phase1Total), caption: "survey respondents" },
      },
      {
        pill: "2 · Selected",
        phase: "Phase 2",
        title: "Inviting a balanced audience",
        sub: "We selected a subset of respondents that reflects California",
        info: false,
        stat: { icon: "people", value: fmt(data.invitedTotal), caption: "invited" },
      },
      {
        pill: "3 · Phase 2",
        phase: "Phase 1",
        title: "Joining the conversation",
        sub: "These Californians RSVP’d “yes” and joined a discussion",
        info: false,
        stat: { icon: "people", value: fmt(keptTotal), caption: "attended" },
      },
      {
        pill: "4 · Conversations",
        phase: "Phase 2",
        title: "The discussion groups",
        sub: "Here are the demographics of each discussion",
        info: false,
        stat: { icon: "chats", value: fmt(data.sessions.length), caption: "conversations" },
      },
    ];
  }

  var SELECTION_STAGE_COUNT = 4;

  function easeInOut(x) {
    return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
  }

  /** Lifts the source's header crossfade math out into a pure function so
   * the DOM header tracks the same curve the dots move on. `t` is the
   * stage-transition progress (0-1) the render loop already tracks.
   *
   * Returns { k, useTo, opacity }:
   *   k       raw eased crossfade position, 0 at the old stage settling in,
   *           1 at the new stage settled.
   *   useTo   which stage's copy to show right now — false = stage being
   *           left, true = stage being entered.
   *   opacity 0-1 for the fading copy block, 0 at the exact midpoint, 1 at
   *           both ends.
   */
  function headerCrossfade(t) {
    var k = easeInOut(Math.min(1, t * 1.6));
    return { k: k, useTo: k >= 0.5, opacity: Math.abs(k - 0.5) * 2 };
  }

  /** Canvas-space vertical extent of each stage's dot content — measured
   * from the real layout (not hand-copied constants) so this stays correct
   * if the export's session count/sizes change. Stages 0 ("Phase 1") and 1
   * ("Selected") share the drifting cloud, so they share a band; stage 2
   * ("Phase 2") is the gather blob; stage 3 ("Conversations") is the orbit
   * ring. Used to vertically center every stage on the same line — see
   * selectionYShift below.
   *
   * @param {ReturnType<typeof buildFunnelCloud>} layout
   */
  function selectionStageBands(layout) {
    var cloudTop = Infinity,
      cloudBottom = -Infinity;
    layout.dots.forEach(function (dot) {
      var top = dot.cloud.y - dot.cloud.ay - DOT_SIZE;
      var bottom = dot.cloud.y + dot.cloud.ay + DOT_SIZE;
      if (top < cloudTop) cloudTop = top;
      if (bottom > cloudBottom) cloudBottom = bottom;
    });
    var cloudBand = { top: cloudTop, bottom: cloudBottom };

    // 7 is dotTarget's own stage-2 ("Phase 2") dot radius — named here
    // rather than as an exported constant since it's a draw-time literal.
    var GATHER_DOT_R = 7;
    var gatherTop = Infinity,
      gatherBottom = -Infinity;
    layout.dots.forEach(function (dot) {
      if (!dot.kept) return;
      var half = personHeightFor(GATHER_DOT_R) / 2;
      var top = dot.gather[1] - half;
      var bottom = dot.gather[1] + half;
      if (top < gatherTop) gatherTop = top;
      if (bottom > gatherBottom) gatherBottom = bottom;
    });
    var gatherBand = { top: gatherTop, bottom: gatherBottom };

    var ringTop = Infinity,
      ringBottom = -Infinity;
    layout.clusters.forEach(function (cl) {
      var top = cl.y - cl.rc;
      var bottom = cl.y + cl.rc;
      if (top < ringTop) ringTop = top;
      if (bottom > ringBottom) ringBottom = bottom;
    });
    var ringBand = { top: ringTop, bottom: ringBottom };

    return [cloudBand, cloudBand, gatherBand, ringBand];
  }

  /** Per-stage vertical offset that centers each of `bands`' own midpoint on
   * the midpoint of `[dotTop, dotBottom]` — apply `shift[stage]` to every y
   * (and viaY) a stage draws, and every stage's content shares one center
   * line. */
  function selectionYShift(bands, dotTop, dotBottom) {
    var target = (dotTop + dotBottom) / 2;
    return bands.map(function (b) {
      return target - (b.top + b.bottom) / 2;
    });
  }

  return {
    // personGlyph
    PERSON_PATH: PERSON_PATH,
    PERSON_BOX: PERSON_BOX,
    personHeightFor: personHeightFor,
    personWidthFor: personWidthFor,
    // labels
    wrapLabel: wrapLabel,
    // palette
    assignCategoryColors: assignCategoryColors,
    isNonAnswer: isNonAnswer,
    DATA_VIZ_NEUTRAL_LIGHT: DATA_VIZ_NEUTRAL_LIGHT,
    // funnelCloud
    CANVAS: CANVAS,
    CX: CX,
    CY: CY,
    DOT_SIZE: DOT_SIZE,
    buildFunnelCloud: buildFunnelCloud,
    dotTarget: dotTarget,
    orbitPosition: orbitPosition,
    // funnelSection
    SECTION_HEADING: SECTION_HEADING,
    fmt: fmt,
    buildSelectionStages: buildSelectionStages,
    SELECTION_STAGE_COUNT: SELECTION_STAGE_COUNT,
    headerCrossfade: headerCrossfade,
    selectionStageBands: selectionStageBands,
    selectionYShift: selectionYShift,
  };
})();
