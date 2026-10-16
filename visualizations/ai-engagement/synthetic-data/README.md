# Synthetic data

Generates stand-in data so the prototypes in `../viz/` and the offline stages in
`../analysis/` run without access to the real (non-public) consultation data.

```sh
npm ci
npm run generate     # writes out/ (gitignored)
npm test             # invariants: totals, consistency, every answer marked synthetic
npm run typecheck    # output is typed against viz/'s own data interfaces
```

Output is a pure function of the seed (default `20261013`, override with
`npm run generate -- --seed 123`).

## What it writes

| File (`out/viz/`) | Content |
|---|---|
| `respondents.json`, `verbatims.{personal,economy,government}.json` | **Synthetic.** 2,702 fake respondents, the published Phase 1 total. Each demographic field is drawn independently from the published category totals, so no real combination of answers is reproduced. Answers are templated from codebook theme labels and start with `[SYNTHETIC]` |
| `rooms.json`, `roomIdeas.json` | **Synthetic** Phase 2 ideas and votes, on the published session dates and attendee counts and the public theme / subtheme / concept names |
| `crosswalk.json` | Public concept → theme links from `../analysis/config/phase-crosswalk.json`; theme counts and concept metrics are **synthetic** |
| `funnel.json` | **Published**: the report's participant-funnel data |
| `insights.json` | **Published**: only the 9 discussion quotes printed in the report, with their published bylines |

`out/data/survey respondent demographics, 2026-08-18-1554.csv` is a **synthetic** copy
of the survey export, in the same 15 columns and encoding the pipeline expects:

- RFC 4180 quoting with some embedded newlines
- blanks
- non-answers
- "I don't want to say" refusals
- some answers cut at the export's 1,000-character limit

Run the pipeline on it with `EC_DATA_DIR` / `EC_WORK_DIR`, as the top-level README shows.

## Inputs (committed, none of them respondent data)

| File | Source |
|---|---|
| `inputs/segments.json` | Survey answer-choice labels and how they group for display |
| `inputs/counties.json` | Which counties the survey grouped into each region |
| `inputs/phase2-taxonomy.json` | Phase 2 theme / subtheme / policy-concept ids and public names |
| `inputs/published/ai-report-participant-funnel.json` | <https://engaged.ca.gov/public/data/ai-report-participant-funnel.json>, fetched 2026-10-13 |
| `inputs/published/ai-report-ideas-cloud.json` | <https://engaged.ca.gov/public/data/ai-report-ideas-cloud.json>, fetched 2026-10-13 |
| `inputs/published/report-quotes.json` | Quotes and bylines printed on <https://engaged.ca.gov/ai-impact/report/>, fetched 2026-10-13 |

Theme codes and labels come from `../analysis/config/codebook.json`.
