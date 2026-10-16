# Data sources

Every internal data file this code was built from, what reads it, and what it produced.
**None of these files are in this repository** (README data rule 2). They're listed by
name, size and SHA-256 so that anyone with internal access can confirm they hold the
same file (`shasum -a 256 <file>`).

[`SOURCE.md`](SOURCE.md) has the narrative provenance: where each export came from
(Snowflake for the survey and attendee exports), how the exports changed, and known
reconciliation issues. This file is the inventory and the build trail.

Snapshot taken 2026-10-13 from the project's internal `data/` folder and the run
manifests the pipeline writes (`analysis/artifacts/**/manifest*.json`, gitignored).
Times below are UTC, as recorded in those manifests. Anything that couldn't be traced
is marked **not recorded**.

## 1. Source files

### Read by the pipeline (`analysis/src/config.ts`)

| File | Shape | SHA-256 | Read by |
|---|---|---|---|
| `survey respondent demographics, 2026-08-18-1554.csv` | 2,702 rows × 15 cols | `bdfb1b6228421cdf46c3bf36f585eaf7bb615e79ebec551f85bfe5bcb87890c0` | `DATA_CSV`: audit (s01), clean (s02) → every Phase 1 stage |
| `survey respondent demographics 2026-08-28.csv` | 2,702 rows × 16 cols | `1d5cc45547b24808425647747d39d3a396bcdc83086f5eb3f4d724d24741f0d3` | `DEMOGRAPHICS_ROLLUP_CSV`: funnel (s17); field-of-work rollup |
| `attendee demographics, 2026-08-18-1424.csv` | 103 rows × 26 cols | `13e4f2249a700c63e8e44e5da1058bfd252fe79ab648b8e862bb1ddb0264e8c1` | `ATTENDEE_CSV`: vizdata (s12, the Phase segment), funnel (s17) |
| `Sortition Candidates and Attendance Rates.csv` | 8 rows × 17 cols | `45874d5e968cde430a99435aec11f4a8a9cfc33ce00596be3dac4bedff7080f9` | `SORTITION_CSV`: funnel (s17, invited by region) |
| `Policy ideas with votes (sessions 1-14).xlsx` | workbook | `033431a6cad0fd8141b707ce842c13db2043146c78b6d4d62b3027c52cb1ad0c` | `ROOMS_XLSX`: rooms (s13) |
| `Policy ideas with votes (sessions 1-14) - Themes, subthemes, policy concepts-v2.csv` | 31 rows × 16 cols | `fbb7ffed893f3e3634da287c024d5173ada02b8f3eeacc007e19833528b506b7` | `POLICY_CONCEPTS_V2_CSV`: concept ranking metrics (crosswalk test) |

### Read by the Python data-prep scripts (`analysis/scripts/`)

| File | Shape | SHA-256 | Read by |
|---|---|---|---|
| `all_phase1_opentext_responses.csv` | 2,514 rows × 4 cols | `ceee7f65dc9775c0600e505de3af1666502f884e70e9bacb796a9cf185612d3a` | `phase1_keyword_counts.py` |
| `Copy of Source of truth - Policy concepts, descriptions, subthemes, themes - … (1).csv` | 41 rows × 22 cols | `5a26213580354f91b39e98e5343ca01cd4050d911ab53b19c6e3aa1ead9742e9` | `phase1_keyword_counts.py`, `whirl_data.py` |
| `policy_concepts_ph1_2026-09-15.csv` | 352 rows × 5 cols | `1ff7479550b995d29be6cfb73b2b574c5a830dcccc776e47ffeaa7b1df965f42` | `whirl_data.py` |

### Used for sketch data (the builder script is **not recorded**)

