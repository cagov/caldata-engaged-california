/**
 * Pure stage copy + a stage-numbering table for DiscussionSection.svelte —
 * "The power of the discussion", the three Phase 2 mockup views (Behind the
 * curtain / Moments / Phase 1 -> Phase 2) that
 * ParticipantFunnelCloudConcepts.svelte's stages 5-7 already compute, now
 * switched by a 3-way toggle instead of an auto-advancing timeline, with a
 * real-DOM header (FunnelSectionHeader.svelte) instead of that file's
 * canvas-drawn header().
 *
 * FunnelSectionHeader.svelte and funnelSection.ts's headerCrossfade are
 * reused unchanged (see funnelSection.ts's own header comment, which calls
 * this reuse out as the reason it takes no Selection-specific props) — this
 * file only supplies the per-view FunnelSectionStage copy that pairing
 * needs, plus the toggle-position (0-2) -> funnelCloud.ts dotTarget-stage
 * (5-7) table DiscussionSection.svelte's draw calls key off of.
 */
import type { FunnelSectionStage } from "./funnelSection.ts";

export const DISCUSSION_HEADING = "The power of the discussion";

export type DiscussionViewKey = "curtain" | "moments" | "concepts";

/** Extends FunnelSectionStage (rather than a fresh interface) so
 * FunnelSectionHeader.svelte's existing `stage` prop takes one of these
 * without any change to that component. `key` is this file's own — the
 * header never reads it, DiscussionSection.svelte's toggle does. */
export interface DiscussionView extends FunnelSectionStage {
  key: DiscussionViewKey;
}

/**
 * conversationCount/policyConceptCount/phase2ConceptCount are real, derived
 * counts a caller passes in (layout.clusters.length, allMomentConcepts.length,
 * PHASE1_CONCEPTS.length) — unlike funnelSection.ts's SELECTION_STAGES, none
 * of this section's stats are rounded comms copy standing in for a number
 * the export can't produce, so there's no README data rule 3 carve-out to
 * document here: every value traces straight to its caller, and the
 * "concepts" view's sub-line is built from the same count its stat displays
 * so the two can never read different numbers.
 */
export function buildDiscussionViews(
  conversationCount: number,
  policyConceptCount: number,
  phase2ConceptCount: number,
): DiscussionView[] {
  return [
    {
      key: "curtain",
      pill: "Conversations",
      phase: "Phase 2",
      title: "Participants shared their thoughts, concerns and solutions",
      sub: "Look inside the conversations to see how policy ideas took shape",
      info: false,
      stat: { icon: "chats", value: String(conversationCount), caption: "conversations" },
    },
    {
      key: "moments",
      pill: "Concepts",
      phase: "Phase 2",
      title: "Policy concepts we heard",
      sub: "See how multiple conversations arrived at similar policy concepts",
      info: false,
      stat: { icon: "lightbulb", value: String(policyConceptCount), caption: "policy concepts" },
    },
    {
      key: "concepts",
      pill: "Distillation",
      phase: "Phase 2",
      title: "Phase 1 → Phase 2",
      sub: `See how Phase 1 ideas merge into the ${phase2ConceptCount} real Phase 2 policy concepts.`,
      info: false,
      stat: { icon: "lightbulb", value: String(phase2ConceptCount), caption: "phase 2 concepts" },
    },
  ];
}

/** This section's own 3 toggle positions (0-2) map onto
 * ParticipantFunnelCloudConcepts.svelte's 8-stage funnelCloud.ts numbering as
 * [5, 6, 7] — Behind the curtain, Moments, and the finale slot. dotTarget()
 * has no case for stage 7 and falls through to its documented off-canvas
 * default (every dot fades to alpha 0), which is exactly what the
 * "concepts" view wants while PhaseDistillationFinale.svelte draws instead —
 * see funnelCloud.ts's own comment on that fallback. Explicit table, not
 * arithmetic, same convention as funnelSection.ts's own
 * LIB_STAGE_BY_SECTION_STAGE. */
const LIB_STAGE_BY_VIEW = [5, 6, 7] as const;

export function libStageFor(view: number): number {
  return LIB_STAGE_BY_VIEW[view] ?? LIB_STAGE_BY_VIEW[0];
}

/** The inverse of libStageFor — DiscussionSection.svelte's frame() loop
 * tracks the animation clock in dotTarget's own stage numbers (5-7, since
 * every other draw function it copies from ParticipantFunnelCloudConcepts.svelte
 * already branches on those same absolute numbers), but the header/toggle
 * need this section's own 0-2 view index. An explicit reverse lookup, not
 * `stage - 5`, so the two tables can never silently drift apart. */
export function viewIndexFor(stage: number): number {
  const i = (LIB_STAGE_BY_VIEW as readonly number[]).indexOf(stage);
  return i === -1 ? 0 : i;
}
