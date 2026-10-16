import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stringify } from "csv-stringify/sync";
import { loadCodebook } from "../lib/codebook.ts";
import { buildThemeRows, COLUMN_DICTIONARY, CSV_COLUMNS } from "../lib/themesCsv.ts";
import type { PrevalenceData } from "../lib/aggregate.ts";
import { writeManifest } from "../lib/manifest.ts";
import { ARTIFACTS, CODEBOOK_PATH, REPORTS_DIR, SAMPLE_CAVEAT } from "../config.ts";

const prevalenceJsonPath = join(ARTIFACTS, "s11", "prevalence.json");
const outputDir = join(ARTIFACTS, "s18");
const csvPath = join(REPORTS_DIR, "phase1-themes.csv");
const notesPath = join(REPORTS_DIR, "phase1-themes.notes.md");

const DENOMINATOR_NOTE =
  "denominator_answered excludes blank responses and responses an LLM judgment pass classified as a non-answer; " +
  "it is not just \"not blank\". denominator_all is the full survey population regardless of whether this " +
  "question was answered.";

function renderColumnDictionary(): string {
  const header = "| Column | Description |\n|---|---|";
  const rows = CSV_COLUMNS.map((col) => `| \`${col}\` | ${COLUMN_DICTIONARY[col]} |`);
  return [header, ...rows].join("\n");
}

function renderNotes(prevalence: PrevalenceData): string {
  const lines = prevalence.questions
    .map((q) => `- **${q.id}** — \"${q.prompt}\": denominator_answered ${q.counts.substantive}, denominator_all ${q.counts.total}`)
    .join("\n");

  return `# Notes for phase1-themes.csv

Codebook version ${prevalence.meta.codebookVersion} · model ${prevalence.meta.model} · \`prevalence.json\` generated ${prevalence.meta.generated}.

${SAMPLE_CAVEAT}

${prevalence.meta.multiLabelNote}

${DENOMINATOR_NOTE}
${prevalence.meta.truncationCaveat ? `\n${prevalence.meta.truncationCaveat}\n` : ""}
## Column reference

${renderColumnDictionary()}

## Denominators by question

${lines}

## Verification flags

One row, personal / \`NOT_ADOPTED\`, carries \`verification: needs_verification\` — proposed by a discovery pass but
never backed by a citable quote in the codebook's own audit (see \`analysis/config/codebook.json\`'s reviewNote on
that theme). Confirm its count against verbatims before citing it in a published report.
`;
}

async function main() {
  if (!existsSync(prevalenceJsonPath)) {
    throw new Error(
      `${prevalenceJsonPath} not found. Run "npm run aggregate" first (analysis/src/stages/s11-aggregate.ts) to produce it.`,
    );
  }

  const codebook = loadCodebook(CODEBOOK_PATH);
  const prevalence: PrevalenceData = JSON.parse(readFileSync(prevalenceJsonPath, "utf8"));

  const rows = buildThemeRows(codebook, prevalence);
  const csv = stringify(rows, { header: true, columns: CSV_COLUMNS, quoted: true });

  mkdirSync(REPORTS_DIR, { recursive: true });
  writeFileSync(csvPath, csv);
  writeFileSync(notesPath, renderNotes(prevalence));

  writeManifest(outputDir, {
    script: "s18-themes-csv",
    inputFiles: [CODEBOOK_PATH, prevalenceJsonPath],
    outputFiles: [csvPath, notesPath],
    codebookVersion: codebook.version,
  });

  console.log(`Wrote ${rows.length} theme rows to ${csvPath}`);
  console.log(`Wrote ${notesPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
