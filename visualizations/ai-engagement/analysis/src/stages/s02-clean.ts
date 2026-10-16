import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { stringify } from "csv-stringify/sync";
import { loadCsv } from "../lib/load.ts";
import { normalizeText } from "../lib/normalize.ts";
import { writeManifest } from "../lib/manifest.ts";
import { DATA_CSV, CLEAN_CSV, QUESTIONS } from "../config.ts";

const TEXT_COLUMNS: readonly string[] = QUESTIONS.map((q) => q.column);

// The 2026-08-18 export suffixes single-select gender/race categories with
// " (only)" (e.g. "White (only)") to distinguish them from the multi-select
// GENDER_ARRAY/RACE_ETHNICITY_ARRAY columns. Strip it here, before pinning —
// vizdata.ts and aggregate.ts match REFUSAL_VALUE by exact string, and an
// unstripped "I don't want to say (only)" would silently stop being pinned
// and consume a categorical color slot like a real category.
const ONLY_SUFFIX_COLUMNS: readonly string[] = ["GENDER_CATEGORY", "RACE_ETHNICITY_CATEGORY"];

function stripOnlySuffix(value: string): string {
  return value.replace(/ \(only\)$/, "");
}

async function main() {
  const rows = await loadCsv(DATA_CSV);

  let changed = 0;
  const cleaned = rows.map((row) => {
    const out: Record<string, string> = { ...row };
    for (const col of TEXT_COLUMNS) {
      const before = row[col] ?? "";
      const after = normalizeText(before);
      if (after !== before) changed++;
      out[col] = after;
    }
    // Trim the categorical columns too -- trailing spaces silently create
    // duplicate demographic categories, which quietly splits subgroup counts.
    for (const [key, value] of Object.entries(out)) {
      if (!TEXT_COLUMNS.includes(key)) {
        out[key] = value.trim().replace(/\s{2,}/g, " ");
      }
    }
    for (const col of ONLY_SUFFIX_COLUMNS) {
      if (out[col] !== undefined) out[col] = stripOnlySuffix(out[col]);
    }
    return out;
  });

  const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
  const csv = stringify(cleaned, { header: true, columns, quoted: true });

  mkdirSync(dirname(CLEAN_CSV), { recursive: true });
  writeFileSync(CLEAN_CSV, csv);

  writeManifest("artifacts/s02", {
    script: "s02-clean",
    inputFiles: [DATA_CSV],
    outputFiles: [CLEAN_CSV],
  });

  console.log(`Read ${rows.length} records`);
  console.log(`Changed ${changed} text field(s)`);
  console.log(`Wrote ${CLEAN_CSV}`);
}

main();
