import { parse } from "csv-parse";
import { createReadStream } from "node:fs";

export async function loadCsv(path: string): Promise<Record<string, string>[]> {
  const rows: Record<string, string>[] = [];
  const readStream = createReadStream(path);
  const parser = readStream.pipe(
    parse({ columns: true, bom: true, relax_quotes: false, trim: false }),
  );

  return new Promise((resolve, reject) => {
    // Attach error listeners to both streams to ensure errors are properly rejected
    readStream.on("error", reject);
    parser.on("error", reject);

    (async () => {
      try {
        for await (const rec of parser) rows.push(rec as Record<string, string>);
        resolve(rows);
      } catch (err) {
        reject(err);
      }
    })();
  });
}
