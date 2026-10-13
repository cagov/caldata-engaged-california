/**
 * Pure stage copy + timing helpers for ParticipantFunnelSelection.svelte —
 * the narrower "Who participated" prototype that plays only the funnel
 * itself (Phase 1 -> Selected -> Phase 2 -> Conversations) and carries its
 * top matter as real DOM instead of ctx.fillText, matching the reference
 * mockups (sketches/participant-funnel-region/how-we-got-to-this-list-*.png, not checked into
 * this worktree — see the plan this shipped from).
 *
 * Split out from the component the same way funnelCloud.ts is split from
 * ParticipantFunnelCloud.svelte: this file only decides copy/numbers/easing,
 * the component only draws/animates what this computes.
 */
import { DOT_SIZE, type FunnelCloudLayout, type FunnelData } from "./funnelCloud.ts";
import { personHeightFor } from "./personGlyph.ts";

export const SECTION_HEADING = "Who participated";

/** Comms-rounded thousands separator, e.g. 2678 -> "2,678" — shared by every
 * hero stat and canvas label in this section, so the same number never
 * reads two different ways in one pane. */
export function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

export interface FunnelSectionStat {
  // "lightbulb" is DiscussionSection.svelte's own addition (discussionSection.ts's
  // "moments"/"concepts" views) — widened here, not redeclared there, so
  // FunnelSectionHeader.svelte/EcStatGlyph.svelte stay the single source of
  // truth for which icons a FunnelSectionStat can carry.
  icon: "people" | "chats" | "lightbulb";
  /** Comms-formatted display value, e.g. "2,678" — see buildSelectionStages'
   * own doc comment for where each value traces to. */
  value: string;
  caption: string;
}

export interface FunnelSectionStage {
  /** The stage-jump pill's label, e.g. "1 · Phase 1". */
  pill: string;
  phase: string;
  title: string;
  sub: string;
  /** Whether this stage's subtitle carries the (i) info affordance. */
  info: boolean;
  /** `| null` stays part of the type because FunnelSectionStage is shared
   * with discussionSection.ts's DiscussionView, whose stages can omit a
   * stat column — every SELECTION_STAGES stage below now carries one. */
  stat: FunnelSectionStat | null;
}

/**
 * Every hero number and sub-line here traces to funnel.json:
 *
 * | Pane | Hero | Source |
 * |---|---|---|
 * | 1 Phase 1 | phase1Total | demographics export rows with a stated REGION |
 * | 2 Selected | invitedTotal | sortition Invited count, floored per-region at attendCount |
 * | 3 Phase 2 | keptTotal (sessions' attendees) | attendee demographics export row count |
 * | 4 Conversations | sessions.length | distinct SESSION_DATE values |
 *
 * Pane 2 intentionally diverges from ParticipantFunnelCloud.svelte's and
 * ParticipantFunnelCloudConcepts.svelte's own stage-2 pane, which is
 * captioned "continues to phase 2" with count: keptTotal (103) — this
 * section's "Selected" pane tells a different story (who was invited, not
 * who attended), backed by the wider invited set. Same lib stage
 * (funnelCloud.ts's dotTarget stage 2), different tier — see dotTarget's
 * own stage2Tier param, which this section is the only caller to set to
 * "invited".
 */
// Always the length of buildSelectionStages' return value — a plain
// constant, not stages.length, so callers can compute it (e.g. the last-
// stage index) without referencing the $derived array outside a reactive
// scope.
export const SELECTION_STAGE_COUNT = 4;

export function buildSelectionStages(data: FunnelData): FunnelSectionStage[] {
  const keptTotal = data.sessions.reduce((sum, s) => sum + s.attendees.length, 0);
  return [
    {
      pill: "1 · Phase 1",
      phase: "Phase 1",
      title: "Broad listening",
      sub: "Californians responded to our open survey on AI",
      info: false,
      stat: { icon: "people", value: fmt(data.phase1Total), caption: "survey respondents" },
    },
    {
      pill: "2 · Selected",
      phase: "Phase 2",
      title: "Inviting a balanced audience",
      sub: "We selected a subset of respondents that reflects California",
      info: false,
      stat: { icon: "people", value: fmt(data.invitedTotal), caption: "invited" },
    },
    {
      pill: "3 · Phase 2",
      phase: "Phase 1",
      title: "Joining the conversation",
      sub: "These Californians RSVP’d “yes” and joined a discussion",
      info: false,
      stat: { icon: "people", value: fmt(keptTotal), caption: "attended" },
    },
    {
      pill: "4 · Conversations",
      phase: "Phase 2",
      title: "The discussion groups",
      sub: "Here are the demographics of each discussion",
      info: false,
      stat: { icon: "chats", value: fmt(data.sessions.length), caption: "conversations" },
    },
  ];
}

