import { NEAR_DUP_JACCARD, NEAR_DUP_MIN_LEN } from "../config.ts";

export interface DupItem {
  id: string;
  text: string;
}

export interface DupCluster {
  clusterId: number;
  ids: string[];
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Consecutive 3-word windows, as a set (order doesn't matter for Jaccard). */
function shingles(normalized: string): Set<string> {
  const words = normalized.split(" ").filter(Boolean);
  const set = new Set<string>();
  for (let i = 0; i + 3 <= words.length; i++) {
    set.add(words.slice(i, i + 3).join(" "));
  }
  return set;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  let intersection = 0;
  for (const x of a) if (b.has(x)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Clusters near-identical texts: normalized exact match, or 3-word-shingle
 * Jaccard ≥ NEAR_DUP_JACCARD — both gated on NEAR_DUP_MIN_LEN chars. The
 * length gate matters for exact matches too: short answers like "Nothing"
 * or "Stay out of it." are exactly what many independent respondents
 * converge on by chance in a terse open-text field, not a templated or
 * copy-pasted submission — treating that convergence as a "duplicate"
 * would wrongly suppress real, independent signal downstream. O(n²)
 * pairwise comparison, fine at this corpus size.
 */
export function findDupClusters(items: DupItem[]): DupCluster[] {
  const normalized = items.map((item) => normalize(item.text));
  const shingleSets = normalized.map((n) => shingles(n));

  const parent = items.map((_, i) => i);
  function find(x: number): number {
    while (parent[x] !== x) x = parent[x];
    return x;
  }
  function union(a: number, b: number): void {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  }

  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const bothLongEnough = items[i].text.length >= NEAR_DUP_MIN_LEN && items[j].text.length >= NEAR_DUP_MIN_LEN;
      if (!bothLongEnough) continue;

      const isExactMatch = normalized[i].length > 0 && normalized[i] === normalized[j];
      const isNearDup = jaccard(shingleSets[i], shingleSets[j]) >= NEAR_DUP_JACCARD;
      if (isExactMatch || isNearDup) union(i, j);
    }
  }

  const groups = new Map<number, number[]>();
  for (let i = 0; i < items.length; i++) {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)!.push(i);
  }

  const clusters: DupCluster[] = [];
  let clusterId = 0;
  for (const indices of groups.values()) {
    if (indices.length < 2) continue; // a singleton isn't a cluster
    clusters.push({ clusterId: clusterId++, ids: indices.map((i) => items[i].id) });
  }
  return clusters;
}
