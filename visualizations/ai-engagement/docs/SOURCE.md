# Data provenance

Fill this in when you drop a new export into `data/`. It takes two minutes and
it is the only thing standing between you and being unable to answer "where did
this number come from?" six months from now.

A CSV is a point-in-time snapshot with no version, no timestamp, and no link
back to what produced it. A live warehouse connection at least lets you rerun
the query. A file on disk does not — so the provenance has to be recorded by
hand, once, or it is gone.

---

## Export

**Source system:** Snowflake

**Database / schema / table:**
`<!-- e.g. PUBLIC_ENGAGEMENT.AI_CONSULTATION.RESPONSES -->`

**Query used:**

```sql
-- OPEN: exact query not yet recorded. Paste the exact query used to produce
-- this export, not a description of it, when it is located.
```

**Exported by:** `<!-- name -->`
**Export date:** 2026-08-18 (from filename timestamp `2026-08-18-1554`; not
independently confirmed)
**Rows in source table at export time:** OPEN — unreconciled, carried over from
the prior export (see "Changes from any previous export" below).

## File

**Filename:** `data/survey respondent demographics, 2026-08-18-1554.csv`
**Rows in file (parsed, not line count):** 2,702 (confirmed by `npm run audit`
in `analysis/`, and by `loadCsv` used elsewhere in the pipeline; RFC-4180 with
embedded newlines in quoted fields, so raw line count is not the record count)
**SHA-256:** `bdfb1b6228421cdf46c3bf36f585eaf7bb615e79ebec551f85bfe5bcb87890c0`
**Columns:** 15, unique `SURVEY_RESPONDENT_ID` per record (no duplicates found)

**Free-text truncation:** All three free-text columns (`PERSONAL_AI_IMPACT`,
`ECONOMIC_IMPACT_EXPECTATION`, `GOVERNMENT_ACTION_SUGGESTION`) cap at exactly
1,000 characters. Some answers are cut mid-word at that boundary, affecting an
estimated ~3.8% of respondents (103 of 2,702) — essentially unchanged from the
prior export despite the corrected row count. OPEN — whether this cap
originates in the survey form itself (a client-side/form input limit) or was
introduced by the export/query (e.g. a `VARCHAR(1000)` column or a truncating
export step) is unresolved.

If parsed rows do not match the source count, stop and find out why before
analysing anything. A truncated export produces percentages that look completely
normal.

## Scope

**Collection period covered:** `<!-- first and last submission date -->`
**Filters applied at export:** `<!-- e.g. excluded test submissions, staff -->`
**Known exclusions:** `<!-- anything deliberately left out, and why -->`

Anything filtered out here is invisible to every downstream number. If test
submissions were removed, say so. If they were not, say that too — someone will
ask why the count is higher than the public dashboard.

## Changes from any previous export

**Supersedes:** `data/engaged_california_ai_survey_20260810_162928.csv`
(2,678 rows, SHA-256 `824182e0f5023dd1101e8ae0a8870303ca11209ddbb83f3afc79e87facd74366`)

**What changed:**
- Id column renamed `IDEA_ID` → `SURVEY_RESPONDENT_ID`, and every id was
  **regenerated** — zero overlap with the prior export's ids. Every
  id-keyed pipeline artifact (`artifacts/s03`, `s04`, `s08`, `s10`, `s11`, the
  `viz` export) is unjoinable against this file and had to be rebuilt from
  scratch; nothing from the prior run carries forward.
- Row count 2,678 → 2,702; still does not reconcile against the ~5,000
  source-table estimate mentioned in an earlier export — see "Rows in source
  table at export time" above. Unresolved either way.