// This section's own 4 stages (0-3) map onto funnelCloud.ts's current
// 8-stage dotTarget() numbering as [0, 2, 3, 4] — Phase 1 (cloud), Selected
// (dim/kept split), Phase 2 (gather), Conversations (ring). Expressed as an
// explicit table, not arithmetic, since "skip stage 1" is a fact about
// dotTarget's stage list (stage 1 is the Phase-1-concepts cloud this section
// never shows), not a formula this section should re-derive — the same
// reasoning ParticipantFunnelCloud.svelte's own libStage() shim documents
// for its (different) 6-stage numbering.
const LIB_STAGE_BY_SECTION_STAGE = [0, 2, 3, 4] as const;

export function libStageFor(sectionStage: number): number {
  return LIB_STAGE_BY_SECTION_STAGE[sectionStage] ?? LIB_STAGE_BY_SECTION_STAGE[0];
}

const easeInOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

export interface HeaderCrossfade {
  /** Raw eased crossfade position, 0 at the old stage settling in, 1 at the
   * new stage settled — exposed for callers that want the number itself
   * rather than the two derived fields below. */
  k: number;
  /** Which stage's copy should be shown right now — false = the stage being
   * left, true = the stage being entered. Matches header()'s own
   * `k < 0.5 ? from : to` split in the canvas-drawn original. */
  useTo: boolean;
  /** 0-1 opacity for the fading copy block (phase/title/sub/stat) — 0 at the
   * crossfade's exact midpoint, 1 at both ends, same
   * `Math.abs(k - 0.5) * 2` shape header() used. The heading itself never
   * fades (it's constant across every stage), so this only applies to the
   * per-stage block. */
  opacity: number;
}

/** Lifts header()'s crossfade math (ParticipantFunnelCloud.svelte's
 * canvas-drawn original) out into a pure function so the DOM header tracks
 * the same curve without re-deriving it. `t` is the stage-transition
 * progress (0-1) the component already tracks. */
export function headerCrossfade(t: number): HeaderCrossfade {
  const k = easeInOut(Math.min(1, t * 1.6));
  return { k, useTo: k >= 0.5, opacity: Math.abs(k - 0.5) * 2 };
}

/** Canvas-space vertical extent of each SELECTION_STAGE's dot content —
 * measured from the real layout (not hand-copied constants) so this stays
 * correct if the export's session count/sizes change. Stages 0 ("Phase 1")
 * and 1 ("Selected") share the drifting cloud, so they share a band; stage 2
 * ("Phase 2") is the gather blob; stage 3 ("Conversations") is the orbit
 * ring. Used by ParticipantFunnelSelection.svelte to vertically center every
 * stage on the same line — see selectionYShift below. */
export function selectionStageBands(layout: FunnelCloudLayout): { top: number; bottom: number }[] {
  let cloudTop = Infinity;
  let cloudBottom = -Infinity;
  for (const dot of layout.dots) {
    const top = dot.cloud.y - dot.cloud.ay - DOT_SIZE;
    const bottom = dot.cloud.y + dot.cloud.ay + DOT_SIZE;
    if (top < cloudTop) cloudTop = top;
    if (bottom > cloudBottom) cloudBottom = bottom;
  }
  const cloudBand = { top: cloudTop, bottom: cloudBottom };

  // 7 is dotTarget's own stage-3 ("Phase 2") dot radius (funnelCloud.ts) —
  // named here rather than imported since it's a draw-time literal, not an
  // exported constant.
  const GATHER_DOT_R = 7;
  let gatherTop = Infinity;
  let gatherBottom = -Infinity;
  for (const dot of layout.dots) {
    if (!dot.kept) continue;
    const half = personHeightFor(GATHER_DOT_R) / 2;
    const top = dot.gather[1] - half;
    const bottom = dot.gather[1] + half;
    if (top < gatherTop) gatherTop = top;
    if (bottom > gatherBottom) gatherBottom = bottom;
  }
  const gatherBand = { top: gatherTop, bottom: gatherBottom };

  let ringTop = Infinity;
  let ringBottom = -Infinity;
  for (const cl of layout.clusters) {
    const top = cl.y - cl.rc;
    const bottom = cl.y + cl.rc;
    if (top < ringTop) ringTop = top;
    if (bottom > ringBottom) ringBottom = bottom;
  }
  const ringBand = { top: ringTop, bottom: ringBottom };

  return [cloudBand, cloudBand, gatherBand, ringBand];
}

/** Per-stage vertical offset that centers each of `bands`' own midpoint on
 * the midpoint of `[dotTop, dotBottom]` — the literal "always in the
 * center" requirement: apply `shift[stage]` to every y (and viaY) a stage
 * draws, and every stage's content shares one center line. */
export function selectionYShift(bands: { top: number; bottom: number }[], dotTop: number, dotBottom: number): number[] {
  const target = (dotTop + dotBottom) / 2;
  return bands.map((b) => target - (b.top + b.bottom) / 2);
}
