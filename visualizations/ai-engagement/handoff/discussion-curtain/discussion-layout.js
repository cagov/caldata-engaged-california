/**
 * Pure, DOM-free layout + copy for the "Behind the curtain" tab of "The
 * power of the discussion" prototype. No canvas/DOM calls anywhere in this
 * file — discussion.js only draws and animates what this module computes,
 * same split as the source Svelte component and its sibling handoff
 * (../participant-funnel/).
 *
 * Ported from (all under viz/src/lib/ in the main EngagedCA/AI_Deliberations
 * repo): funnelCloud.ts (orbitRings/orbitPosition only — see below),
 * discussionSection.ts, conversationPeek.ts, deliberativeMoments.ts
 * (attributionFor/sessionDateLabel only), labels.ts (wrapLabel), palette.ts
 * (assignCategoryColors + one ramp).
 *
 * DELIBERATE REBUILD, not a verbatim port, of one piece: buildFunnelCloud().
 * The source function builds all 2,678 survey respondents as "dots" (2,575
 * of them "dropped", drawn as a background cloud) because its own three
 * sibling prototypes show that cloud. This tab never does — dotTarget's
 * stages 5-7 draw dropped dots at alpha 0, i.e. invisible — so
 * buildDiscussionRing() below only ever constructs the 103 real attendees
 * actually seated in the ring. This means the two prototypes' seeded RNGs
 * diverge (this file's mulberry32(SEED) stream is consumed for far fewer
 * draws — only each cluster's own pulse-jitter, not a survey's worth of
 * cloud placement), so a cluster's exact breathing-motion phase/period here
 * will look slightly different from the same conversation's ring in the
 * `participant-funnel` handoff or the live app. That's a cosmetic-only
 * difference (nothing here claims bit-for-bit visual parity with those
 * other views) — every number and every real (region, fieldOfWork) pair is
 * identical, since both derive from the same funnel-data.js sessions.
 *
 * Uses `var DiscussionLayout = { ... }` (a single global object), not ES
 * module exports — see ../participant-funnel/README.md's "classic <script>
 * tags" section for why (fetch()/modules are CORS-blocked on file://).
 */
