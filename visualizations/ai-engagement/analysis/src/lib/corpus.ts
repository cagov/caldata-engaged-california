/**
 * Interleave items by stratum key, round-robining across strata.
 * Groups items by their stratum, then emits index 0 of every group,
 * then index 1 of every group, etc. This prevents any single region
 * from clustering together in the corpus.
 */
export function interleaveByStratum<T>(
  items: T[],
  stratumOf: (t: T) => string,
): T[] {
  // Group items by stratum
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const stratum = stratumOf(item);
    if (!groups.has(stratum)) {
      groups.set(stratum, []);
    }
    groups.get(stratum)!.push(item);
  }

  // Interleave: emit index 0 of each group, then index 1, etc.
  const result: T[] = [];
  let maxLen = Math.max(...Array.from(groups.values()).map((g) => g.length), 0);

  for (let idx = 0; idx < maxLen; idx++) {
    for (const [, group] of groups) {
      if (idx < group.length) {
        result.push(group[idx]);
      }
    }
  }

  return result;
}
