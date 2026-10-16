<script lang="ts">
  /**
   * Evidence panel for one respondent: their demographics and all three
   * free-text answers, selected question first. Verbatims are fetched lazily
   * — nothing is loaded until the first dot is clicked — and each question's
   * file is cached by fetchVerbatims itself, so reopening any respondent
   * after the first click never re-fetches.
   */
  import { onMount } from "svelte";
  import { fetchVerbatims } from "../lib/data.ts";
  import type { RespondentsData, Respondent } from "../lib/data.ts";

  let {
    data,
    respondent,
    questionIndex,
    onClose,
  }: {
    data: RespondentsData;
    respondent: Respondent;
    questionIndex: number;
    onClose: () => void;
  } = $props();

  const STATUS_LABELS: Record<string, string> = {
    substantive: "Wrote something",
    nonanswer: "Non-answer",
    refused: "Refused",
    blank: "Blank",
  };

  // Selected question first, then the other two in their normal order.
  const orderedQuestions = $derived([
    data.meta.questions[questionIndex],
    ...data.meta.questions.filter((_, i) => i !== questionIndex),
  ]);

  let verbatimsByQuestion = $state<Record<string, Record<string, string>>>({});
  let loading = $state(true);

  $effect(() => {
    loading = true;
    Promise.all(data.meta.questions.map((q) => fetchVerbatims(q.id).then((v) => [q.id, v] as const))).then(
      (entries) => {
        verbatimsByQuestion = Object.fromEntries(entries);
        loading = false;
      },
    );
  });

  let closeButton: HTMLButtonElement;
  onMount(() => closeButton?.focus());

  function onKeydown(event: KeyboardEvent) {
    if (event.key === "Escape") onClose();
  }
</script>

<svelte:window onkeydown={onKeydown} />

<div class="overlay" role="presentation" onclick={onClose}>
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div
    class="panel"
    role="dialog"
    aria-modal="true"
    aria-label="Respondent detail"
    tabindex="-1"
    onclick={(e) => e.stopPropagation()}
  >
    <header>
      <p class="id">{respondent.id}</p>
      <button bind:this={closeButton} type="button" class="close" onclick={onClose} aria-label="Close">✕</button>
    </header>

    <dl class="demographics">
      {#each data.meta.segments as segment, i}
        <div>
          <dt>{segment.label}</dt>
          <dd>{segment.rawValues[respondent.rawSeg[i]]}</dd>
        </div>
      {/each}
    </dl>

    <ul class="answers">
      {#each orderedQuestions as question}
        {@const qIdx = data.meta.questions.indexOf(question)}
        {@const status = data.meta.statuses[respondent.status[qIdx]]}
        <li>
          <p class="prompt">{question.prompt}</p>
          <p class="status-tag">{STATUS_LABELS[status] ?? status}</p>
          {#if loading}
            <p class="answer loading">Loading…</p>
          {:else}
            <p class="answer">{verbatimsByQuestion[question.id]?.[respondent.id] ?? "(blank)"}</p>
          {/if}
          {#if respondent.themes[qIdx]?.length}
            <ul class="themes">
              {#each respondent.themes[qIdx] as themeIdx}
                <li>{data.meta.themes[themeIdx].label} <code>{data.meta.themes[themeIdx].code}</code></li>
              {/each}
            </ul>
          {/if}
        </li>
      {/each}
    </ul>
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.4);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
    padding: 1.5rem;
  }

  .panel {
    --ink: #0b0b0b;
    --muted: #52514e;
    --rule: #ccd5dd;
    --surface: #fcfcfb;
    --accent: #2a78d6;

    background: var(--surface);
    color: var(--ink);
    border: 1px solid var(--rule);
    border-radius: 8px;
    padding: 1.5rem;
    max-width: 40rem;
    max-height: 85vh;
    overflow-y: auto;
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  }

  @media (prefers-color-scheme: dark) {
    :root:where(:not([data-theme="light"])) .panel {
      --ink: #ffffff;
      --muted: #c3c2b7;
      --rule: #3a3a37;
      --surface: #1a1a19;
      --accent: #3987e5;
    }
  }
  :root[data-theme="dark"] .panel {
    --ink: #ffffff;
    --muted: #c3c2b7;
    --rule: #3a3a37;
    --surface: #1a1a19;
    --accent: #3987e5;
  }

  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1rem;
  }

  .id {
    margin: 0;
    font-size: 0.72rem;
    letter-spacing: 0.04em;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }

  .close {
    font: inherit;
    background: transparent;
    border: 0;
    color: var(--muted);
    cursor: pointer;
    font-size: 1rem;
    padding: 0.2rem 0.4rem;
    border-radius: 4px;
  }

  .close:hover,
  .close:focus-visible {
    color: var(--ink);
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  .demographics {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 0.5rem 1rem;
    margin: 0 0 1.25rem;
    padding: 0.75rem;
    background: color-mix(in oklab, var(--rule) 35%, transparent);
    border-radius: 6px;
  }

  .demographics dt {
    font-size: 0.68rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--muted);
  }

  .demographics dd {
    margin: 0;
    font-size: 0.85rem;
  }

  .answers {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .answers > li {
    padding: 0.75rem 0;
    border-top: 1px solid var(--rule);
  }

  .answers > li:first-child {
    border-top: 0;
  }

  .prompt {
    margin: 0 0 0.2rem;
    font-size: 0.82rem;
    font-weight: 600;
  }

  .status-tag {
    margin: 0 0 0.4rem;
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--muted);
  }

  .answer {
    margin: 0;
    font-size: 0.88rem;
    line-height: 1.55;
    white-space: pre-wrap;
  }

  .answer.loading {
    color: var(--muted);
  }

  .themes {
    list-style: none;
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    margin: 0.6rem 0 0;
    padding: 0;
  }

  .themes li {
    font-size: 0.72rem;
    color: var(--muted);
    background: color-mix(in oklab, var(--rule) 35%, transparent);
    border-radius: 4px;
    padding: 0.15rem 0.45rem;
  }

  .themes code {
    font-size: 0.68rem;
    opacity: 0.75;
  }
</style>
