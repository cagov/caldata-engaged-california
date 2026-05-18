from dataclasses import dataclass
from dotenv import load_dotenv
import streamlit as st
import os
import re
import json
import pandas as pd
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime


# ---------------------------------------------------------------------------
# Session — works both inside Snowflake native apps and locally
# ---------------------------------------------------------------------------

def get_session():
    load_dotenv()  # LLM model names are stored here, optionally local Snowflake creds too
    try:
        # If running inside Snowflake
        from snowflake.snowpark.context import get_active_session
        return get_active_session()
    except Exception:
        # If running locally
        from snowflake.snowpark import Session
        return Session.builder.configs({
            "account":       os.environ["SNOWFLAKE_ACCOUNT"],
            "user":          os.environ["SNOWFLAKE_USER"],
            "authenticator": "externalbrowser",
            "role":          os.environ.get("SNOWFLAKE_ROLE", ""),
            "warehouse":     os.environ.get("SNOWFLAKE_WAREHOUSE", ""),
        }).create()


session = get_session()


# ---------------------------------------------------------------------------
# LLM model config
# ---------------------------------------------------------------------------

llm_model_high = os.environ.get("LLM_MODEL_HIGH", "")
llm_model_med  = os.environ.get("LLM_MODEL_MED",  "")
llm_model_low  = os.environ.get("LLM_MODEL_LOW",  "")

# Hardcoded AI cost formulas used to estimate analysis costs for users
# They're not exact, but they're not far off either.
COST_PER_SNOWFLAKE_CREDIT = 3.16
MODEL_CREDIT_COSTS = {
    llm_model_high: 2.55,
    llm_model_med:  0.96,
    llm_model_low:  0.25,
}
MODEL_COSTS = {m: c * COST_PER_SNOWFLAKE_CREDIT for m, c in MODEL_CREDIT_COSTS.items() if m}

LLM_TIERS = [
    (llm_model_low,  "Low",    "Fast & economical"),
    (llm_model_med,  "Medium", "Balanced"),
    (llm_model_high, "High",   "Most capable & costly"),
]


# ---------------------------------------------------------------------------
# Survey questions, prompts, and dimension config
# ---------------------------------------------------------------------------

QUESTION_COL_MAP = {
    "Economic Impact":    "ECONOMIC_IMPACT_EXPECTATION",
    "Government Action":  "GOVERNMENT_ACTION_SUGGESTION",
    "Personal AI Impact": "PERSONAL_AI_IMPACT",
}

DIMENSION_COLS = {
    "Gender":         "GENDER_CATEGORY",
    "Age":            "AGE",
    "Race/Ethnicity": "RACE_ETHNICITY_CATEGORY",
    "Field of Work":  "FIELD_OF_WORK",
    "Role at Work":   "ROLE_AT_WORK",
    "Work Status":    "CURRENT_WORK_STATUS",
    "Region":         "REGION",
    "County":         "COUNTY",
}

SYSTEM_PROMPT = (
    "You are analyzing survey responses collected by EngagedCA, an official initiative of "
    "California's Government Operations Agency and Office of Data and Innovation. "
    "EngagedCA uses deliberative democracy practices to give Californians a direct voice in "
    "state policymaking. This survey asked California residents to share their thoughts on "
    "how artificial intelligence may impact their work and lives, and what actions they "
    "believe government should take in response. Findings from these responses inform "
    "evidence-based AI policy recommendations for the State of California. "
    "Responses are separated by semicolons. "
    "Always format your response in Markdown using headers, bullet points, and bold text. "
    "Your response should be no more than 3000 words. "
    "Each response in the input is prefixed with a citation tag in the format [cite:N] where N is an integer. "
    "When you quote or closely paraphrase from a specific response, place that response's "
    "citation tag immediately after the quoted text, like: \"quoted text\" [cite:N]."
)

SYNTHESIS_SYSTEM_PROMPT = (
    "You are analyzing survey responses collected by EngagedCA, an official initiative of "
    "California's Government Operations Agency and Office of Data and Innovation. "
    "EngagedCA uses deliberative democracy practices to give Californians a direct voice in "
    "state policymaking. This survey asked California residents to share their thoughts on "
    "how artificial intelligence may impact their work and lives, and what actions they "
    "believe government should take in response. Findings from these responses inform "
    "evidence-based AI policy recommendations for the State of California. "
    "Always format your response in Markdown using headers, bullet points, and bold text. "
    "Your response should be no more than 3000 words. "
    "The sub-analyses you receive contain citation tags in the format [cite:N]. "
    "When you include a quote in your response, preserve its citation tag immediately after "
    "the quote, like: \"quoted text\" [cite:N]."
)

