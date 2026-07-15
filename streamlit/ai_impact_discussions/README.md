# Engaged California — live discussion explorer

Streamlit dashboard for ODI stakeholders to explore Engaged California phase 2 live-discussion
transcripts (Zoom speech + chat) and analyze them with Snowflake Cortex. Sibling app to
`streamlit/ai_impact_survey/` with the same philosophy — run-button LLM analyses with cost
visibility and verifiable citations — but designed for conversation data.

**Data source:** `RAW_ENGCA_DEV.TEST_DATA.STG_EVENTS` (one row per conversation turn:
session_id, source speech/chat, start_sec, end_sec, speaker, text).

## Anti-hallucination design

The methodology was validated in `notebooks/ai_impact_survey/phase_2_analysis.ipynb`:

- Every turn gets a per-session chronological integer `turn_idx` — the citation backbone.
- The AI cites turns by index (`[turn:N]`); **verbatim quote text, speakers, and timestamps are
  always resolved from the source data, never from the model's output**. Unverifiable indices
  are dropped and flagged.
- System prompts instruct the model to say so — rather than invent themes — when a session
  doesn't substantively discuss AI (some recordings are pilots/staff sessions, and real
  recordings may open with a staff-prep segment).
- Sessions that fit in one call (< ~30k chars) are analyzed whole; larger sessions use a
  map-reduce over contiguous, overlapping chunks (MAP at the Low tier).

## Features

- **Session selector** (sidebar) — switching sessions is free; stats are pure pandas.
- **Analyze session** — one structured Cortex analysis per session (overview, what to protect,
  government actions, general themes, tension, consensus, deliberative moments), cached for the
  browser session with token/cost provenance.
- **Session summary tab** — theme cards with expandable verbatim supporting turns.
- **Transcript tab** — full transcript under a fold, paginated (100 turns/page), speakers
  color-coded, chat vs speech visually distinguished, turns badged with the themes they support.
- **Quote search tab** — topic queries return index-verified verbatim quotes with the model's
  relevance rationale.
- **Custom analysis tab** — pre-baked prompts (What to protect / Government actions /
  Deliberative moments) or a custom prompt, model tier selector, pre-run cost estimate,
  `[turn:N]` citations linked to verbatim cited-turn cards, per-session run history.
- **Data export tab** — transcript CSV, structured summary JSON, and a theme-review CSV
  (themes + verbatim quotes) for human verification.

Summary text contains no speaker names by design (turn-index references only); speaker names
do appear in transcript/quote views for internal review.

## Local dev

```bash
uv sync --group streamlit
cp streamlit/ai_impact_discussions/.env.example streamlit/ai_impact_discussions/.env
# fill in .env with Snowflake creds and LLM model names
uv run --group streamlit streamlit run streamlit/ai_impact_discussions/streamlit_app.py
```

Required env vars: `SNOWFLAKE_ACCOUNT`, `SNOWFLAKE_USER`, `SNOWFLAKE_ROLE`,
`SNOWFLAKE_WAREHOUSE`, `LLM_MODEL_LOW`, `LLM_MODEL_MED`, `LLM_MODEL_HIGH`.
Validated models: `LLM_MODEL_LOW=openai-gpt-5-mini`, `LLM_MODEL_MED=claude-4-sonnet`.

Optional: `MAX_CHARS_PER_LLM_CALL`-style tuning via `MAX_CHARS_PER_CHUNK` (default 30000).

## Snowflake native app packaging

`environment.yml` pins dependencies for the Snowflake app runtime (Python 3.11, pandas 2.2.3,
snowflake-snowpark-python, streamlit). The app detects the runtime context: inside Snowflake it
uses `get_active_session()`; locally it builds a session from env vars with `externalbrowser`
auth.

## Future directions

- Cross-session aggregation/comparison (all caches are keyed by `session_id` to enable this).
- Pre-processing summaries via dbt + scheduled AI runs instead of on-demand computation.
- Per-session "does this substantively discuss AI?" pre-classification to label pilot sessions.
