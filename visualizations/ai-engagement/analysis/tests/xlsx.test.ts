import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readWorkbook, sheetToObjects } from "../src/lib/xlsx.ts";

const REAL_WORKBOOK = join(dirname(fileURLToPath(import.meta.url)), "../../data/deliberation-dataset.xlsx");
// This project's rooms feature deliberately does NOT use this older
// workbook as its source of truth (see docs/SOURCE.md's "Divergence from
// deliberation-dataset.xlsx" note) — it's gitignored and not guaranteed to
// exist on disk. The tests below that exercise it skip cleanly, rather than
// hard-failing, when it's absent, so the suite stays reproducible without a
// silent pass hiding a real regression if the file IS present but broken.
const REAL_WORKBOOK_SKIP = !existsSync(REAL_WORKBOOK) && "real workbook not present";

// --- minimal hand-rolled zip builder, stored (uncompressed) entries only ---
// Used to exercise two paths the real workbook doesn't currently exercise:
// split shared-string runs and the missing-r-attribute fallback. See
// task-1-report.md for why the real file can't cover these.
function buildZip(entries: Array<{ name: string; data: string }>): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, "utf8");
    const dataBuf = Buffer.from(data, "utf8");

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(0, 8); // method: stored
    local.writeUInt16LE(0, 10); // mtime
    local.writeUInt16LE(0, 12); // mdate
    local.writeUInt32LE(0, 14); // crc32 (unchecked by our reader)
    local.writeUInt32LE(dataBuf.length, 18); // compressed size
    local.writeUInt32LE(dataBuf.length, 22); // uncompressed size
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28); // extra length
    localParts.push(local, nameBuf, dataBuf);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0, 8); // flags
    central.writeUInt16LE(0, 10); // method: stored
    central.writeUInt16LE(0, 12); // mtime
    central.writeUInt16LE(0, 14); // mdate
    central.writeUInt32LE(0, 16); // crc32
    central.writeUInt32LE(dataBuf.length, 20); // compressed size
    central.writeUInt32LE(dataBuf.length, 24); // uncompressed size
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30); // extra length
    central.writeUInt16LE(0, 32); // comment length
    central.writeUInt16LE(0, 34); // disk number start
    central.writeUInt16LE(0, 36); // internal attrs
    central.writeUInt32LE(0, 38); // external attrs
    central.writeUInt32LE(offset, 42); // local header offset
    centralParts.push(central, nameBuf);

    offset += local.length + nameBuf.length + dataBuf.length;
  }

  const centralDirOffset = offset;
  const centralBuf = Buffer.concat(centralParts);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(centralDirOffset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralBuf, eocd]);
}

function writeSyntheticWorkbook(): string {
  const workbookXml =
    '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<sheets><sheet name="Test" sheetId="1" r:id="rId1"/></sheets></workbook>';

  const relsXml =
    '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type=".../worksheet" Target="worksheets/sheet1.xml"/></Relationships>';

  // index 0 is a shared string split across two <r><t> runs; index 1-5 are plain.
  const sharedStringsXml =
    '<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="6" uniqueCount="6">' +
    "<si><r><t>Hello </t></r><r><t>World</t></r></si>" +
    "<si><t>col_a</t></si><si><t>col_b</t></si><si><t>col_c</t></si>" +
    "<si><t>left</t></si><si><t>right</t></si>" +
    "</sst>";

  const sheetXml =
    '<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' +
    // header row: normal, with r attributes
    '<row r="1"><c r="A1" t="s"><v>1</v></c><c r="B1" t="s"><v>2</v></c><c r="C1" t="s"><v>3</v></c></row>' +
    // data row: r attributes omitted entirely; middle cell blank - must not
    // collapse the third cell into column B.
    "<row><c t=\"s\"><v>4</v></c><c/><c t=\"s\"><v>5</v></c></row>" +
    // data row: r present, single cell holding the split shared-string run.
    '<row r="3"><c r="A3" t="s"><v>0</v></c></row>' +
    "</sheetData></worksheet>";

  const zip = buildZip([
    { name: "xl/workbook.xml", data: workbookXml },
    { name: "xl/_rels/workbook.xml.rels", data: relsXml },
    { name: "xl/sharedStrings.xml", data: sharedStringsXml },
    { name: "xl/worksheets/sheet1.xml", data: sheetXml },
  ]);

  const dir = mkdtempSync(join(tmpdir(), "xlsx-"));
  const path = join(dir, "synthetic.xlsx");
  writeFileSync(path, zip);
  return path;
}