- Added columns: `GENDER_ARRAY`, `RACE_ETHNICITY_ARRAY` (raw multi-select
  JSON, not consumed by the pipeline yet), `AI_RESPONSE_LABEL` (a
  whole-respondent stance value — `neg`/`mix`/`pos`/`neutral`/blank — now a
  `SEGMENTS` entry, so it groups/colors the viz prototypes and would flow into
  `s11-aggregate` once that stage's own segment-label map is updated).
- Removed column: `AVAILABILITY_FOR_DISCUSSION` (was never read by the
  pipeline).
- `GENDER_CATEGORY` and `RACE_ETHNICITY_CATEGORY` values now carry a trailing
  `" (only)"` (e.g. `"White (only)"` vs. the prior `"White"`), to distinguish
  a single-select category from the new `*_ARRAY` multi-select columns.
  `s02-clean` strips the suffix so downstream category matching (including the
  `REFUSAL_VALUE` pin) is unaffected.
- 1,000-char truncation is present at roughly the same rate (~3.8% of
  respondents) despite the corrected row count — see "Free-text truncation"
  above. Still unresolved.

Do not reuse any `s03`/`s04`/`s08`/`s10`/`s11` artifact generated against the
prior export — re-run the pipeline from `npm run audit` forward.

---

## Attendee demographics (Phase 2)

**Source system:** Snowflake (same export batch as the 2026-08-18 respondent
demographics file, per filename timestamp; not independently confirmed).

**Filename:** `data/attendee demographics, 2026-08-18-1424.csv`
**Rows in file (parsed, not line count):** 103 — RFC-4180 with embedded
newlines in quoted fields, same caveat as every other export here.
**SHA-256:** `13e4f2249a700c63e8e44e5da1058bfd252fe79ab648b8e862bb1ddb0264e8c1`
**Columns:** 26. `SURVEY_RESPONDENT_ID` is unique per record (no duplicates) —
same id space as `survey respondent demographics, 2026-08-18-1554.csv`'s
`SURVEY_RESPONDENT_ID` (this project's `ID_COLUMN`), so the two files join
directly with no crosswalk.

**What this file is:** one row per person who joined a Phase 2 (sortition-
recruited small-group deliberation) session — `SESSION_DATE`/`SESSION_ID`
identify which of the 14 dated sessions, `ATTENDEE_STATUS` is `attended` for
102 rows and blank for 1. The pipeline (`analysis/src/lib/phase.ts`,
`s12-vizdata.ts`) treats every row as an attendee regardless of that status
value, since the export contains no separate not-attended rows to distinguish
from — see the open item below.

**Join to the survey export:** 101 of 103 `SURVEY_RESPONDENT_ID`s are present
in `survey respondent demographics, 2026-08-18-1554.csv` (2,702 rows); 2 are
not (one `attended` row from the 2026-07-15 session, one blank-status row from
2026-07-16). The viz's `PHASE` segment is derived at `s12-vizdata` time only
— it is **not** added to `config.ts`'s `SEGMENTS`, so it never reaches
`analysis/src/stages/s11-aggregate.ts` or `reports/prevalence.md`. A
101-respondent subgroup would trip `SUPPRESS_BELOW`/`FLAG_BELOW` on most
theme cells; promoting Phase into the published report is a decision for a
human to make explicitly, not a byproduct of adding a viz filter.

**Open items — recorded, not resolved:**
1. `design/before_after_graphs*.html` (gitignored) defines Phase 2 as "173
   registered attendees pooled across 15 conversation sessions." This export
   has 103 rows / 102 `attended` across 14 sessions. "Registered" vs
   "attended" likely explains part of the gap; 173 vs 103 is not reconciled by
   any file in this repo.
2. 2 attendee `SURVEY_RESPONDENT_ID`s have no matching row in the survey
   export — unexplained; these 2 people are counted as Phase 2 attendees but
   never appear as a viz respondent.
3. `data/Sortition Candidates and Attendance Rates.csv` reports an `Attended
   count` column summing to 92 across regions — an earlier snapshot than this
   file's 102, not reconciled.

---

## Policy ideas with votes (sessions 1-14)

**Source / Filename:** `data/Policy ideas with votes (sessions 1-14).xlsx` —
the data source for the Phase 2 "rooms" prototype view (14 sortition
deliberation sessions arranged as a ring). Saved 2026-08-21 15:17; the
workbook was revised twice during planning, so the hash below was
re-confirmed at implementation time, not just carried over from the plan.

**SHA-256:** `033431a6cad0fd8141b707ce842c13db2043146c78b6d4d62b3027c52cb1ad0c`
— confirmed by `shasum -a 256` against the file in this worktree's `data/`
at implementation time; unchanged from the hash recorded during planning.

**Sheet inventory:**

- `Themes, subthemes, policy conce` — header `Theme | Subtheme | Policy
  concept | Sessions | Votes | Ideas | Top ideas`. 29 concept rows, 3 themes,
  8 subthemes. Concept rows sum to 518 votes / 149 ideas.
- `policy ideas sheet V4` — header `Session # | Government Action / Idea |
  Votes | Meeting Date | Session participant count | Vote ratio | Reworded
  for clarity (by Wes, Streamlit)`. 157 idea rows, sessions 1-14, 519 votes
  total.
- `lookup` — `Session # | Date & Time | Date only | Attendee count`. 15 rows.
  Sessions 1-14 attendee counts sum to 103. Session 15 has a date but no
  attendee count and no ideas, and is excluded from the viz, giving 14 rooms.

**The one genuine gap — no per-idea theme link:** sheet 2
(`policy ideas sheet V4`) carries no theme, subtheme, or concept column —
only Session #, idea text, Votes, Meeting Date, participant count, vote
ratio, and a rarely-populated "reworded for clarity" column (populated on
only 6 of 157 rows). Nothing in the workbook links an individual idea, and
therefore a room, to sheet 1's theme/subtheme/concept hierarchy. This is a
known, deliberate gap, not an oversight: closing it requires a separate,
human-gated classification step (documented elsewhere in this feature's
implementation as "Task 6") and the rooms view is built to work without it.
Until that lands, the view cannot show which room discussed which theme.

**Internal reconciliation — 4 stated-vs-computed disagreements, recorded
here because the workbook itself contains them, not because this project is
choosing to paper over anything:**

1. `{ scope: "workbook", field: "ideas", stated: 149, computed: 157 }` —
   sheet 1's concept-row totals sum to 149 ideas; sheet 2 actually lists 157.
2. `{ scope: "workbook", field: "votes", stated: 518, computed: 519 }` —
   sheet 1 sums to 518 votes; sheet 2 actually totals 519.
3. `{ scope: "Empowering people to protect their data", field: "votes", stated: 82, computed: 94 }`
4. `{ scope: "Empowering people to protect their data", field: "ideas", stated: 24, computed: 26 }`
   — this one subtheme's own label states 82 votes / 24 ideas, but its 4
   concept rows actually sum to 94 votes / 26 ideas. It's the only subtheme
   where the stated and summed counts disagree at all; the other 7 match
   exactly.

These 4 are re-derivable by running `npm run rooms` from `analysis/` — it is
read-only and safe to re-run, and prints the reconciliation list on every
run. A workbook revision that changes this list should be treated as a
signal to re-read the file, not as noise to suppress.

**An earlier revision's provenance note — no longer visible:** an earlier
saved version of sheet 2 carried a note in row 2, column B: "this sheet was
built by Gemini from the source — check contents if it becomes a source of
truth." The 2026-08-21 15:17 save removed that note. It is recorded here
because it bears on how much confidence to place in this workbook's own
numbers — the caveat no longer being visible in the file does not mean the
sheet's provenance has been confirmed. Treat sheet 2 as originally
LLM-assembled from some other source, unverified, even though nothing in
the current file says so.

**The facilitator assumption:** the `lookup` sheet's attendee counts (summing
to 103) are read as *participant* counts, with one additional facilitator
drawn per room on top of that count — i.e. every `lookup`-sheet number is a
participant, and the facilitator dot in the rooms view is additional, not
subtracted from any of the 103. This is a deliberate reading, not the only
possible one: the older `data/deliberation-dataset.xlsx` workbook (no
separate provenance entry in this file) instead splits its population as
102 attendees **plus** 1 facilitator per session — i.e. it treats a
nominal 103-person count as containing the facilitator, and subtracts the
facilitator out to arrive at 102 attendees. This project's reading adds a
facilitator on top of 103; the older workbook's reading pulls a facilitator
out of a 103-ish total to land on 102. The choice is encoded in
`analysis/src/lib/roomsData.ts` (see the `facilitators: 1` assignment,
commented "stated assumption") — if this reading turns out wrong, change it
there so the `lookup` counts are read as attendees-plus-facilitator (i.e.
subtract 1 from each session's participant count before treating the rest
as attendees) instead of as participants-only.

**Divergence from `deliberation-dataset.xlsx` — intentional, not an error to
reconcile:** this workbook's counts differ from the older
`data/deliberation-dataset.xlsx` workbook — 157 vs 151 ideas, 103 vs 102
attendees, session 7 specifically at 7 vs 6 attendees.
`Policy ideas with votes (sessions 1-14).xlsx` was deliberately chosen as
the source of truth for the rooms view; the data model is built to fit it
rather than reconciled against the older file. A future reader should not
"fix" the rooms view's numbers back toward `deliberation-dataset.xlsx`'s —
that would be undoing a considered choice, not correcting a bug.

**Open items — recorded, not resolved:**

1. Sheet 2 carries no theme/subtheme/concept column, so no idea, and
   therefore no room, can be linked to sheet 1's hierarchy yet — see "the
   one genuine gap" above. Closing this is a separate, human-gated
   classification step, not a byproduct of this provenance entry.
2. The 4 internal stated-vs-computed disagreements above are unreconciled
   inside the workbook itself — not something this project can fix by
   re-reading the file differently, since both the "stated" and "computed"
   values come from the same sheets.
3. `data/deliberation-dataset.xlsx` has no provenance entry anywhere in this
   file (source system, export date, and SHA-256 are all unrecorded) even
   though it's referenced above for its differing counts. Adding one is out
   of scope for this entry, which covers the new rooms workbook only.
4. Whether sheet 2's original "built by Gemini" construction (per the
   now-removed row 2 note) means any of its 157 idea rows were themselves
   generated or reworded, rather than transcribed verbatim from
   participants, is unresolved — the note only says to check, not what was
   found.

