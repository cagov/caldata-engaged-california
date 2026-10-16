import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDiscoverPrompt, parseCandidates } from "../src/lib/discover.ts";

test("prompt contains the question text, verbatim-quote and no-counting instructions, and existing codes", () => {
  const p = buildDiscoverPrompt("How do you expect AI to impact the economy?", ["JOB_LOSS", "JOB_CREATION"]);

  assert.ok(p.includes("How do you expect AI to impact the economy?"));
  assert.ok(p.toLowerCase().includes("verbatim"));
  assert.match(p, /do not report counts or percentages/i);
  assert.ok(p.includes("JOB_LOSS"));
  assert.ok(p.includes("JOB_CREATION"));
});

test("prompt mentions rare/small-group themes as a priority", () => {
  const p = buildDiscoverPrompt("q", []);
  assert.ok(p.toLowerCase().includes("rare"));
});

test("parseCandidates accepts the schema shape", () => {
  const json = JSON.stringify({
    candidates: [
      {
        code: "HEALTHCARE_ACCESS",
        label: "Healthcare access",
        definition: "AI affecting access to healthcare.",
        includes: ["diagnosis tools", "insurance denials"],
        excludes: ["General cost complaints"],
        examples: ["my insurance denied my claim using an AI tool"],
        prominence: "occasional",
        overlapsExisting: null,
      },
    ],
  });
  const parsed = parseCandidates(json);
  assert.equal(parsed.candidates.length, 1);
  assert.equal(parsed.candidates[0].code, "HEALTHCARE_ACCESS");
  assert.equal(parsed.candidates[0].overlapsExisting, null);
});

test("parseCandidates rejects junk", () => {
  assert.throws(() => parseCandidates('{"candidates":[{"code":"X"}]}'));
  assert.throws(() => parseCandidates('{"nope":true}'));
  assert.throws(() => parseCandidates("not json"));
  assert.throws(() =>
    parseCandidates(
      JSON.stringify({
        candidates: [
          {
            code: "X",
            label: "L",
            definition: "D",
            includes: [],
            excludes: [],
            examples: [],
            prominence: "very_common", // invalid enum value
            overlapsExisting: null,
          },
        ],
      }),
    ),
  );
});
