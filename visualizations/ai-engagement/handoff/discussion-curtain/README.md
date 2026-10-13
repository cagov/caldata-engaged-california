# "Behind the curtain" — tab 1 of "The power of the discussion" (handoff)

A standalone port of just the **first tab** of the `DiscussionSection.svelte`
prototype ("The power of the discussion", three toggled views: Conversations
/ Concepts / Distillation) from the EngagedCA AI-consultation visualization
repo (`viz/`). No build step, no npm install, no server — this folder **is**
the plain HTML/CSS/JS version already.

Sibling to `../participant-funnel/` (same no-build pattern); this folder is
independently self-contained — nothing here imports from that one.

## Run it

Double-click `index.html`, or open
`file:///…/discussion-curtain/index.html` directly in a browser.

## What it shows

The 103 real Phase 2 attendees, already seated in their 14 real conversation
groups, arranged in a ring and colored by Region or Field of work (toggle,
bottom-left of the canvas). Hover or focus any conversation to open a
placeholder chat exchange from that room in the right-hand panel; click to
keep it pinned open (click elsewhere, or press Escape, to close it). Orbit
vs. Pulse controls the ring's ambient motion, same as the sibling handoff.

There's no play/pause/stage transport here — unlike the funnel handoff, this
view has exactly one resting state; the ring doesn't "arrive" from anywhere.

## Scope: only tab 1 of 3

The source component has two other tabs this handoff **does not include**:
**"Concepts"** (a sidebar of the 29 real policy concepts, grouped by
popularity, joined to conversations by hover) and **"Distillation"** (an
animation merging placeholder Phase 1 ideas into the real Phase 2 concepts).
Per this handoff's own scope, the 3-way view toggle itself is also dropped —
with nothing to switch to, a toggle bar showing one pressed button would
read as broken UI rather than a real control.

One copy line changed to match: the live prototype's "no linked concept"
caption reads *"Conversations like this one became the policy concepts —
see them next,"* referring to the Concepts tab. Since that tab doesn't exist
here, this port's copy is *"These conversations helped shape the policy
concepts identified in Phase 2"* instead.

## File map

| File | Role |
|---|---|
| `index.html` | Page shell: fonts, header markup, canvas, controls, peek panel. |
| `ec-tokens.css` | Design-system tokens — unmodified copy, same as the sibling handoff. |
| `discussion.css` | Every style this tab uses, de-scoped — see "Where the styles came from." |
| `discussion-data.js` | `FUNNEL_DATA` (full) + `ROOMS_DATA` (trimmed) inlined as globals. |
| `discussion-layout.js` | Pure logic: ring geometry, stage copy, placeholder-chat data shaping. No DOM/canvas calls — `var DiscussionLayout = {...}`. |
| `discussion.js` | Everything DOM/canvas: the draw loop, hover/pin interaction, event wiring. |

Same classic-`<script>`-tags reasoning as the sibling handoff (CORS blocks
both `fetch()` and `<script type="module">` on `file://` URLs) — see that
folder's README for the full explanation.

## What was rebuilt, not just ported

**`buildDiscussionRing()`** in `discussion-layout.js` is a deliberate
rebuild of the source's `buildFunnelCloud()`, not a verbatim port. The
source function models all 2,678 survey respondents as "dots" — 2,575 of
them "dropped," drawn as a background cloud — because its *other* sibling
prototypes (the funnel-selection view, the full 3-tab discussion section)
show that cloud. This tab's own `dotTarget` stage never does: dropped dots
draw at alpha 0 (invisible) at every stage this tab reaches. So
`buildDiscussionRing()` only ever constructs the **103 real attendees**
actually seated in the ring — no dropped-dot population, no proportional
category sampling, no `personGlyph.ts` (no person glyphs are ever drawn on
this tab either).

One consequence, called out in the code: the two prototypes' seeded RNGs
(`mulberry32(SEED)`, same `SEED = 20250825` constant) consume different
numbers of draws before reaching each cluster's pulse-jitter values, so a
given conversation's exact "breathing" phase/timing under Pulse motion will
look slightly different here than in the `participant-funnel` handoff or
the live 3-tab app. That's cosmetic only — every session's real attendee
list, every hero number, and every geometry invariant (ring radius, seat
spacing) is identical, since both derive from the same `funnel-data.js`
sessions.

