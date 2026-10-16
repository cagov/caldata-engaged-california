/**
 * Writes the stand-in data set:
 *   out/viz/   every JSON file the viz app fetches (vite serves this folder)
 *   out/data/  a fake copy of analysis/'s DATA_CSV, for the offline stages
 *
 * Usage: npm run generate [-- --seed 20261013 --out out]
 * Output is a pure function of the seed.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { toCsv } from "./csv.ts";
import { loadInputs, type Inputs } from "./inputs.ts";
import { crosswalkJson, funnelJson, insightsJson } from "./published.ts";
import { makeRng } from "./rng.ts";
import { makeRooms } from "./rooms.ts";
import { makeRespondents, respondentsJson, surveyCsvRows, SURVEY_CSV_HEADER, verbatimsJson } from "./survey.ts";

export const DEFAULT_SEED = 20261013;
/** Fixed so regenerating never produces a diff; not a real timestamp. */
export const GENERATED = "2026-10-13T00:00:00.000Z";
/** Same file name analysis/src/config.ts expects for DATA_CSV. */
export const SURVEY_CSV_NAME = "survey respondent demographics, 2026-08-18-1554.csv";

export function generateAll(seed: number, inputs: Inputs = loadInputs()) {
  const people = makeRespondents(makeRng(seed), inputs);
  const respondents = respondentsJson(people, inputs, GENERATED, seed);
  const { rooms, roomIdeas } = makeRooms(makeRng(seed + 1), inputs, GENERATED, seed);
  const viz: Record<string, unknown> = {
    "respondents.json": respondents,
    "rooms.json": rooms,
    "roomIdeas.json": roomIdeas,
    "funnel.json": funnelJson(inputs, GENERATED),
    "insights.json": insightsJson(inputs),
    "crosswalk.json": crosswalkJson(inputs, respondents, rooms, GENERATED),
  };
  for (const [q, texts] of Object.entries(verbatimsJson(people))) viz[`verbatims.${q}.json`] = texts;
  const surveyCsv = toCsv(SURVEY_CSV_HEADER, surveyCsvRows(makeRng(seed + 2), people, inputs));
  return { viz, surveyCsv, people };
}

function main() {
  const { values } = parseArgs({ options: { seed: { type: "string" }, out: { type: "string" } } });
  const seed = values.seed ? Number(values.seed) : DEFAULT_SEED;
  const out = values.out ?? join(dirname(fileURLToPath(import.meta.url)), "..", "out");
  const { viz, surveyCsv } = generateAll(seed);
  mkdirSync(join(out, "viz"), { recursive: true });
  mkdirSync(join(out, "data"), { recursive: true });
  for (const [name, data] of Object.entries(viz)) writeFileSync(join(out, "viz", name), JSON.stringify(data));
  writeFileSync(join(out, "data", SURVEY_CSV_NAME), surveyCsv);
  console.log(`seed ${seed}: wrote ${Object.keys(viz).length} files to ${join(out, "viz")} and 1 CSV to ${join(out, "data")}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
