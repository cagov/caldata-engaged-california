import type { CircleOrder } from "./swarm.ts";

/**
 * The full set of prototypes shown in the sidebar. Add an entry here to add
 * a prototype — App.svelte's dispatch and Sidebar.svelte's list both read
 * from this registry, no changes needed to either.
 */
export interface Prototype {
  key: string;
  label: string;
  blurb: string;
  kind:
    | "beeswarm"
    | "circle"
    | "rooms"
    | "rooms-popularity"
    | "distill-flow"
    | "distill-tree"
    | "distill-cloud"
    | "funnel-cloud"
    | "funnel-cloud-concepts"
    | "funnel-selection"
    | "discussion-section";
  /** Circle prototypes only — which respondent gets which position. */
  order?: CircleOrder;
  /** Which export this prototype fetches. Omitted (default) means
   * "respondents" — the 4 existing prototypes don't need this added since
   * they're all respondents-backed already. */
  dataset?: "respondents" | "rooms" | "crosswalk" | "funnel";
  /** "white" pins App.svelte's .viz-root to the DS's white surface instead
   * of the app's usual cream, regardless of OS theme — DiscussionSection.svelte
   * is the one prototype whose reference mockups are white-only. Omitted
   * (default) keeps every other prototype's existing cream/dark behavior. */
  surface?: "white";
}

export const PROTOTYPES: Prototype[] = [
  {
    key: "beeswarm",
    label: "Beeswarm split",
    blurb: "All respondents as one oval; splits into per-category swarms.",
    kind: "beeswarm",
  },
  {
    key: "circle-interleaved",
    label: "Circle · data order",
    blurb: "One ring, colored by category, positions unchanged.",
    kind: "circle",
    order: "input",
  },
  {
    key: "circle-banded",
    label: "Circle · bands",
    blurb: "Same ring, sorted into concentric bands by category.",
    kind: "circle",
    order: "radial",
  },
  {
    key: "circle-wedges",
    label: "Circle · wedges",
    blurb: "Same ring, sorted into pie wedges by category.",
    kind: "circle",
    order: "angular",
  },
  {
    key: "rooms",
    label: "Deliberation rooms",
    blurb: "The 14 Phase 2 sessions as a ring; open one to see its ranked ideas.",
    kind: "rooms",
    dataset: "rooms",
  },
  {
    key: "rooms-popularity",
    label: "Deliberation rooms · popularity bins",
    blurb: "Same ring; subthemes/concepts grouped into popularity bins by composite metric (sessions + top ideas) instead of a flat sorted list.",
    kind: "rooms-popularity",
    dataset: "rooms",
  },
  {
    key: "distill-flow",
    label: "Distillation · flow",
    blurb: "Phase 1 survey themes narrowing into Phase 2 policy concepts, subthemes, and themes, as a vertical alluvial.",
    kind: "distill-flow",
    dataset: "crosswalk",
  },
  {
    key: "distill-cloud",
    label: "Distillation · cloud",
    blurb: "The same Phase 1 -> Phase 2 mapping as an animated word cloud: themes split into fragments that fly into the concepts they feed.",
    kind: "distill-cloud",
    dataset: "crosswalk",
  },
  {
    key: "funnel-selection",
    label: "Participant funnel · how we got to this list",
    blurb:
      "The funnel alone — phase 1 respondents narrowing to the real phase 2 attendees and their 14 conversations — with the mockup's section header. Ends on the ring.",
    kind: "funnel-selection",
    dataset: "funnel",
  },
  {
    key: "funnel-cloud",
    label: "Participant funnel · cloud",
    blurb: "Phase 1 respondents funnelling into the real phase 2 attendees and their 14 conversations, colored by Region or Field of work — then into the policy concepts those conversations raised.",
    kind: "funnel-cloud",
    dataset: "funnel",
  },
  {
    key: "funnel-cloud-concepts",
    label: "Participant funnel · cloud + concepts",
    blurb: "Same funnel as above, with two extra stages: a Phase 1 placeholder concept cloud, and a closing Phase 1 -> Phase 2 distillation animation.",
    kind: "funnel-cloud-concepts",
    dataset: "funnel",
  },
  {
    key: "discussion-section",
    label: "The power of the discussion · three views",
    blurb:
      "The three Phase 2 mockup sections — behind the curtain, policy concepts, and the Phase 1 → Phase 2 distillation — as three toggled views on a white page. No auto-advance.",
    kind: "discussion-section",
    dataset: "funnel",
    surface: "white",
  },
  // "distill-tree" (DistillTree.svelte) is deliberately not registered here —
  // not ready to demo. The component, its App.svelte wiring, and the
  // "distill-tree" kind value all still exist; re-add an entry here once
  // its design is reworked.
];
