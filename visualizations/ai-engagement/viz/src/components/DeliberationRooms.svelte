<script lang="ts">
  /**
   * Phase 2: the 14 real deliberation sessions as a ring of "rooms", each a
   * small circle of attendee dots orbiting a facilitator. Positions come
   * from lib/rooms.ts's pure ring geometry — nothing here does its own
   * layout math beyond translating ring-local coordinates into the SVG's
   * viewBox. A rejected earlier attempt at this view used spiral-packed
   * rooms of irregular size and soft tinted discs; this is a plain ring of
   * identically-sized, crisply-stroked circles instead (see the internal analysis notes
   * for why).
   */
  import { roomRing, ringPositions } from "../lib/rooms.ts";
  import { assignCategoryColors } from "../lib/palette.ts";
  import { wrapLabel } from "../lib/labels.ts";
  import { fetchRoomIdeas, type RoomsData, type RoomsIdea } from "../lib/roomsData.ts";
  import {
    RANK_OPTIONS,
    sortByRank,
    sortIdeasByVotes,
    sessionsOf,
    themeIdOf,
    ideaMatchesEntry,
    type RankMetric,
    type RankableEntry,
  } from "../lib/roomsRank.ts";
  import { orbitAnchorRadius } from "../lib/orbitAnchor.ts";
  import Controls from "./Controls.svelte";
  import CategoryLegend from "./CategoryLegend.svelte";

  let { data }: { data: RoomsData } = $props();

  // Room + inner-ring geometry. roomRadius/gap match the brief's worked
  // example (ringRadius ~236, centerFreeRadius ~190 at count=14); innerRadius
  // 30 is the brief's own worked inner-ring example (12 dots at r=3 stay
  // clear of each other at radius ~30 — see rooms.test.ts).
  const ROOM_RADIUS = 46;
  const GAP = 14;
  const INNER_RADIUS = 30;
  const DOT_R = 3;
  // The room's click/focus hit target is drawn slightly larger than the
  // visible room-ring (HIT_R=49 vs. ROOM_RADIUS=46) so a focus outline
  // drawn at this radius has clearance to actually show — painting it at
  // the same radius as room-ring left only ~0.1px of the focus stroke
  // visible on either side of the ring's own opaque stroke, effectively
  // invisible (same HIT_R > R pattern CircleSwarm.svelte already uses for
  // its dots).
  const HIT_R = ROOM_RADIUS + 3;
  // Extra canvas around the ring for each room's caption — the ring's own
  // ringRadius/roomRadius only account for the room circles themselves, not
  // the text outside them.
  const CAPTION_ALLOWANCE = 46;
  // How far outside its own room's edge the caption sits, along the same
  // radial line from the ring's center through that room — like a number
  // on a clock face, so a caption never floats closer to a neighboring
  // room than to the one it actually labels.
  const CAPTION_OFFSET = 18;

  /**
   * Positions a caption along the radial line from the ring's local origin
   * (0,0) through `center`, `offset` past `center` itself, with a
   * text-anchor chosen by which side of the ring it falls on so the label
   * reads outward from its room rather than back over it.
   */
  function radialCaption(center: { x: number; y: number }, offset: number) {
    const dist = Math.hypot(center.x, center.y) || 1;
    const ux = center.x / dist;
    const uy = center.y / dist;
    const anchor: "start" | "middle" | "end" = ux > 0.15 ? "start" : ux < -0.15 ? "end" : "middle";
    return { x: center.x + ux * offset, y: center.y + uy * offset, anchor };
  }

  type Level = "theme" | "subtheme" | "concept";
  // Not `as const` — Controls.svelte's `options` prop wants a plain mutable
  // `{ key: string; label: string }[]`, which a readonly const-asserted
  // tuple doesn't structurally satisfy.
  const LEVEL_OPTIONS: { key: Level; label: string }[] = [
    { key: "theme", label: "Theme" },
    { key: "subtheme", label: "Subtheme" },
    { key: "concept", label: "Concept" },
  ];

  let level = $state<Level>("theme");
  const levelIndex = $derived(LEVEL_OPTIONS.findIndex((o) => o.key === level));

  let rankMetric = $state<RankMetric>("votes");
  const rankIndex = $derived(RANK_OPTIONS.findIndex((o) => o.key === rankMetric));

  function onSelectLevel(i: number) {
    level = LEVEL_OPTIONS[i].key;
  }

  const currentEntries = $derived<RankableEntry[]>(
    level === "theme" ? data.themes : level === "subtheme" ? data.subthemes : data.concepts,
  );
  const rankedEntries = $derived(sortByRank(currentEntries, rankMetric));

  // The workbook disagrees with itself in 4 places (data.meta.reconciliation
  // — see docs/SOURCE.md's "Internal reconciliation" section). That's real
  // ambiguity in the source data, not something this view can resolve, so
  // it needs to be visible rather than silently picked one way. Two of the
  // 4 entries carry a `scope` that matches a specific subtheme's `name`
  // (the other 2 are workbook-wide totals with no single row to flag) —
  // for those, tag the matching ranked-list row directly; the panel-level
  // caption below covers all 4 regardless of scope.
  function reconciliationNoteFor(entry: RankableEntry): string | null {
    const matches = data.meta.reconciliation.filter((r) => r.scope === entry.name);
    if (matches.length === 0) return null;
    return matches.map((r) => `${r.field}: workbook label says ${r.stated}, sheets sum to ${r.computed}`).join("; ");
  }
  function formatSessions(value: number | null): string {
    return value === null ? "—" : String(value);
  }

  // Theme colors are the one color axis this view has — 3 hues, assigned by
  // the app's single shared palette, never invented here.
  const themeColors = $derived(assignCategoryColors(data.themes.map((t) => t.name)));
  const themeColorOf = $derived(new Map(data.themes.map((t, i) => [t.id, themeColors[i]])));

  // Session order IS ring order: sorted ascending by number, point 0 at 12
  // o'clock, increasing index clockwise (roomRing/ringPositions' convention
  // — see lib/rooms.ts's header comment).
  const sessions = $derived([...data.sessions].sort((a, b) => a.number - b.number));
  const ring = $derived(roomRing(sessions.length, { roomRadius: ROOM_RADIUS, gap: GAP }));
  const halfSize = $derived(ring.ringRadius + ring.roomRadius + CAPTION_ALLOWANCE);
  const svgSize = $derived(halfSize * 2);
  const rooms = $derived(sessions.map((session, i) => ({ session, center: ring.centers[i] ?? { x: 0, y: 0 } })));

  const centerLine1 = $derived(`${data.meta.attendees} people in ${data.meta.sessions} conversations`);
  // ~11px sans-serif average glyph width; wrapLabel has no DOM measurement
  // available, so this is an estimate like every other caller of it.
  const CENTER_CHAR_WIDTH_PX = 6.1;
  const centerLine2 = $derived(
    wrapLabel("Open one to see what the group proposed and how they voted", ring.centerFreeRadius * 1.6, CENTER_CHAR_WIDTH_PX),
  );

  let openSessionNumber = $state<number | null>(null);
  const openRoom = $derived(openSessionNumber === null ? null : sessions.find((s) => s.number === openSessionNumber) ?? null);
  const openRoomIdeas = $derived(
    openRoom ? sortIdeasByVotes(data.ideas.filter((idea) => idea.sessionNumber === openRoom.number)) : [],
  );

  interface SubthemeIdeaGroup {
    subthemeId: string | null;
    subthemeName: string;
    ideas: RoomsIdea[];
  }

  // Groups a room's ideas by subtheme (via idea.conceptId -> concept ->
  // concept.subthemeId), for both the hover tooltip's compact summary and
  // the click-opened detail panel's idea list. hasIdeaLinkage is only
  // ~85% (see meta.linkageCoverage) — ideas with no conceptId land in a
  // final "not yet linked" bucket instead of silently disappearing.
  function groupIdeasBySubtheme(ideas: RoomsIdea[]): SubthemeIdeaGroup[] {
    const groups = new Map<string, SubthemeIdeaGroup>();
    const unlinked: RoomsIdea[] = [];
    for (const idea of ideas) {
      const concept = idea.conceptId ? data.concepts.find((c) => c.id === idea.conceptId) : undefined;
      const subtheme = concept ? data.subthemes.find((s) => s.id === concept.subthemeId) : undefined;
      if (subtheme) {
        if (!groups.has(subtheme.id)) groups.set(subtheme.id, { subthemeId: subtheme.id, subthemeName: subtheme.name, ideas: [] });
        groups.get(subtheme.id)!.ideas.push(idea);
      } else {
        unlinked.push(idea);
      }
    }
    const result = [...groups.values()].sort((a, b) => b.ideas.length - a.ideas.length);
    if (unlinked.length > 0) result.push({ subthemeId: null, subthemeName: "Not yet linked to a subtheme", ideas: unlinked });
    return result;
  }

  const openRoomSubthemeGroups = $derived(groupIdeasBySubtheme(openRoomIdeas));

  // Hovering a ranked-list row (theme/subtheme/concept, whichever `level`
  // is active) highlights every room with at least one idea that resolves
  // up to it, and surfaces those ideas grouped by room — the reverse
  // direction from the click-opened room panel (that one goes
  // room -> its subthemes; this one goes subtheme/concept -> its rooms).
  // Clicking a row pins it, so the panel and the highlighted rooms persist
  // after the pointer moves away instead of only ever showing on hover;
  // hovering a different row still previews it live, reverting to whatever
  // is pinned (if anything) once the pointer leaves.
  let hoveredEntryId = $state<string | null>(null);
  let pinnedEntryId = $state<string | null>(null);
  const activeEntryId = $derived(hoveredEntryId ?? pinnedEntryId);
  const hoveredEntry = $derived(activeEntryId === null ? null : rankedEntries.find((e) => e.id === activeEntryId) ?? null);

  const conceptById = $derived(new Map(data.concepts.map((c) => [c.id, c])));
  const matchingIdeasForHover = $derived(
    hoveredEntry ? data.ideas.filter((idea) => ideaMatchesEntry(idea.conceptId ? conceptById.get(idea.conceptId) : undefined, hoveredEntry)) : [],
  );
  const highlightedSessionNumbers = $derived(new Set(matchingIdeasForHover.map((idea) => idea.sessionNumber)));

  interface RoomIdeaGroup {
    sessionNumber: number;
    ideas: RoomsIdea[];
  }
  const matchingIdeasByRoom = $derived.by((): RoomIdeaGroup[] => {
    const groups = new Map<number, RoomsIdea[]>();
    for (const idea of matchingIdeasForHover) {
      if (!groups.has(idea.sessionNumber)) groups.set(idea.sessionNumber, []);
      groups.get(idea.sessionNumber)!.push(idea);
    }
    return [...groups.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([sessionNumber, ideas]) => ({ sessionNumber, ideas: sortIdeasByVotes(ideas) }));
  });

  function setEntryHover(entryId: string) {
    hoveredEntryId = entryId;
  }
  function clearEntryHover() {
    hoveredEntryId = null;
  }
  function toggleEntryPin(entryId: string) {
    pinnedEntryId = pinnedEntryId === entryId ? null : entryId;
  }
  function clearEntryPin() {
    pinnedEntryId = null;
  }

  function openRoomAt(sessionNumber: number) {
    openSessionNumber = sessionNumber;
  }
  function closeRoom() {
    openSessionNumber = null;
  }
  function onWindowKeydown(event: KeyboardEvent) {
    if (event.key !== "Escape") return;
    if (openSessionNumber !== null) closeRoom();
    else if (pinnedEntryId !== null) clearEntryPin();
  }

  // Idea text is participant response text — fetched lazily the first time
  // it's actually needed, either by opening a room or by hovering a ranked
  // entry (fetchRoomIdeas is memoized, so whichever happens first is the
  // only network call; never eager on mount, never logged). See
  // DetailPanel.svelte for the same lazy-fetch-on-open shape.
  let roomIdeaText = $state<Record<string, string>>({});
  let ideaTextLoading = $state(true);
  $effect(() => {
    if (openSessionNumber === null && hoveredEntryId === null && pinnedEntryId === null) return;
    ideaTextLoading = true;
    fetchRoomIdeas().then((map) => {
      roomIdeaText = map;
      ideaTextLoading = false;
    });
  });

  // $state (not a plain let) so this effect reliably re-runs once bind:this
  // actually assigns it, the same "focus once the dialog exists" behavior
  // DetailPanel.svelte gets for free from onMount on its own component
  // instance — this panel is a conditional block within DeliberationRooms
  // rather than a separate component, so onMount alone wouldn't fire per-open.
  let panelEl = $state<HTMLDivElement | undefined>();
  $effect(() => {
    if (openRoom && panelEl) panelEl.focus();
  });
