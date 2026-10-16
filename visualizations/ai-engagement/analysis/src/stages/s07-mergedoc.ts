import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { loadCodebook, type Theme } from "../lib/codebook.ts";
import { writeManifest } from "../lib/manifest.ts";
import { PROMINENCE_VALUES, type Candidate } from "../lib/discover.ts";
import { QUESTIONS, ARTIFACTS, REPORTS_DIR, CODEBOOK_PATH } from "../config.ts";

const candidatesDir = join(ARTIFACTS, "s06");
const reportPath = join(REPORTS_DIR, "codebook-merge.md");

function renderExistingThemesTable(themes: Theme[], candidates: Candidate[]): string {
  const header = "| Code | Label | Matched candidate | Prominence |\n|---|---|---|---|";
  const rows = themes.map((theme) => {
    const match = candidates.find((c) => c.overlapsExisting === theme.code);
    const matchedLabel = match ? match.label : "—";
    const prominence = match ? match.prominence : "—";
    return `| \`${theme.code}\` | ${theme.label} | ${matchedLabel} | ${prominence} |`;
  });
  return [header, ...rows].join("\n");
}

function renderCandidateSection(candidate: Candidate, existingCodes: Set<string>): string {
  const lines: string[] = [];
  lines.push(`##### \`${candidate.code}\` — ${candidate.label}`);
  lines.push("");
  lines.push(candidate.definition);
  lines.push("");
  if (candidate.includes.length > 0) {
    lines.push("Includes:");
    for (const inc of candidate.includes) lines.push(`- ${inc}`);
    lines.push("");
  }
  if (candidate.excludes.length > 0) {
    lines.push("Excludes:");
    for (const exc of candidate.excludes) lines.push(`- ${exc}`);
    lines.push("");
  }
  if (candidate.examples.length > 0) {
    lines.push("Verbatim examples:");
    for (const ex of candidate.examples) lines.push(`> ${ex}`);
    lines.push("");
  }
  lines.push(`Prominence: ${candidate.prominence}`);
  if (candidate.overlapsExisting && !existingCodes.has(candidate.overlapsExisting)) {
    lines.push("");
    lines.push(
      `_Note: model claimed overlap with \`${candidate.overlapsExisting}\`, which is not an existing code for this question — treated as new._`,
    );
  }
  lines.push("");
  lines.push(`- [ ] ADOPT / RENAME / MERGE INTO ______ / REJECT — \`${candidate.code}\``);
  return lines.join("\n");
}

function main() {
  mkdirSync(REPORTS_DIR, { recursive: true });

  const codebook = loadCodebook(CODEBOOK_PATH);

  const inputFiles: string[] = [CODEBOOK_PATH];
  const sections: string[] = [];

  sections.push(`# Codebook merge — candidates vs. codebook v${codebook.version}`);
  sections.push("");
  sections.push(
    "Discovery candidates joined against the current codebook. For each new " +
      "candidate below, mark exactly one decision. This document is a human " +
      "review aid only — no theme definitions are changed by generating it.",
  );
  sections.push("");

  for (const q of QUESTIONS) {
    const question = codebook.questions.find((cq) => cq.id === q.id);
    if (!question) {
      throw new Error(`Codebook has no question entry for id "${q.id}"`);
    }
    const existingCodes = new Set(question.themes.map((t) => t.code));

    const candidatesPath = join(candidatesDir, `candidates.${q.id}.json`);
    let candidates: Candidate[] = [];
    if (existsSync(candidatesPath)) {
      candidates = JSON.parse(readFileSync(candidatesPath, "utf-8")) as Candidate[];
      inputFiles.push(candidatesPath);
    }

    sections.push(`## ${q.id} — "${q.prompt}"`);
    sections.push("");

    if (candidates.length === 0) {
      sections.push(`_No candidates file found at \`${candidatesPath}\` — discovery has not run for this question yet._`);
      sections.push("");
      continue;
    }

    sections.push("### Existing themes");
    sections.push("");
    sections.push(renderExistingThemesTable(question.themes, candidates));
    sections.push("");

    const newCandidates = candidates.filter((c) => !c.overlapsExisting || !existingCodes.has(c.overlapsExisting));

    sections.push("### New candidates");
    sections.push("");
    sections.push(
      "_Grouped by the discovery model's qualitative prominence guess, dominant " +
        "first, purely to make a first review pass faster — this is not a real " +
        "count and nothing here is pre-decided. Review every group; rare themes " +
        "raised by a handful of respondents are often exactly what a public " +
        "consultation is for._",
    );
    sections.push("");
    if (newCandidates.length === 0) {
      sections.push("_No new candidates — every discovered theme matched an existing code._");
      sections.push("");
    } else {
      for (const prominence of PROMINENCE_VALUES) {
        const group = newCandidates.filter((c) => c.prominence === prominence);
        if (group.length === 0) continue;
        sections.push(`#### ${prominence[0].toUpperCase()}${prominence.slice(1)} (${group.length})`);
        sections.push("");
        for (const candidate of group) {
          sections.push(renderCandidateSection(candidate, existingCodes));
          sections.push("");
        }
      }
    }
  }

  const content = sections.join("\n");
  writeFileSync(reportPath, content);
  console.log(`Wrote ${reportPath}`);

  writeManifest(join(ARTIFACTS, "s07"), {
    script: "s07-mergedoc",
    inputFiles,
    outputFiles: [reportPath],
    codebookVersion: codebook.version,
  });
}

main();