test("synthetic workbook: concatenates split shared-string runs", () => {
  const sheets = readWorkbook(writeSyntheticWorkbook());
  const rows = sheets.get("Test")!;
  assert.equal(rows[2][0], "Hello World");
});

test("synthetic workbook: missing-r fallback advances past a blank middle cell", () => {
  const sheets = readWorkbook(writeSyntheticWorkbook());
  const rows = sheets.get("Test")!;
  assert.deepEqual(rows[0], ["col_a", "col_b", "col_c"]);
  assert.deepEqual(rows[1], ["left", "", "right"]);
});

test("synthetic workbook: sheetToObjects uses row 0 as headers", () => {
  const sheets = readWorkbook(writeSyntheticWorkbook());
  const objects = sheetToObjects(sheets.get("Test")!);
  assert.equal(objects.length, 2);
  assert.deepEqual(objects[0], { col_a: "left", col_b: "", col_c: "right" });
});

test("real workbook: yields all 10 named sheets", { skip: REAL_WORKBOOK_SKIP }, () => {
  const sheets = readWorkbook(REAL_WORKBOOK);
  assert.deepEqual(
    [...sheets.keys()],
    [
      "README",
      "Sessions",
      "Participants",
      "Themes",
      "Subthemes",
      "IdeaGroups",
      "PolicyIdeas",
      "SessionThemes",
      "Moments",
      "MotionParams",
    ],
  );
});

test("real workbook: PolicyIdeas decodes to 151 data rows plus header/TOTAL", { skip: REAL_WORKBOOK_SKIP }, () => {
  const sheets = readWorkbook(REAL_WORKBOOK);
  const rows = sheets.get("PolicyIdeas")!;
  assert.equal(rows.length, 153); // header + 151 ideas + TOTAL

  const objects = sheetToObjects(rows);
  assert.equal(objects.length, 152);
  assert.equal(objects[0].idea_id, "I-001");
  assert.equal(objects[150].idea_id, "I-151");
  assert.equal(objects[151].idea_id, "TOTAL");
});

test("real workbook: PolicyIdeas TOTAL row's sparse cells land in their real (r-derived) columns, not shifted left", { skip: REAL_WORKBOOK_SKIP }, () => {
  const sheets = readWorkbook(REAL_WORKBOOK);
  const rows = sheets.get("PolicyIdeas")!;
  const header = rows[0];
  const total = rows[rows.length - 1];
  // TOTAL only populates idea_id (A), votes (G) and starred (H); every other
  // cell is entirely absent from the row's XML. A reader that ignored the r
  // attribute and just counted <c> elements in sequence would put the votes
  // total at index 1 (column B) instead of index 6 (column G).
  assert.equal(header[6], "votes");
  assert.equal(header[7], "starred");
  assert.equal(total[0], "TOTAL");
  assert.equal(total[6], "519");
  assert.equal(total[7], "54");
  assert.equal(total[1], ""); // sticky_text - genuinely absent, not the votes figure
});

test("real workbook: Sessions blank top_third_threshold column doesn't misalign later columns", { skip: REAL_WORKBOOK_SKIP }, () => {
  const sheets = readWorkbook(REAL_WORKBOOK);
  const rows = sheets.get("Sessions")!;
  const objects = sheetToObjects(rows);

  const header = rows[0];
  assert.equal(header[5], "top_third_threshold");

  for (const sessionId of ["S01", "S02", "S03", "S04", "S05"]) {
    const row = objects.find((o) => o.session_id === sessionId)!;
    assert.ok(row, `expected a row for ${sessionId}`);
    assert.equal(row.top_third_threshold, "");
    // color_hex sits two columns after the blank one; must still be intact.
    assert.ok(/^#[0-9A-Fa-f]{6}$/.test(row.color_hex), `color_hex for ${sessionId} should be a hex color, got ${JSON.stringify(row.color_hex)}`);
  }
});
