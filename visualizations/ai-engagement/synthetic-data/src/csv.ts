/** Minimal RFC 4180 writer: quotes any field containing a comma, quote, or newline. */

function field(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function toCsv(header: readonly string[], rows: readonly Record<string, string>[]): string {
  const lines = [header.map(field).join(",")];
  for (const row of rows) lines.push(header.map((h) => field(row[h] ?? "")).join(","));
  return lines.join("\r\n") + "\r\n";
}
