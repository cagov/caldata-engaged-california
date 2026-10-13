<script lang="ts">
  /**
   * A styled native <select> — extracted from App.svelte's original inline
   * theme-picker markup/CSS so the deliberation-rooms "Pick" dropdown can
   * reuse it verbatim instead of a second copy of the chevron/border CSS.
   * `id` is optional and only exists so a caller's own <label for="..."> can
   * still associate with the underlying <select> exactly as before — the
   * label text itself stays with the caller, not here, since captions like
   * "Highlight theme" are context the caller owns.
   */
  let {
    options,
    value,
    onChange,
    ariaLabel,
    id,
  }: {
    options: { value: string; label: string }[];
    value: string;
    onChange: (value: string) => void;
    ariaLabel: string;
    id?: string;
  } = $props();

  function onSelectChange(event: Event) {
    onChange((event.currentTarget as HTMLSelectElement).value);
  }
</script>

<div class="select-wrap">
  <select {id} aria-label={ariaLabel} {value} onchange={onSelectChange}>
    {#each options as option (option.value)}
      <option value={option.value}>{option.label}</option>
    {/each}
  </select>
</div>

<style>
  .select-wrap {
    --ink: #0b0b0b;
    --muted: #52514e;
    --rule: #ccd5dd;
    --surface-1: #fcfcfb;

    position: relative;
    display: inline-block;
  }

  @media (prefers-color-scheme: dark) {
    :root:where(:not([data-theme="light"])) .select-wrap {
      --ink: #ffffff;
      --muted: #c3c2b7;
      --rule: #3a3a37;
      --surface-1: #1a1a19;
    }
  }
  :root[data-theme="dark"] .select-wrap {
    --ink: #ffffff;
    --muted: #c3c2b7;
    --rule: #3a3a37;
    --surface-1: #1a1a19;
  }

  /* Native <select> arrows aren't reliably inside the padding box (Safari
     in particular draws it as separate chrome), so padding-right alone
     can't add space next to it — strip it and draw our own, which we can
     actually position. */
  select {
    appearance: none;
    -webkit-appearance: none;
    -moz-appearance: none;
    font: inherit;
    font-size: 0.82rem;
    color: var(--ink);
    background: var(--surface-1);
    border: 1px solid var(--rule);
    border-radius: 6px;
    padding: 0.35rem 1.75rem 0.35rem 0.5rem;
    max-width: 26rem;
  }

  .select-wrap::after {
    content: "";
    position: absolute;
    top: 50%;
    right: 0.7rem;
    width: 0.4rem;
    height: 0.4rem;
    border-right: 1.5px solid var(--muted);
    border-bottom: 1.5px solid var(--muted);
    transform: translateY(-65%) rotate(45deg);
    pointer-events: none;
  }
</style>
