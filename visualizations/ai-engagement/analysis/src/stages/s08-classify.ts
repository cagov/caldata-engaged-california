import "dotenv/config";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import type { MessageBatch, MessageBatchIndividualResponse } from "@anthropic-ai/sdk/resources/messages/batches";
import { loadCsv } from "../lib/load.ts";
import { loadCodebook } from "../lib/codebook.ts";
import { buildClassifySystem, buildClassifyUser, validateLabels, LABELS_SCHEMA, type Label } from "../lib/classify.ts";
import { writeManifest } from "../lib/manifest.ts";
import { PIPELINE_MODEL, QUESTIONS, CLEAN_CSV, ID_COLUMN, ARTIFACTS, CODEBOOK_PATH, type Column } from "../config.ts";

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("ANTHROPIC_API_KEY missing — add it to analysis/.env (see .env.example)");
  process.exit(1);
}

const POLL_INTERVAL_MS = 30_000;

const statusFinalPath = join(ARTIFACTS, "s04", "status-final.jsonl");

const outputDir = join(ARTIFACTS, "s08");
const rawDir = join(outputDir, "raw");
const labelsPath = join(outputDir, "labels.jsonl");
const triagePath = join(outputDir, "triage.jsonl");

interface StatusRecord {
  id: string;
  question: string;
  status: string;
}

interface Respondent {
  id: string;
  answers: { column: Column; prompt: string; text: string }[];
}

function readJsonl<T>(path: string): T[] {
  const raw = readFileSync(path, "utf8");
  return raw
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as T);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pollUntilEnded(client: Anthropic, batchId: string): Promise<MessageBatch> {
  let current = await client.messages.batches.retrieve(batchId);
  while (current.processing_status !== "ended") {
    console.log(`  status=${current.processing_status} counts=${JSON.stringify(current.request_counts)}`);
    await sleep(POLL_INTERVAL_MS);
    current = await client.messages.batches.retrieve(batchId);
  }
  console.log(`  status=ended counts=${JSON.stringify(current.request_counts)}`);
  return current;
}

/**
 * Submits one batch request per respondent (custom_id = IDEA_ID), archives
 * every raw result line before parsing, and returns per-respondent outcomes
 * keyed by IDEA_ID. Shared between the first pass and the one retry pass.
 */
async function runBatch(
  client: Anthropic,
  systemPrompt: string,
  respondents: Respondent[],
  rawArchivePath: string,
  resumeBatchId?: string,
): Promise<Map<string, { ok: Label[]; unknownCodes: string[] } | { error: string }>> {
  let batchId: string;
  if (resumeBatchId) {
    console.log(`Resuming batch ${resumeBatchId} (skipping submission)...`);
    batchId = resumeBatchId;
  } else {
    console.log(`Submitting batch of ${respondents.length} classify request(s)...`);
    const batch = await client.messages.batches.create({
      requests: respondents.map((r) => ({
        custom_id: r.id,
        params: {
          model: PIPELINE_MODEL,
          max_tokens: 4000,
          system: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }],
          output_config: { format: { type: "json_schema", schema: LABELS_SCHEMA } },
          messages: [{ role: "user", content: buildClassifyUser(r.answers) }],
        },
      })),
    });
    batchId = batch.id;
    console.log(`Batch ${batch.id} submitted; polling every ${POLL_INTERVAL_MS / 1000}s until ended...`);
  }

  await pollUntilEnded(client, batchId);

  const rawLines: MessageBatchIndividualResponse[] = [];
  const resultStream = await client.messages.batches.results(batchId);
  for await (const line of resultStream) {
    rawLines.push(line);
  }
  writeFileSync(rawArchivePath, rawLines.map((line) => JSON.stringify(line)).join("\n") + (rawLines.length ? "\n" : ""));
  console.log(`Archived ${rawLines.length} raw result line(s) to ${rawArchivePath}`);

  const outcomes = new Map<string, { ok: Label[]; unknownCodes: string[] } | { error: string }>();
  const cb = loadCodebook(CODEBOOK_PATH);

  for (const line of rawLines) {
    if (line.result.type !== "succeeded") {
      outcomes.set(line.custom_id, { error: `batch result type: ${line.result.type}` });
      continue;
    }
    const textBlock = line.result.message.content.find(
      (block): block is Extract<typeof block, { type: "text" }> => block.type === "text",
    );
    if (!textBlock) {
      outcomes.set(line.custom_id, { error: "no text content block in successful result" });
      continue;
    }
    try {
      const parsed = JSON.parse(textBlock.text);
      outcomes.set(line.custom_id, validateLabels(parsed, cb));
    } catch (err) {
      outcomes.set(line.custom_id, { error: `parse/validate failed: ${(err as Error).message}` });
    }
  }

  for (const r of respondents) {
    if (!outcomes.has(r.id)) {
      outcomes.set(r.id, { error: "no result returned for submitted request" });
    }
  }

  return outcomes;
}