## What was simplified out, and why it's safe

1. **No stage-transition machinery at all.** The source's `dotTarget`
   pipeline exists to animate *between* 8 stages; this tab is permanently
   "arrived" (`t` starts at 1 and never changes — see the source's own
   `init()` comment: "there is no stage 0-4 flight to arrive from"). The
   port skips `place()`, the transition `t`/`delay`/`easeInOut` lerp, and
   `goTo()`/`snapValues()` entirely, and computes each dot's ring position
   directly every frame.
2. **`insights.json` is not included at all.** See `discussion-data.js`'s
   header comment: that file's own metadata reads *"Hand-authored comms
   copy containing real participant speech... per README data rule 2."*
   Excluding it changes nothing observable — its `sessions` field (the only
   part that would feed real quotes into this tab) is empty in the current
   export, so the live prototype already shows 100% placeholder chat turns
   here. `buildConversationPeeks()` takes an optional
   `overridesBySessionNumber` map if you want to hand-author real quotes
   **locally** — keep that data in your own untracked file, never commit
   real response text.
3. **`rooms.json` is trimmed to `meta.sampleCaveat` + `sessions` only.**
   The full export's `themes`/`subthemes`/`concepts`/`ideas` arrays (policy
   concept vote aggregation) exist only to serve the Concepts tab, which
   this handoff doesn't include. `sessions` (id/number/date/attendee
   counts) is the only piece this tab reads — it's the join key for showing
   a conversation's real session number (e.g. "Conversation 7") instead of
   just a ring position.
4. **Hardcoded white surface, no light/dark token bridge.** This
   prototype's reference mockups are white-only — the live app pins it via
   a page-level `.white-surface` override (`viz/src/App.svelte`). This
   handoff reproduces that pin directly (`discussion.css`'s two-property
   `:root` override, plus `index.html`'s `data-theme="light"` attribute,
   which keeps `ec-tokens.css`'s own OS-dark-mode block from ever applying)
   and hardcodes the resolved canvas color constants, rather than porting
   `ecCanvasTokens.ts`'s runtime CSS-custom-property bridge for a surface
   that's designed to never actually switch.
5. **Dev-only palette A/B toggle dropped**, same rationale as the sibling
   handoff (source marks it explicitly removable once a design review
   settles).

## Where the styles came from

`discussion.css` merges: the *shared* chrome from `DiscussionSection.svelte`
(header layout, dimension toggle, peek hotspot/leader/panel — the
`.moments-sidebar`/`.info-wrap`/`.view-toggle` blocks belong to the other
two tabs and are dropped), `ConversationPeekCard.svelte`'s own styles, and
the three small `EcCard`/`EcGlyph`/`EcStatusPill` primitives, all de-scoped
to plain class selectors. `FunnelSectionHeader.svelte`'s header CSS and
`EcButton`'s pill variant are reproduced here byte-identically to the
sibling handoff's copies (each folder stays independently self-contained,
so nothing is shared by reference between them).

## Known state of the sketch itself (not introduced by this port)

The "This turned into: Policy concept — …" footer (`peek.linkedConceptName`)
never appears in this handoff's live behavior, for the same reason
placeholder quotes always show: it's only ever populated from
`insights.json`'s `sessions[].linkedConceptId`, which isn't included here.
The plumbing (`overridesBySessionNumber`) is there if you wire it up
locally.

## Verifying a port against this one

Deterministic given `discussion-data.js`'s data and the same
`SEED = 20250825` constant (see "What was rebuilt" above for the one caveat
on cluster pulse-jitter, which doesn't affect any of these numbers):

- 103 total ring dots, all "kept" (this tab never models a dropped
  population at all).
- 14 conversation clusters, sized `[6, 12, 11, 5, 5, 7, 7, 5, 5, 12, 8, 8, 7, 5]`.
- Header stat: 14 conversations.
- Every conversation's real (region, fieldOfWork) attendee pairs match
  `funnel-data.js`'s `sessions[].attendees` exactly — toggling Region vs.
  Field of work recolors the same 103 people, never changes who's shown.
