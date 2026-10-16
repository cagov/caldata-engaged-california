/**
 * Real export data, inlined as plain globals (not fetched) so this sketch
 * runs from a double-clicked index.html with no local server — `fetch()`
 * against a `file://` URL is blocked by CORS in every major browser.
 *
 * FUNNEL_DATA: verbatim from analysis/artifacts/viz/funnel.json (same file
 * the sibling `participant-funnel` handoff uses) — drives the 14
 * conversation rings' geometry and real attendee (region, fieldOfWork)
 * pairs. Only aggregate counts and attendee category pairs — no names, no
 * IDs, no response text.
 *
 * ROOMS_DATA: TRIMMED from analysis/artifacts/viz/rooms.json — only `meta.
 * sampleCaveat` and `sessions` (id/number/date/attendee-count stats) are
 * kept. The full export's `themes`/`subthemes`/`concepts`/`ideas` arrays
 * (policy-concept vote aggregation) belong to this prototype's other two
 * tabs ("Concepts" and "Distillation"), which this handoff doesn't include
 * — see README.md. `sessions` is what lets a conversation badge show its
 * real session number (e.g. "Conversation 7") instead of just a ring
 * position.
 *
 * insights.json is deliberately NOT included here at all — its own
 * `meta.note` reads "Hand-authored comms copy containing real participant
 * speech... per README data rule 2" (never commit response text to git). This
 * changes nothing visible: insights.json's `sessions` map (the only field
 * that would feed real quotes into this tab) is empty in the current
 * export, so the live prototype already shows 100% placeholder chat turns
 * for every conversation. See README.md if you want to hand-author your
 * own local (uncommitted) override quotes.
 */