async function main() {
  mkdirSync(rawDir, { recursive: true });

  const cb = loadCodebook(CODEBOOK_PATH);
  const rows = await loadCsv(CLEAN_CSV);
  const statusRecords = readJsonl<StatusRecord>(statusFinalPath);

  const statusById = new Map<string, Map<string, string>>();
  for (const rec of statusRecords) {
    if (!statusById.has(rec.id)) statusById.set(rec.id, new Map());
    statusById.get(rec.id)!.set(rec.question, rec.status);
  }

  const respondents: Respondent[] = [];
  for (const row of rows) {
    const id = row[ID_COLUMN];
    if (!id) continue;
    const answers = QUESTIONS.filter((q) => statusById.get(id)?.get(q.id) === "substantive").map((q) => ({
      column: q.column,
      prompt: q.prompt,
      text: row[q.column] ?? "",
    }));
    if (answers.length > 0) respondents.push({ id, answers });
  }

  console.log(`${respondents.length} respondent(s) have at least one substantive answer.`);

  const systemPrompt = buildClassifySystem(cb);
  const client = new Anthropic();

  const outcomes = await runBatch(
    client,
    systemPrompt,
    respondents,
    join(rawDir, "results.jsonl"),
    process.env.RESUME_BATCH_ID,
  );

  const failedIds = respondents.filter((r) => "error" in outcomes.get(r.id)!).map((r) => r.id);
  let retryOutcomes = new Map<string, { ok: Label[]; unknownCodes: string[] } | { error: string }>();
  if (failedIds.length > 0) {
    console.log(`Retrying ${failedIds.length} failed respondent(s) once...`);
    const retryRespondents = respondents.filter((r) => failedIds.includes(r.id));
    retryOutcomes = await runBatch(
      client,
      systemPrompt,
      retryRespondents,
      join(rawDir, "retry-results.jsonl"),
      process.env.RESUME_RETRY_BATCH_ID,
    );
  }

  const labelLines: string[] = [];
  const triage: Record<string, unknown>[] = [];

  for (const r of respondents) {
    const outcome = retryOutcomes.get(r.id) ?? outcomes.get(r.id)!;
    if ("error" in outcome) {
      triage.push({ id: r.id, reason: outcome.error });
      continue;
    }
    for (const label of outcome.ok) {
      labelLines.push(JSON.stringify({ id: r.id, field: label.field, code: label.code, codebookVersion: cb.version, model: PIPELINE_MODEL }));
    }
    if (outcome.unknownCodes.length > 0) {
      triage.push({ id: r.id, reason: "model returned code(s) not in the codebook", unknownCodes: outcome.unknownCodes });
    }
  }

  writeFileSync(labelsPath, labelLines.join("\n") + (labelLines.length ? "\n" : ""));
  writeFileSync(triagePath, triage.map((t) => JSON.stringify(t)).join("\n") + (triage.length ? "\n" : ""));

  writeManifest(outputDir, {
    script: "s08-classify",
    inputFiles: [CLEAN_CSV, statusFinalPath, CODEBOOK_PATH],
    outputFiles: [labelsPath, triagePath],
    model: PIPELINE_MODEL,
    codebookVersion: cb.version,
  });

  console.log("");
  console.log(`Wrote ${labelLines.length} label(s) to ${labelsPath}`);
  console.log(`Wrote ${triagePath} (${triage.length} entries)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
