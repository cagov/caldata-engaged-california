<script lang="ts">
  /**
   * A small circular hairline glyph for inline expand/collapse affordances
   * (the moments sidebar's bin and concept toggles) — replaces the old
   * ASCII "^ v + –" characters, which read as debug output rather than UI.
   *
   * The DS's own IconCaretDown/IconCaretUp/IconCheckFill etc (under
   * design/Engaged California Design System.zip's components/ directory)
   * ship only as React JSX stubs that delegate to a `window` global in
   * _ds_bundle.js, and assets/icons/icon-data.js contains only the 51
   * *topic* icons (Backpack, Gavel, …) — no caret or plus path data
   * actually shipped in the export. So these strokes are hand-drawn to
   * Phosphor bold-weight proportions (the DS's documented icon library)
   * rather than copied from anywhere in the package. Worth flagging back
   * to whoever maintains the DS export as a gap.
   */
  let {
    kind,
    size = 20,
  }: {
    kind: "chevron-up" | "chevron-down" | "plus" | "minus";
    size?: number;
  } = $props();
</script>

<span class="ec-glyph" style="--size: {size}px">
  <svg width={size * 0.5} height={size * 0.5} viewBox="0 0 16 16" fill="none" aria-hidden="true">
    {#if kind === "chevron-down"}
      <path d="M3 6l5 5 5-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
    {:else if kind === "chevron-up"}
      <path d="M3 10l5-5 5 5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
    {:else if kind === "plus"}
      <path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
    {:else}
      <path d="M3 8h10" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
    {/if}
  </svg>
</span>

<style>
  .ec-glyph {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 auto;
    width: var(--size);
    height: var(--size);
    border-radius: 50%;
    border: 1px solid var(--ec-hairline);
    color: var(--ec-on-surface-muted);
  }
</style>
