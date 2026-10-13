<script lang="ts">
  /**
   * The prototype switcher — a persistent vertical list, always visible,
   * independent of whatever demographic breakdown is selected. Roving
   * Up/Down focus mirrors Controls.svelte's Left/Right pattern, just on the
   * vertical axis this list actually uses.
   */
  import type { Prototype } from "../lib/prototypes.ts";

  let {
    prototypes,
    activeKey,
    onSelect,
  }: {
    prototypes: Prototype[];
    activeKey: string;
    onSelect: (key: string) => void;
  } = $props();

  function onKeydown(event: KeyboardEvent, index: number) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      const next = (index + 1) % prototypes.length;
      onSelect(prototypes[next].key);
      focusButton(next);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      const prev = (index - 1 + prototypes.length) % prototypes.length;
      onSelect(prototypes[prev].key);
      focusButton(prev);
    }
  }

  let buttons: HTMLButtonElement[] = [];
  function focusButton(index: number) {
    buttons[index]?.focus();
  }
</script>

<nav class="sidebar" aria-label="Prototype">
  <p class="heading">Prototypes</p>
  {#each prototypes as proto, i}
    <button
      bind:this={buttons[i]}
      type="button"
      aria-pressed={proto.key === activeKey}
      class:active={proto.key === activeKey}
      onclick={() => onSelect(proto.key)}
      onkeydown={(e) => onKeydown(e, i)}
    >
      <span class="label">{proto.label}</span>
      <span class="blurb">{proto.blurb}</span>
    </button>
  {/each}
</nav>

<style>
  .sidebar {
    --ink: #0b0b0b;
    --muted: #52514e;
    --rule: #ccd5dd;
    --accent: #2a78d6;

    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    flex-shrink: 0;
    width: 13rem;
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  }

  @media (prefers-color-scheme: dark) {
    :root:where(:not([data-theme="light"])) .sidebar {
      --ink: #ffffff;
      --muted: #c3c2b7;
      --rule: #3a3a37;
      --accent: #3987e5;
    }
  }
  :root[data-theme="dark"] .sidebar {
    --ink: #ffffff;
    --muted: #c3c2b7;
    --rule: #3a3a37;
    --accent: #3987e5;
  }

  .heading {
    margin: 0 0 0.15rem;
    font-size: 0.7rem;
    letter-spacing: 0.09em;
    text-transform: uppercase;
    color: var(--muted);
  }

  button {
    font: inherit;
    text-align: left;
    color: var(--muted);
    background: transparent;
    border: 1px solid var(--rule);
    border-radius: 6px;
    padding: 0.55rem 0.7rem;
    cursor: pointer;
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }

  button:hover {
    color: var(--ink);
    border-color: var(--accent);
  }

  button:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  button.active {
    background: var(--accent);
    border-color: var(--accent);
  }

  button.active .label,
  button.active .blurb {
    color: #fff;
  }

  .label {
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--ink);
  }

  .blurb {
    font-size: 0.72rem;
    line-height: 1.35;
    color: var(--muted);
  }
</style>
