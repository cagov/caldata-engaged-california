<script lang="ts">
  /**
   * DOM top matter for ParticipantFunnelSelection.svelte, styled after the
   * "How we got to this list" reference mockups — a constant heading, a
   * per-stage phase/title/subtitle block (with an optional (i) tooltip), and
   * an optional right-hand stat callout. Ported out of canvas (unlike
   * ParticipantFunnelCloud.svelte's ctx.fillText-drawn header()) specifically
   * so the (i) affordance can be a real interactive tooltip and the type can
   * use the DS scale directly rather than a hand-picked px-per-font-size
   * canvas approximation.
   *
   * Built to be reusable by the later "power of the discussions" and
   * "policy concepts" sections once those get specced — heading/stage/
   * opacity/infoText are all it needs, nothing here is Selection-specific.
   */
  import type { FunnelSectionStage } from "../lib/funnelSection.ts";
  import EcStatGlyph from "./ec/EcStatGlyph.svelte";

  let {
    heading,
    stage,
    opacity,
    infoText,
  }: {
    heading: string;
    stage: FunnelSectionStage;
    /** 0-1 fade for the per-stage block (phase/title/sub/stat) — see
     * funnelSection.ts's headerCrossfade. The heading itself never fades. */
    opacity: number;
    /** Tooltip body shown by the (i) button when stage.info is true. */
    infoText: string;
  } = $props();
</script>

<div class="funnel-section-header">
  <div class="copy-col">
    <h2>{heading}</h2>
    <div class="stage-copy" style="opacity: {opacity}">
      <p class="phase">{stage.phase}</p>
      <div class="title-row">
        <h3>{stage.title}</h3>
      </div>
      <p class="sub">
        {stage.sub}
        {#if stage.info}
          <span class="info-wrap">
            <button type="button" class="info-icon" aria-describedby="funnel-section-info-tooltip">i</button>
            <span class="info-tooltip" id="funnel-section-info-tooltip" role="tooltip">{infoText}</span>
          </span>
        {/if}
      </p>
    </div>
  </div>

  {#if stage.stat}
    <div class="stat-col" style="opacity: {opacity}">
      <EcStatGlyph kind={stage.stat.icon} size={40} />
      <p class="stat-value">{stage.stat.value}</p>
      <p class="stat-caption">{stage.stat.caption}</p>
    </div>
  {/if}
</div>

<style>
  .funnel-section-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 24px;
    font-family: var(--ec-font-sans);
    /* Own explicit width, not just a flex item's content size — the parent
       (.funnel-cloud) is a centered flex column, so without this the header
       would shrink to its content instead of spanning the same 1040px box
       as #stage/.controls/.hint below it. */
    width: 100%;
    max-width: 1040px;
    /* Percentages of the 1040px canvas below, so the heading's left edge and
       the stat's right edge stay aligned with the canvas's own text margins
       (x=60, NUMBER_X=980 in funnelCloud.ts-derived layout) at any width. */
    padding: 0 5.77%;
    box-sizing: border-box;
  }

  .copy-col {
    min-width: 0;
    flex: 1 1 auto;
  }

  h2 {
    margin: 0 0 20px;
    font-size: var(--ec-text-h2);
    font-weight: var(--ec-weight-black);
    letter-spacing: var(--ec-tracking-tight);
    color: var(--ec-on-surface);
  }

  .stage-copy {
    transition: opacity 120ms linear;
  }

  .phase {
    margin: 0 0 4px;
    font-size: var(--ec-text-body-sm);
    font-weight: var(--ec-weight-semibold);
    color: var(--ec-on-surface-muted);
  }

  .title-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  h3 {
    margin: 0;
    font-size: var(--ec-text-h4);
    font-weight: var(--ec-weight-bold);
    letter-spacing: var(--ec-tracking-tight);
    color: var(--ec-on-surface);
  }

  .sub {
    margin: 6px 0 0;
    font-size: var(--ec-text-body);
    color: var(--ec-on-surface-muted);
    /* Wide enough that the (i) icon never wraps onto its own line after
       "factors" — no fixed cap; copy-col's own flex-basis (bounded by
       .funnel-section-header's 1040px max-width minus the stat column) is
       the only real limit, so this scales with whatever room is actually
       available instead of an arbitrary rem value. */
    max-width: none;
  }

  .info-wrap {
    position: relative;
    display: inline-flex;
    margin-left: 6px;
    vertical-align: middle;
  }

  .info-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.1rem;
    height: 1.1rem;
    padding: 0;
    border-radius: 50%;
    border: 1px solid var(--ec-on-surface-muted);
    background: none;
    font-family: inherit;
    font-size: 0.7rem;
    font-style: italic;
    font-weight: var(--ec-weight-bold);
    color: var(--ec-on-surface-muted);
    cursor: help;
  }

  /* CSS-driven, not a native `title` tooltip — a native tooltip's browser
     debounce means it won't reliably re-show on a second hover of the same
     element without first moving away for a beat. This shows every time.
     Same recipe as ParticipantFunnelCloud.svelte's .info-tooltip, using the
     chip token pair so it reads as "on top of" the page in either theme. */
  .info-tooltip {
    position: absolute;
    top: 130%;
    left: 0;
    z-index: 20;
    width: 18rem;
    padding: 0.6rem 0.75rem;
    background: var(--ec-chip-surface);
    color: var(--ec-chip-on-surface);
    font-size: var(--ec-text-caption);
    line-height: var(--ec-leading-normal);
    border-radius: var(--ec-radius-sm);
    box-shadow: var(--ec-shadow-sm);
    opacity: 0;
    visibility: hidden;
    transition: opacity 120ms ease;
    pointer-events: none;
  }

  .info-icon:hover + .info-tooltip,
  .info-icon:focus-visible + .info-tooltip {
    opacity: 1;
    visibility: visible;
  }

  .stat-col {
    /* Fixed, not content-sized (flex 0 0 auto's old basis) — the 4 stages'
       captions range from "invited"/"attended" to "survey respondents", and
       with a content-sized column, .funnel-section-header's space-between
       keeps the column's *right* edge flush against the header's right
       padding while its *left* edge (and everything centered inside it —
       the icon, the value) shifts stage to stage, and copy-col's available
       width shifts by the same amount on the other side. That read as the
       icon+number jumping horizontally, and the copy/stat gap changing,
       every time the header crossfades. 11rem comfortably fits "survey
       respondents" at --ec-text-body-sm with room to spare — widen this if
       a future stage's caption is longer, rather than dropping back to auto. */
    flex: 0 0 11rem;
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    transition: opacity 120ms linear;
  }

  .stat-value {
    margin: 6px 0 0;
    font-size: var(--ec-text-h1);
    font-weight: var(--ec-weight-black);
    letter-spacing: var(--ec-tracking-tight);
    color: var(--ec-on-surface);
    line-height: 1;
    white-space: nowrap;
  }

  .stat-caption {
    margin: 4px 0 0;
    font-size: var(--ec-text-body-sm);
    color: var(--ec-on-surface-muted);
    white-space: nowrap;
  }
</style>
