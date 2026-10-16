# "Ideas we heard" — scroll-story word cloud (handoff)

> **Public-repo note:** `ideas-scroll-data.js`'s `poll` was refreshed on 2026-10-13 to the currently published
> `/public/data/ai-report-ideas-cloud.json` (229 poll ideas). Counts below that mention 135 poll
> ideas describe the 2026-09-18 snapshot. `design/exports-for-jim/` (the raw 337-label export) is not in this repo.

A report-page-styled variant of `sketches/policy-ideas-whirl-v1.html`
(the "policy ideas whirl" scroll story), reshaped to sit inside
`https://engaged.ca.gov/ai-impact/report/`'s
`#what-we-heard` section, with the intro composition borrowed from the LA
fires action-plan page (words arranged *around* the centred copy, not behind
it). Same convention as `handoff/participant-funnel/` and
`handoff/discussion-curtain/`: plain HTML/CSS/JS, no build step.

## Run it

```
cd <this folder>
python3 -m http.server 8765
# then http://127.0.0.1:8765/index.html
```

Serve it rather than open the `file://` path directly — `ideas-scroll-data.js`
is loaded with a cache-busting query string that needs http(s), same reason
as the sketches this is ported from. Fonts (Noto Sans) load from Google
Fonts; offline, the layout stays overlap-free (layout and drawing use the
same registered font either way) but falls back to Arial's metrics, which
changes the exact word sizes/positions.

## What's different from the sketch it's based on

1. **Copy plate** — one 8px-radius rounded rectangle behind each beat's copy,
   ~85% opaque, no feathered halo (was a triple box-shadow glow). Retune via
   the `--ideas-plate-opacity` CSS custom property.
2. **Report design match** — the report's own `--report-*` tokens, type scale
   and (approximate) Bootstrap container/grid, not the sketch's `ec-tokens`.
   See `report-tokens.css`'s own header for exactly what was copied from the
   live page and what's a stand-in.
