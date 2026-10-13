import { test } from "node:test";
import assert from "node:assert/strict";
import type { CrosswalkData } from "../../viz/src/lib/crosswalkData.ts";
import type { FunnelData } from "../../viz/src/lib/funnelData.ts";
import type { InsightsData } from "../../viz/src/lib/insightsData.ts";
import type { RespondentsData } from "../../viz/src/lib/data.ts";
import type { RoomsData } from "../../viz/src/lib/roomsData.ts";
import { DEFAULT_SEED, generateAll } from "../src/generate.ts";
import { loadInputs } from "../src/inputs.ts";
import { ANSWER_CAP, QUESTIONS, SURVEY_CSV_HEADER, SYNTHETIC_PREFIX } from "../src/survey.ts";

const inputs = loadInputs();
const { viz, surveyCsv, people } = generateAll(DEFAULT_SEED, inputs);
const respondents = viz["respondents.json"] as RespondentsData;
const rooms = viz["rooms.json"] as RoomsData;
const roomIdeas = viz["roomIdeas.json"] as Record<string, string>;
const funnel = viz["funnel.json"] as FunnelData;
const insights = viz["insights.json"] as InsightsData;
const crosswalk = viz["crosswalk.json"] as CrosswalkData;
const verbatims = (q: string) => viz[`verbatims.${q}.json`] as Record<string, string>;
const publishedAttendees = inputs.funnel.sessions.reduce((a, s) => a + s.attendees.length, 0);

test("output is a pure function of the seed", () => {
  const again = generateAll(DEFAULT_SEED, inputs);
  assert.equal(JSON.stringify(again.viz), JSON.stringify(viz));
  assert.equal(again.surveyCsv, surveyCsv);
  const other = generateAll(DEFAULT_SEED + 100, inputs);
  assert.notEqual(JSON.stringify(other.viz["respondents.json"]), JSON.stringify(respondents));
});

test("writes every file the viz app fetches", () => {
  const expected = ["respondents.json", "rooms.json", "roomIdeas.json", "funnel.json", "insights.json", "crosswalk.json",
    ...QUESTIONS.map((q) => `verbatims.${q.id}.json`)];
  assert.deepEqual(Object.keys(viz).sort(), expected.sort());
});

test("respondent totals match the published funnel", () => {
  assert.equal(respondents.respondents.length, inputs.funnel.phase1Total);
  const phase = respondents.meta.segments.findIndex((s) => s.key === "PHASE");
  assert.equal(respondents.respondents.filter((r) => r.seg[phase] === 1).length, publishedAttendees);
  assert.equal(new Set(respondents.respondents.map((r) => r.id)).size, respondents.respondents.length);
});

test("respondent fields are internally consistent", () => {
  const { meta } = respondents;
  respondents.respondents.forEach((r, n) => {
    r.rawSeg.forEach((raw, i) => assert.equal(r.seg[i], inputs.segments[i].rawToValue[raw]));
    QUESTIONS.forEach((q, qi) => {
      assert.equal(r.len[qi], people[n].text[qi].length);
      if (r.status[qi] !== 0) assert.deepEqual(r.themes[qi], []);
    });
  });
  for (const q of QUESTIONS) {
    assert.equal(meta.statusCounts[q.id].reduce((a, b) => a + b, 0), respondents.respondents.length);
    assert.equal(meta.themeDenominators[q.id], meta.statusCounts[q.id][0]);
    const qi = QUESTIONS.findIndex((x) => x.id === q.id);
    meta.themes.forEach((_, t) => {
      const raised = respondents.respondents.filter((r) => r.themes[qi].includes(t)).length;
      assert.equal(meta.themeCounts[q.id][t], raised);
    });
  }
  assert.equal(meta.themes.length, inputs.codebook.questions.reduce((a, q) => a + q.themes.length, 0));
});

