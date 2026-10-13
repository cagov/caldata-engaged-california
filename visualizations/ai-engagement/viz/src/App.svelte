<script lang="ts">
  import { fetchRespondents, DataNotFoundError, type RespondentsData } from "./lib/data.ts";
  import { fetchRooms, RoomsNotFoundError, type RoomsData } from "./lib/roomsData.ts";
  import { fetchCrosswalk, CrosswalkNotFoundError, type CrosswalkData } from "./lib/crosswalkData.ts";
  import { fetchFunnel, FunnelNotFoundError, type FunnelData } from "./lib/funnelData.ts";
  import { fetchInsights, type InsightsData } from "./lib/insightsData.ts";
  import { buildThemeOptions, computeHighlight } from "./lib/themes.ts";
  import Beeswarm from "./components/Beeswarm.svelte";
  import CircleSwarm from "./components/CircleSwarm.svelte";
  import DeliberationRooms from "./components/DeliberationRooms.svelte";
  import DeliberationRoomsByPopularity from "./components/DeliberationRoomsByPopularity.svelte";
  import DistillFlow from "./components/DistillFlow.svelte";
  import DistillTree from "./components/DistillTree.svelte";
  import DistillCloud from "./components/DistillCloud.svelte";
  import ParticipantFunnelCloud from "./components/ParticipantFunnelCloud.svelte";
  import ParticipantFunnelCloudConcepts from "./components/ParticipantFunnelCloudConcepts.svelte";
  import ParticipantFunnelSelection from "./components/ParticipantFunnelSelection.svelte";
  import DiscussionSection from "./components/DiscussionSection.svelte";
  import Controls from "./components/Controls.svelte";
  import Select from "./components/Select.svelte";
  import Sidebar from "./components/Sidebar.svelte";
  import { PROTOTYPES } from "./lib/prototypes.ts";

  // Named `view`, not `state` — a variable named `state` collides with
  // Svelte's legacy `$state`-store auto-subscription heuristic even in
  // runes mode, and confuses svelte-check into misreporting a TDZ error on
  // the $state() rune call itself.
  let view = $state<
    | { kind: "loading" }
    | { kind: "missing" }
    | { kind: "error"; message: string }
    | { kind: "ready"; data: RespondentsData }
  >({ kind: "loading" });

  // Mirrors `view`'s shape exactly, just for the rooms export — kept as a
  // separate state machine (not a union with `view`) since the two exports
  // are fetched from different endpoints on different schedules; see the
  // per-dataset fetch effects below.
  let roomsView = $state<
    | { kind: "loading" }
    | { kind: "missing" }
    | { kind: "error"; message: string }
    | { kind: "ready"; data: RoomsData }
  >({ kind: "loading" });

  // Mirrors `view`/`roomsView`'s shape for the crosswalk export — the two
  // new distillation prototypes' Phase 1 -> Phase 2 mapping data.
  let crosswalkView = $state<
    | { kind: "loading" }
    | { kind: "missing" }
    | { kind: "error"; message: string }
    | { kind: "ready"; data: CrosswalkData }
  >({ kind: "loading" });

  // Mirrors the same shape for the funnel export — real phase 1 -> phase 2
  // participant counts by region and field of work.
  let funnelView = $state<
    | { kind: "loading" }
    | { kind: "missing" }
    | { kind: "error"; message: string }
    | { kind: "ready"; data: FunnelData }
  >({ kind: "loading" });

  // Optional hand-authored quote/copy overlay for the funnel-cloud's
  // moments sidebar — unlike the other exports, a "missing" file isn't an
  // error state, it's the expected default: `data: null` just means every
  // concept keeps its placeholder copy. See insightsData.ts's fetchInsights.
  let insightsView = $state<
    | { kind: "loading" }
    | { kind: "error"; message: string }
    | { kind: "ready"; data: InsightsData | null }
  >({ kind: "loading" });

  let prototypeKey = $state(PROTOTYPES[0].key);
  const proto = $derived(PROTOTYPES.find((p) => p.key === prototypeKey) ?? PROTOTYPES[0]);
  const dataset = $derived(proto.dataset ?? "respondents");

  // Each export is fetched at most once, and only once a prototype that
  // actually needs it is selected — the rooms view must never pull the
  // 488KB respondents.json it doesn't read, and vice versa for rooms.json
  // before any rooms prototype is ever chosen. Plain (non-$state) guards:
  // we only need a one-time "already started" flag, not something the UI
  // reacts to.
  let respondentsFetchStarted = false;
  let roomsFetchStarted = false;
  let crosswalkFetchStarted = false;
  let funnelFetchStarted = false;
  let insightsFetchStarted = false;

  $effect(() => {
    if (dataset !== "respondents" || respondentsFetchStarted) return;
    respondentsFetchStarted = true;
    fetchRespondents()
      .then((data) => {
        view = { kind: "ready", data };
      })
      .catch((err) => {
        view = err instanceof DataNotFoundError
          ? { kind: "missing" }
          : { kind: "error", message: err instanceof Error ? err.message : String(err) };
      });
  });

  $effect(() => {
    if ((dataset !== "rooms" && dataset !== "crosswalk" && dataset !== "funnel") || roomsFetchStarted) return;
    roomsFetchStarted = true;
    fetchRooms()
      .then((data) => {
        roomsView = { kind: "ready", data };
      })
      .catch((err) => {
        roomsView = err instanceof RoomsNotFoundError
          ? { kind: "missing" }
          : { kind: "error", message: err instanceof Error ? err.message : String(err) };
      });
  });

  $effect(() => {
    if (dataset !== "crosswalk" || crosswalkFetchStarted) return;
    crosswalkFetchStarted = true;
    fetchCrosswalk()
      .then((data) => {
        crosswalkView = { kind: "ready", data };
      })
      .catch((err) => {
        crosswalkView = err instanceof CrosswalkNotFoundError
          ? { kind: "missing" }
          : { kind: "error", message: err instanceof Error ? err.message : String(err) };
      });
  });

  $effect(() => {
    if (dataset !== "funnel" || funnelFetchStarted) return;
    funnelFetchStarted = true;
    fetchFunnel()
      .then((data) => {
        funnelView = { kind: "ready", data };
      })
      .catch((err) => {
        funnelView = err instanceof FunnelNotFoundError
          ? { kind: "missing" }
          : { kind: "error", message: err instanceof Error ? err.message : String(err) };
      });
  });

  $effect(() => {
    if (dataset !== "funnel" || insightsFetchStarted) return;
    insightsFetchStarted = true;
    fetchInsights()
      .then((data) => {
        insightsView = { kind: "ready", data };
      })
      .catch((err) => {
        insightsView = { kind: "error", message: err instanceof Error ? err.message : String(err) };
      });
  });

  // -1 is the synthetic "All respondents" group — one undivided swarm,
  // ahead of any real demographic breakdown. It's the default view.
  let segmentIndex = $state(-1);
  let questionIndex = $state(0);

  // Highlight axis: pick a theme (scoped to the current question) to dim
  // every non-matching dot. Indexes into data.meta.themes; null means no
  // highlight. Reset on every question switch since a theme's index only
  // means something in the picker it came from.
  let selectedThemeIndex = $state<number | null>(null);
  // "Cluster matches" — moves highlighted dots to the core of their blob.
  // Meaningless without a picked theme, so it's disabled (not reset) while
  // selectedThemeIndex is null — see the button's `disabled` below. Left
  // as-is on a question switch rather than reset, since the dropdown reset
  // already gates it off; flipping it back on then just resumes the same
  // choice against whatever theme gets picked next.
  let clusterOn = $state(false);
  // "Group by stance" — an independent toggle: it rearranges dots within
  // whatever blobs the current breakdown already produces, whether or not
  // a theme is picked or Cluster matches is on. Never disabled.
  let stanceGroupOn = $state(false);
  function onSelectQuestion(i: number) {
    questionIndex = i;
    selectedThemeIndex = null;
  }

  const questionOptions = $derived(
    view.kind === "ready"
      ? view.data.meta.questions.map((q) => ({ key: q.id, label: q.id.charAt(0).toUpperCase() + q.id.slice(1) }))
      : [],
  );

  const themeOptions = $derived(
    view.kind === "ready"
      ? buildThemeOptions(
          view.data.meta.themes,
          view.data.meta.themeCounts[view.data.meta.questions[questionIndex].id] ?? [],
          view.data.meta.themeDenominators[view.data.meta.questions[questionIndex].id] ?? 0,
          view.data.meta.questions[questionIndex].id,
        )
      : [],
  );

  const highlightOf = $derived(
    view.kind === "ready" ? computeHighlight(view.data.respondents, questionIndex, selectedThemeIndex) : null,
  );

  // The picked theme's own label, for captioning the highlight legend next
  // to the color legend. Read from the full meta.themes list, not
  // themeOptions — that's filtered to the current question's home themes
  // (lib/themes.ts), so it's the wrong source for a lookup that must
  // always resolve regardless of which question is active.
  const highlightLabel = $derived(
    view.kind === "ready" && selectedThemeIndex !== null
      ? view.data.meta.themes[selectedThemeIndex]?.label ?? null
      : null,
  );

  // Independent "color by" axis — lets Stance be laid over any breakdown
  // (e.g. group by Region, color by Stance), which no single segment index
  // could express on its own. "match" reproduces the pre-existing behavior
  // exactly (color = breakdown, or no color on "All respondents"), so it's
  // the default and neither prototype regresses.
  type ColorMode = "match" | "stance" | "none";
  let colorMode = $state<ColorMode>("match");
  const COLOR_OPTIONS: { key: ColorMode; label: string }[] = [
    { key: "match", label: "Breakdown" },
    { key: "stance", label: "Stance" },
    { key: "none", label: "None" },
  ];
  // -1 is also CircleSwarm/Beeswarm's existing "no color" sentinel — reused
  // here rather than inventing a second one.
  const stanceSegmentIndex = $derived(
    view.kind === "ready" ? view.data.meta.segments.findIndex((s) => s.key === "AI_RESPONSE_LABEL") : -1,
  );
  const colorSegmentIndex = $derived(
    colorMode === "match" ? segmentIndex : colorMode === "stance" ? stanceSegmentIndex : -1,
  );

  // For "Group by stance" — each respondent's Stance category index, in the
  // segment's own canonical order (same order the color legend already
  // uses: Negative, Mixed, Positive, Neutral, (not stated)). null if the
  // export has no Stance segment at all.
  const stanceIndexOf = $derived(
    view.kind === "ready" && stanceSegmentIndex !== -1
      ? view.data.respondents.map((r) => r.seg[stanceSegmentIndex])
      : null,
  );
  const stanceCategoryCount = $derived(
    view.kind === "ready" && stanceSegmentIndex !== -1 ? view.data.meta.segments[stanceSegmentIndex].values.length : 0,
  );
