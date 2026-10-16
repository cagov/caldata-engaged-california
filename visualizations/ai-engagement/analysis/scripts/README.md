# Data-prep scripts for the sketches

One-off Python scripts (standard library only) that built the data some sketches embed.
They read internal exports that aren't in this repo, so they only run with access to
the real `data/` folder. They're kept so you can see how that data was made.

| Script | What it built | Inputs (internal) |
|---|---|---|
| `phase1_keyword_counts.py` | The keyword-match counts that size the placeholder Phase 1 concepts in `sketches/concept-distillation-real-phase2-themes.html` (and `viz/src/lib/phase1ConceptsData.ts`). Prints JS to stdout | `data/all_phase1_opentext_responses.csv`, the policy-concepts source-of-truth sheet |
| `whirl_data.py` | `sketches/whirl-data.js` for the "policy ideas whirl" sketches | `data/policy_concepts_ph1_2026-09-15.csv`, the source-of-truth sheet |

Run them from this repo's `visualizations/ai-engagement/` folder, e.g.
`python3 analysis/scripts/phase1_keyword_counts.py`.

> [!WARNING]
> **Don't commit `whirl_data.py`'s output.** It rewrites `sketches/whirl-data.js` from
> the internal export, which includes Phase 1 labels that were never published. The
> committed `whirl-data.js` instead uses the list published on engaged.ca.gov
> (README data rule 2). Run `node scripts/privacy-scan.mjs --real-data ../data`
> before committing any regenerated data.
