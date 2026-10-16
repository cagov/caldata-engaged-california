<script lang="ts">
  /**
   * The DS's card surface (readme.md's "Cards & Containers" / "Corner
   * Radii" / "Shadows"): 24px radius, 30px padding, the DS's subtle
   * 0px-4px-4px shadow, near-white/white fill. `padding` is overridable
   * since the moments sidebar needs a tighter inset than a page-level card.
   */
  import type { Snippet } from "svelte";

  let { padding = "var(--ec-card-padding)", children }: { padding?: string; children: Snippet } = $props();
</script>

<div class="ec-card" style="--pad: {padding}">
  {@render children()}
</div>

<style>
  .ec-card {
    background: var(--ec-surface-alt);
    border-radius: var(--ec-radius-lg);
    box-shadow: var(--ec-shadow-sm);
    padding: var(--pad);
    box-sizing: border-box;
  }
</style>
