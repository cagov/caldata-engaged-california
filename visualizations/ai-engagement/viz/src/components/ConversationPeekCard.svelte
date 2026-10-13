<script lang="ts">
  /**
   * The stage-4 ("Behind the curtain") right-hand panel — a single
   * conversation's placeholder chat, shown in the same column
   * .moments-sidebar occupies at stage 5, in lieu of that sidebar. Extracted
   * as its own component (rather than inlined like the moments sidebar)
   * since ParticipantFunnelCloud.svelte is already long; see
   * conversationPeek.ts for where its data comes from and why the quotes
   * are placeholder.
   *
   * Uses the same EcCard surface (--ec-surface-alt/--ec-on-surface) the
   * Moments sidebar uses, not the darker chip tokens the .info-tooltip uses
   * elsewhere — the speaker dots are the same category-color swatches the
   * ring dots use on the canvas's own light surface, and those colors lose
   * contrast against the chip pair's dark navy fill in light mode.
   *
   * Each turn's quote leads with the chat-bubble mark from
   * design/convo-bubble.svg, inlined and recolored from its exported
   * literal fill (#444444) to currentColor — same convention
   * EcStatGlyph.svelte's icons follow — rather than a static asset, since
   * there's no assets dir this app's Vite config would serve one from (see
   * EcStatGlyph.svelte's own header comment). Sized down from the source
   * file's 45x45 to sit inline with the quote text, not as a large stat
   * icon. The "This turned into: Policy concept: …" block below the quotes
   * is the mockup's own closing line — see conversationPeek.ts's
   * linkedConceptName for where that comes from.
   */
  import EcCard from "./ec/EcCard.svelte";
  import EcGlyph from "./ec/EcGlyph.svelte";
  import EcStatusPill from "./ec/EcStatusPill.svelte";
  import { DATA_VIZ_NEUTRAL_LIGHT } from "../lib/palette.ts";
  import type { ConversationPeek } from "../lib/conversationPeek.ts";
  import type { FunnelDimension } from "../lib/funnelCloud.ts";

  let {
    peek,
    colorOf,
    dimension,
    pinned,
    ontoggle,
  }: {
    peek: ConversationPeek;
    colorOf: Map<string, string>;
    dimension: FunnelDimension;
    pinned: boolean;
    ontoggle: () => void;
  } = $props();

  // Falls back to the same neutral swatch colorFor() uses in
  // ParticipantFunnelCloud.svelte for an unresolved category — a turn with
  // no real attendee to attribute to (an empty session) carries "" for both
  // fields, which never matches a colorOf key.
  function speakerColor(turn: ConversationPeek["turns"][number]): string {
    return colorOf.get(turn[dimension]) ?? DATA_VIZ_NEUTRAL_LIGHT;
  }
</script>

