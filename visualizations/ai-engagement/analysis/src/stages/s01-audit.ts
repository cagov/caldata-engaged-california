import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadCsv } from "../lib/load.ts";
import { auditRows } from "../lib/audit.ts";
import { writeManifest } from "../lib/manifest.ts";
import { DATA_CSV, TRUNCATION_LEN, REPORTS_DIR } from "../config.ts";

/**
 * Known-good row count for the current export, pinned in docs/SOURCE.md.
 * If this stops matching, the export has changed underneath the pipeline —
 * every downstream percentage is suspect until SOURCE.md is updated to match.
 */
const EXPECTED_ROW_COUNT = 2702;

/**
 * Allow `--file <path>` to override the input CSV, so the cleaned output
 * (e.g. `data/responses_clean.csv`) can be re-audited with the same checks.
 */
function resolveInputPath(): string {
  const args = process.argv.slice(2);
  const flagIndex = args.indexOf("--file");
  if (flagIndex !== -1 && args[flagIndex + 1]) {
    return args[flagIndex + 1];
  }
  return DATA_CSV;
}

function renderReport(a: ReturnType<typeof auditRows>, sourcePath: string): string {
  const lines: string[] = [];
  lines.push("# Audit Report");
  lines.push("");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Source: \`${sourcePath}\``);
  lines.push("");

  lines.push("## Row count");
  lines.push("");
  lines.push(`Parsed rows: **${a.rowCount}** (expected ${EXPECTED_ROW_COUNT})`);
  lines.push("");
  if (a.rowCount !== EXPECTED_ROW_COUNT) {
    lines.push(
      "> ⚠ ROW COUNT MISMATCH — the export has changed. `docs/SOURCE.md` " +
        `pins ${EXPECTED_ROW_COUNT} rows; this run parsed ${a.rowCount}. ` +
        "Do not trust any downstream percentages until `docs/SOURCE.md` " +
        "(filename, SHA-256, row count) is updated to match the new file " +
        "and the discrepancy is understood.",
    );
    lines.push("");
  }

  lines.push("## Duplicate IDs");
  lines.push("");
  if (a.duplicateIds.length > 0) {
    lines.push(
      `> ⚠ ${a.duplicateIds.length} duplicate ID value(s) found: ${a.duplicateIds.slice(0, 20).join(", ")}` +
        (a.duplicateIds.length > 20 ? ", …" : ""),
    );
  } else {
    lines.push("No duplicate IDs found.");
  }
  lines.push("");

  lines.push("## Per-question stats");
  lines.push("");
  lines.push("| Column | Filled | Median Len | Max Len | Truncation Suspects |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const q of a.perQuestion) {
    lines.push(`| ${q.column} | ${q.filled} | ${q.medianLen} | ${q.maxLen} | ${q.truncationSuspects} |`);
  }
  lines.push("");

  const truncated = a.perQuestion.filter((q) => q.truncationSuspects > 0);
  if (truncated.length > 0) {
    lines.push("## ⚠ TRUNCATION");
    lines.push("");
    lines.push(
      `> One or more free-text columns have answers at or above ${TRUNCATION_LEN} ` +
        "characters. This export caps free-text fields at exactly 1,000 " +
        "characters, and answers landing at or near that cap may be cut " +
        "mid-word rather than genuinely ending there. Affected columns:",
    );
    lines.push(">");
    for (const q of truncated) {
      lines.push(`> - **${q.column}**: ${q.truncationSuspects} suspect answer(s) (max length ${q.maxLen})`);
    }
    lines.push(">");
    lines.push(
      "> This is a suspected export-side or form-side truncation, unresolved " +
        "as of this run (see `docs/SOURCE.md`). The export should be re-pulled " +
        "with a corrected cap, or these figures should be reported with this " +
        "caveat attached.",
    );
    lines.push("");
  }

  return lines.join("\n") + "\n";
}

async function main() {
  const inputPath = resolveInputPath();
  const rows = await loadCsv(inputPath);
  const result = auditRows(rows);

  mkdirSync(REPORTS_DIR, { recursive: true });
  const outPath = join(REPORTS_DIR, "audit.md");
  writeFileSync(outPath, renderReport(result, inputPath));

  writeManifest("artifacts/s01", {
    script: "s01-audit",
    inputFiles: [inputPath],
    outputFiles: [outPath],
  });

  console.log(`Wrote ${outPath}`);
  if (result.rowCount !== EXPECTED_ROW_COUNT) {
    console.log(`⚠ row count mismatch: expected ${EXPECTED_ROW_COUNT}, got ${result.rowCount}`);
  }
  const truncatedCols = result.perQuestion.filter((q) => q.truncationSuspects > 0);
  if (truncatedCols.length > 0) {
    console.log(`⚠ truncation suspects present in: ${truncatedCols.map((q) => q.column).join(", ")}`);
  }
}

main();