</script>

<main class="viz-root" class:white-surface={proto.surface === "white"}>
  <div class="shell">
    <Sidebar prototypes={PROTOTYPES} activeKey={prototypeKey} onSelect={(key) => (prototypeKey = key)} />
    <div class="content">
      {#if proto.kind === "rooms" || proto.kind === "rooms-popularity"}
        {#if roomsView.kind === "loading"}
          <p class="status">Loading rooms…</p>
        {:else if roomsView.kind === "missing"}
          <div class="empty">
            <p class="empty-title">No export found.</p>
            <p>
              Run <code>npm run rooms</code> in <code>analysis/</code> first, then reload
              this page.
            </p>
          </div>
        {:else if roomsView.kind === "error"}
          <div class="empty">
            <p class="empty-title">Couldn't load the export.</p>
            <p>{roomsView.message}</p>
          </div>
        {:else if proto.kind === "rooms-popularity"}
          <DeliberationRoomsByPopularity data={roomsView.data} />
        {:else}
          <DeliberationRooms data={roomsView.data} />
        {/if}
      {:else if proto.kind === "distill-flow" || proto.kind === "distill-tree" || proto.kind === "distill-cloud"}
        {#if crosswalkView.kind === "loading" || roomsView.kind === "loading"}
          <p class="status">Loading crosswalk…</p>
        {:else if crosswalkView.kind === "missing"}
          <div class="empty">
            <p class="empty-title">No export found.</p>
            <p>
              Run <code>npm run crosswalk</code> in <code>analysis/</code> first, then reload
              this page.
            </p>
          </div>
        {:else if roomsView.kind === "missing"}
          <div class="empty">
            <p class="empty-title">No export found.</p>
            <p>
              Run <code>npm run rooms</code> in <code>analysis/</code> first, then reload
              this page.
            </p>
          </div>
        {:else if crosswalkView.kind === "error"}
          <div class="empty">
            <p class="empty-title">Couldn't load the export.</p>
            <p>{crosswalkView.message}</p>
          </div>
        {:else if roomsView.kind === "error"}
          <div class="empty">
            <p class="empty-title">Couldn't load the export.</p>
            <p>{roomsView.message}</p>
          </div>
        {:else if crosswalkView.kind === "ready" && roomsView.kind === "ready"}
          {#if proto.kind === "distill-flow"}
            <DistillFlow crosswalk={crosswalkView.data} rooms={roomsView.data} />
          {:else if proto.kind === "distill-cloud"}
            <DistillCloud crosswalk={crosswalkView.data} rooms={roomsView.data} />
          {:else}
            <DistillTree crosswalk={crosswalkView.data} rooms={roomsView.data} />
          {/if}
        {/if}
      {:else if proto.kind === "funnel-selection"}
        {#if funnelView.kind === "loading"}
          <p class="status">Loading funnel…</p>
        {:else if funnelView.kind === "missing"}
          <div class="empty">
            <p class="empty-title">No export found.</p>
            <p>
              Run <code>npm run funnel</code> in <code>analysis/</code> first, then reload
              this page.
            </p>
          </div>
        {:else if funnelView.kind === "error"}
          <div class="empty">
            <p class="empty-title">Couldn't load the export.</p>
            <p>{funnelView.message}</p>
          </div>
        {:else if funnelView.kind === "ready"}
          <ParticipantFunnelSelection data={funnelView.data} />
        {/if}
      {:else if proto.kind === "funnel-cloud" || proto.kind === "funnel-cloud-concepts" || proto.kind === "discussion-section"}
        {#if funnelView.kind === "loading" || roomsView.kind === "loading"}
          <p class="status">Loading funnel…</p>
        {:else if funnelView.kind === "missing"}
          <div class="empty">
            <p class="empty-title">No export found.</p>
            <p>
              Run <code>npm run funnel</code> in <code>analysis/</code> first, then reload
              this page.
            </p>
          </div>
        {:else if roomsView.kind === "missing"}
          <div class="empty">
            <p class="empty-title">No export found.</p>
            <p>
              Run <code>npm run rooms</code> in <code>analysis/</code> first, then reload
              this page.
            </p>
          </div>
        {:else if funnelView.kind === "error"}
          <div class="empty">
            <p class="empty-title">Couldn't load the export.</p>
            <p>{funnelView.message}</p>
          </div>
        {:else if roomsView.kind === "error"}
          <div class="empty">
            <p class="empty-title">Couldn't load the export.</p>
            <p>{roomsView.message}</p>
          </div>
        {:else if funnelView.kind === "ready" && roomsView.kind === "ready"}
          {#if proto.kind === "funnel-cloud-concepts"}
            <ParticipantFunnelCloudConcepts
              data={funnelView.data}
              rooms={roomsView.data}
              insights={insightsView.kind === "ready" ? insightsView.data : null}
            />
          {:else if proto.kind === "discussion-section"}
            <DiscussionSection
              data={funnelView.data}
              rooms={roomsView.data}
              insights={insightsView.kind === "ready" ? insightsView.data : null}
            />
          {:else}
            <ParticipantFunnelCloud
              data={funnelView.data}
              rooms={roomsView.data}
              insights={insightsView.kind === "ready" ? insightsView.data : null}
            />
          {/if}
        {/if}
      {:else if view.kind === "loading"}
        <p class="status">Loading respondents…</p>
      {:else if view.kind === "missing"}
        <div class="empty">
          <p class="empty-title">No export found.</p>
          <p>
            Run <code>npm run vizdata</code> in <code>analysis/</code> first, then reload
            this page.
          </p>
        </div>
      {:else if view.kind === "error"}
        <div class="empty">
          <p class="empty-title">Couldn't load the export.</p>
          <p>{view.message}</p>
        </div>
      {:else}
        <div class="controls-row">
          <Controls
            options={[{ key: "ALL", label: "All respondents" }, ...view.data.meta.segments]}
            activeIndex={segmentIndex + 1}
            onSelect={(i: number) => (segmentIndex = i - 1)}
            ariaLabel="Demographic breakdown"
          />
        </div>
        <div class="controls-row inline-row">
          {#if proto.kind === "beeswarm"}
            <Controls
              options={COLOR_OPTIONS}
              activeIndex={COLOR_OPTIONS.findIndex((o) => o.key === colorMode)}
              onSelect={(i: number) => (colorMode = COLOR_OPTIONS[i].key)}
              ariaLabel="Color by"
            />
          {/if}
          <button
            type="button"
            class="toggle-pill"
            aria-pressed={stanceGroupOn}
            onclick={() => (stanceGroupOn = !stanceGroupOn)}
          >
            Group by stance
          </button>
        </div>
        <div class="controls-row">
          <Controls options={questionOptions} activeIndex={questionIndex} onSelect={onSelectQuestion} ariaLabel="Question" />
        </div>
        <div class="controls-row theme-picker">
          <label for="theme-select">Highlight theme</label>
          <Select
            id="theme-select"
            options={[
              { value: "", label: "— none —" },
              ...themeOptions.map((t) => ({ value: String(t.index), label: `${t.label} (n=${t.count}, ${t.pct}%)` })),
            ]}
            value={selectedThemeIndex === null ? "" : String(selectedThemeIndex)}
            onChange={(v) => (selectedThemeIndex = v === "" ? null : Number(v))}
            ariaLabel="Highlight theme"
          />
          <button
            type="button"
            class="toggle-pill"
            aria-pressed={clusterOn}
            disabled={selectedThemeIndex === null}
            onclick={() => (clusterOn = !clusterOn)}
          >
            Cluster matches
          </button>
        </div>
        {#if proto.kind === "beeswarm"}
          <Beeswarm
            data={view.data}
            {segmentIndex}
            {questionIndex}
            colorIndex={colorSegmentIndex}
            {highlightOf}
            {highlightLabel}
            {clusterOn}
            {stanceIndexOf}
            {stanceCategoryCount}
            {stanceGroupOn}
          />
        {:else}
          <CircleSwarm
            data={view.data}
            {segmentIndex}
            {questionIndex}
            order={proto.order ?? "input"}
            {highlightOf}
            {highlightLabel}
            {clusterOn}
            {stanceIndexOf}
            {stanceCategoryCount}
            {stanceGroupOn}
          />
        {/if}
      {/if}
    </div>
  </div>
</main>

<style>
  .viz-root {
    color-scheme: light;
    /* Matches the EC design system's own cream page surface
       (var(--ec-bg-cream), #FFF4EB — see styles/ec-tokens.css) rather than
       the ad-hoc near-white this predates, so the app's outer background
       never seams against an EC-styled prototype's own canvas fill
       (ParticipantFunnelSelection.svelte's SURFACE reads the same token). */
    --surface-1: var(--ec-bg-white);
    --text-primary: #0b0b0b;
    --text-secondary: #52514e;
    --rule: #ccd5dd;
    --accent: #2a78d6;

    background: var(--surface-1);
    color: var(--text-primary);
    min-height: 100vh;
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    font-variant-numeric: tabular-nums;
    padding: 2rem;
    box-sizing: border-box;
  }

  @media (prefers-color-scheme: dark) {
    :root:where(:not([data-theme="light"])) .viz-root {
      color-scheme: dark;
      --surface-1: #1a1a19;
      --text-primary: #ffffff;
      --text-secondary: #c3c2b7;
      --rule: #3a3a37;
      --accent: #3987e5;
    }
  }
  :root[data-theme="dark"] .viz-root {
    color-scheme: dark;
    --surface-1: #1a1a19;
    --text-primary: #ffffff;
    --text-secondary: #c3c2b7;
    --rule: #3a3a37;
    --accent: #3987e5;
  }

  /* DiscussionSection.svelte's own page background — its reference mockups
     are white-only, so this pins the DS's semantic tokens to their light
     values regardless of OS theme, rather than remapping them (which would
     still flip under prefers-color-scheme). --ec-surface cascades down to
     the canvas, which ecCanvasTokens.ts probes off the canvas element's own
     parent (see that file's own comment), so the dot canvas's fill turns
     white for free, no JS change needed. The leading `:root` isn't
     structurally necessary (.viz-root.white-surface alone would select the
     same element) — it's there to match `:root[data-theme="dark"] .viz-root`
     above at 3 class-level selectors instead of 2, so this rule wins even if
     something ever sets that manual override, not just by source order. */
  :root .viz-root.white-surface {
    color-scheme: light;
    --surface-1: var(--ec-bg-white);
    --ec-surface: var(--ec-bg-white);
    --ec-surface-alt: var(--ec-bg-white);
    --ec-on-surface: var(--ec-navy);
    --ec-on-surface-muted: var(--ec-text-dark);
    --ec-hairline: var(--ec-border);
    --ec-emphasis: var(--ec-navy);
    --ec-link: var(--ec-link-light);
    --ec-nondata: #3b3a48;
    --ec-dropped: var(--ec-dataviz-6);
    --ec-chip-surface: var(--ec-navy);
    --ec-chip-on-surface: var(--ec-text-light);
  }

  .shell {
    display: flex;
    align-items: flex-start;
    gap: 2rem;
  }

  .content {
    flex: 1 1 auto;
    min-width: 0;
  }

  .controls-row {
    margin-bottom: 1.25rem;
  }

  .inline-row {
    display: flex;
    align-items: center;
    gap: 0.6rem;
  }

  .theme-picker {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    font-size: 0.82rem;
  }

  .theme-picker label {
    color: var(--text-secondary);
  }

  /* The <select>'s own chevron/border/dark-mode CSS now lives in
     Select.svelte (extracted so the rooms view's "Pick" dropdown can reuse
     it) — this file only keeps the surrounding row layout. */

  .toggle-pill {
    font: inherit;
    font-size: 0.82rem;
    color: var(--text-secondary);
    background: transparent;
    border: 1px solid var(--rule);
    border-radius: 6px;
    padding: 0.35rem 0.75rem;
    cursor: pointer;
  }

  .toggle-pill:hover:not(:disabled) {
    color: var(--text-primary);
  }

  .toggle-pill:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  .toggle-pill[aria-pressed="true"] {
    background: var(--text-primary);
    color: var(--surface-1);
    border-color: var(--text-primary);
    font-weight: 600;
  }

  .toggle-pill:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .status {
    color: var(--text-secondary);
    font-size: 0.9rem;
  }

  .empty {
    max-width: 32rem;
    border: 1px solid var(--rule);
    border-radius: 4px;
    padding: 1.25rem 1.5rem;
  }

  .empty-title {
    font-weight: 600;
    margin: 0 0 0.4rem;
  }

  .empty code {
    background: var(--rule);
    padding: 0.1rem 0.35rem;
    border-radius: 3px;
    font-size: 0.85em;
  }
</style>
