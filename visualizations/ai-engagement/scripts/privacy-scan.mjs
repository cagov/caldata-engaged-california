#!/usr/bin/env node
// Privacy scan for this folder (README data rule 2). No dependencies.
//
//   node scripts/privacy-scan.mjs                      structural checks only
//   node scripts/privacy-scan.mjs --real-data <path> [--real-data <path> ...]
//                                                       + real-text overlap (internal use)
//
// Structural checks (always): data/media files, .env files, key-shaped strings,
// home-directory paths, internal hostnames.
// Real-text check (needs the internal exports): <path> is a folder or file of
// .csv (free-text columns), .xlsx (all cells), .json or .txt (all strings are
// treated as real text, so pass only response-text files like verbatims or
// hand-picked quotes). Flags any run of 30+ characters shared with them, unless that run is
// also public (published on engaged.ca.gov or a theme/concept name) or listed
// in scripts/privacy-allowlist.json as a reviewed coincidence.
// Exits 1 on any finding. Never prints more than 60 characters of a match.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateRawSync } from "node:zlib";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const realPaths = args.flatMap((a, i) => (a === "--real-data" ? [args[i + 1]] : []));
const K = 30;

const SKIP_DIRS = new Set(["node_modules", "out", "dist", ".git"]);
const FORBIDDEN_EXT = new Set([".csv", ".tsv", ".xlsx", ".xls", ".parquet", ".jsonl", ".mov", ".mp4", ".png", ".jpg", ".jpeg", ".gif", ".fig", ".zip", ".pdf"]);
const BINARY_OK = new Set([".ttf"]);
const PATTERNS = [
  ["API key", /sk-ant-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{30,}|-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["home-directory path", /\/Users\/[a-z][\w.-]+\/|\/home\/[a-z][\w.-]+\/|C:\\Users\\/i],
  ["internal host", /\.pr\.engaged\.ca\.gov|figma\.com\/(board|file|design)\/[A-Za-z0-9]{10,}/],
];

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? (SKIP_DIRS.has(e.name) ? [] : walk(join(dir, e.name))) : [join(dir, e.name)],
  );
}
const files = walk(ROOT).map((f) => relative(ROOT, f)).sort();
const findings = [];
const clip = (s) => (s.length > 60 ? s.slice(0, 57) + "..." : s);

// ------------------------------------------------------------ structural
for (const rel of files) {
  const ext = extname(rel).toLowerCase();
  const name = basename(rel);
  if (FORBIDDEN_EXT.has(ext)) findings.push([rel, "data/media file"]);
  if (name === ".DS_Store") findings.push([rel, "OS metadata file"]);
  if (/^\.env(\..+)?$/.test(name) && name !== ".env.example") findings.push([rel, "env file"]);
  if (BINARY_OK.has(ext) || rel.endsWith("package-lock.json") || rel === "scripts/privacy-scan.mjs") continue;
  const text = readFileSync(join(ROOT, rel), "utf8");
  for (const [what, re] of PATTERNS) {
    const m = text.match(re);
    if (m) findings.push([rel, `${what}: ${clip(m[0])}`]);
  }
}

// ------------------------------------------------------------ real text
// Same normalization as the inventory scan: unescape, unify quotes/dashes,
// collapse whitespace, lowercase.
function norm(s) {
  return s
    .replace(/\\n/g, " ").replace(/\\"/g, '"').replace(/\\'/g, "'")
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/[\u2013\u2014]/g, "-")
    .replace(/\s+/g, " ").trim().toLowerCase();
}
/** 53-bit hash of a string (two FNV-1a variants), safe as a Map/Set key. */
function hash(s, from, to) {
  let a = 0x811c9dc5, b = 0x01000193;
  for (let i = from; i < to; i++) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x5bd1e995) ^ (b >>> 13);
  }
  return (a >>> 0) * 0x200000 + ((b >>> 0) & 0x1fffff);
}
function addWindows(set, text) {
  const t = norm(text);
  for (let i = 0; i + K <= t.length; i++) set.add(hash(t, i, i + K));
}
/** RFC 4180 CSV -> rows of fields. */
function parseCsv(text) {
  const rows = [];
  let row = [], field = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; } else if (c === '"') q = false; else field += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}