---

## Phase 1 -> Phase 2 concept crosswalk

**What this is:** `analysis/config/phase-crosswalk.json` maps each of the 29
Phase 2 policy concepts back to the Phase 1 codebook themes (version
`2026-08-18d`) it plausibly answers. **This mapping is authored, not
measured** — nothing in the pipeline ever elicited a Phase 1 <-> Phase 2 link
from a respondent or a deliberation session. It exists only to power the
`viz/` "distillation" prototype (`DistillFlow.svelte`, `DistillTree.svelte`)
and must never be the basis for a published prevalence number.

**Method:** authored by Claude (Opus 5) reviewing each of the 29 concepts'
text against the 112 theme definitions in `codebook.json`, anchored
Phase-2-first (for each concept, which themes feed it — not the reverse) so
that themes claimed by no concept fall out as a derived "did not carry
forward" set rather than a hand-picked one. Every edge carries a
`strength` (`primary`/`secondary`/`tangential`) and a mandatory `rationale`.

**Review status:** `status: "proposed"` as of `version: "2026-08-25a"` —
**not yet reviewed by a human.** The viz shows a persistent banner while this
is true. Flip `status` to `"approved"` and set `approvedBy` once reviewed.

**Validation:** `analysis/src/stages/s15-crosswalk.ts` (`npm run crosswalk`)
refuses to build if `codebookVersion` or `roomsSourceHash` are stale, if any
`conceptId` doesn't match `rooms.json`, if any theme `code` doesn't match the
codebook, or if any concept is missing coverage. See
`analysis/src/lib/crosswalk.ts`'s `validateCrosswalk`.

**Output:** `analysis/artifacts/viz/crosswalk.json` (gitignored, rebuilt by
`npm run crosswalk`) — themes with per-question respondent counts, edges with
rationale, the derived unclaimed-theme list, and per-concept ranking metrics
computed the same way as the `Policy ideas with votes (sessions 1-14) -
Themes, subthemes, policy concepts-v2.csv` recut's own ranking columns,
using rooms.json's reconciled subtheme totals rather than the workbook's
stated header totals. These agree for 7 of 8 subthemes; the one known
exception is "Empowering people to protect their data" (see rooms.json's
own `meta.reconciliation` above). Parity-tested in
`analysis/tests/crosswalk.test.ts`, including a case covering that
exception.

---

## Publication record

Fill in when numbers go public, so a figure in a report can be traced to the
exact inputs that produced it.

| Published figure | Date | Export SHA | Codebook version |
| --- | --- | --- | --- |
|  |  |  |  |
