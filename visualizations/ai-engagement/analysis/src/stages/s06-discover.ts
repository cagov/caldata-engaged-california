import "dotenv/config";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { buildDiscoverPrompt, parseCandidates, CANDIDATE_SCHEMA } from "../lib/discover.ts";
import { loadCodebook } from "../lib/codebook.ts";
import { writeManifest } from "../lib/manifest.ts";
import { PIPELINE_MODEL, QUESTIONS, ARTIFACTS, CORPUS_DIR, CODEBOOK_PATH } from "../config.ts";

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("ANTHROPIC_API_KEY missing — add it to analysis/.env (see .env.example)");
  process.exit(1);
}

const outputDir = join(ARTIFACTS, "s06");
const rawDir = join(outputDir, "raw");

async function main() {
  mkdirSync(rawDir, { recursive: true });

  const codebook = loadCodebook(CODEBOOK_PATH);
  const client = new Anthropic();

  const inputFiles: string[] = [CODEBOOK_PATH];
  const outputFiles: string[] = [];

  for (const q of QUESTIONS) {
    const corpusPath = join(CORPUS_DIR, `${q.id}.txt`);
    const corpusText = readFileSync(corpusPath, "utf-8");
    inputFiles.push(corpusPath);

    // Existing codes are scoped to this question only — the discovery model
    // is looking for overlaps within one question's theme space, not across
    // all three questions' codebooks.
    const existingCodes = (codebook.questions.find((cq) => cq.id === q.id)?.themes ?? []).map((t) => t.code);

    const instructions = buildDiscoverPrompt(q.prompt, existingCodes);
    const fullPrompt = `${instructions}

Here is every substantive response to this question, one per block, each
prefixed with its response ID in brackets:

${corpusText}`;

    console.log(`Discovering themes for "${q.id}" (~${Math.ceil(corpusText.length / 4)} corpus tokens)...`);

    const stream = client.messages.stream({
      model: PIPELINE_MODEL,
      max_tokens: 32000, // extended thinking may be on by default for PIPELINE_MODEL and counts toward max_tokens
      output_config: { format: { type: "json_schema", schema: CANDIDATE_SCHEMA } },
      messages: [{ role: "user", content: fullPrompt }],
    });

    // Streaming (not a plain create call): the input is ~50-80k tokens and a
    // non-streaming request risks timing out.
    const finalMessage = await stream.finalMessage();

    // Archive the raw response to disk before any parsing happens.
    const rawPath = join(rawDir, `${q.id}.json`);
    writeFileSync(rawPath, JSON.stringify(finalMessage, null, 2));
    console.log(`  archived raw response to ${rawPath}`);

    const textBlock = finalMessage.content.find(
      (block): block is Extract<typeof block, { type: "text" }> => block.type === "text",
    );
    if (!textBlock) {
      throw new Error(`No text content block in discovery response for question "${q.id}"`);
    }

    const { candidates } = parseCandidates(textBlock.text);

    const candidatesPath = join(outputDir, `candidates.${q.id}.json`);
    writeFileSync(candidatesPath, JSON.stringify(candidates, null, 2));
    outputFiles.push(candidatesPath);

    console.log(`  -> ${candidates.length} candidate theme(s) for "${q.id}"`);
  }

  writeManifest(outputDir, {
    script: "s06-discover",
    inputFiles,
    outputFiles,
    model: PIPELINE_MODEL,
  });

  console.log("");
  console.log(`Wrote candidates for ${QUESTIONS.length} question(s) to ${outputDir}/`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
