import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function writeManifest(
  dir: string,
  entry: { script: string; inputFiles: string[]; outputFiles: string[]; model?: string; codebookVersion?: string },
  filename = "manifest.json",
): void {
  mkdirSync(dir, { recursive: true });
  const hash = (paths: string[]) => Object.fromEntries(paths.map((p) => [p, sha256(p)]));
  writeFileSync(
    join(dir, filename),
    JSON.stringify(
      { ...entry, timestamp: new Date().toISOString(), inputFiles: hash(entry.inputFiles), outputFiles: hash(entry.outputFiles) },
      null,
      2,
    ),
  );
}
