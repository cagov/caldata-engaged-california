import { test } from "node:test";
import assert from "node:assert/strict";
import { DISCUSSION_HEADING, buildDiscussionViews, libStageFor, viewIndexFor } from "../src/lib/discussionSection.ts";

test("DISCUSSION_HEADING is the mockup's constant heading", () => {
  assert.equal(DISCUSSION_HEADING, "The power of the discussion");
});

test("buildDiscussionViews returns exactly 3 views in curtain, moments, concepts order", () => {
  const views = buildDiscussionViews(14, 29, 27);
  assert.equal(views.length, 3);
  assert.deepEqual(
    views.map((v) => v.key),
    ["curtain", "moments", "concepts"],
  );
});

test("buildDiscussionViews' stats display the passed counts, with the mockups' icons", () => {
  const [curtain, moments, concepts] = buildDiscussionViews(14, 29, 27);

  assert.deepEqual(curtain.stat, { icon: "chats", value: "14", caption: "conversations" });
  assert.deepEqual(moments.stat, { icon: "lightbulb", value: "29", caption: "policy concepts" });
  assert.deepEqual(concepts.stat, { icon: "lightbulb", value: "27", caption: "phase 2 concepts" });
});

test("the concepts view's sub-line quotes the same count its stat displays", () => {
  const [, , concepts31] = buildDiscussionViews(14, 29, 31);
  assert.ok(concepts31.sub.includes("31"), `expected sub to mention 31, got: ${concepts31.sub}`);
  assert.equal(concepts31.stat?.value, "31");

  const [, , concepts27] = buildDiscussionViews(14, 29, 27);
  assert.ok(concepts27.sub.includes("27"), `expected sub to mention 27, got: ${concepts27.sub}`);
  assert.ok(!concepts27.sub.includes("31"));
});

test("every view carries non-empty copy and a non-null stat", () => {
  for (const view of buildDiscussionViews(14, 29, 27)) {
    assert.ok(view.phase.length > 0, `${view.key} missing phase`);
    assert.ok(view.title.length > 0, `${view.key} missing title`);
    assert.ok(view.sub.length > 0, `${view.key} missing sub`);
    assert.ok(view.stat !== null, `${view.key} missing stat`);
  }
});

test("libStageFor maps this section's 3 views onto funnelCloud.ts's stage numbering", () => {
  assert.deepEqual([0, 1, 2].map(libStageFor), [5, 6, 7]);
});

test("libStageFor falls back to the first view for an out-of-range index", () => {
  assert.equal(libStageFor(-1), 5);
  assert.equal(libStageFor(3), 5);
});

test("viewIndexFor is libStageFor's inverse for every in-range stage", () => {
  assert.deepEqual([5, 6, 7].map(viewIndexFor), [0, 1, 2]);
});

test("viewIndexFor falls back to 0 for a stage this section never uses", () => {
  assert.equal(viewIndexFor(0), 0);
  assert.equal(viewIndexFor(4), 0);
});
