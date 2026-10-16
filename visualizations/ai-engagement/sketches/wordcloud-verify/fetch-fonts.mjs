// Downloads the Noto Sans TTFs the canvas diagnostics render with into fonts/
// (gitignored). Runs automatically after `npm ci`; safe to re-run.
// Source: the official Noto release (SIL Open Font License 1.1).
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = "https://raw.githubusercontent.com/notofonts/notofonts.github.io/main/fonts/NotoSans/hinted/ttf/";
const FONTS = {
  "NotoSans-Regular.ttf": "478c558ea716033cd60c03438f628dfa75694dcf6b5f6d505a2f05fd2b4f3823",
  "NotoSans-Bold.ttf": "1df075a380fc7cb898acf64c1f7b3b4dd780de3caa860178bf929de35817a913",
};
const dir = join(dirname(fileURLToPath(import.meta.url)), "fonts");
const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

mkdirSync(dir, { recursive: true });
for (const [name, expected] of Object.entries(FONTS)) {
  const path = join(dir, name);
  if (existsSync(path) && sha256(readFileSync(path)) === expected) continue;
  const res = await fetch(BASE + name);
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status} from ${BASE + name}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (sha256(buf) !== expected) throw new Error(`${name}: checksum mismatch — the upstream file changed`);
  writeFileSync(path, buf);
  console.log(`fetched fonts/${name}`);
}
