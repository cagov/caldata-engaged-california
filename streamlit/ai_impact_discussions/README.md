# Engaged California — live discussion explorer

Streamlit dashboard for ODI stakeholders to explore Engaged California phase 2 live-discussion
transcripts (Zoom speech + chat). Themes and supporting quotes are pre-computed by the dbt
tagging pipeline and read straight from tables, so the app loads instantly and incurs no LLM
cost for the core views. Two on-demand tabs (Quote search, Custom analysis) still call Snowflake
Cortex live for ad-hoc questions.

**Data source (all built by dbt):**

- `phase2_zoom_transcripts_and_chats` — one row per conversation turn (session_id, source
  speech/chat, start_sec, end_sec, speaker, text, and the per-session `turn_idx`).
- `phase2_transcript_session_summaries` — the pre-tagged themes: one row per (session, section,
  theme), plus an overview row per session, with validated `supporting_turn_idxs`.

Point the app at these via `DISCUSSIONS_DATABASE` / `DISCUSSIONS_SCHEMA` (see `.env.example`).

## Anti-hallucination design

The methodology was validated in `notebooks/ai_impact_survey/phase_2_analysis.ipynb` and now
lives in the dbt models:

- Every turn has a per-session chronological integer `turn_idx` — the citation backbone.
- The AI cites turns by index (`[turn:N]`); **verbatim quote text, speakers, and timestamps are
  always resolved from the source data, never from the model's output**. The dbt model drops
  unverifiable indices before the app ever sees them.
- System prompts instruct the model to say so — rather than invent themes — when a session
  doesn't substantively discuss AI (some recordings are pilots/staff sessions, and real
  recordings may open with a staff-prep segment).

## Features

- **Session selector** (sidebar) — switching sessions is free; everything is pre-computed.
- **Session summary tab** — pre-tagged theme cards (overview, what to protect, government
  actions, general themes, tension, consensus, deliberative moments) with expandable verbatim
  supporting turns. A caption shows which model tagged the session and when.
- **Transcript tab** — full transcript under a fold, paginated (100 turns/page), speakers
  color-coded, chat vs speech visually distinguished, turns badged with the themes they support.
- **Quote search tab** *(live Cortex)* — topic queries return index-verified verbatim quotes
  with the model's relevance rationale.
- **Custom analysis tab** *(live Cortex)* — pre-baked prompts (What to protect / Government
  actions / Deliberative moments) or a custom prompt, model tier selector, pre-run cost estimate,
  `[turn:N]` citations linked to verbatim cited-turn cards, per-session run history.
- **Data export tab** — transcript CSV, structured summary JSON, and a theme-review CSV
  (themes + verbatim quotes) for human verification.

Summary text contains no speaker names by design (turn-index references only); speaker names
do appear in transcript/quote views for internal review.

## Local dev

```bash
uv sync --group streamlit
cp streamlit/ai_impact_discussions/.env.example streamlit/ai_impact_discussions/.env
# fill in .env with Snowflake creds, the DISCUSSIONS_* table location, and LLM model names
uv run --group streamlit streamlit run streamlit/ai_impact_discussions/streamlit_app.py
```

Required env vars: `SNOWFLAKE_ACCOUNT`, `SNOWFLAKE_USER`, `SNOWFLAKE_ROLE`,
`SNOWFLAKE_WAREHOUSE`, `DISCUSSIONS_DATABASE`, `DISCUSSIONS_SCHEMA`. The `LLM_MODEL_*` vars are
only needed for the Quote search and Custom analysis tabs (validated:
`LLM_MODEL_LOW=[check EngagedCA Developer Page]`, `LLM_MODEL_MED=[check EngagedCA Developer Page]`).

Optional: `MAX_CHARS_PER_CHUNK` (default 30000) tunes chunking for the on-demand analysis tabs.

The pre-tagged tables come from the dbt project in `transform/` — build them with
`dbt build --select +phase2_transcript_turn_tags`.

## Snowflake native app packaging

`environment.yml` pins dependencies for the Snowflake app runtime (Python 3.11, pandas 2.2.3,
snowflake-snowpark-python, streamlit). The app detects the runtime context: inside Snowflake it
uses `get_active_session()`; locally it builds a session from env vars with `externalbrowser`
auth.

## Future directions

- Cross-session aggregation/comparison (the pre-tagged tables make this a straight query).
- Per-session "does this substantively discuss AI?" pre-classification to label pilot sessions.
