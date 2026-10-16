<script lang="ts">
  /**
   * Engaged California button, per design/Engaged California Design
   * System.zip's guidelines/buttons.card.html — the DS itself ships this
   * only as a React JSX stub that delegates to a window global
   * (_ds_bundle.js), so there's nothing importable; this reimplements the
   * documented spec instead of copying code.
   *
   * variant:
   *  - "primary": orange fill, DS's "Fill / Primary" CTA.
   *  - "outline": DS's "Outline / Secondary".
   *  - "pill":    DS's "Pill status badge" sizing, reused here for toggle
   *               rows (stage jumps, dimension picker, bin expanders)
   *               where a full-size CTA would be too heavy.
   *
   * `pressed` sets aria-pressed and its own filled state — distinct from
   * :hover/:focus-visible, for toggle buttons that stay "on" (Loop, the
   * active stage, the active dimension). Left `undefined` (not `false`) by
   * default so the attribute is omitted entirely for non-toggle buttons —
   * a disclosure control (the sidebar's bin/concept expanders) uses
   * `aria-expanded` instead and must never also carry aria-pressed, which
   * would misrepresent it as a toggle-button widget.
   *
   * Any other native button attribute (aria-expanded, aria-describedby,
   * type overrides, …) passes through via `...rest`.
   */
  import type { Snippet } from "svelte";

  let {
    variant = "outline",
    pressed = undefined,
    disabled = false,
    ariaLabel,
    onclick,
    children,
    ...rest
  }: {
    variant?: "primary" | "outline" | "pill";
    pressed?: boolean;
    disabled?: boolean;
    ariaLabel?: string;
    onclick?: (event: MouseEvent) => void;
    children: Snippet;
    [key: string]: unknown;
  } = $props();
</script>

<button
  type="button"
  class="ec-button {variant}"
  aria-pressed={pressed}
  aria-label={ariaLabel}
  {disabled}
  {onclick}
  {...rest}
>
  {@render children()}
</button>

<style>
  .ec-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px; /* spacing when a caller composes label text + an EcGlyph child */
    font-family: var(--ec-font-sans);
    line-height: 1.5;
    cursor: pointer;
    white-space: nowrap;
    /* No scale transform on hover, per the DS: "Hover: slight darkening of
       fill; no scale transform." */
    transition: background-color 0.15s, color 0.15s, border-color 0.15s, box-shadow 0.15s;
  }

  .ec-button:focus-visible {
    outline: 2px solid var(--ec-link);
    outline-offset: 2px;
  }

  .ec-button:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }

  /* Fill / Primary */
  .primary {
    background: var(--ec-orange);
    color: var(--ec-navy);
    border: none;
    border-radius: var(--ec-button-radius);
    padding: 8px 17px;
    font-size: 18px;
    font-weight: var(--ec-weight-bold);
  }
  .primary:hover:not(:disabled) {
    background: var(--ec-orange-dark);
  }
  .primary[aria-pressed="true"] {
    background: var(--ec-navy);
    color: var(--ec-surface);
  }

  /* Outline / Secondary */
  .outline {
    background: transparent;
    color: var(--ec-on-surface);
    border: none;
    box-shadow: inset 0 0 0 2px var(--ec-on-surface);
    border-radius: var(--ec-button-radius);
    padding: 8px 17px;
    font-size: 18px;
    font-weight: var(--ec-weight-bold);
  }
  .outline:hover:not(:disabled) {
    background: var(--ec-hairline);
  }
  .outline[aria-pressed="true"] {
    background: var(--ec-on-surface);
    color: var(--ec-surface);
  }

  /* Pill — DS's "Pill status badge" sizing, used here for toggles rather
     than status display. */
  .pill {
    background: transparent;
    color: var(--ec-on-surface-muted);
    border: none;
    box-shadow: inset 0 0 0 1px var(--ec-hairline);
    border-radius: var(--ec-pill-radius);
    padding: 4px 14px;
    font-size: var(--ec-text-caption);
    font-weight: var(--ec-weight-regular);
  }
  .pill:hover:not(:disabled) {
    color: var(--ec-link);
    box-shadow: inset 0 0 0 1px var(--ec-link);
  }
  .pill[aria-pressed="true"] {
    background: var(--ec-navy);
    color: var(--ec-surface);
    box-shadow: inset 0 0 0 1px var(--ec-navy);
    font-weight: var(--ec-weight-semibold);
  }
  /* An already-pressed pill (e.g. the active stage) keeps its navy fill and
     navy border on hover — the plain .pill:hover rule's --ec-link text reads
     as a washed-out light blue on that dark background (well under 4.5:1);
     #b7c7cf clears ~9:1 against navy, so hover swaps just the text to that. */
  .pill[aria-pressed="true"]:hover:not(:disabled) {
    color: #b7c7cf;
  }
</style>
