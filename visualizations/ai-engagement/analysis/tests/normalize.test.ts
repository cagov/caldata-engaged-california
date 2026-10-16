import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeText } from "../src/lib/normalize.ts";

test("curly quotes, dashes, ellipsis, CRLF, zero-width", () => {
  assert.equal(normalizeText("don’t “quote” — ok…"), 'don\'t "quote" - ok...');
  assert.equal(normalizeText("a\r\nb"), "a\nb");
  assert.equal(normalizeText("a​b c"), "ab c");
});

test("paragraph breaks preserved, runs collapsed", () => {
  assert.equal(normalizeText("one\n\n\n\ntwo"), "one\n\ntwo");
  assert.equal(normalizeText("a  \t b"), "a b");
});