/** Shared strings of an .xlsx (a zip), read from the zip's central directory. */
function xlsxStrings(buf) {
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  let p = buf.readUInt32LE(eocd + 16);
  const n = buf.readUInt16LE(eocd + 10);
  for (let i = 0; i < n; i++) {
    const method = buf.readUInt16LE(p + 10), size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    if (name === "xl/sharedStrings.xml") {
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const raw = buf.subarray(start, start + size);
      const xml = (method === 8 ? inflateRawSync(raw) : raw).toString("utf8");
      return [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join(""));
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return [];
}

if (realPaths.length) {
  const FREE = /^(ECONOMIC_IMPACT_EXPECTATION|GOVERNMENT_ACTION_SUGGESTION|PERSONAL_AI_IMPACT|AI_RESPONSE_RATIONALE|Ideas for narrative framing)$/i;
  const PUBLIC_COL = /^(theme|subtheme|policy concept|policy concept description.*|policy_concept_label|policy_subtheme|policy_concept_description)$/i;
  const ID_COL = /^(SURVEY_RESPONDENT_ID|IDEA_ID)$/;
  const real = new Set(), pub = new Set(), ids = new Set();
  const realFiles = realPaths.flatMap((p) => (statSync(p).isDirectory() ? readdirSync(p).map((f) => join(p, f)) : [p]));
  const jsonStrings = (x) => (typeof x === "string" ? [x] : x && typeof x === "object" ? Object.values(x).flatMap(jsonStrings) : []);
  for (const full of realFiles) {
    const f = basename(full);
    if (f.endsWith(".json")) {
      for (const s of jsonStrings(JSON.parse(readFileSync(full, "utf8")))) if (s.length >= K) addWindows(real, s);
    } else if (f.endsWith(".txt")) {
      addWindows(real, readFileSync(full, "utf8"));
    } else if (f.endsWith(".csv")) {
      const [header, ...rows] = parseCsv(readFileSync(full, "utf8").replace(/^\uFEFF/, ""));
      header.forEach((h, c) => {
        const col = h.trim();
        for (const r of rows) {
          const v = r[c] ?? "";
          if (ID_COL.test(col) && v) ids.add(v.toLowerCase());
          else if (v.length >= K && FREE.test(col)) addWindows(real, v);
          else if (v.length >= K && PUBLIC_COL.test(col)) addWindows(pub, v);
        }
      });
    } else if (f.endsWith(".xlsx")) {
      for (const s of xlsxStrings(readFileSync(full))) if (s.length >= K) addWindows(real, s);
    }
  }
  // Anything published on engaged.ca.gov, plus the survey questions, is public.
  for (const f of walk(join(ROOT, "synthetic-data/inputs/published"))) addWindows(pub, readFileSync(f, "utf8"));
  for (const q of ["How has AI impacted your job and workplace, if at all?", "How do you expect AI to impact the economy?", "What do you think the government should do about these impacts?"]) addWindows(pub, q);

  const allow = JSON.parse(readFileSync(join(ROOT, "scripts/privacy-allowlist.json"), "utf8")).entries;
  const allowed = (rel, snippet) => allow.some((a) => a.file === rel && snippet.includes(norm(a.text)));
  const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

  for (const rel of files) {
    const ext = extname(rel).toLowerCase();
    if (BINARY_OK.has(ext) || rel.endsWith("package-lock.json") || rel.includes("/vendor/") || rel.startsWith("synthetic-data/inputs/published/") || rel === "scripts/privacy-allowlist.json") continue;
    const raw = readFileSync(join(ROOT, rel), "utf8");
    for (const m of raw.matchAll(uuid)) if (ids.has(m[0].toLowerCase())) findings.push([rel, "real respondent id"]);
    const t = norm(raw);
    for (let i = 0; i + K <= t.length; ) {
      const h = hash(t, i, i + K);
      if (!real.has(h)) { i++; continue; }
      let j = i + 1, isPublic = pub.has(h);
      while (j + K <= t.length && real.has(hash(t, j, j + K))) { isPublic ||= pub.has(hash(t, j, j + K)); j++; }
      const run = t.slice(i, j + K - 1);
      if (!isPublic && !allowed(rel, run)) findings.push([rel, `real text (${run.length} chars): "${clip(run)}"`]);
      i = j + K - 1;
    }
  }
  console.log(`real-text check: ${real.size.toLocaleString()} windows from ${realFiles.length} files`);
}

console.log(`scanned ${files.length} files`);
if (findings.length === 0) {
  console.log("✓ no findings");
} else {
  for (const [rel, what] of findings) console.log(`✗ ${rel}: ${what}`);
  console.log(`${findings.length} finding(s)`);
  process.exitCode = 1;
}