MAP_PROMPT = (
    "Briefly extract the 3–5 most prominent themes or perspectives from these responses. "
    "For each, write 1–2 sentences and include 1–2 representative verbatim quotes with their "
    "citation tags. Be concise — this summary will be used as input to a larger synthesis."
)


# Pre-packaged analysis prompts
PROMPTS = {
    "Thematic Analysis": (
        "Perform an open-coding analysis on these survey responses and identify 3–6 emerging themes.\n\n"
        "For each theme, use this format:\n\n"
        "#### [Theme number]. [Theme Label]\n\n"
        "*Description: [A 2–3 sentence description of the theme and who holds it]*\n\n"
        "*Representative quotes:*\n"
        "- [At least three verbatim quotes (use ellipses [...] to trim). "
        "Choose quotes that clearly illustrate the theme.]"
    ),
    "Sentiment & Balance": (
        "Analyze the overall sentiment of these responses about AI.\n\n"
        "Structure your response as:\n\n"
        "1. **Overall sentiment** — Is the general mood optimistic, concerned, or mixed? Summarize in 2–3 sentences.\n\n"
        "2. **Sources of optimism** — What positive impacts or opportunities do respondents mention? "
        "List 3–5 with supporting quotes.\n\n"
        "3. **Sources of concern** — What worries or risks do respondents highlight? "
        "List 3–5 with supporting quotes.\n\n"
        "4. **Balance** — Roughly what share of respondents seem excited vs. reticent? "
        "Support your estimate with evidence from the responses."
    ),
    "Policy Ideas": (
        "Identify 5 emerging policy ideas or government actions suggested in these responses.\n\n"
        "For each policy idea:\n\n"
        "#### [Number]. [Policy Idea Label]\n\n"
        "*Summary: [1–2 sentence description of what respondents are asking for]*\n\n"
        "*Representative quotes:*\n"
        "- [2–3 verbatim quotes illustrating this suggestion]"
    ),
    "Key Concerns": (
        "Summarize what respondents are worried or concerned about regarding AI.\n\n"
        "Organize your response as:\n\n"
        "1. **Emerging concerns** — Describe 3–5 notable worries that appear across responses. "
        "For each: a brief description and 2 representative quotes.\n\n"
        "2. **Specific harms mentioned** — List any concrete negative outcomes respondents describe.\n\n"
        "3. **Patterns** — Within this group, are there notable sub-patterns in who expresses concern "
        "(e.g., by role, work status, or other visible differences between respondents)?"
    ),
    "Hopes & Dreams": (
        "Summarize the hopes, aspirations, and positive visions respondents express about what AI "
        "itself could unlock, enable, or improve in their lives and work — not what they hope "
        "government will do about AI.\n\n"
        "Organize your response as:\n\n"
        "1. **Emerging hopes** — Describe 3–5 notable aspirations or opportunities that appear across responses. "
        "For each: a brief description and 2 representative quotes.\n\n"
        "2. **Specific opportunities mentioned** — List any concrete positive outcomes respondents envision "
        "AI enabling or improving.\n\n"
        "3. **Patterns** — Within this group, are there notable sub-patterns in who expresses hope or optimism "
        "(e.g., by role, work status, or other visible differences between respondents)?"
    ),
}


# ---------------------------------------------------------------------------
# Page config
# ---------------------------------------------------------------------------

st.set_page_config(page_title="EngagedCA — AI Impact Survey Explorer", layout="wide")

st.markdown(
    """
    <style>
    [data-testid="stMetricDelta"] svg {display: none !important;}
    </style>
    """,
    unsafe_allow_html=True,
)


# ---------------------------------------------------------------------------
# Types
# ---------------------------------------------------------------------------

@dataclass
class GroupAnalysis:
    group_value: str
    n: int
    text: str
    tokens: int


# ---------------------------------------------------------------------------
# Data loading & analysis helpers
# ---------------------------------------------------------------------------