| File | Shape | SHA-256 | Fed |
|---|---|---|---|
| `survey respondent demographics and status 2026-09-04.csv` | 2,421 rows × 17 cols | `63873e2739294b5fe9751180db7242d3768e3b300149cd04487d53829f05bedb` | `RING_DATA` in `sketches/ring_chart_v3.html` and `demo_charts_simplified_v2.html` |
| `survey respondent demographics and status 2026-09-02.csv` | 3,858 rows (recorded in the sketch) | **not recorded**: file no longer present | `RING_DATA` in `sketches/ring_chart_v2.html` |
| `policy_concepts_ph1_n25_2026-09-14-1835.csv` | 337 rows × 4 cols | `d926018488c908eec551781c790b324111179967dc137a5fd2d2bd20f971322a` | an earlier version of the whirl sketches (replaced by the published list) |
| `phase-1.csv` | **not recorded** | **not recorded** | `sketches/ring_chart_v1.html` (named in the sketch) |
| `chart_data.csv` | **not recorded** | **not recorded** | `CHART_DATA` in `sketches/demo_chart2_*.html` (named in the sketch) |

The `before_after_graphs*.html` baselines are public data: California adults 18+ from the
ACS 2024, and Jan 1, 2025 county populations grouped into the survey's regions.

### Present in `data/` but not read by any code in this repo

| File | Shape | SHA-256 | Notes |
|---|---|---|---|
| `engaged_california_ai_survey_20260810_162928.csv` | 2,678 rows × 13 cols | `824182e0f5023dd1101e8ae0a8870303ca11209ddbb83f3afc79e87facd74366` | The earlier 13-column export. The pipeline was later pointed at the corrected 2026-08-18 export (see `SOURCE.md`) |
| `deliberation-dataset.xlsx` | workbook | `95b02104ad56a317bca7cd3e00adc2c8bd76fdd6837fd77e904ac7e0c59d35ad` | Read only by the `xlsx` reader's test, and by an older `deliberations.json` stage on an unmerged branch. That run's manifest records a different hash (`c3d434ad966c6cff…`), so the workbook changed afterwards |
| `Copy of Policy ideas with votes (sessions 1-14) - Themes, subthemes, policy concepts.csv` | 41 rows × 21 cols | `3ad7bc90846ff299b0232dce01df1e138246ce14254813530240a7cd2927535c` | Used by hand to verify `viz/src/lib/deliberativeMoments.ts`'s PERCENTRANK ranking; not read by code |
| `ai_response_label.csv` | 2,534 rows × 3 cols | `d57569ed0b973ab6018bec10331b2f62e602820f5079fcbdf27a09016b7d0345` | Per-respondent AI-sentiment label plus rationale. **Not recorded** how it was used; the same `AI_RESPONSE_LABEL` column appears in the demographics exports |
| `Phase2_convo_<date>_<time>.csv` (15 files, one per session) | 2–15 rows × 6 cols each | combined (sorted, concatenated) `22740f71aa8fd5df579485bbb53e5fd442e54a30de5e3f6694da3a5e5f5f7584` | Attendee demographics per session (not transcripts). Not read by code |

## 2. How each viz JSON was built

The pipeline stages are the recipe (run `npm run <stage>` in `analysis/`). Short hashes
are the first 16 hex characters recorded in each manifest.

