/**
 * Memoizes an async computation by key, sharing in-flight work across
 * concurrent callers. Used to cache each breakdown's swarm layout (a ~2s
 * worker call) so switching back to a previously-visited breakdown, or a
 * background pre-warm racing a user click, only ever computes it once.
 */
import type { PositionedDot } from "./swarm.ts";

export interface LayoutCache<T> {
  get(key: string, compute: () => Promise<T>): Promise<T>;
  has(key: string): boolean;
}

export function createLayoutCache<T>(): LayoutCache<T> {
  const entries = new Map<string, Promise<T>>();

  return {
    get(key, compute) {
      let pending = entries.get(key);
      if (!pending) {
        pending = compute();
        entries.set(key, pending);
      }
      return pending;
    },
    has(key) {
      return entries.has(key);
    },
  };
}

/** One shared cache for the whole app — the current view and the
 * background pre-warm both read/write through it, so a pre-warmed
 * breakdown is a cache hit no matter which one asks for it first. */
export const swarmLayoutCache: LayoutCache<PositionedDot[]> = createLayoutCache<PositionedDot[]>();
