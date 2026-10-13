<script lang="ts">
  /**
   * A generic segmented button row — not a dropdown. Used for both the
   * demographic breakdown picker and the question picker: few enough
   * options to show at once, and a visible row of known states makes
   * switching read as "move to a place I can see" rather than a menu
   * commit. Arrow keys move focus between buttons; the active one carries
   * aria-pressed so screen readers get the state without color.
   */
  let {
    options,
    activeIndex,
    onSelect,
    ariaLabel,
  }: {
    options: { key: string; label: string }[];
    activeIndex: number;
    onSelect: (index: number) => void;
    ariaLabel: string;
  } = $props();

  function onKeydown(event: KeyboardEvent, index: number) {
    if (event.key === "ArrowRight") {
      event.preventDefault();
      const next = (index + 1) % options.length;
      onSelect(next);
      focusButton(next);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      const prev = (index - 1 + options.length) % options.length;
      onSelect(prev);
      focusButton(prev);
    }
  }

  let buttons: HTMLButtonElement[] = [];
  function focusButton(index: number) {
    buttons[index]?.focus();
  }
</script>

<div class="controls" role="group" aria-label={ariaLabel}>
  {#each options as option, i}
    <button
      bind:this={buttons[i]}
      type="button"
      aria-pressed={i === activeIndex}
      class:active={i === activeIndex}
      onclick={() => onSelect(i)}
      onkeydown={(e) => onKeydown(e, i)}
    >
      {option.label}
    </button>
  {/each}
</div>

<style>
  .controls {
    --ink: #0b0b0b;
    --muted: #52514e;
    --rule: #ccd5dd;
    --accent: #2a78d6;
    --surface: #fcfcfb;

    display: flex;
    gap: 0.25rem;
    padding: 0.25rem;
    background: var(--rule);
    border-radius: 8px;
    width: fit-content;
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  }

  @media (prefers-color-scheme: dark) {
    :root:where(:not([data-theme="light"])) .controls {
      --ink: #ffffff;
      --muted: #c3c2b7;
      --rule: #3a3a37;
      --accent: #3987e5;
      --surface: #1a1a19;
    }
  }
  :root[data-theme="dark"] .controls {
    --ink: #ffffff;
    --muted: #c3c2b7;
    --rule: #3a3a37;
    --accent: #3987e5;
    --surface: #1a1a19;
  }

  button {
    font: inherit;
    font-size: 0.82rem;
    color: var(--muted);
    background: transparent;
    border: 0;
    border-radius: 6px;
    padding: 0.4rem 0.75rem;
    cursor: pointer;
  }

  button:hover {
    color: var(--ink);
  }

  button:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  button.active {
    background: var(--surface);
    color: var(--ink);
    font-weight: 600;
  }
</style>
