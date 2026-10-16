import { test } from "node:test";
import assert from "node:assert/strict";
import { findDupClusters } from "../src/lib/dups.ts";

const base = "ban tax incentives for ai projects including film production work and data centers because they drain public money";
test("near-identical texts cluster; unrelated text does not", () => {
  const clusters = findDupClusters([
    { id: "a", text: base },
    { id: "b", text: base.replace("drain", "waste") },
    { id: "c", text: "I love using AI for my hobby photography and it saves me time every week honestly" },
  ]);
  assert.equal(clusters.length, 1);
  assert.deepEqual(clusters[0].ids.sort(), ["a", "b"]);
});

test("short coincidental matches don't cluster — many independent people can write the same terse answer", () => {
  // "Nothing" / "Stay out of it." are exactly the kind of short answer many
  // independent respondents converge on by chance; that's a real, meaningful
  // signal, not a templated submission, and must not be treated as a dup.
  const clusters = findDupClusters([
    { id: "a", text: "Nothing" },
    { id: "b", text: "Nothing" },
    { id: "c", text: "Nothing" },
  ]);
  assert.equal(clusters.length, 0);
});

test("exact duplicates (after normalizing case/punctuation/whitespace) cluster once long enough to be a real match", () => {
  const long = "Ban AI use for profit and education in California until it is proven safe and regulated properly by the state";
  const clusters = findDupClusters([
    { id: "a", text: `${long}.` },
    { id: "b", text: long },
    { id: "c", text: "Regulate it heavily but allow continued research into medical applications" },
  ]);
  assert.equal(clusters.length, 1);
  assert.deepEqual(clusters[0].ids.sort(), ["a", "b"]);
});

test("three mutually-similar long texts form one cluster, not pairs", () => {
  const clusters = findDupClusters([
    { id: "a", text: base },
    { id: "b", text: base.replace("drain", "waste") },
    { id: "c", text: base.replace("public money", "taxpayer money") },
  ]);
  assert.equal(clusters.length, 1);
  assert.deepEqual(clusters[0].ids.sort(), ["a", "b", "c"]);
});

test("no clusters when every text is distinct", () => {
  const clusters = findDupClusters([
    { id: "a", text: "I love using AI for my hobby photography and it saves me time every week honestly" },
    { id: "b", text: "The government should ban surveillance uses of facial recognition technology immediately" },
  ]);
  assert.equal(clusters.length, 0);
});