| Output (`analysis/artifacts/viz/`) | Stage | Inputs (hash) | Last run |
|---|---|---|---|
| `respondents.json` `fa04903f2dd698f8`, `verbatims.{personal,economy,government}.json` | `vizdata` (s12) | `responses_clean.csv` `907828753f17b295`, `status-final.jsonl` `e7a1aa7e22798f48`, `labels.jsonl` `8d1ab5de1b5666fb`, `codebook.json` `4391e108d08569ac`, attendee demographics `13e4f2249a700c63` | 2026-08-20 20:51 |
| `rooms.json` `0c278efa955666c6` → `504a025d6371c392`, `roomIdeas.json` `5a5e27142819344d` | `rooms` (s13), then `figjam-linkage` (s16) rewrites `rooms.json` in place to add idea→concept links | s13: policy-ideas workbook `033431a6cad0fd81`. s16: `figjam-idea-concept-map.json` `c87e108d5e593544` (the original, before this repo's sticky text was made synthetic) | s13 2026-08-28 23:26, s16 2026-08-28 23:34 |
| `crosswalk.json` `d98f582d8196731a` | `crosswalk` (s15) | `phase-crosswalk.json` `be277a8451d1f51f`, `codebook.json` `4391e108d08569ac`, `respondents.json` `fa04903f2dd698f8`, `rooms.json` `683a1f6be7c6c0c5` | 2026-08-26 17:00 |
| `funnel.json` `000183cea4799db7` | `funnel` (s17) | demographics 2026-08-28 `1d5cc45547b24808`, attendee demographics `13e4f2249a700c63`, sortition `45874d5e968cde43` | 2026-09-11 19:07 |
| `respondents.readable.json` `76ca77a6b84371c2` | `respondents-readable` (s19) | `respondents.json` `fa04903f2dd698f8` | 2026-08-28 22:57 |
| `insights.json` `c4fe24736c0cb8a0` | none: **hand-authored** comms copy with quotes taken from the discussions | **not recorded** | file dated 2026-08-31 |

Upstream of `vizdata`, the Phase 1 chain ran: `audit` → `clean` (2026-08-19 02:55) →
`status` → `judge` (2026-08-19 16:54, model `claude-opus-5`) → `classify`
(2026-08-19 17:19, model `claude-opus-5`, codebook `2026-08-18d` = `4391e108d08569ac`) →
`dups` → `aggregate` (2026-08-28 22:37) → `themes-csv`.

**Known drift in the trail:**

- `corpus`, `discover` and `mergedoc` (s05–s07) last ran **2026-08-12**, against an
  earlier cleaned file (`1f9e4bbd9576bd91`) and an earlier codebook (`683ae55d4ff85fde`).
  That was before the corrected 2026-08-18 export. Classification and everything after
  it used the newer inputs.
- `crosswalk.json` was built from an earlier `rooms.json` (`683a1f6be7c6c0c5`) than the
  current one. Re-run `crosswalk` after `rooms` + `figjam-linkage` to bring it in line.
- `classify-ideas` (s14) has no manifest, so there's no record it was ever run.

## 3. Data embedded in sketches and handoffs

| File | Data | Origin |
|---|---|---|
| `handoff/participant-funnel/funnel-data.js`, `handoff/discussion-curtain/discussion-data.js` | Funnel counts and per-attendee {region, field of work}; trimmed rooms data | Copied from `funnel.json` (`000183cea4799db7`, 2026-09-11) and `rooms.json` |
| `handoff/ideas-we-heard-scroll/ideas-scroll-data.js` | Ideas word cloud | The published `/public/data/ai-report-ideas-cloud.json`, refreshed 2026-10-13 (the same file is at `synthetic-data/inputs/published/`) |
| `sketches/whirl-data.js` | Ideas word cloud | Built by `analysis/scripts/whirl_data.py`; `phase1` then replaced with the published list (2026-10-13) |
| `sketches/concept-distillation-real-phase2-themes.html`, `viz/src/lib/phase1ConceptsData.ts` | Placeholder Phase 1 concepts sized by keyword counts | `analysis/scripts/phase1_keyword_counts.py` over `all_phase1_opentext_responses.csv` |
| `sketches/ring_chart_v2.html`, `ring_chart_v3.html`, `demo_charts_simplified_v2.html` | `RING_DATA` (synthetic rows, real totals) | Totals from the files in `RING_DATA.provenance.original`; rows re-dealt for this repo |
| `sketches/ring_chart_v1.html`, `demo_chart2_*.html`, `before_after_graphs*.html` | Aggregate shares | `phase-1.csv` / `chart_data.csv` (**not recorded** further) plus the public baselines above |

For what's synthetic versus published in the running app, see the
[README's data table](../README.md#data-in-this-repo) and
[`synthetic-data/README.md`](../synthetic-data/README.md).