@st.cache_data
def load_survey_data() -> pd.DataFrame:
    df = session.sql("""
        SELECT
            s.SURVEY_ID as IDEA_ID,
            s.COUNTY,
            s.FIELD_OF_WORK,
            s.CURRENT_WORK_STATUS,
            s.ROLE_AT_WORK,
            s.AVAILABILITY_FOR_DISCUSSION,
            s.ECONOMIC_IMPACT_EXPECTATION,
            s.GOVERNMENT_ACTION_SUGGESTION,
            s.PERSONAL_AI_IMPACT,
            --s.PUBLISHED_AT,
            -- s.SUBMITTED_AT,
            S.AGE,
            S.REGION,
            S.GENDER_CATEGORY,
            S.RACE_ETHNICITY_CATEGORY
        FROM ANALYTICS_ENGCA_PRD.GOVOCAL.GOVOCAL_AI_SURVEY_RESPONDENTS s
        WHERE s.PUBLICATION_STATUS = 'published'
    """).to_pandas()
    for col in ("AGE", "GENDER_CATEGORY", "RACE_ETHNICITY_CATEGORY"):
        if col in df.columns:
            # Regex to strip out parenthetical substrings that make categories more cluttered
            df[col] = df[col].str.replace(r'\s*\([^)]*\)', '', regex=True).str.strip()
    return df


def _esc(s: str) -> str:
    """Escape single quotes for safe embedding in SQL string literals."""
    return s.replace("'", "''")


def assemble_chunk_text(rows: pd.DataFrame, question_col: str, uuid_to_int: dict[str, int]) -> str:
    """Concatenates data from a column of a Dataframe into a single formatted string.

    Row ids are converted from uuid to ints to reduce tokens and context size.
    """
    parts = []
    for _, row in rows.iterrows():
        val = row.get(question_col)
        if pd.notna(val) and str(val).strip():
            n = uuid_to_int[row["IDEA_ID"]]
            parts.append(f"[cite:{n}] {str(val).strip()}")
    return "; ".join(parts)


def run_cortex_complete(assembled_text: str, model: str, user_prompt: str, synthesis: bool = False):
    """Core function that runs the AI analysis of assembled survey text.

    Both first-pass analysis on sub-groups and second-pass sythesis are supported by this function,
    based on the value of `synthesis`. The only difference is the system prompt passed to the model.
    """
    sys_prompt = SYNTHESIS_SYSTEM_PROMPT if synthesis else SYSTEM_PROMPT
    full_user = f"{user_prompt}\n\nResponses:\n{assembled_text}"
    query = f"""
    SELECT SNOWFLAKE.CORTEX.COMPLETE(
        '{_esc(model)}',
        ARRAY_CONSTRUCT(
            OBJECT_CONSTRUCT('role', 'system', 'content', '{_esc(sys_prompt)}'),
            OBJECT_CONSTRUCT('role', 'user', 'content', '{_esc(full_user)}')
        ),
        OBJECT_CONSTRUCT('temperature', 0)
    ) AS result
    """
    row = session.sql(query).to_pandas().iloc[0]
    return json.loads(row["RESULT"])


def build_synthesis_prompt(dimension_label: str, sub_results: list[GroupAnalysis], user_prompt: str) -> str:
    sub_texts = "\n\n".join(
        f"**{r.group_value}** ({r.n} responses):\n{r.text}"
        for r in sub_results
    )
    return (
        f"The following are analyses of survey responses broken down by {dimension_label}, "
        f"provided as source material. Using these, write a single response that directly answers "
        f"the original analysis question below.\n\n"
        f"Guidelines:\n"
        f"- Be selective — highlight the most representative findings, not every group\n"
        f"- Only call out differences between {dimension_label} groups when they are notable and meaningful\n"
        f"- Do not structure your response as a per-group breakdown\n"
        f"- Preserve representative quotes from the sub-analyses where they add value\n\n"
        f"Original analysis question:\n{user_prompt}\n\n"
        f"Sub-analyses by {dimension_label}:\n\n{sub_texts}"
    )


