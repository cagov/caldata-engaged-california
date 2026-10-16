/**
 * The viz files that can be built entirely from published or public inputs:
 * funnel.json (published participant funnel), insights.json (published
 * report quotes), and crosswalk.json (public concept→theme links, with theme
 * counts taken from the synthetic respondents).
 */
import type { CrosswalkData } from "../../viz/src/lib/crosswalkData.ts";
import type { FunnelData } from "../../viz/src/lib/funnelData.ts";
import type { InsightsData } from "../../viz/src/lib/insightsData.ts";
import type { RespondentsData } from "../../viz/src/lib/data.ts";
import type { RoomsData } from "../../viz/src/lib/roomsData.ts";
import type { Inputs } from "./inputs.ts";

const PUBLISHED = "published: https://engaged.ca.gov/ai-impact/report/";

export function funnelJson(inputs: Inputs, generated: string): FunnelData {
  const f = inputs.funnel;
  return {
    meta: {
      generated,
      sourceHashes: { phase1: PUBLISHED, phase2: PUBLISHED, sortition: PUBLISHED },
      sampleCaveat:
        "Published figures from engaged.ca.gov. Self-selected public consultation, not a probability sample. Percentages describe the people who responded, not Californians.",
    },
    phase1Total: f.phase1Total,
    regions: f.regions,
    fieldOfWork: f.fieldOfWork,
    sessions: f.sessions.map((s) => ({ date: s.date, attendees: s.attendees.map(({ region, fieldOfWork }) => ({ region, fieldOfWork })) })),
    invitedByRegion: f.invitedByRegion,
    invitedTotal: f.invitedTotal,
  };
}

export function insightsJson(inputs: Inputs): InsightsData {
  const concepts: InsightsData["concepts"] = {};
  for (const q of inputs.quotes.quotes) {
    (concepts[q.conceptId] ??= { quotes: [] }).quotes.push({ text: q.text, byline: q.byline });
  }
  return {
    meta: {
      source: inputs.quotes.source,
      note: `Only quotes published in the Engaged California AI report (fetched ${inputs.quotes.fetched}), with their published bylines.`,
    },
    concepts,
  };
}

export function crosswalkJson(inputs: Inputs, respondents: RespondentsData, rooms: RoomsData, generated: string): CrosswalkData {
  const cw = inputs.crosswalk;
  const { themes, themeCounts } = respondents.meta;
  const edges = cw.concepts.flatMap((c) => c.sources.map((s) => ({ conceptId: c.conceptId, ...s })));
  const claimed = new Set(edges.map((e) => e.code));
  const totalSessions = rooms.sessions.length;
  return {
    meta: {
      generated,
      version: cw.version,
      codebookVersion: cw.codebookVersion,
      roomsSourceHash: rooms.meta.sourceHash,
      status: cw.status,
      approvedBy: cw.approvedBy,
      method: cw.method,
      caveat:
        "Concept→theme links are interpretive, not measured. Theme counts and concept metrics here are SYNTHETIC.",
    },
    themes: themes.map((t, i) => ({
      ...t,
      counts: { personal: themeCounts.personal[i], economy: themeCounts.economy[i], government: themeCounts.government[i] },
    })),
    edges,
    unclaimedCodes: themes.map((t) => t.code).filter((c) => !claimed.has(c)),
    // Same formulas as analysis/src/lib/crosswalk.ts.
    concepts: rooms.concepts.map((c) => {
      const parent = rooms.subthemes.find((s) => s.id === c.subthemeId)!;
      const sessionsPct = Math.round((c.sessions / totalSessions) * 100);
      const topPct = c.ideas > 0 ? Math.round((c.topIdeas / c.ideas) * 100) : 0;
      return {
        conceptId: c.id,
        sessionsPct,
        topPct,
        voteToIdeaRatio: parent.ideas > 0 ? parent.votes / parent.ideas : 0,
        compositePctSum: sessionsPct + topPct,
        compositeCountSum: c.sessions + c.topIdeas,
      };
    }),
  };
}
