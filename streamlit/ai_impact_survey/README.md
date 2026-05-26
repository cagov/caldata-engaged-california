# EngagedCA — AI Impact Survey Explorer

A Streamlit app that enables ODI stakeholders to explore and analyze open-ended survey responses from California residents about AI's impact on their work and lives. It runs both locally and as a Snowflake native app, using Snowflake Cortex for LLM-powered analysis.

Survey data is read from `ANALYTICS_ENGCA_PRD.GOVOCAL.GOVOCAL_AI_SURVEY_RESPONDENTS`.

## Features

### LLM Analysis tab
- Select one of three survey questions to analyze: Economic Impact, Government Action, or Personal AI Impact
- Choose a demographic dimension to break analysis down by (Gender, Age, Race/Ethnicity, Field of Work, Role at Work, Work Status, Region, or County)
- Run one of five built-in analysis prompts or write a custom prompt:
  - **Thematic Analysis** — open-coding to identify 3–6 emerging themes
  - **Sentiment & Balance** — overall mood, sources of optimism and concern, and rough excited/reticent split
  - **Policy Ideas** — top 5 emerging policy ideas or government actions suggested
  - **Key Concerns** — notable worries and specific harms mentioned
  - **Hopes & Dreams** — aspirations and positive visions respondents express
- Analysis uses a map-reduce approach: parallel per-group LLM calls followed by a synthesis pass
- Results include inline citation markers (`[†n]`) linked to the source responses
- Cited responses are shown in expandable cards below the analysis with full response text and demographics
- Three model tiers (Low / Medium / High) with cost estimates before and after running

### Browse Responses tab
- Paginated table of all filtered responses with columns for Region, County, Field of Work, Role at Work, Work Status, and all three open-ended answers

### Data Export tab
- Download the current filtered dataset as a CSV

### Sidebar filters
Filter responses by: Gender, Age, Race/Ethnicity, Field of Work, Role at Work, Work Status, Region, County, and Availability for Discussion. Active filter count and match count are shown in the sidebar.

## Local development setup

1. Install [uv](https://docs.astral.sh/uv/getting-started/installation/) if you haven't already.
2. From the repo root, install dependencies:
   ```
   uv sync --group streamlit
   ```
3. Copy `.env.example` to `.env` and fill in your Snowflake credentials:
   ```
   cp streamlit/ai_impact_survey/.env.example streamlit/ai_impact_survey/.env
   ```
4. Run the app from the repo root:
   ```
   uv run --group streamlit streamlit run streamlit/ai_impact_survey/streamlit_app.py
   ```

### Required environment variables

| Variable | Description |
|---|---|
| `SNOWFLAKE_ACCOUNT` | Snowflake account identifier |
| `SNOWFLAKE_USER` | Your Snowflake username |
| `SNOWFLAKE_ROLE` | Role with read access to `ANALYTICS_ENGCA_PRD` |
| `SNOWFLAKE_WAREHOUSE` | Warehouse to use for queries |
| `LLM_MODEL_LOW` | Cortex model name for the Low tier |
| `LLM_MODEL_MED` | Cortex model name for the Medium tier |
| `LLM_MODEL_HIGH` | Cortex model name for the High tier |
