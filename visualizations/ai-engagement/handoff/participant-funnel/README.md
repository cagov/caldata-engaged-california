# "Who participated" — participant funnel sketch (handoff)

A standalone port of the `ParticipantFunnelSelection.svelte` prototype from
the EngagedCA AI-consultation visualization repo (`viz/`), for a developer
converting it to plain HTML/CSS/JS in another codebase. This folder **is**
that plain HTML/CSS/JS version — no build step, no npm install, no server.

## Run it

Double-click `index.html`, or open it directly in a browser
(`file:///…/participant-funnel/index.html`). That's the whole setup.

## What it shows

An animated funnel walking through four stages of a real state-agency public
consultation on AI:

1. **Phase 1** — 2,678 survey respondents, drawn as a drifting cloud of dots.
2. **Selected** — 948 of them, highlighted, were invited to a discussion
   (the rest dim).
3. **Phase 2** — 103 real attendees gather, drawn as person glyphs.
4. **Conversations** — those 103 people split into the 14 real discussion
   sessions they attended, arranged as an orbiting ring, colored by either
   **Region** or **Field of work** (toggle button, bottom-left of the
   canvas).

Controls: Play/Pause, Restart, jump to any of the 4 stages, Loop on/off,
Orbit vs. Pulse motion for the final ring. Space toggles play; Left/Right
arrow keys step between stages. `prefers-reduced-motion` is honored (stages
snap instead of animating). Colors follow OS light/dark mode automatically.

## File map

| File | Role |
|---|---|
| `index.html` | Page shell: fonts, header markup, canvas, controls. |
| `ec-tokens.css` | Engaged California design-system tokens — **unmodified copy** of `viz/src/styles/ec-tokens.css` in the source repo. |
| `funnel.css` | Every component style this sketch uses, de-scoped into plain class selectors — see "Where the styles came from" below. |
| `funnel-data.js` | The real export data (`analysis/artifacts/viz/funnel.json` in the source repo), inlined as `var FUNNEL_DATA = {...}`. |
| `funnel-layout.js` | Pure logic: layout math, animation targets, stage copy. No DOM/canvas calls — `var FunnelLayout = {...}`. |
| `funnel.js` | Everything DOM/canvas: the draw loop, the animation clock, event wiring. Reads `FUNNEL_DATA` and `FunnelLayout`. |

`funnel-layout.js` decides every position, color, and number; `funnel.js`
only draws and animates what that module computes. That split mirrors the
source repo's own `funnelCloud.ts`/`funnelSection.ts` vs.
`ParticipantFunnelSelection.svelte` split — keep it if you port this
further, it's what makes the layout math testable independent of a browser.

## Why classic `<script>` tags, not ES modules

Both `fetch()` and `<script type="module">` are blocked by CORS when the
page is opened as a `file://` URL, in every major browser. An ES-module
version would silently fail to run on double-click and force you to stand up
a local web server. So each file declares a plain global
(`FUNNEL_DATA`, `FunnelLayout`) and `index.html` loads them in a fixed order.
This is the one place this port deliberately uses an older idiom than the
source — switch to real modules the moment your own build serves this over
http(s).

## Where the styles came from

`funnel.css` merges the scoped styles of three Svelte components from the
source repo — `ParticipantFunnelSelection.svelte`, `FunnelSectionHeader.svelte`,
and `EcButton.svelte` — into plain class selectors (Svelte's per-component
scoping hashes aren't needed in a single-page document). Property values are
byte-identical; only the selectors changed.

It also carries over two rules the original component relied on but didn't
itself own, from the source repo's page shell (`viz/src/App.svelte`'s
`.viz-root`): the page background/padding, and `font-variant-numeric:
tabular-nums` on `.page`. Without `tabular-nums` the hero stat number
visibly changes width as it switches between stages (e.g. "103" → "2,678").

`ec-tokens.css` is the Engaged California design system's CSS custom
properties (colors, type scale, spacing) plus a light/dark semantic layer —
copied verbatim, not reproduced. If the design system updates, re-copy that
file rather than hand-editing values here.

## What was simplified out of the original, and why it's safe

The source `funnelCloud.ts` module is shared by **four** different
prototypes in the `viz/` app, and carries stage machinery, ramps, and a
dev-only toggle that only exist for the *other three*. This port strips all
of that. None of it changes what you see running this sketch:

1. **8 animation stages collapsed to 4.** The source's `dotTarget()`
   function handles stages 0–7 across all four prototypes; this sketch only
   ever used stages `[0, 2, 3, 4]` (reached through a lookup table,
   `libStageFor`). The port's `dotTarget()` takes `0–3` directly — cloud /
   invited-vs-dropped split / gather / ring.
2. **The "invited" vs. "attended" stat-tier parameter is hardcoded.** The
   source's `dotTarget()` has a `stage2Tier` param because this is the only
   one of the four prototypes that shows "invited" (948) rather than
   "attended" (103) at the Selected stage. The port's stage 1 always reads
   `dot.invited`.
3. **One color ramp, not two.** The source has a dev-only A/B toggle
   between two palette orderings ("Engaged" vs. "ODI"), explicitly marked in
   its own comments as removable once a design review was done. This port
   keeps only "Engaged" (the default), as the single ramp.
4. **No TypeScript.** Types became the `@typedef` JSDoc block at the top of
   `funnel-layout.js`. The explanatory comments from the source were kept
   line-for-line wherever a constant's *value* isn't self-explanatory (e.g.
   why the seat spacing is 20px, why the gather-packing multiplier is 2.5) —
   those explain tuning decisions you can't recover from the code alone.
5. **Both motion modes (Orbit/Pulse) and reduced-motion were kept**, unlike
   the palette toggle — these are real, user-facing controls in the sketch,
   and honoring `prefers-reduced-motion` is a baseline accessibility
   requirement for this project.

## Known state of the sketch itself (not introduced by this port)

- **The heading reads "Who participated,"** not "How we got to this list" —
  the source repo's own sidebar label and reference mockups still use the
  older name, but `funnelSection.ts`'s `SECTION_HEADING` constant (which
  this port matches) was already changed to "Who participated" before this
  handoff was made. Change the `SECTION_HEADING` value in
  `funnel-layout.js` if you want the older heading.
- **The `(i)` info-tooltip affordance is wired but never appears.** Every
  stage currently sets `info: false` in `buildSelectionStages()`. The DOM,
  CSS, and hover/focus logic are all ported and ready — set any stage's
  `info: true` in `funnel-layout.js` and give it copy via `selectionInfoText`
  in `funnel.js` to turn it on.

## Data

`funnel-data.js` is a byte-for-byte copy of the source repo's
`analysis/artifacts/viz/funnel.json` (generated 2026-09-11). It contains only
aggregate counts (2,678 survey respondents, 948 invited, per-region and
per-field-of-work survey/attend counts) and 103 `{region, fieldOfWork}` pairs
grouped into 14 dated sessions — no names, no record IDs, and no response
text of any kind. Safe to share, copy, and commit as-is.

## Verifying a port against this one

If you're re-implementing this in another language/framework, the numbers
below are exact and should reproduce identically given `funnel-data.js`'s
data and the `SEED = 20250825` constant in `funnel-layout.js` (the layout is
fully deterministic — same seed in, same dot positions/colors out, every
run):

- 2,678 total dots; 103 "kept" (real attendees); 948 "invited".
- Every kept dot is also invited (kept is a subset of invited).
- 14 conversation clusters, sized `[6, 12, 11, 5, 5, 7, 7, 5, 5, 12, 8, 8, 7, 5]`.
- Stage hero numbers: 2,678 → 948 → 103 → 14.
