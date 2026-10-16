// Zero-dependency .xlsx reader for the subset of the OOXML format this
// project's workbooks use (LibreOffice/Excel-produced, single-disk zip,
// shared-string table, no zip64). No npm dependency: only node:zlib for
// inflate and hand-rolled zip/XML scanning.
//
// Deliberately reads the zip's *central directory* (via the end-of-central-
// directory record) rather than walking local file headers in sequence: the
// real workbook this was built against sets the "data descriptor" bit
// (general-purpose flag bit 3) on every entry, which means local headers
// report compressed/uncompressed size as 0 — the central directory is the
// only place those sizes are reliable.
import { readFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";

const EOCD_SIG = 0x06054b50;
const CDH_SIG = 0x02014b50;
const LFH_SIG = 0x04034b50;

/** Unzips the whole archive into a map of entry path -> decompressed bytes. */
function readZipEntries(buf: Buffer): Map<string, Buffer> {
  // Central-directory record count/size/offset live in the EOCD, which sits
  // at the end of the file (after an optional comment) - scan backward for it.
  let eocdAt = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) {
      eocdAt = i;
      break;
    }
  }
  if (eocdAt < 0) throw new Error("not a zip file (no end-of-central-directory record found)");

  const entryCount = buf.readUInt16LE(eocdAt + 10);
  const cdOffset = buf.readUInt32LE(eocdAt + 16);

  const entries = new Map<string, Buffer>();
  let p = cdOffset;
  for (let i = 0; i < entryCount; i++) {
    if (buf.readUInt32LE(p) !== CDH_SIG) throw new Error(`corrupt central directory entry at offset ${p}`);
    const method = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localHeaderOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);

    entries.set(name, readEntryData(buf, localHeaderOffset, method, compressedSize));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** Reads and decompresses one entry given its local header offset (name/extra lengths there can differ in padding, so re-read them rather than trust the central directory's copy). */
function readEntryData(buf: Buffer, localHeaderOffset: number, method: number, compressedSize: number): Buffer {
  if (buf.readUInt32LE(localHeaderOffset) !== LFH_SIG) {
    throw new Error(`corrupt local file header at offset ${localHeaderOffset}`);
  }
  const nameLen = buf.readUInt16LE(localHeaderOffset + 26);
  const extraLen = buf.readUInt16LE(localHeaderOffset + 28);
  const dataStart = localHeaderOffset + 30 + nameLen + extraLen;
  const compressed = buf.subarray(dataStart, dataStart + compressedSize);

  if (method === 0) return Buffer.from(compressed); // stored
  if (method === 8) return inflateRawSync(compressed); // deflate
  throw new Error(`unsupported zip compression method ${method}`);
}

const XML_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

function decodeXmlEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-z]+);/g, (whole, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isNaN(code) ? whole : String.fromCodePoint(code);
    }
    return XML_ENTITIES[body] ?? whole;
  });
}

/** Column letters ("A", "AA", ...) from a cell reference like "F17" to a zero-based index. */
function columnIndexFromRef(ref: string): number {
  const letters = ref.match(/[A-Z]+/)?.[0] ?? "";
  let idx = 0;
  for (const ch of letters) idx = idx * 26 + (ch.charCodeAt(0) - 64);
  return idx - 1;
}

/**
 * Shared strings can be split across multiple <t> runs inside one <si>
 * (rich-text formatting splits a cell's text into several <r><t>...</t></r>
 * runs) - concatenate every <t> found within an <si>, in document order.
 */
function parseSharedStrings(xml: string): string[] {
  const strings: string[] = [];
  for (const siMatch of xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>|<si\b[^>]*\/>/g)) {
    const inner = siMatch[1] ?? "";
    let text = "";
    for (const tMatch of inner.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>|<t\b[^>]*\/>/g)) {
      text += tMatch[1] ?? "";
    }
    strings.push(decodeXmlEntities(text));
  }
  return strings;
}

/** `<sheet name="..." r:id="rId..">` entries from xl/workbook.xml, in document order. */
function parseWorkbookSheets(xml: string): Array<{ name: string; rId: string }> {
  const sheets: Array<{ name: string; rId: string }> = [];
  for (const m of xml.matchAll(/<sheet\b([^>]*)\/?>/g)) {
    const attrs = m[1];
    const name = attrs.match(/\bname="([^"]*)"/)?.[1];
    const rId = attrs.match(/\br:id="([^"]*)"/)?.[1];
    if (name && rId) sheets.push({ name: decodeXmlEntities(name), rId });
  }
  return sheets;
}