</script>

<svelte:window onkeydown={onWindowKeydown} />

<section class="rooms">
  <header>
    <p class="eyebrow">EngagedCA AI consultation · Phase 2</p>
    <h2>Deliberation rooms</h2>
    <p class="caveat">{data.meta.sampleCaveat}</p>
  </header>

  <div class="controls-row">
    <Controls options={LEVEL_OPTIONS} activeIndex={levelIndex} onSelect={onSelectLevel} ariaLabel="Level" />
  </div>
  <div class="controls-row">
    <Controls
      options={RANK_OPTIONS}
      activeIndex={rankIndex}
      onSelect={(i) => (rankMetric = RANK_OPTIONS[i].key)}
      ariaLabel="Rank by"
    />
  </div>

  <div class="main-row">
    <svg
      width={svgSize}
      height={svgSize}
      viewBox="0 0 {svgSize} {svgSize}"
      style="--rooms-svg-size: {svgSize}px;"
      role="img"
      aria-label="Ring of {sessions.length} deliberation-room sessions"
    >
      <g transform="translate({halfSize}, {halfSize})">
        {#each rooms as room (room.session.id)}
          {@const dots = ringPositions(room.center, INNER_RADIUS, room.session.attendees)}
          {@const isDimmed = hoveredEntry !== null && !highlightedSessionNumbers.has(room.session.number)}
          {@const isHighlighted = hoveredEntry !== null && highlightedSessionNumbers.has(room.session.number)}
          {@const caption = radialCaption(room.center, ROOM_RADIUS + CAPTION_OFFSET)}
          <g
            class="room"
            class:dimmed={isDimmed}
            class:highlighted={isHighlighted}
            tabindex="0"
            role="button"
            aria-label="Conversation {room.session.number}, {room.session.attendees} people — open for details"
            onclick={() => openRoomAt(room.session.number)}
            onkeydown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                openRoomAt(room.session.number);
              }
            }}
          >
            <circle class="hit" cx={room.center.x} cy={room.center.y} r={HIT_R} />
            <circle class="room-ring" cx={room.center.x} cy={room.center.y} r={ROOM_RADIUS} />
            <!-- Orbit: one CSS animation per room's own dot group, rotating
                 around that group's own fill-box center — no
                 requestAnimationFrame loop. The dots alone are only
                 2-fold-symmetric (and therefore bbox-centered on
                 room.center) for even attendee counts; odd counts (5, 7,
                 11 all occur in the real data) leave the dots' own
                 bounding box measurably off-center. The paint-free
                 "orbit-anchor" circle below fixes this for every count: it
                 contributes its own full, room.center-centered geometry to
                 the bbox regardless of paint, and — since every dot's
                 coordinates are individually bounded by innerRadius — its
                 bbox always contains every dot's, so the aggregate bbox
                 (and thus the rotation center) is always exactly
                 room.center. See lib/orbitAnchor.ts and its tests. -->
            <g class="orbit">
              <circle
                class="orbit-anchor"
                cx={room.center.x}
                cy={room.center.y}
                r={orbitAnchorRadius(INNER_RADIUS, DOT_R)}
                fill="none"
                stroke="none"
                pointer-events="none"
              />
              {#each dots as dot, di (di)}
                <circle class="attendee" cx={dot.x} cy={dot.y} r={DOT_R} />
              {/each}
            </g>
            <circle class="facilitator-ring" cx={room.center.x} cy={room.center.y} r="8" />
            <text class="caption-count" x={caption.x} y={caption.y} text-anchor={caption.anchor}>
              {room.session.number}
            </text>
          </g>
        {/each}

        <g class="center-copy">
          <text class="center-line1" x="0" y="-6">{centerLine1}</text>
          {#each centerLine2 as line, li}
            <text class="center-line2" x="0" y={14 + li * 15}>{line}</text>
          {/each}
        </g>
      </g>
    </svg>

    <aside class="ranked-panel">
      <h3>{LEVEL_OPTIONS[levelIndex].label}s ranked by {RANK_OPTIONS[rankIndex].label.toLowerCase()}</h3>
      <ol class="ranked-list">
        {#each rankedEntries as entry (entry.id)}
          {@const reconcileNote = reconciliationNoteFor(entry)}
          {@const entryColor = themeColorOf.get(themeIdOf(entry)) ?? "var(--rule)"}
          <li>
            <button
              type="button"
              class="entry-row"
              class:hovered={entry.id === hoveredEntryId}
              class:pinned={entry.id === pinnedEntryId}
              style="border-left-color: {entryColor}"
              aria-label="{entry.name} — hover to preview which rooms raised related ideas, click to keep it open"
              aria-pressed={entry.id === pinnedEntryId}
              onpointerenter={() => setEntryHover(entry.id)}
              onpointerleave={clearEntryHover}
              onfocus={() => setEntryHover(entry.id)}
              onblur={clearEntryHover}
              onclick={() => toggleEntryPin(entry.id)}
            >
              <div class="row-top">
                <span class="name">{entry.name}</span>
                {#if reconcileNote}
                  <span class="reconcile-flag" title="This workbook disagrees with itself here — {reconcileNote}. See docs/SOURCE.md.">⚠</span>
                {/if}
              </div>
              <div class="row-meta">
                <span class="pill" style="background: {entryColor}">{entry.votes} votes</span>
                <span class="count"
                  >{entry.ideas} ideas · {entry.topIdeas} top ideas · {formatSessions(sessionsOf(entry))} sessions</span
                >
              </div>
            </button>
          </li>
        {/each}
      </ol>

      {#if hoveredEntry}
        <div class="hover-ideas-panel" class:pinned={pinnedEntryId === hoveredEntry.id}>
          <p class="hover-ideas-title">
            {hoveredEntry.name} · {matchingIdeasForHover.length} idea{matchingIdeasForHover.length === 1 ? "" : "s"} across {matchingIdeasByRoom.length}
            room{matchingIdeasByRoom.length === 1 ? "" : "s"}
            {#if pinnedEntryId === hoveredEntry.id}
              <button type="button" class="unpin" onclick={clearEntryPin}>✕ unpin</button>
            {/if}
          </p>
          {#if matchingIdeasByRoom.length > 0}
            <ul class="hover-ideas-list">
              {#each matchingIdeasByRoom as group (group.sessionNumber)}
                <li>
                  <p class="hover-room-label">Conversation {group.sessionNumber}</p>
                  {#each group.ideas as idea (idea.id)}
                    <p class="hover-idea-text">{ideaTextLoading ? "Loading…" : roomIdeaText[idea.id] ?? "(no text)"} · {idea.votes} votes</p>
                  {/each}
                </li>
              {/each}
            </ul>
          {:else}
            <p class="hover-empty">No linked ideas yet for this entry.</p>
          {/if}
        </div>
      {/if}

      <CategoryLegend
        values={data.themes.map((t) => t.name)}
        colors={themeColors}
        counts={data.themes.map((t) => t.votes)}
        total={data.meta.votes}
        caption="Theme (by votes)"
      />
      {#if data.meta.reconciliation.length > 0}
        <p class="caveat reconcile-caveat">
          This workbook contains {data.meta.reconciliation.length} internal disagreement{data.meta.reconciliation.length === 1
            ? ""
            : "s"} between its own sheets — see docs/SOURCE.md.
        </p>
      {/if}
    </aside>

    {#if openRoom}
      <div class="room-detail" role="dialog" aria-label="Conversation {openRoom.number} detail" tabindex="-1" bind:this={panelEl}>
        <header>
          <p class="id">Conversation {openRoom.number}</p>
          <button type="button" class="close" onclick={closeRoom} aria-label="Close">✕</button>
        </header>
        <dl class="totals">
          <div>
            <dt>People</dt>
            <dd>{openRoom.attendees}</dd>
          </div>
          <div>
            <dt>Ideas</dt>
            <dd>{openRoom.ideas}</dd>
          </div>
          <div>
            <dt>Votes</dt>
            <dd>{openRoom.votes}</dd>
          </div>
        </dl>
        {#each openRoomSubthemeGroups as group (group.subthemeId ?? "unlinked")}
          <p class="subtheme-heading">{group.subthemeName}</p>
          <ol class="idea-list">
            {#each group.ideas as idea (idea.id)}
              <li>
                <p class="idea-text">{ideaTextLoading ? "Loading…" : roomIdeaText[idea.id] ?? "(no text)"}</p>
                <p class="idea-meta">{idea.votes} votes · ratio {idea.voteRatio.toFixed(2)}</p>
              </li>
            {/each}
          </ol>
        {/each}
      </div>
    {/if}
  </div>
</section>

<style>
  .rooms {
    --ink: #0b0b0b;
    --muted: #52514e;
    --rule: #ccd5dd;
    --surface-1: #fcfcfb;
    --accent: #2a78d6;
    --dot: color-mix(in oklab, var(--muted) 55%, transparent);

    color: var(--ink);
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    font-variant-numeric: tabular-nums;
  }

  @media (prefers-color-scheme: dark) {
    :root:where(:not([data-theme="light"])) .rooms {
      --ink: #ffffff;
      --muted: #c3c2b7;
      --rule: #3a3a37;
      --surface-1: #1a1a19;
      --accent: #3987e5;
    }
  }
  :root[data-theme="dark"] .rooms {
    --ink: #ffffff;
    --muted: #c3c2b7;
    --rule: #3a3a37;
    --surface-1: #1a1a19;
    --accent: #3987e5;
  }

  .eyebrow {
    margin: 0;
    font-size: 0.7rem;
    letter-spacing: 0.09em;
    text-transform: uppercase;
    color: var(--muted);
  }

  h2 {
    margin: 0.4rem 0 0.5rem;
    font-size: 1.35rem;
    font-weight: 600;
    letter-spacing: -0.015em;
  }

  .caveat {
    margin: 0 0 1rem;
    max-width: 46rem;
    font-size: 0.82rem;
    line-height: 1.5;
    color: var(--muted);
  }

  .controls-row {
    margin-bottom: 1.25rem;
  }

  .main-row {
    display: flex;
    align-items: flex-start;
    gap: 2rem;
    flex-wrap: wrap;
  }

  svg {
    display: block;
    /* The ring must shrink before .main-row wraps — a wrapped layout drops
       the room-detail panel below the fold at common laptop/monitor widths
       (1440-1728px), defeating the point of a side panel over a modal (see
       the internal analysis notes: "so the ring stays visible"). width: 100% (rather
       than flex-shrink: 0's old fixed size) lets flexbox shrink this item
       when the ranked panel + detail panel don't leave room for it at its
       natural size; height: auto keeps the ring's square aspect ratio as
       it shrinks, since the width/height attributes above are otherwise
       both fixed pixel values with no auto axis for the browser to scale
       from. max-width caps it at its natural (viewBox) size so it doesn't
       grow past its designed size on very wide viewports. */
    width: 100%;
    height: auto;
    max-width: var(--rooms-svg-size);
    min-width: 0;
  }

  .room {
    cursor: pointer;
    transition: opacity 150ms ease;
  }

  .room.dimmed {
    opacity: 0.25;
  }

  .room.highlighted .room-ring {
    stroke: var(--accent);
    stroke-width: 2px;
  }

  .hit {
    fill: transparent;
  }

  .room:focus-visible .hit {
    stroke: var(--accent);
    stroke-width: 1.5px;
  }

  .room-ring {
    fill: none;
    stroke: var(--rule);
    stroke-width: 1.25;
  }

  .attendee {
    fill: var(--dot);
  }

  .facilitator-ring {
    fill: none;
    stroke: var(--ink);
    stroke-width: 1.5;
  }

  .orbit {
    transform-box: fill-box;
    transform-origin: center;
    animation: orbit 60s linear infinite;
  }

  @keyframes orbit {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .orbit {
      animation: none;
    }
  }

  .caption-count {
    font-size: 12px;
    font-weight: 600;
    fill: var(--ink);
    dominant-baseline: middle;
  }

  .center-copy {
    pointer-events: none;
  }

  .center-line1 {
    font-size: 16px;
    font-weight: 700;
    fill: var(--ink);
    text-anchor: middle;
  }

  .center-line2 {
    font-size: 11px;
    fill: var(--muted);
    text-anchor: middle;
  }

  .ranked-panel {
    flex: 1 1 16rem;
    min-width: 16rem;
  }

  .ranked-panel h3 {
    margin: 0 0 0.6rem;
    font-size: 0.9rem;
    font-weight: 600;
  }

  .ranked-list {
    list-style: none;
    margin: 0 0 1rem;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    max-height: 28rem;
    overflow-y: auto;
  }

  .entry-row {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    width: 100%;
    text-align: left;
    font: inherit;
    color: inherit;
    padding: 0.55rem 0.7rem;
    border-radius: 6px;
    border: 1px solid var(--rule);
    border-left: 3px solid var(--rule);
    background: var(--surface-1);
    cursor: pointer;
  }

  .entry-row.hovered {
    border-top-color: var(--accent);
    border-right-color: var(--accent);
    border-bottom-color: var(--accent);
    background: color-mix(in oklab, var(--accent) 6%, transparent);
  }

  .entry-row.pinned {
    border-top-color: var(--accent);
    border-right-color: var(--accent);
    border-bottom-color: var(--accent);
    background: color-mix(in oklab, var(--accent) 10%, transparent);
    font-weight: 600;
  }

  .entry-row:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  .row-top {
    display: flex;
    align-items: baseline;
    gap: 0.4rem;
  }

  .row-meta {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .pill {
    color: #fff;
    font-size: 0.7rem;
    font-weight: 600;
    border-radius: 999px;
    padding: 0.1rem 0.55rem;
    white-space: nowrap;
  }

  .name {
    font-size: 0.85rem;
    font-weight: 600;
  }

  .count {
    font-size: 0.72rem;
    color: var(--muted);
  }

  .reconcile-flag {
    font-size: 0.7rem;
    cursor: help;
    color: var(--muted);
  }

  .reconcile-caveat {
    margin-top: 0.5rem;
    max-width: none;
  }

  .room-detail {
    flex: 0 0 20rem;
    border: 1px solid var(--rule);
    border-radius: 8px;
    padding: 1rem 1.25rem;
    max-height: 34rem;
    overflow-y: auto;
  }

  .room-detail header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 0.75rem;
  }

  .room-detail .id {
    margin: 0;
    font-size: 0.72rem;
    letter-spacing: 0.04em;
    color: var(--muted);
  }

  .room-detail .close {
    font: inherit;
    background: transparent;
    border: 0;
    color: var(--muted);
    cursor: pointer;
    font-size: 1rem;
    padding: 0.2rem 0.4rem;
    border-radius: 4px;
  }

  .room-detail .close:hover,
  .room-detail .close:focus-visible {
    color: var(--ink);
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  .totals {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 0.5rem;
    margin: 0 0 1rem;
    padding: 0.6rem;
    background: color-mix(in oklab, var(--rule) 35%, transparent);
    border-radius: 6px;
  }

  .totals dt {
    font-size: 0.65rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--muted);
  }

  .totals dd {
    margin: 0;
    font-size: 0.95rem;
    font-weight: 600;
  }

  .idea-list {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .idea-list li {
    padding: 0.6rem 0;
    border-top: 1px solid var(--rule);
  }

  .idea-list li:first-child {
    border-top: 0;
  }

  .idea-text {
    margin: 0 0 0.2rem;
    font-size: 0.85rem;
    line-height: 1.5;
    white-space: pre-wrap;
  }

  .idea-meta {
    margin: 0;
    font-size: 0.72rem;
    color: var(--muted);
  }

  .subtheme-heading {
    margin: 1rem 0 0.3rem;
    font-size: 0.72rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--muted);
  }

  .subtheme-heading:first-of-type {
    margin-top: 0;
  }

  .hover-ideas-panel {
    margin: 0 0 1rem;
    padding: 0.6rem 0.75rem;
    background: color-mix(in oklab, var(--accent) 6%, var(--surface-1));
    border: 1px solid var(--rule);
    border-radius: 6px;
    font-size: 0.8rem;
  }

  .hover-ideas-panel.pinned {
    border-color: var(--accent);
  }

  .hover-ideas-title {
    margin: 0 0 0.5rem;
    font-weight: 600;
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
  }

  .unpin {
    font: inherit;
    font-weight: 400;
    font-size: 0.75rem;
    color: var(--muted);
    background: transparent;
    border: 0;
    cursor: pointer;
    padding: 0;
    margin-left: auto;
  }

  .unpin:hover {
    color: var(--ink);
    text-decoration: underline;
  }

  .unpin:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  .hover-ideas-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    max-height: 16rem;
    overflow-y: auto;
  }

  .hover-room-label {
    margin: 0 0 0.2rem;
    font-size: 0.72rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--muted);
  }

  .hover-idea-text {
    margin: 0 0 0.15rem;
    line-height: 1.4;
  }

  .hover-empty {
    margin: 0;
    color: var(--muted);
  }
</style>