def _analyze_group(group_value: str, group_rows: pd.DataFrame, answer_col: str, uuid_to_int: dict[str, int], model: str, dimension_label: str) -> GroupAnalysis:
    """Run one map-pass LLM call for a single demographic group. Safe to call from a thread."""
    chunk_text   = assemble_chunk_text(group_rows, answer_col, uuid_to_int)
    group_prompt = (
        f"The following responses are from respondents in this group — "
        f"{dimension_label}: **{group_value}**.\n\n{MAP_PROMPT}"
    )
    result = run_cortex_complete(chunk_text, model, group_prompt)
    return GroupAnalysis(
        group_value=group_value,
        n=len(group_rows),
        text=result["choices"][0]["messages"],
        tokens=result["usage"]["total_tokens"],
    )


def collect_cited_ints(texts: list[str]) -> list[int]:
    """Return ordered list of unique integer cite IDs across all texts, in order of first appearance.
    
    This is run as a post-AI analysis step to gather comment id citations and link them to cached survey results.
    """
    seen = []
    for text in texts:
        if not text:
            continue
        for m in re.finditer(r'\[cite:(\d+)\]', text):
            n = int(m.group(1))
            if n not in seen:
                seen.append(n)
    return seen


def apply_global_citations(text: str, global_cite_map: dict[int, int]) -> str:
    """Replace [cite:N] tags with anchor-linked footnote markers using a global numbering map."""
    def replacer(m):
        n = int(m.group(1))
        fn = global_cite_map.get(n)
        if fn:
            return f'<a href="#cite-{fn}" style="text-decoration:none;">[†{fn}]</a>'
        return "[†?]"
    return re.sub(r'\[cite:(\d+)\]', replacer, text)


# ---------------------------------------------------------------------------
# Load data
# ---------------------------------------------------------------------------

try:
    df = load_survey_data()
except Exception as e:
    st.error(f"Failed to load survey data: {e}")
    st.stop()

if df.empty:
    st.warning("No published survey responses found.")
    st.stop()


# ---------------------------------------------------------------------------
# Header
# ---------------------------------------------------------------------------

st.header("EngagedCA — AI Impact Survey Explorer")
st.markdown(
    "Explore and analyze responses from California residents on AI's impact on their lives. "
    "Use the sidebar to filter by demographics, then run LLM-powered analysis on the filtered responses."
)

# TODO: these summary stats could probably be fleshed out with more informative metrics
col1, col2, col3, col4, col5 = st.columns(5)
with col1:
    st.metric("Total Responses", len(df), delta_color="off")
with col2:
    st.metric("Economic Impact Answers", df["ECONOMIC_IMPACT_EXPECTATION"].notna().sum(), delta_color="off")
with col3:
    st.metric("Government Action Answers", df["GOVERNMENT_ACTION_SUGGESTION"].notna().sum(), delta_color="off")
with col4:
    st.metric("Personal AI Impact Answers", df["PERSONAL_AI_IMPACT"].notna().sum(), delta_color="off")
with col5:
    st.metric("Counties Represented", df["COUNTY"].nunique(), delta_color="off")

st.divider()


# ---------------------------------------------------------------------------
# Sidebar filters
# ---------------------------------------------------------------------------

FILTER_COLS = {
    "Gender":                   "GENDER_CATEGORY",
    "Age":                      "AGE",
    "Race/Ethnicity":           "RACE_ETHNICITY_CATEGORY",
    "Field of Work":            "FIELD_OF_WORK",
    "Role at Work":             "ROLE_AT_WORK",
    "Work Status":              "CURRENT_WORK_STATUS",
    "Region":                   "REGION",
    "County":                   "COUNTY",
    "Available for Discussion": "AVAILABILITY_FOR_DISCUSSION",
}

with st.sidebar:
    st.header("Demographic Filters")
    st.caption("Leave blank to include all values.")
    selected_filters: dict[str, list[str]] = {}
    for label, col in FILTER_COLS.items():
        options = sorted(df[col].dropna().unique().tolist())
        selected_filters[col] = st.multiselect(label, options)

    st.divider()
    if st.button("Refresh data", type="primary", help="Reload survey responses from Snowflake"):
        load_survey_data.clear()
        st.rerun()

filtered_df = df.copy()
for col, sel in selected_filters.items():
    if sel:
        filtered_df = filtered_df[filtered_df[col].isin(sel)]

active_filter_count = sum(1 for s in selected_filters.values() if s)
if active_filter_count:
    st.sidebar.info(
        f"Showing {len(filtered_df):,} of {len(df):,} responses "
        f"({active_filter_count} filter{'s' if active_filter_count > 1 else ''} active)"
    )