var FUNNEL_DATA = {
  "meta": {
    "generated": "2026-09-11T19:07:50.387Z",
    "sourceHashes": {
      "phase1": "1d5cc45547b24808425647747d39d3a396bcdc83086f5eb3f4d724d24741f0d3",
      "phase2": "13e4f2249a700c63e8e44e5da1058bfd252fe79ab648b8e862bb1ddb0264e8c1",
      "sortition": "45874d5e968cde430a99435aec11f4a8a9cfc33ce00596be3dac4bedff7080f9"
    },
    "sampleCaveat": "Self-selected public consultation, not a probability sample. Percentages describe the people who responded, not Californians."
  },
  "phase1Total": 2678,
  "regions": [
    { "name": "Los Angeles", "surveyCount": 712, "attendCount": 24 },
    { "name": "Bay Area", "surveyCount": 647, "attendCount": 20 },
    { "name": "Southern California", "surveyCount": 442, "attendCount": 19 },
    { "name": "Sacramento Valley / Sierra Foothills", "surveyCount": 418, "attendCount": 17 },
    { "name": "Central Valley", "surveyCount": 163, "attendCount": 5 },
    { "name": "Far North / North Coast", "surveyCount": 161, "attendCount": 6 },
    { "name": "Central Coast", "surveyCount": 123, "attendCount": 8 },
    { "name": "Sierra Region", "surveyCount": 12, "attendCount": 2 },
    { "name": "(not stated)", "surveyCount": 0, "attendCount": 2 }
  ],
  "fieldOfWork": [
    { "name": "Government", "surveyCount": 424, "attendCount": 25 },
    { "name": "Other", "surveyCount": 380, "attendCount": 7 },
    { "name": "Information technology", "surveyCount": 376, "attendCount": 10 },
    { "name": "Creative", "surveyCount": 349, "attendCount": 13 },
    { "name": "Education", "surveyCount": 212, "attendCount": 8 },
    { "name": "Professional services", "surveyCount": 190, "attendCount": 9 },
    { "name": "Healthcare", "surveyCount": 184, "attendCount": 9 },
    { "name": "I don't currently work", "surveyCount": 165, "attendCount": 3 },
    { "name": "Financial", "surveyCount": 107, "attendCount": 4 },
    { "name": "Goods producing and harvesting", "surveyCount": 98, "attendCount": 5 },
    { "name": "Retail", "surveyCount": 67, "attendCount": 1 },
    { "name": "Logistics", "surveyCount": 61, "attendCount": 6 },
    { "name": "Hospitality", "surveyCount": 38, "attendCount": 0 },
    { "name": "(not stated)", "surveyCount": 0, "attendCount": 3 },
    { "name": "I don't want to say", "surveyCount": 27, "attendCount": 0 }
  ],
  "sessions": [
    { "date": "2026-07-09", "attendees": [
      { "region": "Bay Area", "fieldOfWork": "Professional services" },
      { "region": "Sierra Region", "fieldOfWork": "Government" },
      { "region": "Bay Area", "fieldOfWork": "Government" },
      { "region": "Los Angeles", "fieldOfWork": "Financial" },
      { "region": "Los Angeles", "fieldOfWork": "Healthcare" },
      { "region": "Los Angeles", "fieldOfWork": "Healthcare" }
    ]},
    { "date": "2026-07-15", "attendees": [
      { "region": "Central Coast", "fieldOfWork": "Government" },
      { "region": "Sacramento Valley / Sierra Foothills", "fieldOfWork": "Goods producing and harvesting" },
      { "region": "Southern California", "fieldOfWork": "Information technology" },
      { "region": "Los Angeles", "fieldOfWork": "Creative" },
      { "region": "Bay Area", "fieldOfWork": "Healthcare" },
      { "region": "Central Coast", "fieldOfWork": "Information technology" },
      { "region": "Sacramento Valley / Sierra Foothills", "fieldOfWork": "Other" },
      { "region": "Los Angeles", "fieldOfWork": "Other" },
      { "region": "Los Angeles", "fieldOfWork": "I don't currently work" },
      { "region": "Far North / North Coast", "fieldOfWork": "Retail" },
      { "region": "Southern California", "fieldOfWork": "Financial" },
      { "region": "(not stated)", "fieldOfWork": "(not stated)" }
    ]},
    { "date": "2026-07-16", "attendees": [
      { "region": "Central Coast", "fieldOfWork": "Other" },
      { "region": "Sacramento Valley / Sierra Foothills", "fieldOfWork": "Logistics" },
      { "region": "Southern California", "fieldOfWork": "Healthcare" },
      { "region": "Southern California", "fieldOfWork": "Professional services" },
      { "region": "Los Angeles", "fieldOfWork": "Logistics" },
      { "region": "Sacramento Valley / Sierra Foothills", "fieldOfWork": "Professional services" },
      { "region": "Central Coast", "fieldOfWork": "Government" },
      { "region": "Los Angeles", "fieldOfWork": "Creative" },
      { "region": "Los Angeles", "fieldOfWork": "Other" },
      { "region": "Southern California", "fieldOfWork": "Information technology" },
      { "region": "(not stated)", "fieldOfWork": "(not stated)" }
    ]},
    { "date": "2026-07-17", "attendees": [
      { "region": "Far North / North Coast", "fieldOfWork": "Creative" },
      { "region": "Bay Area", "fieldOfWork": "Government" },
      { "region": "Bay Area", "fieldOfWork": "Professional services" },
      { "region": "Far North / North Coast", "fieldOfWork": "Healthcare" },
      { "region": "Bay Area", "fieldOfWork": "Goods producing and harvesting" }
    ]},
    { "date": "2026-07-19", "attendees": [
      { "region": "Sacramento Valley / Sierra Foothills", "fieldOfWork": "Government" },
      { "region": "Bay Area", "fieldOfWork": "(not stated)" },
      { "region": "Bay Area", "fieldOfWork": "Education" },
      { "region": "Los Angeles", "fieldOfWork": "Other" },
      { "region": "Southern California", "fieldOfWork": "Logistics" }
    ]},
    { "date": "2026-07-20", "attendees": [
      { "region": "Sacramento Valley / Sierra Foothills", "fieldOfWork": "Government" },
      { "region": "Far North / North Coast", "fieldOfWork": "I don't currently work" },
      { "region": "Southern California", "fieldOfWork": "Education" },
      { "region": "Los Angeles", "fieldOfWork": "Healthcare" },
      { "region": "Los Angeles", "fieldOfWork": "Professional services" },
      { "region": "Central Coast", "fieldOfWork": "Healthcare" },
      { "region": "Far North / North Coast", "fieldOfWork": "Government" }
    ]},
    { "date": "2026-07-22", "attendees": [
      { "region": "Sacramento Valley / Sierra Foothills", "fieldOfWork": "Information technology" },
      { "region": "Central Coast", "fieldOfWork": "Professional services" },
      { "region": "Southern California", "fieldOfWork": "Other" },
      { "region": "Sacramento Valley / Sierra Foothills", "fieldOfWork": "Logistics" },
      { "region": "Southern California", "fieldOfWork": "Information technology" },
      { "region": "Los Angeles", "fieldOfWork": "Creative" },
      { "region": "Bay Area", "fieldOfWork": "Information technology" }
    ]},
    { "date": "2026-07-25", "attendees": [
      { "region": "Sierra Region", "fieldOfWork": "Information technology" },
      { "region": "Southern California", "fieldOfWork": "Goods producing and harvesting" },
      { "region": "Los Angeles", "fieldOfWork": "Creative" },
      { "region": "Southern California", "fieldOfWork": "Education" },
      { "region": "Los Angeles", "fieldOfWork": "Creative" }
    ]},
    { "date": "2026-07-28", "attendees": [
      { "region": "Los Angeles", "fieldOfWork": "Creative" },
      { "region": "Sacramento Valley / Sierra Foothills", "fieldOfWork": "Goods producing and harvesting" },
      { "region": "Los Angeles", "fieldOfWork": "Creative" },
      { "region": "Bay Area", "fieldOfWork": "Creative" },
      { "region": "Central Coast", "fieldOfWork": "Government" }
    ]},
    { "date": "2026-07-30", "attendees": [
      { "region": "Bay Area", "fieldOfWork": "Creative" },
      { "region": "Los Angeles", "fieldOfWork": "Other" },
      { "region": "Southern California", "fieldOfWork": "Government" },
      { "region": "Southern California", "fieldOfWork": "Healthcare" },
      { "region": "Los Angeles", "fieldOfWork": "Healthcare" },
      { "region": "Bay Area", "fieldOfWork": "Financial" },
      { "region": "Los Angeles", "fieldOfWork": "Government" },
      { "region": "Los Angeles", "fieldOfWork": "Education" },
      { "region": "Sacramento Valley / Sierra Foothills", "fieldOfWork": "Goods producing and harvesting" },
      { "region": "Los Angeles", "fieldOfWork": "Education" },
      { "region": "Central Coast", "fieldOfWork": "Information technology" },
      { "region": "Bay Area", "fieldOfWork": "Professional services" }
    ]},
    { "date": "2026-08-04", "attendees": [
      { "region": "Sacramento Valley / Sierra Foothills", "fieldOfWork": "Government" },
      { "region": "Central Valley", "fieldOfWork": "Government" },
      { "region": "Southern California", "fieldOfWork": "Logistics" },
      { "region": "Southern California", "fieldOfWork": "Government" },
      { "region": "Sacramento Valley / Sierra Foothills", "fieldOfWork": "Government" },
      { "region": "Bay Area", "fieldOfWork": "Education" },
      { "region": "Sacramento Valley / Sierra Foothills", "fieldOfWork": "Government" },
      { "region": "Southern California", "fieldOfWork": "Professional services" }
    ]},
    { "date": "2026-08-05", "attendees": [
      { "region": "Central Valley", "fieldOfWork": "Education" },
      { "region": "Central Valley", "fieldOfWork": "Education" },
      { "region": "Bay Area", "fieldOfWork": "Government" },
      { "region": "Sacramento Valley / Sierra Foothills", "fieldOfWork": "Government" },
      { "region": "Bay Area", "fieldOfWork": "Logistics" },
      { "region": "Far North / North Coast", "fieldOfWork": "Government" },
      { "region": "Southern California", "fieldOfWork": "Government" },
      { "region": "Central Valley", "fieldOfWork": "Government" }
    ]},
    { "date": "2026-08-06", "attendees": [
      { "region": "Sacramento Valley / Sierra Foothills", "fieldOfWork": "Professional services" },
      { "region": "Bay Area", "fieldOfWork": "Creative" },
      { "region": "Sacramento Valley / Sierra Foothills", "fieldOfWork": "Government" },
      { "region": "Bay Area", "fieldOfWork": "Information technology" },
      { "region": "Bay Area", "fieldOfWork": "I don't currently work" },
      { "region": "Southern California", "fieldOfWork": "Financial" },
      { "region": "Central Valley", "fieldOfWork": "Information technology" }
    ]},
    { "date": "2026-08-12", "attendees": [
      { "region": "Los Angeles", "fieldOfWork": "Creative" },
      { "region": "Sacramento Valley / Sierra Foothills", "fieldOfWork": "Government" },
      { "region": "Los Angeles", "fieldOfWork": "Government" },
      { "region": "Bay Area", "fieldOfWork": "Government" },
      { "region": "Southern California", "fieldOfWork": "Creative" }
    ]}
  ],
  "invitedByRegion": [
    { "name": "Los Angeles", "count": 245 },
    { "name": "Bay Area", "count": 201 },
    { "name": "Southern California", "count": 156 },
    { "name": "Sacramento Valley / Sierra Foothills", "count": 126 },
    { "name": "Central Valley", "count": 98 },
    { "name": "Far North / North Coast", "count": 49 },
    { "name": "Central Coast", "count": 62 },
    { "name": "Sierra Region", "count": 9 },
    { "name": "(not stated)", "count": 2 }
  ],
  "invitedTotal": 948
};

