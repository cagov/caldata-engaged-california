# Engaged California — pull quote explorer

Streamlit dashboard for ODI staff to find representative participant quotes from the
Engaged California phase 2 discussion sessions, organized by the 29 manually-curated
themes that emerged across the 14 sessions. All theme tags are pre-computed by the dbt
pipeline — the app reads tables only and makes **zero live Cortex calls**.

**Data sources (all built by dbt):**

- `phase2_transcript_curated_theme_tags` — the tagged quotes: one row per (session,
  theme, tagged turn) with verbatim text/speaker/timestamps, plus a status row per
  (session, theme) pair. Built from the `curated_discussion_themes` seed.
- `phase2_zoom_transcripts_and_chats` — the full transcripts, used for the
  click-to-expand context around each quote.
- `phase2_sessions` — session numbering/dates for labels.
- `phase2_speaker_ai_survey` — speaker demographics shown on quote cards.

Point the app at these via `DISCUSSIONS_DATABASE` / `DISCUSSIONS_SCHEMA` (see
`.env.example` — same variable names as the `ai_impact_discussions` app, so one local
`.env` serves both).

## Features

- **All themes × all sessions by default**, with sidebar filters for theme, session,
  speaker, and source (speech vs chat). Empty filters mean "show everything".
- **Theme-frequency heatmap** (themes × sessions) at the top that reacts to every
  filter, with a table view and a filtered-quotes CSV download.
- **Quotes grouped by theme** — one expandable section per theme, quotes in
  chronological order, paginated. A turn tagged with multiple themes appears under
  each of them, with "also tagged" pills.
- **Click-to-expand context** — "⋯ show 3 earlier/later turn(s)" buttons above and
  below each quote reveal the surrounding transcript 3 turns at a time. Context turns
  render dimmed so the tagged turn stays visually primary.
- **Anti-hallucination by construction** — the tagging model only ever returns turn
  indices; verbatim text, speakers, and timestamps are resolved from the source data
  in dbt, and each tag is stored against the turn's stable `turn_hash`. The app resolves
  hashes to the current transcript on load, flags sessions whose transcript changed
  since tagging, and hides (with a warning) any tag that no longer resolves.
  Facilitator/staff turns are excluded upstream.
- **PII gate** — the dashboard shows speaker names and demographics; users must
  acknowledge the PII notice before anything renders.

## Running locally

```bash
uv sync --group streamlit
cp streamlit/ai_impact_discussions_quote_explorer/.env.example streamlit/ai_impact_discussions_quote_explorer/.env  # then fill it in
uv run --group streamlit streamlit run streamlit/ai_impact_discussions_quote_explorer/streamlit_app.py
```

Uses `externalbrowser` (SSO) auth locally; inside Snowflake it picks up the active
session automatically.

## Deployment

**Deployment is a manual Snowsight upload — no CI deploys this app.** Create/update the
Streamlit app in Snowsight from `streamlit_app.py` + `environment.yml`, same as the
other apps in this repo.
