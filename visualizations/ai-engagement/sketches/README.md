# Sketches

One-off design explorations from the AI consultation report. They're plain HTML with
inline JS and no build step. Most open with a double-click.

Two markers in the tables below:

- 🖥 **must be served over http**, because these files load their data with a
  cache-busting query. Run `python3 -m http.server 8765` from this folder, then open
  `http://127.0.0.1:8765/<file>`.
- 🌐 loads d3 from a CDN and needs an internet connection.

These are explorations, not production code. Versions (`-v2`, `-v3`, …) are kept so
the design history is visible.

## Participant funnel: from 2,700 survey respondents to 14 conversations

| File | What it explores |
|---|---|
| `participant-funnel.html` | Dots narrowing from Phase 1 respondents to 103 attendees in 14 conversation groups |
| `participant-funnel-cloud.html` | Same story as a drifting cloud that funnels down |
| `participant-funnel-implied.html` | Funnel shape implied by the flow of dots |
| `participant-funnel-visible.html` | Funnel drawn explicitly |
| `participant-funnel-region/*.html` | The four variants above, colored by region |

## Who participated: demographics

| File | What it explores |
|---|---|
| `before_after_graphs.html` (+ `_dark_mode`, `_dark_mode_more_fields`) | Phase 1 vs Phase 2 demographics against a California baseline (ACS) |
| `demo_chart2_v2.html`, `demo_chart2_v4.html`, `demo_chart2_v4-alt.html` | Target vs Phase 1 vs Phase 2 bar layouts (combined, vs-target, morph tabs) |
| `demo_charts_simplified_v2.html` | Survey respondents as stacked bars ⚠️ synthetic rows |
| `ring_chart_v1.html` | Phase 1 respondents as a region × age ring (aggregates) |
| `ring_chart_v2.html`, `ring_chart_v3.html` | Explorable ring: pick wedge/shade dimensions ⚠️ synthetic rows |

⚠️ **synthetic rows**: the per-respondent data in these files was randomly re-dealt.
Every category total matches the original, but no row is a real person.

## Ideas: Phase 1 survey ideas → Phase 2 policy ideas

| File | What it explores |
|---|---|
| `policy-ideas-whirl-v1.html` 🖥 🌐 | "A wide range of ideas" scroll story: the Phase 1 word cloud whirls into the 27 Phase 2 policy ideas |
| `ideas-we-heard-inline-v1.html` 🖥 🌐 | Self-animating inline version of the same |
| `finale-layout-picker-v1.html` 🖥 🌐 | Tool for generating, comparing and keeping finale word-cloud layouts (writes `whirl-finale-layout.js`) |
| `concept-scrollytelling.html`, `concept-scrollytelling-words*.html` | Bubble / word-cloud scrollytelling of how ideas were distilled |
| `concept-distillation.html` | Phase 1 concepts merging into Phase 2 |
| `concept-distillation-real-phase2-themes.html` | Same, with the real Phase 2 concepts and placeholder Phase 1 concepts |

Shared data and layout code:

- `whirl-data.js` holds the published word-cloud list from engaged.ca.gov.
- `whirl-layout.js`, `whirl-finale-layout.js` and `d3-cloud-multiline.js` are the layout
  engine, a saved finale layout, and a multi-line fork of d3-cloud.
- The Python scripts that built this data from internal exports live in
  [`../analysis/scripts/`](../analysis/scripts/README.md).

## `wordcloud-verify/`: word-cloud overlap diagnostics

Node scripts that render the word clouds with `canvas` and check for overlapping
labels at the pixel level. They were used to find and fix three mask/render mismatches
in the d3-cloud fork (`d3-cloud-multiline-proposed.diff`).

```sh
cd wordcloud-verify
npm ci                          # installs node-canvas and downloads the Noto Sans fonts
node whirl_overlap_diag.js --asis   # checks the shipped fork: 229/229 placed, 0 overlaps
# (--fixed re-applies the pre-2026-09-17 patches and fails on the current fork, which already has them)
```

`npm ci` runs `fetch-fonts.mjs`, which downloads Noto Sans Regular and Bold (SIL Open Font License)
from the official Noto release into `fonts/`, checking their hashes. That folder is gitignored.
`whirl_scroll_probe.js` also needs `npm i --no-save playwright-core` + `npx playwright install chromium`,
and this folder served at `http://127.0.0.1:8765` (`python3 -m http.server 8765`
from `sketches/`). The scripts write scratch PNGs and JS to `/tmp`.
