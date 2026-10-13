<script lang="ts">
  /**
   * The DS's "Pill status badge" (readme.md's Buttons section: 30px
   * radius, 1px inset border, sentence case) — used for non-interactive
   * status text, unlike EcButton's `pill` variant which is a toggle.
   * `tone` sets the border/text color; fill stays transparent so it sits
   * on any surface (card, sidebar row) without its own background clash.
   */
  import type { Snippet } from "svelte";

  let { tone = "var(--ec-hairline)", children }: { tone?: string; children: Snippet } = $props();
</script>

<span class="ec-status-pill" style="--tone: {tone}">
  {@render children()}
</span>

<style>
  .ec-status-pill {
    display: inline-block;
    font-family: var(--ec-font-sans);
    font-size: var(--ec-text-xs);
    font-weight: var(--ec-weight-regular);
    color: var(--tone);
    box-shadow: inset 0 0 0 1px var(--tone);
    border-radius: var(--ec-pill-radius);
    padding: 1px 10px;
    vertical-align: middle;
  }
</style>
