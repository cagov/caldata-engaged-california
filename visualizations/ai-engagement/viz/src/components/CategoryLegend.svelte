<script lang="ts">
  /**
   * A static key for a color-by-category chart: swatch, label, n and share.
   * Not the deleted Legend.svelte, which was an interactive highlight
   * picker for a status-coloring feature that no longer exists — this is
   * read-only, there's nothing here to click.
   */
  let {
    values,
    colors,
    counts,
    total,
    caption,
  }: {
    values: string[];
    colors: string[];
    counts: number[];
    total: number;
    /** What this key explains — a breakdown/color-axis name ("Region") or a
     * picked theme's label. Optional: a lone key with an obvious subject
     * (e.g. the only legend on screen) can omit it. When two keys stack —
     * a color key and a highlight key — this is what keeps them from being
     * ambiguous about which encoding each one describes. */
    caption?: string;
  } = $props();
</script>

<div class="legend-block">
  {#if caption}
    <p class="caption">{caption}</p>
  {/if}
  <ul class="legend" aria-label="Category color key">
    {#each values as value, i}
      <li>
        <span class="swatch" style="background: {colors[i]}"></span>
        <span class="label">{value}</span>
        <span class="count">{counts[i]} ({total > 0 ? Math.round((counts[i] / total) * 100) : 0}%)</span>
      </li>
    {/each}
  </ul>
</div>

<style>
  .legend-block {
    --ink: #0b0b0b;
    --muted: #52514e;

    margin: 0.75rem 0 0;
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  }

  @media (prefers-color-scheme: dark) {
    :root:where(:not([data-theme="light"])) .legend-block {
      --ink: #ffffff;
      --muted: #c3c2b7;
    }
  }
  :root[data-theme="dark"] .legend-block {
    --ink: #ffffff;
    --muted: #c3c2b7;
  }

  .caption {
    margin: 0 0 0.3rem;
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--ink);
  }

  .legend {
    list-style: none;
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem 1rem;
    margin: 0;
    padding: 0;
  }

  li {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.8rem;
  }

  .swatch {
    width: 0.7rem;
    height: 0.7rem;
    border-radius: 2px;
    flex-shrink: 0;
  }

  .label {
    color: var(--ink);
  }

  .count {
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }
</style>
