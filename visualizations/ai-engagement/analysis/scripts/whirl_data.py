#!/usr/bin/env python3
"""
Bakes the two Phase 1 / Phase 2 policy-concept CSVs into a single
`whirl-data.js` for sketches/policy-ideas-whirl-v1.html.

Inputs (both gitignored, under ../data/):
  - policy_concepts_ph1_2026-09-15.csv
      352 Phase 1 concepts: POLICY_CONCEPT_IDS, POLICY_CONCEPT_LABEL,
      POLICY_CONCEPT_DESCRIPTION, POLICY_SUBTHEME,
      COUNT_OF_RESPONDENTS_WHO_MENTIONED_THIS.
  - "Copy of Source of truth - Policy concepts, descriptions, subthemes,
    themes - Policy concepts, descriptions, subthemes, themes (1).csv"
      41 rows, of which 27 carry a real "Policy concept" (the rest are
      trailing blanks from the sheet export — dropped here).

There is NO id linking the 337 Phase 1 concepts to the 27 Phase 2 ideas —
the only shared field is subtheme name. Do not invent one downstream.

Fails loudly (non-zero exit) rather than silently shifting colors if a
subtheme string doesn't match the fixed 0-7 order below, or if either
input's row count drifts from what's been verified against the current
exports. A corrected export replacing either CSV should break this build.
"""
import csv
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
DATA_DIR = HERE.parent.parent / "data"  # repo-level data/ (internal, gitignored)

PHASE1_CSV = DATA_DIR / "policy_concepts_ph1_2026-09-15.csv"
SOT_CSV = (
    DATA_DIR
    / "Copy of Source of truth - Policy concepts, descriptions, subthemes, "
    "themes - Policy concepts, descriptions, subthemes, themes (1).csv"
)

# Fixed 0-7 subtheme order, matching viz/src/lib/phase1ConceptsData.ts's
# PHASE1_SUBTHEMES. Each subtheme draws from the same DATA_VIZ_CAT_V2 hue as
# viz/src/lib/palette.ts's DATA_VIZ_CAT_V2_TEXT (blue, orchid, olive, teal,
# red, dark purple, orange, 8th), but the text colours here were re-derived
# on 2026-09-17 (sketches/wordcloud-verify/derive_text_palette.js): darkened
# in OKLCH along each hue with chroma kept, so they stay recognisably the
# legend's hues instead of going brown/grey; the two purples pushed apart
# (OKLab distance 14 vs 11.7 before); and the 8th slot is the legend's light
# blue taken down to a navy (V2_TEXT used the pink #f2c3c7 -> mauve). All
# >= 4.6:1 on white. NOT yet mirrored in palette.ts — the app still uses
# DATA_VIZ_CAT_V2_TEXT; sync there if this set is approved.
SUBTHEMES = [
    {
        "shortName": "People & nature",
        "fullName": "Protecting people and nature from the effects of AI",
        "color": "#2a79ba",
    },
    {
        "shortName": "How & where AI is used",
        "fullName": "Regulating how AI works and where it’s used",
        "color": "#ab53a9",
    },
    {
        "shortName": "Jobs & workers",
        "fullName": "Protecting jobs and workers",
        "color": "#546823",
    },
    {
        "shortName": "Public's say",
        "fullName": "Making sure the public has their say on AI impacts that affect them",
        "color": "#13827d",
    },
    {
        "shortName": "Personal data",
        "fullName": "Empowering people to protect their data",
        "color": "#cc4733",
    },
    {
        "shortName": "Human choice",
        "fullName": "Preserving the rights of humans to choose and decide",
        "color": "#654992",
    },
    {
        "shortName": "Research & literacy",
        "fullName": "Increasing AI research and literacy",
        "color": "#a6660f",
    },
    {
        "shortName": "Kids & education",
        "fullName": "Protecting kids and education",
        "color": "#135372",
    },
]
FULLNAME_TO_INDEX = {s["fullName"]: i for i, s in enumerate(SUBTHEMES)}

EXPECTED_PHASE1_ROWS = 352
EXPECTED_PHASE2_ROWS = 27

GOV_SHOULD_RE = re.compile(r"^Government should\s+")


def fail(msg: str) -> None:
    print(f"whirl_data.py: FAILED — {msg}", file=sys.stderr)
    sys.exit(1)


def normalize_label(raw: str) -> str:
    """Strips a leading "Government should " and a trailing period from the
    276 sentence-style Phase 1 tail labels, so the stream-of-consciousness
    reading has readable fragments instead of repeated boilerplate. When the
    prefix was stripped, the fragment's first letter is capitalised (2026-09-17)
    so every idea starts with a capital like the short curated labels do —
    "require AI companies…" -> "Require AI companies…". Only the first
    character changes; acronyms and the rest of the text are untouched. The
    raw label is kept separately for hover/tooltip — nothing is silently
    rewritten."""
    stripped = GOV_SHOULD_RE.sub("", raw)
    s = stripped.strip()
    if s.endswith("."):
        s = s[:-1]
    if stripped != raw and s:
        s = s[0].upper() + s[1:]
    return s


