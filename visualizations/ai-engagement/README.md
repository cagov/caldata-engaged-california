# AI engagement visualizations

Prototype code from the Engaged California consultation on AI and work
("Impact of AI on work"). Phase 1 was an open survey (2,702 respondents). Phase 2
was 14 small-group discussions (103 participants). The published report is at
<https://engaged.ca.gov/ai-impact/report/>.

This folder holds the design prototypes and the analysis pipeline behind that
report. **It does not hold the data.**

> [!IMPORTANT]
> **Real response data has been removed from this repo.** Survey answers, open-text
> responses, demographic exports, Phase 2 idea text, attendee lists and the
> deliberation workbooks are not included and are gitignored. Where code needs data,
> it runs on one of two things:
>
> - **synthetic stand-ins** — every fake free-text answer starts with `[SYNTHETIC]`
> - **copies of figures already published on engaged.ca.gov**
>
> Numbers and quotes in the running prototypes are therefore either fake or already
> public. See [Data in this repo](#data-in-this-repo) for exactly which is which.

## What's here

| Folder | What it is | How to run |
|---|---|---|
| [`viz/`](viz/) | Svelte 5 + Vite app with 12 interactive prototypes (beeswarm, circles, deliberation rooms, distillation, participant funnel, "power of the discussion") | `npm run dev` (see below) |
| [`synthetic-data/`](synthetic-data/) | Generator for the fake data the app and pipeline run on | `npm run generate` |
| [`sketches/`](sketches/) | One-off HTML/JS design sketches (word clouds, funnels, ring charts, demographic bars) | open in a browser (some need serving, see below) |
| [`handoff/`](handoff/) | Three self-contained, no-build ports handed to the web team | serve the folder, open `index.html` |
| [`analysis/`](analysis/) | TypeScript pipeline: audit → clean → LLM-assisted theme coding → aggregation → viz exports. `analysis/scripts/` holds two Python data-prep scripts behind the sketches | `npm test`; stages per below |
| [`docs/`](docs/) | [`SOURCE.md`](docs/SOURCE.md): data provenance notes. [`DATA-SOURCES.md`](docs/DATA-SOURCES.md): inventory of every source file and how each JSON was built | — |

You need **Node.js 22 or newer** for `viz/`, `synthetic-data/` and `analysis/`.
The sketches and handoffs only need a browser.

## Run the Svelte prototypes (`viz/`)

```sh
cd synthetic-data
npm ci
npm run generate        # writes synthetic-data/out/viz/*.json (gitignored)

cd ../viz
npm ci
npm run dev             # open the printed URL, then pick a prototype in the sidebar
```

Other commands, run from `viz/`:

```sh
npm test                # unit tests (layout/geometry/data logic)
npm run typecheck       # tsc + svelte-check
npm run build           # static build into viz/dist/
```

The app reads its data from `synthetic-data/out/viz/` by default. If you have the
real export (internal only), point it there instead:
`VIZ_DATA_DIR=../analysis/artifacts/viz npm run dev`.

## Open the sketches and handoffs (no build)

These are standalone HTML files with no build step. **The simplest way to open them is to
serve this folder:**

```sh
python3 -m http.server 8765    # from this folder
# then open http://127.0.0.1:8765/sketches/ or http://127.0.0.1:8765/handoff/
```

Most files also open with a double-click. Four don't: they load their data with a
cache-busting query string and need to be served over http.

- `handoff/ideas-we-heard-scroll/`
- `sketches/policy-ideas-whirl-v1.html`
- `sketches/ideas-we-heard-inline-v1.html`
- `sketches/finale-layout-picker-v1.html`

- [`sketches/README.md`](sketches/README.md) lists every sketch with a short description.
- Each handoff folder has its own README: [participant funnel](handoff/participant-funnel/README.md),
  [discussion "behind the curtain"](handoff/discussion-curtain/README.md) and
  [ideas-we-heard scroll story](handoff/ideas-we-heard-scroll/README.md).
- A few word-cloud sketches load d3 / GSAP from a CDN, so they need an internet connection.
  The handoffs bundle their libraries in `vendor/`.

Comments in these files sometimes mention `sketches/`. That was the internal design
folder: its code is `sketches/` here, and its images, SVGs and the design-system zip
were not included.

## Analysis pipeline (`analysis/`)

```sh
cd analysis
npm ci
npm test                # runs without data or an API key; tests that need real data skip themselves
```

The stages (`npm run <name>`) are listed below, along with what each needs:

| Stage | Needs |
|---|---|
| `audit`, `clean`, `status` | the survey CSV, or the synthetic one (see below) |
| `judge`, `discover`, `classify`, `classify-ideas` | `ANTHROPIC_API_KEY` in `analysis/.env` (see `.env.example`) + real data |
| `corpus`, `mergedoc`, `gaps`, `dups`, `aggregate`, `themes-csv`, `respondents-readable` | outputs of earlier stages |
| `vizdata` | earlier-stage outputs + the attendee export (internal) |
| `rooms`, `crosswalk`, `figjam-linkage`, `funnel` | the Phase 2 workbook, attendee and sortition exports (internal) |

To try the offline stages on synthetic data:

```sh
# after `npm run generate` in synthetic-data/
EC_DATA_DIR=../synthetic-data/out/data EC_WORK_DIR=../synthetic-data/out/work npm run audit
EC_DATA_DIR=../synthetic-data/out/data EC_WORK_DIR=../synthetic-data/out/work npm run clean
EC_DATA_DIR=../synthetic-data/out/data EC_WORK_DIR=../synthetic-data/out/work npm run status
```

`EC_DATA_DIR` is where input exports live (default `../data`). `EC_WORK_DIR` is where
stage outputs are written (default `analysis/`). Both default paths are gitignored.

The LLM model is pinned in `analysis/src/config.ts` (`PIPELINE_MODEL`).

## Data sources and provenance

The source data files aren't in this repo, but they are fully documented:

- **[`docs/SOURCE.md`](docs/SOURCE.md)** covers provenance: where each export came from
  (Snowflake for the survey and attendee exports), how the exports changed over time,
  the policy-ideas workbook, the Phase 1 → Phase 2 crosswalk method, and the
  publication record.
- **[`docs/DATA-SOURCES.md`](docs/DATA-SOURCES.md)** is the inventory. It lists every
  source CSV and XLSX by name, size and SHA-256, which stage or script reads it, and how
  each viz JSON was built (inputs, hashes and run dates from the pipeline's manifests).
  It also says where each sketch's embedded data came from, and flags the places where
  the trail is incomplete.

## Data in this repo

| Kind | Where | Notes |
|---|---|---|
| **Published** (copied from engaged.ca.gov) | `synthetic-data/inputs/published/`, `funnel.json` and `insights.json` written by the generator, `sketches/whirl-data.js` Phase 1 + Phase 2 labels, `handoff/ideas-we-heard-scroll/ideas-scroll-data.js` | Participant-funnel counts, the "Ideas we heard" word cloud, and the 9 discussion quotes printed in the report, with their published bylines |
| **Public names** | `analysis/config/codebook.json` (theme codes, labels, definitions), `synthetic-data/inputs/phase2-taxonomy.json`, crosswalks | Theme, subtheme and policy-concept names |
| **Synthetic** | everything `synthetic-data/` generates: respondents, all free-text answers, Phase 2 ideas, votes, crosswalk counts, a fake survey CSV | Seeded and reproducible. Free text starts with `[SYNTHETIC]` |
| **Aggregates** | `handoff/participant-funnel/funnel-data.js`, `handoff/discussion-curtain/discussion-data.js`, `sketches/*funnel*.html`, `sketches/demo_chart2*.html`, `sketches/before_after_graphs*.html`, `sketches/ring_chart_v1.html` | Category totals from 2026-08/09 snapshots of breakdowns the report now publishes. The two handoff files also hold one anonymous {region, field of work} pair per discussion attendee, which the report publishes in the same form. Sortition targets are census-derived |

**Files where real content was replaced with dummy data:**

- `analysis/config/codebook.json`: every theme's `examples` (originally verbatim
  survey answers) is synthetic. `includes` cue phrases that had been taken from answers
  were reworded.
- `analysis/config/figjam-idea-concept-map.json`: sticky-note text (participant ideas)
  is synthetic, and the internal FigJam link is redacted. Positions, colors and
  concept labels are unchanged. Because of this, the `figjam-linkage` stage needs the
  original internal file.
- `sketches/ring_chart_v2.html`, `ring_chart_v3.html`, `demo_charts_simplified_v2.html`:
  the one-row-per-respondent `RING_DATA` is randomly re-dealt. Every category total
  (overall and among attendees) matches the original, but no row is a real person.
- `sketches/whirl-data.js` and `handoff/ideas-we-heard-scroll/ideas-scroll-data.js`:
  the Phase 1 idea list is exactly the published word-cloud list.

## Data rules

Comments in the code refer to these by number ("README data rule 2"):

1. **A human approves the codebook.** Discovery proposes themes and a person merges
   them. Classification runs only against a human-approved codebook version. Nobody
   changes a theme's definition and reports that theme's prevalence in the same pass.
2. **Never commit response text.** Survey answers, idea text and discussion speech
   stay out of git, commit messages and PR descriptions. `data/`,
   `analysis/{data,corpus,artifacts,reports}/` and `.env` are gitignored.
3. **Every published number traces back**: report → aggregation manifest → frozen
   `labels.jsonl` → archived raw model outputs → codebook version → input-file hash.
   Aggregation reads saved artifacts; it never re-runs the model.
4. **The pipeline model is pinned** in `analysis/src/config.ts`. Don't substitute it.
5. **Every published figure carries its caveats.** Respondents can raise several
   themes, so percentages don't sum to 100. The sample is self-selected, not
   representative. "I don't want to say" is a refusal and gets its own category,
   separate from blank.

## Privacy check

Run this before every commit that touches data files:

```sh
node scripts/privacy-scan.mjs
```

It checks for data and media files, `.env` files, key-shaped strings, home-directory
paths and internal hostnames. Run it from this folder; it needs no install.

With access to the internal exports, add the real-text check. It flags any 30+
character run shared with real answers, idea text or quotes:

```sh
node scripts/privacy-scan.mjs --real-data ../data --real-data analysis/artifacts/viz/insights.json
```

Text that's public is allowed: anything published on engaged.ca.gov, plus theme and
concept names. Reviewed coincidences (common phrases in staff-written text) are listed,
each with a reason, in `scripts/privacy-allowlist.json`.

## Third-party code and assets

| What | Where | License |
|---|---|---|
| [d3](https://d3js.org) | `handoff/ideas-we-heard-scroll/vendor/`, CDN in sketches; `d3-scale` in `viz/` | ISC |
| [d3-cloud](https://github.com/jasondavies/d3-cloud) (modified fork) | `sketches/d3-cloud-multiline.js`, `handoff/ideas-we-heard-scroll/` | BSD-3-Clause |
| [Lenis](https://github.com/darkroomengineering/lenis) | `handoff/ideas-we-heard-scroll/vendor/` | MIT |
| [GSAP](https://gsap.com) + ScrollTrigger | `handoff/ideas-we-heard-scroll/vendor/` | [GSAP standard license](https://gsap.com/standard-license) |
| [Noto Sans](https://fonts.google.com/noto/specimen/Noto+Sans) | downloaded into `sketches/wordcloud-verify/fonts/` on `npm ci` (not committed) | SIL Open Font License 1.1 |
| [Phosphor Icons](https://phosphoricons.com) (thin "Users", "Chats", "Lightbulb"), inlined as SVG paths | `viz/src/components/ec/` | MIT |

Everything else is covered by this repository's [LICENSE](../../LICENSE).