3. **Words start around the copy, not the centre** — beat 1's arrival ring
   is built from the LA fires action-plan page's own composition (an ellipse
   of illustrations around a fixed hero column), reimplemented as a
   resize-aware function (`ideas-scroll-layout.js`'s `ringHomePositions`) so
   it works for however many words are seeded and clears the copy plate's
   *measured* size, not a hardcoded one.
4. **Title case** — every label passes through `WL.titleCase()`
   (`whirl-layout.js`, this bundle's own fork), AP-style, preserving
   already-all-caps tokens (`AI`, `UBI`) and never touching text after an
   apostrophe.
5. **Centred lines + size-dependent line height** — wrapped two-line labels
   centre each line instead of left-aligning it, and line height tightens
   from 1.22× at the smallest sizes toward ~1.02× at the largest. Both are
   applied identically in the d3-cloud fork's mask (`d3-cloud-multiline.js`,
   PATCH 9 + PATCH 10) and in `WL.drawWord` — see that file's PATCH comments
   for why matching the mask exactly is what keeps the zero-overlap
   guarantee real.
6. **Long tail hidden, edges feathered** — 35% of the count-1 poll ideas are
   dropped, deterministically (same seed every load); the remaining poll
   cloud lays out on a field 18% larger than the visible frame and fades out
   approaching that frame's edge, so it dissolves rather than stopping at a
   hard rectangle. Both apply to the poll cloud only — the 27 discussion
   ideas (the published shortlist) always render at full alpha, fully
   inside the field.

## A data-driven change this variant required

This bundle builds on the report's own **already-shipped**
`/public/data/ai-report-ideas-cloud.json` (135 poll ideas, not the 337-label
raw export the sketches use — see "Real data" below), not on
`sketches/.../whirl-data.js`. That file also carries a `keptLayouts["1400x820"]`
entry: a specific, previously-verified arrangement of the 27 discussion
ideas that the report's own shipped module reuses instead of recomputing.

**This bundle does not reuse it.** Change 5 above (centred lines +
size-dependent line height) changes exactly what a word's rendered ink looks
like at a given `x,y` — the saved layout's positions were verified safe
under the *old* left-aligned, fixed-1.22-line-height rendering. Reusing them
here produced 9 overlapping line pairs at full alpha
(`sketches/wordcloud-verify/ideas_scroll_render_check.js` caught this — see
Verification below); `WL.applySavedFinale`'s own match check didn't catch it
because it only compares label/lines/fontSize, none of which changed. So
`ideas-scroll.js` always computes the finale fresh
(`layoutFinale`/`layoutFinaleBalanced`), which is guaranteed safe for the
same reason the fork always has been: the code that builds the collision
mask and the code that draws are the same patched pair, kept in sync on
purpose. The trade-off is a font size about 1/3 smaller than the sketch's
own finale scale (1400×820 is under half the area of the sketch's shared
field) — `ideas-scroll.js`'s `layoutFinale` shrinks in a loop until all 27
fit with zero drops, logged to the console.

## File map

| File | Role |
|---|---|
| `index.html` | Page shell — an approximation of `#what-we-heard`'s real markup plus the pinned story |
| `report-tokens.css` | The report's own type/color/grid, copied from its live CSS — drop at integration, the real page already has it |
| `ideas-scroll.css` | This component's own styles: the copy plate, canvas, legend, caption, tooltip |
| `ideas-scroll-data.js` | The report's own `/public/data/ai-report-ideas-cloud.json`, inlined (fetch() is CORS-blocked on `file://`) |
| `d3-cloud-multiline.js` | Fork of Jason Davies' d3-cloud with multi-line labels — this bundle's own copy, with two additional patches (9, 10) on top of the upstream sketch's eight; see the file's own PATCH comments |
| `whirl-layout.js` | Layout engine (measurement, wrapping, seeding, d3-cloud runs, drawing) — this bundle's own fork, adding `titleCase`, `lineHeightFactor`, centred `drawWord`, and a case-normalised `applySavedFinale` label match |
| `ideas-scroll-layout.js` | Pure logic unique to this variant: sizing formulas, word-record building, long-tail sampling, ring seeding, edge feathering. No DOM — testable under plain Node |
| `ideas-scroll.js` | Everything DOM/canvas/scroll: the draw loop, GSAP + Lenis scroll wiring, hover, reduced-motion fallback |
| `vendor/` | d3 v7, GSAP 3.12.5 + ScrollTrigger, Lenis 1.3.8 (local copies, same as the sketches) |

`ideas-scroll-layout.js` decides sizes, which words survive the tail cut,
and where the arrival ring sits; `ideas-scroll.js` only draws and animates
what that module (plus `whirl-layout.js`'s d3-cloud calls) computes — same
split as `funnel-layout.js`/`funnel.js` in `handoff/participant-funnel/`.

## Integrating into the real page

1. Drop `report-tokens.css` — the real page already defines everything in it.
2. Copy `ideas-scroll.css`, `ideas-scroll-data.js` (or point `data-src` at the
   live JSON and add a real `fetch()` — this bundle inlines it only because
   of the `file://` CORS issue noted above), `d3-cloud-multiline.js`,
   `whirl-layout.js`, `ideas-scroll-layout.js`, `ideas-scroll.js`, and
   `vendor/` into the report's own static assets.
3. **The report page loads none of GSAP, ScrollTrigger or Lenis today** — this
   is the real integration cost of a pinned scroll story there (the report's
   own `#ideas-cloud` widget is a timed auto-play loop, not a scroll-pinned
   one). Confirm the added weight (`vendor/` is ~410KB unminified further)
   is acceptable, or swap to whatever the report's build already uses for
   equivalent behavior.
4. In `#what-we-heard`, add the `.ideas-scroll-story` block as a sibling of
   the section's `.container` divs — **not nested inside one**. A 100vh
   pinned element inside a centred Bootstrap container gets clipped to the
   text column; see `ideas-scroll.css`'s header comment.
5. Re-run the verification below against the integrated page, not just this
   preview shell — a different surrounding stylesheet can change the
   `.narrative-copy` plate's measured size, which feeds the ring-seeding math.

## Verification

1. **Serve and scroll** (see "Run it" above). Walk all three beats: words
   start on a ring around the copy, fly inward, dissolve into 8 colour
   masses, the 27 discussion ideas resolve. Scroll back up: beats hold at
   their finished state rather than unwinding.
2. **Zero overlap, end to end** — the check that matters most, since the
   centred-lines/line-height change touches the collision mask directly:
   ```
   cd sketches/wordcloud-verify
   node ideas_scroll_render_check.js
   ```
   Runs the reduced-motion path under Node with the real Noto Sans, records
   every `fillText()` call this bundle makes, rasterises each drawn line and
   fails on any two lines sharing an ink pixel. Confirmed clean (0 overlap
   pairs across all three beats) as of this bundle's last edit; re-run after
   any change to sizing, wrapping, or the fork.
3. **Dev assertions in the browser console** — `poll cloud dropped=0`,
   `finale dropped=0`, and a logged same-subtheme vs. cross-subtheme nearest-
   neighbour average (same-subtheme should be larger — interleaved, not
   clustered). A line also logs how many single-mention poll ideas were
   dropped by the long-tail cut.
4. **Reduced motion** — `prefers-reduced-motion: reduce` in devtools → three
   static sections, no pinning, no Lenis.
5. **Narrow viewport** — the ring seeding and edge feather both derive from
   field size; check phone width too.

## Real, unpublished-pipeline-floor data — please note

`ideas-scroll-data.js` is a snapshot of the report's own **already-shipped**
`/public/data/ai-report-ideas-cloud.json` (taken 2026-09-18) — the report
itself already serves this file publicly, so it's safe to keep here, unlike
the 337-label raw export the sketches in `design/exports-for-jim/` use (that
one includes single-respondent ideas in their own words with the pipeline's
privacy floor not yet applied — do not copy that file into this folder).
Hiding 35% of the count-1 poll ideas in this bundle is a visual-density
choice on that already-public data, not a privacy control — the caption and
this README both say so. Self-selected public consultation, not a
probability sample: percentages and counts describe the people who
responded, not Californians as a whole.