def load_phase1():
    if not PHASE1_CSV.exists():
        fail(f"missing input {PHASE1_CSV}")
    with PHASE1_CSV.open(newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))

    if len(rows) != EXPECTED_PHASE1_ROWS:
        fail(
            f"{PHASE1_CSV.name} has {len(rows)} rows, expected "
            f"{EXPECTED_PHASE1_ROWS} — re-verify this generator against the "
            "new export before trusting its output."
        )

    out = []
    seen_labels = set()
    for r in rows:
        raw_label = r["POLICY_CONCEPT_LABEL"].strip()
        subtheme_name = r["POLICY_SUBTHEME"].strip()
        count_str = r["COUNT_OF_RESPONDENTS_WHO_MENTIONED_THIS"].strip()

        if not raw_label:
            fail(f"empty POLICY_CONCEPT_LABEL for row {r!r}")
        if raw_label in seen_labels:
            fail(f"duplicate Phase 1 label: {raw_label!r}")
        seen_labels.add(raw_label)

        if subtheme_name not in FULLNAME_TO_INDEX:
            fail(
                f"unrecognized POLICY_SUBTHEME {subtheme_name!r} for "
                f"{raw_label!r} — add it to SUBTHEMES or fix the export."
            )

        try:
            count = int(count_str)
        except ValueError:
            fail(f"non-integer count {count_str!r} for {raw_label!r}")
        if count < 1:
            fail(f"count {count} < 1 for {raw_label!r}")

        out.append(
            {
                "label": normalize_label(raw_label),
                "rawLabel": raw_label,
                "subtheme": FULLNAME_TO_INDEX[subtheme_name],
                "count": count,
            }
        )
    return out


def load_phase2():
    if not SOT_CSV.exists():
        fail(f"missing input {SOT_CSV}")
    with SOT_CSV.open(newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))

    concept_rows = [r for r in rows if r.get("Policy concept", "").strip()]
    if len(concept_rows) != EXPECTED_PHASE2_ROWS:
        fail(
            f"{SOT_CSV.name} has {len(concept_rows)} non-blank concept rows, "
            f"expected {EXPECTED_PHASE2_ROWS} — re-verify this generator "
            "against the new export before trusting its output."
        )

    out = []
    seen_labels = set()
    seen_orders = set()
    for r in concept_rows:
        label = r["Policy concept"].strip()
        subtheme_name = r["Subtheme"].strip()
        theme_name = r["Theme"].strip()
        votes_str = r["Votes"].strip()
        sessions_str = r["Sessions"].strip()
        order_str = r["Display concepts in this order"].strip()

        if label in seen_labels:
            fail(f"duplicate Phase 2 label: {label!r}")
        seen_labels.add(label)

        if subtheme_name not in FULLNAME_TO_INDEX:
            fail(
                f"unrecognized Subtheme {subtheme_name!r} for {label!r} — "
                "add it to SUBTHEMES or fix the export."
            )

        try:
            votes = int(votes_str)
            sessions = int(sessions_str)
            order = int(order_str)
        except ValueError:
            fail(f"non-integer Votes/Sessions/order for {label!r}")
        if votes < 1:
            fail(f"votes {votes} < 1 for {label!r}")
        if order in seen_orders:
            fail(f"duplicate display order {order} for {label!r}")
        seen_orders.add(order)

        out.append(
            {
                "label": label,
                "subtheme": FULLNAME_TO_INDEX[subtheme_name],
                "theme": theme_name,
                "votes": votes,
                "sessions": sessions,
                "order": order,
            }
        )

    out.sort(key=lambda c: c["order"])
    expected_orders = set(range(1, EXPECTED_PHASE2_ROWS + 1))
    if seen_orders != expected_orders:
        fail(f"display orders {sorted(seen_orders)} != 1..{EXPECTED_PHASE2_ROWS}")

    return out


def main():
    phase1 = load_phase1()
    phase2 = load_phase2()

    used_subthemes = sorted({c["subtheme"] for c in phase1} | {c["subtheme"] for c in phase2})
    if used_subthemes != list(range(len(SUBTHEMES))):
        fail(
            f"subthemes used {used_subthemes} don't cover all "
            f"{len(SUBTHEMES)} — check for a typo'd name that silently "
            "dropped a subtheme."
        )

    tally = [0] * len(SUBTHEMES)
    for c in phase1:
        tally[c["subtheme"]] += 1

    print(f"whirl_data.py: {len(phase1)} Phase 1 concepts, {len(phase2)} Phase 2 ideas, "
          f"{len(SUBTHEMES)} subthemes")
    for i, s in enumerate(SUBTHEMES):
        print(f"  [{i}] {tally[i]:>3} of {len(phase1)}  {s['shortName']!r:<26} {s['fullName']}")

    payload = {
        "subthemes": SUBTHEMES,
        "phase1": phase1,
        "phase2": phase2,
    }

    out_path = HERE.parent.parent / "sketches" / "whirl-data.js"
    out_path.write_text(
        "// Generated by analysis/scripts/whirl_data.py — do not hand-edit.\n"
        "window.WHIRL_DATA = " + json.dumps(payload, indent=2, ensure_ascii=False) + ";\n",
        encoding="utf-8",
    )
    print(f"whirl_data.py: wrote {out_path}")


if __name__ == "__main__":
    main()
