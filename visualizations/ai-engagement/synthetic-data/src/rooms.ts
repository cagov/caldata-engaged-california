/**
 * Fake Phase 2 deliberation-room data. Session dates and attendee counts come
 * from the published funnel; theme/subtheme/concept names are the public
 * taxonomy; every idea, vote count, and idea text is synthetic.
 */
import type { RoomsData, RoomsIdea, RoomsSession } from "../../viz/src/lib/roomsData.ts";
import type { Inputs } from "./inputs.ts";
import { int, pick, shuffle, weighted, type Rng } from "./rng.ts";
import { SYNTHETIC_PREFIX } from "./survey.ts";

const LINKED_SHARE = 0.85; // the real board join links ~85% of ideas to a concept
const TOP_PER_SESSION = 3;

export const ROOMS_CAVEAT =
  "SYNTHETIC DATA — ideas and votes are fake. Session dates and attendee counts are the published ones. (Real caveat: small-group sessions recruited via sortition; too few sessions for statistical inference.)";

const IDEA_TEMPLATES = [
  "{c}.",
  "{c}, starting with a pilot program.",
  "{c}, and report back on results every year.",
  "{c}, with input from the workers affected.",
  "{c} — make it enforceable, not voluntary.",
];

const UNLINKED_IDEAS = [
  "Set up a standing advisory group on AI.",
  "Revisit these rules every two years.",
  "Coordinate with other states before acting.",
  "Publish plain-language guides for residents.",
];

export interface RoomsOutput {
  rooms: RoomsData;
  roomIdeas: Record<string, string>;
}

export function makeRooms(rng: Rng, inputs: Inputs, generated: string, seed: number): RoomsOutput {
  const { taxonomy } = inputs;
  const popularity = new Map(shuffle(rng, taxonomy.concepts).map((c, rank) => [c.id, 1 / Math.pow(rank + 1, 0.6)]));
  const conceptWeights = taxonomy.concepts.map((c) => popularity.get(c.id)!);

  const published = [...inputs.funnel.sessions].sort((a, b) => a.date.localeCompare(b.date));
  const ideas: RoomsIdea[] = [];
  const roomIdeas: Record<string, string> = {};
  const top = new Set<string>();
  const sessions: RoomsSession[] = published.map((s, i) => {
    const number = i + 1;
    const attendees = s.attendees.length;
    const count = int(rng, 8, 14);
    const totalVotes = attendees * int(rng, 4, 6);
    const shares = Array.from({ length: count }, () => rng() ** 2 + 0.05);
    const votes = shares.map(() => 0);
    for (let v = 0; v < totalVotes; v++) votes[weighted(rng, shares)]++;
    const mine: RoomsIdea[] = votes.map((v) => {
      const id = `I-${String(ideas.length + 1).padStart(3, "0")}`;
      const concept = rng() < LINKED_SHARE ? taxonomy.concepts[weighted(rng, conceptWeights)] : null;
      const idea: RoomsIdea = { id, sessionNumber: number, votes: v, voteRatio: attendees > 0 ? v / attendees : 0, conceptId: concept?.id ?? null };
      ideas.push(idea);
      roomIdeas[id] = SYNTHETIC_PREFIX + (concept ? pick(rng, IDEA_TEMPLATES).replace("{c}", concept.name) : pick(rng, UNLINKED_IDEAS));
      return idea;
    });
    [...mine].sort((a, b) => b.votes - a.votes || a.id.localeCompare(b.id)).slice(0, TOP_PER_SESSION).forEach((x) => top.add(x.id));
    return {
      id: `S${String(number).padStart(2, "0")}`,
      number,
      date: s.date,
      attendees,
      facilitators: 1,
      ideas: count,
      votes: totalVotes,
      votesPerAttendee: attendees > 0 ? totalVotes / attendees : 0,
    };
  });

  const concepts = taxonomy.concepts.map((c) => {
    const linked = ideas.filter((x) => x.conceptId === c.id);
    return {
      ...c,
      sessions: new Set(linked.map((x) => x.sessionNumber)).size,
      votes: linked.reduce((a, x) => a + x.votes, 0),
      ideas: linked.length,
      topIdeas: linked.filter((x) => top.has(x.id)).length,
    };
  });
  const subthemes = taxonomy.subthemes.map((s) => {
    const mine = concepts.filter((c) => c.subthemeId === s.id);
    const linked = ideas.filter((x) => mine.some((c) => c.id === x.conceptId));
    const votes = mine.reduce((a, c) => a + c.votes, 0);
    const ideaCount = mine.reduce((a, c) => a + c.ideas, 0);
    return {
      ...s,
      statedVotes: votes,
      statedIdeas: ideaCount,
      statedSessions: new Set(linked.map((x) => x.sessionNumber)).size,
      votes,
      ideas: ideaCount,
      topIdeas: mine.reduce((a, c) => a + c.topIdeas, 0),
      concepts: mine.length,
    };
  });
  const themes = taxonomy.themes.map((t) => {
    const mine = subthemes.filter((s) => s.themeId === t.id);
    return {
      ...t,
      votes: mine.reduce((a, s) => a + s.votes, 0),
      ideas: mine.reduce((a, s) => a + s.ideas, 0),
      topIdeas: mine.reduce((a, s) => a + s.topIdeas, 0),
      subthemes: mine.length,
    };
  });

  const linkedCount = ideas.filter((x) => x.conceptId !== null).length;
  return {
    rooms: {
      meta: {
        generated,
        sourceFile: "synthetic",
        sourceHash: `synthetic:seed=${seed}`,
        sessions: sessions.length,
        attendees: sessions.reduce((a, s) => a + s.attendees, 0),
        ideas: ideas.length,
        votes: sessions.reduce((a, s) => a + s.votes, 0),
        sampleCaveat: ROOMS_CAVEAT,
        reconciliation: [],
        hasIdeaLinkage: true,
        linkageCoverage: ideas.length > 0 ? linkedCount / ideas.length : 0,
      },
      themes,
      subthemes,
      concepts,
      sessions,
      ideas,
    },
    roomIdeas,
  };
}