var DiscussionLayout = (function () {
  "use strict";

  /**
   * @typedef {Object} FunnelAttendee
   * @property {string} region
   * @property {string} fieldOfWork
   *
   * @typedef {Object} FunnelSession
   * @property {string} date
   * @property {FunnelAttendee[]} attendees
   *
   * @typedef {Object} FunnelData
   * @property {{sampleCaveat: string}} meta
   * @property {{name:string,surveyCount:number,attendCount:number}[]} regions
   * @property {{name:string,surveyCount:number,attendCount:number}[]} fieldOfWork
   * @property {FunnelSession[]} sessions
   *
   * @typedef {Object} RoomsSession
   * @property {number} number
   * @property {string} date
   *
   * @typedef {Object} RoomsData
   * @property {{sampleCaveat: string}} meta
   * @property {RoomsSession[]} sessions
   */

  // ---------------------------------------------------------------------
  // labels.ts — wrapLabel, verbatim (same as participant-funnel's copy)
  // ---------------------------------------------------------------------

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
  // palette.ts — assignCategoryColors + the "Engaged" ramp (same as
  // participant-funnel's copy — one palette for the whole app).
  // ---------------------------------------------------------------------

  var DATA_VIZ_CAT = ["#53cab0", "#65ade1", "#c591da", "#ee9930", "#6d4884", "#e45d48", "#6c8043", "#a9d4f2", "#75bc60", "#f2c3c7"];
  var DATA_VIZ_CAT_LIGHTER = ["#7fa1c2", "#f4cea1", "#a395d5", "#eca995", "#98decd", "#ecac67", "#abccde", "#75bc60", "#c591da"];
  var DATA_VIZ_NEUTRAL_LIGHT = "#bcbbc1";
  var NON_ANSWER = { "(not stated)": true, "I don't want to say": true };

  function isNonAnswer(value) {
    return !!NON_ANSWER[value];
  }

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
  // funnelCloud.ts — geometry constants + orbitRings/orbitPosition,
  // verbatim. RING_SHIFT_X/PULSE_* are this section's own tuning (how far
  // left the ring sits to leave room for the peek panel, and the "pulse"
  // motion's breathing amplitude/rate) — unchanged from the source.
  // ---------------------------------------------------------------------

  var CANVAS = { W: 1040, H: 812 };
  var CX = CANVAS.W / 2;
  var CY = 435;
  var SEAT_SPACING = 20;
  var RING_SHIFT_X = 215;
  var PULSE_AMPLITUDE = 0.08;
  var PULSE_ROTATE_FRACTION = 0.08;
  var PULSE_PERIOD_BASE = 8.8;
  var PULSE_PERIOD_JITTER = 0.3;
  var SEED = 20250825;

  function mulberry32(a) {
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // A two-ring cluster's inner and outer seats rotate at different rates, so
  // the gap between rings has to clear a stacked pair — see funnelCloud.ts's
  // RING_GAP comment in the source repo. This tab never draws person
  // glyphs (only plain dots, r=6, at every stage it reaches), so the gap is
  // pinned at the same 25px the source's RING_GAP resolves to for a dot-only
  // ring (personHeightFor(6) + 8 = 1.55*2*6 + 8 = 26.6 ≈ RING_GAP's real
  // value there) — close enough that no session in the real 14-session
  // layout crosses into a two-ring cluster at all (max session size 12; see
  // orbitRings below, single-ring covers up to n≈14 at this SEAT_SPACING),
  // so this constant is never actually exercised by today's export.
  var RING_GAP = 27;

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

  /** "orbit" (default) is the steady rotation. "pulse" is the alternative:
   * the same seats rotate at only PULSE_ROTATE_FRACTION of that speed while
   * their distance from the cluster center breathes in and out by
   * +/-PULSE_AMPLITUDE, in sync across every dot in the cluster. */
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
   * Builds the 14 conversation rings and their 103 real attendee seats —
   * see this file's header comment for why this only ever models the kept
   * (real attendee) dots, never the ~2,575 dropped ones the sibling
   * prototypes' clouds need.
   *
   * @param {FunnelData} data
   */
  function buildDiscussionRing(data) {
    var rand = mulberry32(SEED);

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

    var dots = [];
    data.sessions.forEach(function (s, g) {
      var rings = clusters[g].rings;
      var seatCursor = 0;
      rings.forEach(function (ring) {
        for (var k = 0; k < ring.count; k++, seatCursor++) {
          var attendee = s.attendees[seatCursor];
          dots.push({
            region: attendee.region,
            fieldOfWork: attendee.fieldOfWork,
            group: g,
            orbit: {
              r: ring.r,
              rate: ring.rate,
              a0: clusters[g].ang + Math.PI + (seatCursor / ring.count) * Math.PI * 2,
            },
          });
        }
      });
    });

    return { dots: dots, clusters: clusters, ringRadius: ringRadius, keptTotal: dots.length };
  }

  // ---------------------------------------------------------------------
  // discussionSection.ts — this tab's own header copy. Only the "curtain"
  // view (the source's first of three) — the "moments"/"concepts" entries
  // buildDiscussionViews() also returns belong to the other two tabs.
  // ---------------------------------------------------------------------

  var DISCUSSION_HEADING = "The power of the discussion";

  function fmt(n) {
    return n.toLocaleString("en-US");
  }

  /** @param {number} conversationCount */
  function buildCurtainView(conversationCount) {
    return {
      phase: "Phase 2",
      title: "Participants shared their thoughts, concerns and solutions",
      sub: "Look inside the conversations to see how policy ideas took shape",
      stat: { icon: "chats", value: String(conversationCount), caption: "conversations" },
    };
  }

  // ---------------------------------------------------------------------
  // deliberativeMoments.ts — attributionFor + its phrase tables, and
  // sessionDateLabel from conversationPeek.ts. Both verbatim.
  // ---------------------------------------------------------------------

  var FIELD_OF_WORK_PHRASE = {
    Government: "government worker",
    Other: "worker",
    "Information technology": "IT worker",
    Creative: "creative worker",
    Education: "education worker",
    "Professional services": "professional services worker",
    Healthcare: "healthcare worker",
    Financial: "finance worker",
    "Goods producing and harvesting": "goods and harvesting worker",
    Retail: "retail worker",
    Logistics: "logistics worker",
    Hospitality: "hospitality worker",
  };

  var REGION_PHRASE = {
    "Los Angeles": "in Los Angeles",
    "Bay Area": "in the Bay Area",
    "Southern California": "in Southern California",
    "Sacramento Valley / Sierra Foothills": "in the Sacramento Valley / Sierra Foothills",
    "Central Valley": "in the Central Valley",
    "Far North / North Coast": "in the Far North / North Coast",
    "Central Coast": "in the Central Coast",
    "Sierra Region": "in the Sierra Region",
  };

  function capitalizeFirst(s) {
    return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
  }

  /** Picks a real attendee of the given session (deterministically, by
   * `seed`) and describes them as "<field-of-work phrase> <region phrase>",
   * e.g. "finance worker in the Bay Area". This attendee is real; the quote
   * text placed next to their byline is not — see PEEK_TURN_SETS below. */
  function attributionFor(attendees, seed) {
    if (attendees.length === 0) return "An attendee";
    var index = ((seed % attendees.length) + attendees.length) % attendees.length;
    var attendee = attendees[index];
    var work = FIELD_OF_WORK_PHRASE[attendee.fieldOfWork] || "attendee";
    var region = REGION_PHRASE[attendee.region];
    return capitalizeFirst(region ? work + " " + region : work);
  }

  var MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

  /** Formats a cluster's raw "YYYY-MM-DD" date string as "July 17" — by
   * hand-parsing the parts, not `new Date(iso)`, which parses as UTC and
   * can render the previous day once formatted back out in a
   * negative-UTC-offset timezone like America/Los_Angeles. */
  function sessionDateLabel(iso) {
    var parts = iso.split("-");
    var month = MONTH_NAMES[Number(parts[1]) - 1] || "";
    var day = Number(parts[2]);
    return month + " " + day;
  }

  // ---------------------------------------------------------------------
  // conversationPeek.ts — placeholder chat turns + the per-cluster peek
  // data structure. `overridesBySessionNumber` (new — not in the source)
  // is this port's extension point for a developer who later hand-authors
  // real, locally-kept quotes without touching this file: see README.md.
  // ---------------------------------------------------------------------

  var PEEK_TURN_SETS = [
    {
      observation: "Placeholder — an opening observation from this conversation would appear here.",
      agreement: "Placeholder — I agree, and here's why that matters to me.",
      proposal: "Placeholder — let's propose the policy wording as this.",
    },
    {
      observation: "Placeholder — someone raises a concern they've run into personally.",
      agreement: "Placeholder — that matches what I've seen too.",
      proposal: "Placeholder — what if the state required this instead?",
    },
    {
      observation: "Placeholder — a question about how this would actually work.",
      agreement: "Placeholder — good point, and it applies to my field as well.",
      proposal: "Placeholder — so the idea we'd want to submit is this.",
    },
    {
      observation: "Placeholder — a story about how this already showed up at work.",
      agreement: "Placeholder — same here, more often than I expected.",
      proposal: "Placeholder — let's write that up as a concrete ask.",
    },
  ];
  var TURN_ROLES = ["observation", "agreement", "proposal"];

  function mod(n, m) {
    return ((n % m) + m) % m;
  }

  function buildTurns(attendees, seed) {
    var set = PEEK_TURN_SETS[mod(seed, PEEK_TURN_SETS.length)];
    var n = attendees.length;
    return TURN_ROLES.map(function (role, i) {
      var attendee = n > 0 ? attendees[mod(seed + i, n)] : undefined;
      return {
        text: set[role],
        byline: attributionFor(attendees, seed + i),
        region: attendee ? attendee.region : "",
        fieldOfWork: attendee ? attendee.fieldOfWork : "",
        isPlaceholder: true,
      };
    });
  }

  /**
   * `joinBySessionNumber`: funnel-data.js's clusters carry only a session
   * `date`; rooms-data.js's sessions carry `number` and `date`. All 14
   * dates match 1:1 — this is the one join point between the two files.
   */
  function joinBySessionNumber(roomsSessions, clusters) {
    var clusterIndexByDate = {};
    clusters.forEach(function (cl, i) {
      clusterIndexByDate[cl.date] = i;
    });
    var sessionNumberByCluster = {};
    roomsSessions.forEach(function (session) {
      var clusterIndex = clusterIndexByDate[session.date];
      if (clusterIndex !== undefined) sessionNumberByCluster[clusterIndex] = session.number;
    });
    return sessionNumberByCluster;
  }

  /**
   * One peek per cluster, in ring order. `overridesBySessionNumber` (keyed
   * by rooms-data.js session `number`, e.g. `7`) is an optional
   * `{ turns?, linkedConceptName? }` map — see this file's own note above.
   */
  function buildConversationPeeks(clusters, roomsSessions, attendeesOf, overridesBySessionNumber) {
    var overrides = overridesBySessionNumber || {};
    var sessionNumberByCluster = joinBySessionNumber(roomsSessions, clusters);
    return clusters.map(function (cluster, clusterIndex) {
      var attendees = attendeesOf(clusterIndex);
      var sessionNumber = sessionNumberByCluster[clusterIndex];
      if (sessionNumber === undefined) sessionNumber = null;
      var override = sessionNumber !== null ? overrides[sessionNumber] : undefined;
      return {
        clusterIndex: clusterIndex,
        sessionNumber: sessionNumber,
        date: cluster.date,
        dateLabel: sessionDateLabel(cluster.date),
        attendeeCount: attendees.length,
        turns: override && override.turns ? override.turns : buildTurns(attendees, clusterIndex),
        linkedConceptName: (override && override.linkedConceptName) || null,
      };
    });
  }

  return {
    // labels
    wrapLabel: wrapLabel,
    // palette
    assignCategoryColors: assignCategoryColors,
    DATA_VIZ_NEUTRAL_LIGHT: DATA_VIZ_NEUTRAL_LIGHT,
    // funnelCloud geometry
    CANVAS: CANVAS,
    CX: CX,
    CY: CY,
    RING_SHIFT_X: RING_SHIFT_X,
    PULSE_AMPLITUDE: PULSE_AMPLITUDE,
    buildDiscussionRing: buildDiscussionRing,
    orbitPosition: orbitPosition,
    // discussionSection
    DISCUSSION_HEADING: DISCUSSION_HEADING,
    fmt: fmt,
    buildCurtainView: buildCurtainView,
    // deliberativeMoments / conversationPeek
    attributionFor: attributionFor,
    sessionDateLabel: sessionDateLabel,
    buildConversationPeeks: buildConversationPeeks,
  };
})();
