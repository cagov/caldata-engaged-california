import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadCsv } from "../src/lib/load.ts";

test("parses quoted embedded newlines as one record", async () => {
  const dir = mkdtempSync(join(tmpdir(), "csv-"));
  const p = join(dir, "t.csv");
  writeFileSync(p, 'ID,TEXT\na1,"line one\nline two"\na2,plain\n');
  const rows = await loadCsv(p);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].TEXT, "line one\nline two");
});

test("rejects with error when path does not exist", async () => {
  const nonexistentPath = join(tmpdir(), "nonexistent-" + Math.random() + ".csv");
  try {
    await loadCsv(nonexistentPath);
    assert.fail("expected loadCsv to reject");
  } catch (err) {
    assert.ok(err instanceof Error, "error should be an Error instance");
    assert.ok((err as NodeJS.ErrnoException).code === "ENOENT", `expected ENOENT, got ${(err as NodeJS.ErrnoException).code}`);
  }
});
