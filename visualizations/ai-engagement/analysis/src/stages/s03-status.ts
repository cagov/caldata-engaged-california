import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadCsv } from "../lib/load.ts";
import { deterministicStatus } from "../lib/status.ts";
import { writeManifest } from "../lib/manifest.ts";
import { CLEAN_CSV, QUESTIONS, ID_COLUMN, ARTIFACTS } from "../config.ts";

const outputDir = join(ARTIFACTS, "s03");
const statusJsonlPath = join(outputDir, "status.jsonl");
const pendingJsonlPath = join(outputDir, "pending.jsonl");

interface StatusRecord {
  id: string;
  question: string;
  status: "blank" | "refused" | "substantive" | "needs_judgment";
  len: number;
}

interface PendingRecord {
  question: string;
  text: string;
}

async function main() {
  const rows = await loadCsv(CLEAN_CSV);

  mkdirSync(outputDir, { recursive: true });

  // Track distinct pending pairs using a Set to avoid duplicates
  const pendingSet = new Set<string>();
  const statusRecords: StatusRecord[] = [];
  const perQuestionCounts: Record<string, Record<string, number>> = {};

  // Initialize per-question counts
  for (const q of QUESTIONS) {
    perQuestionCounts[q.id] = {
      blank: 0,
      refused: 0,
      substantive: 0,
      needs_judgment: 0,
    };
  }

  // Process each row and each question
  for (const row of rows) {
    const id = row[ID_COLUMN];
    if (!id) continue;

    for (const q of QUESTIONS) {
      const text = row[q.column] ?? "";
      const status = deterministicStatus(text);
      const len = text.trim().length;

      statusRecords.push({
        id,
        question: q.id,
        status,
        len,
      });

      // Update counts
      perQuestionCounts[q.id][status]++;

      // Collect distinct pending pairs (lower-cased and trimmed)
      if (status === "needs_judgment") {
        const normalizedText = text.trim().toLowerCase();
        const key = JSON.stringify({ question: q.id, text: normalizedText });
        pendingSet.add(key);
      }
    }
  }

  // Write status.jsonl
  const statusLines = statusRecords.map((r) => JSON.stringify(r)).join("\n");
  writeFileSync(statusJsonlPath, statusLines + "\n");

  // Write pending.jsonl with distinct pairs
  const pendingRecords: PendingRecord[] = Array.from(pendingSet)
    .map((key) => JSON.parse(key) as PendingRecord)
    .sort((a, b) => {
      if (a.question !== b.question) return a.question.localeCompare(b.question);
      return a.text.localeCompare(b.text);
    });

  const pendingLines = pendingRecords.map((r) => JSON.stringify(r)).join("\n");
  writeFileSync(pendingJsonlPath, pendingLines + "\n");

  // Write manifest
  writeManifest(outputDir, {
    script: "s03-status",
    inputFiles: [CLEAN_CSV],
    outputFiles: [statusJsonlPath, pendingJsonlPath],
  });

  // Print per-question counts to console
  console.log(`Read ${rows.length} records`);
  console.log("");
  console.log("Per-question status counts:");
  for (const q of QUESTIONS) {
    const counts = perQuestionCounts[q.id];
    console.log(`${q.id}:`);
    console.log(`  blank: ${counts.blank}`);
    console.log(`  refused: ${counts.refused}`);
    console.log(`  substantive: ${counts.substantive}`);
    console.log(`  needs_judgment: ${counts.needs_judgment}`);
  }
  console.log("");
  console.log(`Distinct pending pairs: ${pendingRecords.length}`);
  console.log(`Wrote ${statusJsonlPath}`);
  console.log(`Wrote ${pendingJsonlPath}`);
}

main();
