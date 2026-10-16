# Pipeline methodology changelog

Tracks changes to how the pipeline *computes* prevalence — not changes to
theme definitions, which live in `config/CHANGELOG.md`.

## 2026-08-29 — per-question theme counts no longer include cross-field bleed

**What changed:** `lib/aggregate.ts`'s per-question theme `count`/`share`, and
the matching per-segment-cell theme counts, now only count a respondent
toward a theme if the classifier assigned that theme's code specifically on
the question being aggregated. Previously they counted a respondent if the
code appeared on *any* of their three answers ("cross-field bleed"), while
the denominator stayed anchored to the one question's substantive count —
so a bled-in respondent who wasn't substantive on that question could still
land in the numerator.

**Why:** the viz app's theme picker (`lib/vizdata.ts`'s `buildThemeIndex`,
used by `App.svelte`'s dropdown and respondent highlighting) already used
the strict per-field rule, so the same theme could show two different
percentages depending on which surface you looked at — the report/CSV and
the interactive viz. This reconciles them onto the stricter rule, since it's
the one the viz's highlighting already depends on for internal consistency,
and it removes a documented pathology (numerator exceeding what the
denominator alone implied).

**What did NOT change:** `personLevel` (the cross-question rollup of
distinct respondents who raised a theme anywhere) still pools all three
fields — it has no per-question denominator, so pooling isn't a distortion
there, and pooling is the entire point of that rollup.

**Effect on published numbers:** theme `count`/`share` in
`reports/prevalence.md`, `reports/phase1-themes.csv`, and every segment
breakdown can only go down or stay the same versus the 2026-08-20 run — never
up. `personLevel` and the raw `artifacts/s08/labels.jsonl` are unaffected.
Re-run `npm run aggregate && npm run themes-csv` to regenerate against this
rule; both artifacts carry `codebookVersion` and an input-hash manifest, so
an old copy of either report is identifiable by its manifest even without
this note.
