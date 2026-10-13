/**
 * Preserves paragraph breaks — a respondent who wrote three distinct proposals
 * separated by blank lines is giving you structure, and collapsing it to one
 * line makes multi-part answers harder for both humans and the model to read.
 */
export function normalizeText(value: string): string {
  return value
    // Windows and classic Mac line endings to LF.
    .replace(/\r\n?/g, "\n")
    // Curly quotes, dashes, and ellipses to ASCII. Matching, dedup, and cache
    // keys all behave better when "don't" and "don’t" are the same string.
    .replace(/[\u2018\u2019\u02BC]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2026/g, "...")
    // Non-breaking and zero-width characters that survive copy-paste.
    .replace(/\u00A0/g, " ")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    // Runs of spaces and tabs, but not newlines.
    .replace(/[ \t]{2,}/g, " ")
    // Trailing spaces at end of lines.
    .replace(/[ \t]+$/gm, "")
    // Three or more newlines become a single paragraph break.
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
