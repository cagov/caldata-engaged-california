import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { loadCsv } from "../lib/load.ts";
import { loadCodebook } from "../lib/codebook.ts";
import { auditRows } from "../lib/audit.ts";
import { aggregate, type PrevalenceData, type QuestionPrevalence } from "../lib/aggregate.ts";
import { writeManifest, sha256 } from "../lib/manifest.ts";
import {
  CLEAN_CSV,
  ID_COLUMN,
  ARTIFACTS,
  REPORTS_DIR,
  CODEBOOK_PATH,
  PIPELINE_MODEL,
  SAMPLE_CAVEAT,
  SEGMENTS,
  SUPPRESS_BELOW,
  FLAG_BELOW,
} from "../config.ts";

const SEGMENT_LABELS: Record<string, string> = {
  REGION: "Region",
  AGE: "Age",
  GENDER_CATEGORY: "Gender",
  RACE_ETHNICITY_CATEGORY: "Race / ethnicity",
  CURRENT_WORK_STATUS: "Current work status",
  ROLE_AT_WORK: "Role at work",
  FIELD_OF_WORK: "Field of work",
};

const MULTI_LABEL_NOTE =
  "Responses can raise more than one theme, so percentages within a question do not sum to 100%. (A theme can " +
  "also be raised while answering a different question than its own — classification tags this cross-field " +
  "bleed — but that only counts toward the person-level rollup below, never toward a question's own theme shares.)";

const labelsPath = join(ARTIFACTS, "s08", "labels.jsonl");
const statusFinalPath = join(ARTIFACTS, "s04", "status-final.jsonl");
const dupClustersPath = join(ARTIFACTS, "s10", "dup-clusters.json");

const outputDir = join(ARTIFACTS, "s11");
const prevalenceJsonPath = join(outputDir, "prevalence.json");
const reportPath = join(REPORTS_DIR, "prevalence.md");

interface LabelRecord {
  id: string;
  field: string;
  code: string;
}

interface StatusRecord {
  id: string;
  question: string;
  status: string;
}

function readJsonl<T>(path: string): T[] {
  if (!existsSync(path)) return [];
  const raw = readFileSync(path, "utf8");
  return raw
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as T);
}

function pct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}

function renderThemeTable(q: QuestionPrevalence): string {
  const header = "| Theme | Share | 95% CI | n | n excl. near-dups |\n|---|---|---|---|---|";
  const rows = q.themes.map((t) => {
    const flag = t.verification === "needs_verification" ? " ⚠︎" : "";
    return `| ${t.label} (\`${t.code}\`)${flag} | ${pct(t.share)} | ${pct(t.ciLow)}–${pct(t.ciHigh)} | ${t.count} | ${t.countExclDups} |`;
  });
  const unverified = q.themes.filter((t) => t.verification === "needs_verification");
  const footnote =
    unverified.length > 0
      ? `\n\n⚠︎ **Needs verification before publication:** ${unverified.map((t) => `\`${t.code}\``).join(", ")} — proposed by a discovery pass but never backed by a citable quote in the codebook's own audit. Confirm this count against verbatims before reporting it; delete the theme rather than reporting a number at zero if it doesn't hold up.`
      : "";
  return [header, ...rows].join("\n") + footnote;
}

function renderSegmentsAppendix(q: QuestionPrevalence): string {
  return q.segments
    .map((seg) => {
      const cellLines = Object.entries(seg.values).map(([value, cell]) => {
        if (cell.suppressed) return `- **${value}** — n=${cell.n} (suppressed, below privacy threshold)`;
        const flag = cell.wideUncertainty ? " ⚠ wide uncertainty (small sample)" : "";
        const themeLine = (cell.themes ?? [])
          .filter((t) => t.count > 0)
          .map((t) => `${t.code} ${pct(t.share)}`)
          .join(", ");
        return `- **${value}** — n=${cell.n}${flag}${themeLine ? `: ${themeLine}` : ""}`;
      });
      return `#### ${seg.label}\n\n${cellLines.join("\n")}`;
    })
    .join("\n\n");
}