<EcCard padding="18px 20px">
  <div class="peek-card">
    <button type="button" class="peek-header" onclick={ontoggle} aria-expanded={pinned}>
      <span class="peek-title">Conversation {peek.sessionNumber ?? peek.clusterIndex + 1}</span>
      <EcGlyph kind={pinned ? "chevron-up" : "chevron-down"} size={18} />
    </button>

    <ul class="peek-turns">
      {#each peek.turns as turn, ti (ti)}
        <li>
          <div class="peek-quote-row">
            <svg class="peek-quote-icon" viewBox="0 0 45 45" fill="none" aria-hidden="true">
              <path
                d="M29.4813 19.2386C29.4813 19.4508 29.397 19.6543 29.2469 19.8043C29.0969 19.9543 28.8934 20.0386 28.6812 20.0386H15.8813C15.6691 20.0386 15.4656 19.9543 15.3156 19.8043C15.1655 19.6543 15.0813 19.4508 15.0813 19.2386C15.0813 19.0264 15.1655 18.823 15.3156 18.6729C15.4656 18.5229 15.6691 18.4386 15.8813 18.4386H28.6812C28.8934 18.4386 29.0969 18.5229 29.2469 18.6729C29.397 18.823 29.4813 19.0264 29.4813 19.2386ZM28.6812 24.8386H15.8813C15.6691 24.8386 15.4656 24.9229 15.3156 25.0729C15.1655 25.223 15.0813 25.4264 15.0813 25.6386C15.0813 25.8508 15.1655 26.0543 15.3156 26.2043C15.4656 26.3543 15.6691 26.4386 15.8813 26.4386H28.6812C28.8934 26.4386 29.0969 26.3543 29.2469 26.2043C29.397 26.0543 29.4813 25.8508 29.4813 25.6386C29.4813 25.4264 29.397 25.223 29.2469 25.0729C29.0969 24.9229 28.8934 24.8386 28.6812 24.8386ZM42.2812 22.4386C42.2819 25.9204 41.3736 29.3421 39.6461 32.3652C37.9186 35.3882 35.4318 37.908 32.4317 39.6751C29.4317 41.4422 26.0222 42.3955 22.5407 42.4406C19.0592 42.4858 15.6262 41.6213 12.5813 39.9326L5.44325 42.3126C5.02038 42.4536 4.56659 42.4741 4.13274 42.3717C3.69889 42.2693 3.30213 42.0481 2.98693 41.7329C2.67172 41.4177 2.45053 41.021 2.34815 40.5871C2.24576 40.1533 2.26623 39.6995 2.40725 39.2766L4.78725 32.1386C3.30777 29.4685 2.45912 26.4952 2.30632 23.4464C2.15353 20.3976 2.70064 17.3543 3.90575 14.5497C5.11085 11.745 6.94197 9.25347 9.25881 7.26586C11.5756 5.27824 14.3167 3.84734 17.272 3.08278C20.2273 2.31823 23.3184 2.2403 26.3085 2.85497C29.2985 3.46964 32.1082 4.76061 34.5223 6.62895C36.9363 8.49729 38.8907 10.8934 40.2356 13.6338C41.5805 16.3742 42.2802 19.386 42.2812 22.4386ZM40.6813 22.4386C40.6804 19.6161 40.0302 16.8316 38.781 14.3006C37.5318 11.7696 35.7171 9.55988 33.4772 7.84245C31.2373 6.12503 28.6324 4.94591 25.8639 4.39634C23.0954 3.84677 20.2376 3.94148 17.5116 4.67313C14.7856 5.40478 12.2644 6.75377 10.1431 8.61572C8.0219 10.4777 6.35744 12.8027 5.27854 15.4108C4.19965 18.019 3.73524 20.8404 3.92125 23.6568C4.10726 26.4732 4.9387 29.209 6.35125 31.6526C6.40794 31.7507 6.44314 31.8598 6.45452 31.9725C6.4659 32.0853 6.4532 32.1991 6.41725 32.3066L3.92525 39.7826C3.87824 39.9236 3.87142 40.0748 3.90555 40.2194C3.93968 40.3641 4.01341 40.4963 4.11848 40.6014C4.22354 40.7065 4.3558 40.7802 4.50041 40.8143C4.64503 40.8484 4.79629 40.8416 4.93725 40.7946L12.4133 38.3026C12.495 38.2747 12.5809 38.2606 12.6673 38.2606C12.8077 38.2613 12.9455 38.2985 13.0673 38.3686C15.8644 39.9868 19.0384 40.8398 22.2699 40.8418C25.5014 40.8438 28.6765 39.9947 31.4756 38.3799C34.2748 36.7652 36.5993 34.4417 38.2153 31.6432C39.8313 28.8448 40.6818 25.6701 40.6813 22.4386Z"
                fill="currentColor"
              />
            </svg>
            <p class="peek-text">“{turn.text}”</p>
          </div>
          <p class="peek-byline">
            <span class="speaker-dot" style="background: {speakerColor(turn)}" aria-hidden="true"></span>
            {turn.byline}
          </p>
        </li>
      {/each}
    </ul>

    <div class="peek-footer">
      <p class="peek-meta">
        {peek.attendeeCount} people · {peek.dateLabel}
        {#if peek.turns.every((t) => t.isPlaceholder)}
          <EcStatusPill tone="var(--ec-on-surface-muted)">Placeholder conversation</EcStatusPill>
        {/if}
      </p>
      {#if peek.linkedConceptName}
        <div class="peek-turned-into">
          <p class="turned-into-label">This turned into:</p>
          <p class="turned-into-concept"><span class="concept-kicker">Policy concept</span>{peek.linkedConceptName}</p>
        </div>
      {:else}
        <p class="peek-caption">Conversations like this one became the policy concepts — see them next.</p>
      {/if}
    </div>
  </div>
</EcCard>

<style>
  .peek-card {
    display: flex;
    flex-direction: column;
    gap: 0.7rem;
    color: var(--ec-on-surface);
  }

  .peek-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.4rem;
    padding: 0;
    border: none;
    background: none;
    font-family: inherit;
    color: inherit;
    cursor: pointer;
  }

  .peek-title {
    font-size: var(--ec-text-h5);
    font-weight: var(--ec-weight-semibold);
  }

  .peek-turns {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }

  .peek-quote-row {
    display: flex;
    align-items: flex-start;
    gap: 0.5rem;
  }

  /* Top-aligned with the quote's first line (margin-top nudges past the
     text's own line-height ascent) rather than centered on the whole
     (possibly multi-line) block — matches how a leading glyph reads next
     to a paragraph, not a single-line label. */
  .peek-quote-icon {
    flex: 0 0 auto;
    width: 1.1rem;
    height: 1.1rem;
    margin-top: 0.15rem;
    color: var(--ec-on-surface-muted);
  }

  .peek-text {
    flex: 1 1 auto;
    min-width: 0;
    margin: 0 0 0.2rem;
    font-size: var(--ec-text-body-sm);
    line-height: var(--ec-leading-normal);
  }

  .peek-byline {
    margin: 0;
    /* Indented to align under the quote text, not the icon column above it
       (1.1rem icon + 0.5rem gap = 1.6rem) — reads as "who said the text",
       not "who owns the icon". */
    padding-left: 1.6rem;
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-size: var(--ec-text-caption);
    color: var(--ec-on-surface-muted);
  }

  .speaker-dot {
    flex: 0 0 auto;
    width: 0.6rem;
    height: 0.6rem;
    border-radius: 50%;
  }

  .peek-footer {
    border-top: 1px solid var(--ec-hairline);
    padding-top: 0.6rem;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .peek-meta {
    margin: 0;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
    font-size: var(--ec-text-caption);
    font-weight: var(--ec-weight-semibold);
  }

  .peek-caption {
    margin: 0;
    font-size: var(--ec-text-caption);
    line-height: 1.4;
    color: var(--ec-on-surface-muted);
  }

  /* Only shown in place of .peek-caption's generic teaser, when this
     session actually names a linkedConceptName — the two would otherwise
     read as contradicting each other ("became the policy concepts" vs "this
     specific one already did"). */
  .peek-turned-into {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }

  .turned-into-label {
    margin: 0;
    font-size: var(--ec-text-caption);
    color: var(--ec-on-surface-muted);
  }

  .turned-into-concept {
    margin: 0;
    font-size: var(--ec-text-body-sm);
    font-weight: var(--ec-weight-semibold);
    color: var(--ec-on-surface);
  }

  .concept-kicker {
    display: block;
    font-size: var(--ec-text-xs);
    font-weight: var(--ec-weight-semibold);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--ec-on-surface-muted);
  }
</style>