# ---------------------------------------------------------------------------
# Session state
# ---------------------------------------------------------------------------

if "last_query_tokens" not in st.session_state:
    st.session_state.last_query_tokens = 0
    st.session_state.last_query_cost = 0.0


# ---------------------------------------------------------------------------
# Tabs
# ---------------------------------------------------------------------------

tab1, tab2, tab3 = st.tabs(["LLM Analysis", "Browse Responses", "Data Export"])


# ── Tab 1: LLM Analysis ──────────────────────────────────────────────────────

with tab1:
    if filtered_df.empty:
        st.warning("No responses match the current filters.")
        st.stop()

    # Question and dimension selectors
    col_q, col_dim = st.columns(2)
    with col_q:
        selected_question = st.selectbox(
            "Survey Question to Analyze",
            list(QUESTION_COL_MAP.keys()),
        )
    with col_dim:
        selected_dimension_label = st.selectbox(
            "Analyze by",
            list(DIMENSION_COLS.keys()),
        )
    answer_col = QUESTION_COL_MAP[selected_question]
    dimension_col = DIMENSION_COLS[selected_dimension_label]

    # Prompt selector
    prompt_options = list(PROMPTS.keys()) + ["Custom…"]
    selected_prompt_label = st.selectbox("Analysis prompt", prompt_options)

    if selected_prompt_label == "Custom…":
        user_prompt = st.text_area(
            "Enter your custom prompt",
            height=180,
            placeholder="Describe what you'd like the model to analyze or summarize…",
        )
    else:
        user_prompt = PROMPTS[selected_prompt_label]
        with st.expander("View prompt"):
            st.code(user_prompt, language="text")

    st.write("")

    # Model selector | response count | tips
    col_model, col_count, col_tips = st.columns([1, 1, 1])

    valid_tiers = [(m, tier, desc) for m, tier, desc in LLM_TIERS if m]

    with col_model:
        if not valid_tiers:
            st.warning("LLM models not configured. Set LLM_MODEL_LOW/MED/HIGH environment variables.")
            selected_llm = ""
        else:
            selected_llm = st.selectbox(
                "Model",
                [t[0] for t in valid_tiers],
                format_func=lambda m: next(
                    (f"{t[1]} — {t[2]}" for t in valid_tiers if t[0] == m), m
                ),
            )
        if st.session_state.last_query_tokens:
            st.info(
                f"Last query: {st.session_state.last_query_tokens:,} tokens "
                f"(${st.session_state.last_query_cost:.4f})"
            )

    # Count responses with an answer to the selected question
    has_answer = filtered_df[answer_col].notna() & (filtered_df[answer_col].str.strip() != "")
    respondents_with_answers = filtered_df[has_answer]

    with col_count:
        st.metric("Responses to analyze", len(respondents_with_answers), delta_color="off")
        if selected_llm and MODEL_COSTS.get(selected_llm):
            total_chars = respondents_with_answers[answer_col].dropna().str.len().sum()
            est_cost = (total_chars / 4 / 1_000_000) * MODEL_COSTS[selected_llm]
            st.caption(f"Input cost estimate: ~${est_cost:.4f}")

    with col_tips:
        st.markdown(
            "**Model tips:**\n"
            "- **Low** — Fastest & cheapest. Good for exploration and iteration.\n"
            "- **Medium** — Balanced quality and cost.\n"
            "- **High** — Best analysis quality; use for final outputs."
        )

    st.write("")

    # Run button
    if st.button("Run Analysis", type="primary"):
        if selected_prompt_label == "Custom…" and not user_prompt.strip():
            st.error("Enter a custom prompt before running.")
        elif not selected_llm:
            st.error("No LLM model configured.")
        elif respondents_with_answers.empty:
            st.warning("No responses match the selected question and filters.")
        else:  # Run analysis
            all_ids = respondents_with_answers["IDEA_ID"].tolist()
            uuid_to_int = {uuid: i + 1 for i, uuid in enumerate(all_ids)}
            int_to_uuid  = {v: k for k, v in uuid_to_int.items()}

            dim_series = respondents_with_answers[dimension_col].fillna("Not specified")
            groups = sorted(
                respondents_with_answers.assign(_dim=dim_series).groupby("_dim"),
                key=lambda g: -len(g[1]),
            )

            sub_results: list[GroupAnalysis] = []
            total_tokens = 0
            total_cost   = 0.0

            # Pre-filter groups to those with at least one answer
            valid_groups = [
                (str(gv), gdf[gdf[answer_col].notna() & (gdf[answer_col].str.strip() != "")])
                for gv, gdf in groups
            ]
            valid_groups = [(gv, rows) for gv, rows in valid_groups if not rows.empty]
            group_order  = [gv for gv, _ in valid_groups]

            with st.status(
                f"Analyzing {len(all_ids):,} responses across {len(valid_groups)} "
                f"{selected_dimension_label} group{'s' if len(valid_groups) != 1 else ''}…",
                expanded=True,
            ) as status:
                # All this complexity is to enable executing sub-group analysis in parallel.
                # This *substantially* speeds up execution while also keeping context manageable
                futures = {}
                with ThreadPoolExecutor(max_workers=min(len(valid_groups), 12)) as executor:
                    for group_value, group_rows in valid_groups:
                        future = executor.submit(
                            _analyze_group,
                            group_value, group_rows, answer_col, uuid_to_int,
                            selected_llm, selected_dimension_label,
                        )
                        futures[future] = group_value

                    for future in as_completed(futures):
                        group_value = futures[future]
                        try:
                            ga = future.result()
                            total_tokens += ga.tokens
                            total_cost   += (ga.tokens / 1_000_000) * MODEL_COSTS.get(selected_llm, 0)
                            sub_results.append(ga)
                            st.write(f"✓ **{ga.group_value}** ({ga.n} responses)")
                        except Exception as e:
                            st.warning(f"Analysis failed for '{group_value}': {e}")

                # Restore original group order (largest first)
                sub_results.sort(key=lambda r: group_order.index(r.group_value))

                # With first pass analysis complete, we synthesize the results into a final output.
                synthesis_text = None
                if len(sub_results) > 1:
                    st.write("Synthesizing results across groups…")
                    try:
                        synth_result   = run_cortex_complete(
                            "", selected_llm,
                            build_synthesis_prompt(selected_dimension_label, sub_results, user_prompt),
                            synthesis=True,
                        )
                        synthesis_text  = synth_result["choices"][0]["messages"]
                        tokens          = synth_result["usage"]["total_tokens"]
                        total_tokens   += tokens
                        total_cost     += (tokens / 1_000_000) * MODEL_COSTS.get(selected_llm, 0)
                    except Exception as e:
                        st.warning(f"Synthesis failed: {e}")

                status.update(label="Analysis complete", state="complete", expanded=False)

            st.session_state.last_query_tokens = total_tokens
            st.session_state.last_query_cost   = total_cost
            st.info(f"Used {total_tokens:,} tokens total — cost ${total_cost:.4f}")

            if not sub_results:
                st.warning("No analysis results returned.")
            else:  # Display results
                n_groups = len(sub_results)
                n_total  = sum(r.n for r in sub_results)

                # Build global citation map from only the text that is displayed to the user
                displayed_text  = synthesis_text if synthesis_text else sub_results[0].text
                all_cited_ints  = collect_cited_ints([displayed_text])
                global_cite_map = {n: i + 1 for i, n in enumerate(all_cited_ints)}
                total_citations = len(all_cited_ints)

                st.subheader(
                    f"Analysis of {n_total:,} responses"
                    + (f" across {n_groups} {selected_dimension_label} groups" if n_groups > 1 else "")
                )
                if total_citations:
                    st.caption(
                        f"This analysis cites {total_citations} response{'s' if total_citations != 1 else ''}. "
                        "Click any [†n] marker to jump to the source, or scroll to **Cited Responses** below."
                    )

                if synthesis_text:
                    st.markdown(apply_global_citations(synthesis_text, global_cite_map), unsafe_allow_html=True)
                else:
                    # Single group — show its analysis directly
                    if n_groups == 1:
                        st.caption(f"Only one {selected_dimension_label} group found — showing direct analysis.")
                    st.markdown(apply_global_citations(sub_results[0].text, global_cite_map), unsafe_allow_html=True)

                if total_citations:  # Generate citation HTML
                    st.divider()
                    st.markdown("**Cited Responses**")
                    st.caption(
                        "Response data is looked up independently from the AI's output. "
                        "⚠️ indicates an ID the model cited that does not exist in the dataset."
                    )
                    for fn, int_id in enumerate(all_cited_ints, 1):
                        st.markdown(f'<a id="cite-{fn}"></a>', unsafe_allow_html=True)
                        uuid  = int_to_uuid.get(int_id)
                        match = df[df["IDEA_ID"] == uuid] if uuid else pd.DataFrame()
                        if match.empty:
                            with st.expander(f"†{fn} — ⚠️ Response not found"):
                                st.warning(f"No response found for cite ID {int_id}. This citation could not be verified.")
                        else:
                            r      = match.iloc[0]
                            county = r.get("COUNTY") or "Unknown county"
                            field  = r.get("FIELD_OF_WORK") or "Unknown field"
                            with st.expander(f"†{fn} — {county} · {field}"):
                                for q_label, col in QUESTION_COL_MAP.items():
                                    val = r.get(col)
                                    if pd.notna(val) and str(val).strip():
                                        quoted = "\n> ".join(str(val).strip().splitlines())
                                        st.markdown(f"**{q_label}**\n\n> {quoted}")
                                demo_parts = [
                                    f"{lbl}: {r.get(col)}"
                                    for lbl, col in [("Work Status", "CURRENT_WORK_STATUS"), ("Role", "ROLE_AT_WORK")]
                                    if pd.notna(r.get(col)) and str(r.get(col)).strip()
                                ]
                                if demo_parts:
                                    st.caption(" · ".join(demo_parts))