var ROOMS_DATA = {
  "meta": {
    "sampleCaveat": "14 small-group sessions (103 participants total), recruited via sortition. Too few sessions for statistical inference — read as illustrative of what these particular groups discussed, not as a poll."
  },
  "sessions": [
    { "id": "S01", "number": 1, "date": "2026-07-09", "attendees": 6, "facilitators": 1, "ideas": 10, "votes": 50, "votesPerAttendee": 8.333333333333334 },
    { "id": "S02", "number": 2, "date": "2026-07-15", "attendees": 12, "facilitators": 1, "ideas": 14, "votes": 66, "votesPerAttendee": 5.5 },
    { "id": "S03", "number": 3, "date": "2026-07-16", "attendees": 11, "facilitators": 1, "ideas": 12, "votes": 49, "votesPerAttendee": 4.454545454545454 },
    { "id": "S04", "number": 4, "date": "2026-07-17", "attendees": 5, "facilitators": 1, "ideas": 11, "votes": 30, "votesPerAttendee": 6 },
    { "id": "S05", "number": 5, "date": "2026-07-19", "attendees": 5, "facilitators": 1, "ideas": 12, "votes": 31, "votesPerAttendee": 6.2 },
    { "id": "S06", "number": 6, "date": "2026-07-20", "attendees": 7, "facilitators": 1, "ideas": 12, "votes": 44, "votesPerAttendee": 6.285714285714286 },
    { "id": "S07", "number": 7, "date": "2026-07-22", "attendees": 7, "facilitators": 1, "ideas": 13, "votes": 43, "votesPerAttendee": 6.142857142857143 },
    { "id": "S08", "number": 8, "date": "2026-07-25", "attendees": 5, "facilitators": 1, "ideas": 12, "votes": 33, "votesPerAttendee": 6.6 },
    { "id": "S09", "number": 9, "date": "2026-07-28", "attendees": 5, "facilitators": 1, "ideas": 9, "votes": 20, "votesPerAttendee": 4 },
    { "id": "S10", "number": 10, "date": "2026-07-30", "attendees": 12, "facilitators": 1, "ideas": 11, "votes": 43, "votesPerAttendee": 3.5833333333333335 },
    { "id": "S11", "number": 11, "date": "2026-08-04", "attendees": 8, "facilitators": 1, "ideas": 14, "votes": 33, "votesPerAttendee": 4.125 },
    { "id": "S12", "number": 12, "date": "2026-08-05", "attendees": 8, "facilitators": 1, "ideas": 9, "votes": 27, "votesPerAttendee": 3.375 },
    { "id": "S13", "number": 13, "date": "2026-08-06", "attendees": 7, "facilitators": 1, "ideas": 7, "votes": 20, "votesPerAttendee": 2.857142857142857 },
    { "id": "S14", "number": 14, "date": "2026-08-12", "attendees": 5, "facilitators": 1, "ideas": 11, "votes": 30, "votesPerAttendee": 6 }
  ]
};
