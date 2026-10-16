import { test } from "node:test";
import { existsSync } from "node:fs";
import assert from "node:assert/strict";
import { loadCsv } from "../src/lib/load.ts";
import { auditRows } from "../src/lib/audit.ts";
import { DATA_CSV } from "../src/config.ts";

test("auditRows: fixture with a duplicate ID and a truncated-length answer", () => {
  const rows = [
    { SURVEY_RESPONDENT_ID: "a1", PERSONAL_AI_IMPACT: "x".repeat(990), ECONOMIC_IMPACT_EXPECTATION: "short", GOVERNMENT_ACTION_SUGGESTION: "" },
    { SURVEY_RESPONDENT_ID: "a1", PERSONAL_AI_IMPACT: "", ECONOMIC_IMPACT_EXPECTATION: "y".repeat(50), GOVERNMENT_ACTION_SUGGESTION: "z".repeat(10) },
    { SURVEY_RESPONDENT_ID: "a2", PERSONAL_AI_IMPACT: "  ", ECONOMIC_IMPACT_EXPECTATION: "", GOVERNMENT_ACTION_SUGGESTION: "hello" },
  ];
  const a = auditRows(rows);

  assert.equal(a.rowCount, 3);
  assert.deepEqual(a.duplicateIds, ["a1"]);

  const personal = a.perQuestion.find((q) => q.column === "PERSONAL_AI_IMPACT")!;
  // row 1 has a 990-char answer, row 2 is blank, row 3 is whitespace-only (trimmed to empty)
  assert.equal(personal.filled, 1);
  assert.equal(personal.maxLen, 990);
  assert.equal(personal.medianLen, 990);
  assert.equal(personal.truncationSuspects, 1);

  const economic = a.perQuestion.find((q) => q.column === "ECONOMIC_IMPACT_EXPECTATION")!;
  assert.equal(economic.filled, 2);
  assert.equal(economic.truncationSuspects, 0);
});

test("real export: 2702 rows, unique IDs, 1000-char cap visible", { skip: !existsSync(DATA_CSV) && "survey export not present (set EC_DATA_DIR)" }, async () => {
  const rows = await loadCsv(DATA_CSV);
  const a = auditRows(rows);
  assert.equal(a.rowCount, 2702);
  assert.equal(a.duplicateIds.length, 0);
  const gov = a.perQuestion.find((q) => q.column === "GOVERNMENT_ACTION_SUGGESTION")!;
  assert.equal(gov.maxLen, 1000);
  assert.ok(gov.truncationSuspects >= 60, `saw ${gov.truncationSuspects}`);
});