# ── Tab 2: Browse Responses ──────────────────────────────────────────────────

with tab2:
    st.subheader("Browse Responses")
    st.caption(f"Showing {len(filtered_df):,} of {len(df):,} responses based on current sidebar filters.")

    display_cols = [
        "IDEA_ID",
        "REGION",
        "COUNTY",
        "GENDER_CATEGORY",
        "AGE",
        "RACE_ETHNICITY_CATEGORY",
        "FIELD_OF_WORK",
        "ROLE_AT_WORK",
        "CURRENT_WORK_STATUS",
        "AVAILABILITY_FOR_DISCUSSION",
        "ECONOMIC_IMPACT_EXPECTATION",
        "GOVERNMENT_ACTION_SUGGESTION",
        "PERSONAL_AI_IMPACT",
    ]
    available_cols = [c for c in display_cols if c in filtered_df.columns]

    st.dataframe(
        filtered_df[available_cols],
        use_container_width=True,
        hide_index=True,
        column_config={
            "REGION":                        st.column_config.TextColumn("Region"),
            "COUNTY":                        st.column_config.TextColumn("County"),
            "GENDER_CATEGORY":               st.column_config.TextColumn("Gender"),
            "AGE":                           st.column_config.TextColumn("Age"),
            "RACE_ETHNICITY_CATEGORY":       st.column_config.TextColumn("Race/Ethnicity"),
            "FIELD_OF_WORK":                 st.column_config.TextColumn("Field of Work"),
            "ROLE_AT_WORK":                  st.column_config.TextColumn("Role at Work"),
            "CURRENT_WORK_STATUS":           st.column_config.TextColumn("Work Status"),
            "AVAILABILITY_FOR_DISCUSSION":   st.column_config.TextColumn("Available for Discussion"),
            "ECONOMIC_IMPACT_EXPECTATION":   st.column_config.TextColumn("Economic Impact", width="large"),
            "GOVERNMENT_ACTION_SUGGESTION":  st.column_config.TextColumn("Government Action", width="large"),
            "PERSONAL_AI_IMPACT":            st.column_config.TextColumn("Personal AI Impact", width="large"),
        },
    )


# ── Tab 3: Data Export ───────────────────────────────────────────────────────

with tab3:
    st.subheader("Data Export")
    st.markdown(
        f"Download the filtered dataset as CSV. "
        f"**{len(filtered_df):,} records** will be exported."
    )

    if not filtered_df.empty:
        export_df = filtered_df.copy()
        csv_data = export_df.to_csv(index=False)
        filename = f"engagedca_ai_survey_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"

        st.download_button(
            label="Download CSV",
            data=csv_data,
            file_name=filename,
            mime="text/csv",
        )

        st.caption("Preview (first 10 rows):")
        st.dataframe(export_df.head(10), use_container_width=True, hide_index=True)