/** rId -> target path from xl/_rels/workbook.xml.rels. */
function parseWorkbookRels(xml: string): Map<string, string> {
  const rels = new Map<string, string>();
  for (const m of xml.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const attrs = m[1];
    const id = attrs.match(/\bId="([^"]*)"/)?.[1];
    const target = attrs.match(/\bTarget="([^"]*)"/)?.[1];
    if (id && target) rels.set(id, target);
  }
  return rels;
}

/** Parses one worksheet's <sheetData> into rows of cell strings, using shared strings for t="s" cells. */
function parseWorksheet(xml: string, sharedStrings: string[]): string[][] {
  const rows: string[][] = [];
  for (const rowMatch of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>|<row\b[^>]*\/>/g)) {
    const rowInner = rowMatch[1] ?? "";
    const row: string[] = [];
    let maxIndex = -1;
    let position = 0; // fallback column counter, advanced once per <c> regardless of content

    for (const cellMatch of rowInner.matchAll(/<c\b([^>]*)\/>|<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attrs = cellMatch[1] ?? cellMatch[2] ?? "";
      const inner = cellMatch[3];
      const ref = attrs.match(/\br="([^"]*)"/)?.[1];
      // Cells in this workbook can omit the r (reference) attribute entirely;
      // fall back to sequential position, but still advance the counter for
      // every <c> seen (including empty ones) so later columns don't shift.
      const colIndex = ref ? columnIndexFromRef(ref) : position;
      position++;

      row[colIndex] = extractCellValue(attrs, inner, sharedStrings);
      if (colIndex > maxIndex) maxIndex = colIndex;
    }

    // Dense row, left-to-right, with unset (skipped/blank) positions as "".
    const dense: string[] = [];
    for (let i = 0; i <= maxIndex; i++) dense.push(row[i] ?? "");
    rows.push(dense);
  }
  return rows;
}

function extractCellValue(attrs: string, inner: string | undefined, sharedStrings: string[]): string {
  if (!inner) return ""; // self-closing <c/> - genuinely blank
  const type = attrs.match(/\bt="([^"]*)"/)?.[1];

  if (type === "inlineStr") {
    let text = "";
    const is = inner.match(/<is>([\s\S]*?)<\/is>/)?.[1] ?? "";
    for (const tMatch of is.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>|<t\b[^>]*\/>/g)) text += tMatch[1] ?? "";
    return decodeXmlEntities(text);
  }

  const raw = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1];
  if (raw === undefined) return ""; // e.g. a formula cell with no cached value
  if (type === "s") {
    const idx = Number(raw);
    return sharedStrings[idx] ?? "";
  }
  return decodeXmlEntities(raw);
}

/** Reads an .xlsx workbook, returning every sheet's rows (header row included) keyed by sheet name, in workbook order. */
export function readWorkbook(path: string): Map<string, string[][]> {
  const buf = readFileSync(path);
  const entries = readZipEntries(buf);

  const workbookXml = entries.get("xl/workbook.xml")?.toString("utf8");
  if (!workbookXml) throw new Error("xl/workbook.xml not found in workbook");
  const relsXml = entries.get("xl/_rels/workbook.xml.rels")?.toString("utf8") ?? "";
  const sharedStringsXml = entries.get("xl/sharedStrings.xml")?.toString("utf8");

  const sharedStrings = sharedStringsXml ? parseSharedStrings(sharedStringsXml) : [];
  const sheets = parseWorkbookSheets(workbookXml);
  const rels = parseWorkbookRels(relsXml);

  const result = new Map<string, string[][]>();
  for (const { name, rId } of sheets) {
    const target = rels.get(rId);
    if (!target) throw new Error(`no relationship found for sheet "${name}" (${rId})`);
    // Targets in workbook.xml.rels are relative to xl/, unless package-absolute ("/...").
    const entryPath = target.startsWith("/") ? target.slice(1) : `xl/${target}`;
    const sheetXml = entries.get(entryPath)?.toString("utf8");
    if (!sheetXml) throw new Error(`worksheet part "${entryPath}" for sheet "${name}" not found`);
    result.set(name, parseWorksheet(sheetXml, sharedStrings));
  }
  return result;
}

/** Converts one sheet's rows into objects keyed by its header row (row 0). Trailing narrative/TOTAL rows are the caller's problem, not this function's. */
export function sheetToObjects(rows: string[][]): Record<string, string>[] {
  const [header, ...dataRows] = rows;
  if (!header) return [];
  return dataRows.map((row) => {
    const obj: Record<string, string> = {};
    header.forEach((key, i) => {
      obj[key] = row[i] ?? "";
    });
    return obj;
  });
}