test("every free-text answer is clearly synthetic and respects the 1,000-char cap", () => {
  let truncated = 0;
  QUESTIONS.forEach((q, qi) => {
    const texts = verbatims(q.id);
    for (const r of respondents.respondents) {
      const t = texts[r.id];
      const status = r.status[qi];
      if (status === 0) {
        assert.ok(t.startsWith(SYNTHETIC_PREFIX), t);
        assert.ok(t.length <= ANSWER_CAP);
        if (t.length === ANSWER_CAP) truncated++;
      } else if (status === 1) assert.ok(inputs.codebook.nonAnswers.includes(t), t);
      else if (status === 2) assert.equal(t, inputs.codebook.refusalMarker);
      else assert.equal(t, undefined);
    }
  });
  assert.ok(truncated > 0, "some answers should hit the export cap");
});

test("rooms use the published sessions and add up", () => {
  const dates = [...inputs.funnel.sessions].map((s) => s.date).sort();
  assert.deepEqual(rooms.sessions.map((s) => s.date), dates);
  assert.equal(rooms.meta.attendees, publishedAttendees);
  assert.equal(rooms.meta.ideas, rooms.ideas.length);
  for (const s of rooms.sessions) {
    const mine = rooms.ideas.filter((x) => x.sessionNumber === s.number);
    assert.equal(mine.length, s.ideas);
    assert.equal(mine.reduce((a, x) => a + x.votes, 0), s.votes);
  }
  const linkedVotes = rooms.ideas.filter((x) => x.conceptId).reduce((a, x) => a + x.votes, 0);
  assert.equal(rooms.concepts.reduce((a, c) => a + c.votes, 0), linkedVotes);
  assert.equal(rooms.themes.reduce((a, t) => a + t.votes, 0), linkedVotes);
  assert.deepEqual(Object.keys(roomIdeas).sort(), rooms.ideas.map((x) => x.id).sort());
  for (const t of Object.values(roomIdeas)) assert.ok(t.startsWith(SYNTHETIC_PREFIX));
});

test("funnel.json is exactly the published funnel", () => {
  const p = inputs.funnel;
  assert.equal(funnel.phase1Total, p.phase1Total);
  assert.deepEqual(funnel.regions, p.regions);
  assert.deepEqual(funnel.fieldOfWork, p.fieldOfWork);
  assert.deepEqual(funnel.invitedByRegion, p.invitedByRegion);
  assert.equal(funnel.sessions.length, p.sessions.length);
});

test("insights.json contains only published quotes and bylines", () => {
  const published = new Set(inputs.quotes.quotes.map((q) => `${q.text}\u0000${q.byline}`));
  const shown = Object.values(insights.concepts).flatMap((c) => c.quotes);
  assert.equal(shown.length, inputs.quotes.quotes.length);
  for (const q of shown) assert.ok(published.has(`${q.text}\u0000${q.byline}`));
  const conceptIds = new Set(rooms.concepts.map((c) => c.id));
  for (const id of Object.keys(insights.concepts)) assert.ok(conceptIds.has(id), id);
});

test("crosswalk edges come from the committed config and codes partition cleanly", () => {
  assert.equal(crosswalk.edges.length, inputs.crosswalk.concepts.reduce((a, c) => a + c.sources.length, 0));
  const claimed = new Set(crosswalk.edges.map((e) => e.code));
  for (const c of crosswalk.unclaimedCodes) assert.ok(!claimed.has(c));
  assert.equal(claimed.size + crosswalk.unclaimedCodes.length, crosswalk.themes.length);
  assert.equal(crosswalk.concepts.length, rooms.concepts.length);
});

test("survey CSV has the real header and one row per respondent", () => {
  assert.ok(surveyCsv.startsWith(SURVEY_CSV_HEADER.join(",") + "\r\n"));
  // Every record starts with a respondent id at the beginning of a line.
  const starts = surveyCsv.split("\r\n").filter((l) => /^[0-9a-f]{8}-[0-9a-f]{4}-4/.test(l));
  assert.equal(starts.length, respondents.respondents.length);
  assert.ok(surveyCsv.includes('"[SYNTHETIC]'), "answers with commas/newlines are quoted");
});