function renderQuestionSection(q: QuestionPrevalence): string {
  return `## ${q.id} — "${q.prompt}"

Counts: total ${q.counts.total}, substantive ${q.counts.substantive}, blank ${q.counts.blank}, refused ${q.counts.refused}, non-answer ${q.counts.nonanswer}.

${renderThemeTable(q)}

### Segments

${renderSegmentsAppendix(q)}`;
}

function renderReport(data: PrevalenceData): string {
  const personLevelRows = data.personLevel
    .map((t) => `| ${t.label} (\`${t.code}\`) | ${t.respondentCount} |`)
    .join("\n");

  return `# Prevalence report

Codebook version ${data.meta.codebookVersion} · model ${data.meta.model} · generated ${data.meta.generated}

${data.meta.sampleCaveat}

${data.meta.multiLabelNote}
${data.meta.truncationCaveat ? `\n${data.meta.truncationCaveat}\n` : ""}
## Person-level: distinct respondents who raised each theme, across all fields

| Theme | Respondents |
|---|---|
${personLevelRows}

${data.questions.map(renderQuestionSection).join("\n\n")}
`;
}

async function main() {
  mkdirSync(outputDir, { recursive: true });

  const codebook = loadCodebook(CODEBOOK_PATH);
  const demographicRows = await loadCsv(CLEAN_CSV);

  const labels = readJsonl<LabelRecord>(labelsPath);
  if (labels.length === 0) {
    console.warn(`⚠ ${labelsPath} is empty or missing (Task 10 pending / not yet run) — aggregating with zero labels.`);
  }
  const statuses = readJsonl<StatusRecord>(statusFinalPath);

  let dupClusters: Record<string, { clusterId: number; ids: string[] }[]> = {};
  if (existsSync(dupClustersPath)) {
    dupClusters = JSON.parse(readFileSync(dupClustersPath, "utf8"));
  } else {
    console.warn(`⚠ ${dupClustersPath} does not exist (Task 12 pending / not yet run) — countExclDups will equal count.`);
  }

  const audit = auditRows(demographicRows);
  const truncatedTotal = audit.perQuestion.reduce((sum, q) => sum + q.truncationSuspects, 0);
  const truncationCaveat =
    truncatedTotal > 0
      ? `**Export truncation caveat:** ${truncatedTotal} answer(s) across the three questions are at or near the ` +
        `1,000-character export cap and may be cut mid-word — theme counts for long answers may undercount.`
      : undefined;

  const data = aggregate({
    codebook,
    labels,
    statuses,
    dupClusters,
    demographicRows,
    idColumn: ID_COLUMN,
    demoColumns: SEGMENTS,
    segmentLabels: SEGMENT_LABELS,
    model: PIPELINE_MODEL,
    sampleCaveat: SAMPLE_CAVEAT,
    multiLabelNote: MULTI_LABEL_NOTE,
    truncationCaveat,
    suppressBelow: SUPPRESS_BELOW,
    flagBelow: FLAG_BELOW,
  });

  writeFileSync(prevalenceJsonPath, JSON.stringify(data, null, 2));
  writeFileSync(reportPath, renderReport(data));

  const inputFiles = [CLEAN_CSV, statusFinalPath, CODEBOOK_PATH];
  if (existsSync(labelsPath)) inputFiles.push(labelsPath);
  if (existsSync(dupClustersPath)) inputFiles.push(dupClustersPath);

  writeManifest(outputDir, {
    script: "s11-aggregate",
    inputFiles,
    outputFiles: [prevalenceJsonPath, reportPath],
    model: PIPELINE_MODEL,
    codebookVersion: codebook.version,
  });

  console.log(`Wrote ${prevalenceJsonPath}`);
  console.log(`Wrote ${reportPath}`);
  console.log(`Labels-file hash: ${existsSync(labelsPath) ? sha256(labelsPath) : "(no labels.jsonl found)"}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
