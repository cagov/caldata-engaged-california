from dataclasses import dataclass
from dotenv import load_dotenv
from pathlib import Path
import streamlit as st
import plotly.express as px
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

MAX_CHARS_PER_LLM_CALL = int(os.environ.get("MAX_CHARS_PER_LLM_CALL", "200000"))

LLM_TIERS = [
    (llm_model_low,  "Low",    "Fast & economical"),
    (llm_model_med,  "Medium", "Balanced"),
    (llm_model_high, "High",   "Most capable & costly"),
]


# ---------------------------------------------------------------------------
# Survey questions, prompts, and dimension config
# ---------------------------------------------------------------------------

QUESTION_COL_MAP = {
    "Personal AI impact": "PERSONAL_AI_IMPACT",
    "Economic impact":    "ECONOMIC_IMPACT_EXPECTATION",
    "Government action":  "GOVERNMENT_ACTION_SUGGESTION",
}

QUESTION_TEXT = {
    "Personal AI impact": "How has AI impacted your job and workplace, if at all?",
    "Economic impact":    "How do you expect AI to impact the economy?",
    "Government action":  "What do you think the government should do about these impacts?",
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
    "You are analyzing survey responses collected by Engaged California, an official initiative of "
    "California's Government Operations Agency and Office of Data and Innovation. "
    "Engaged California uses deliberative democracy practices to give Californians a direct voice in "
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
    "You are analyzing survey responses collected by Engaged California, an official initiative of "
    "California's Government Operations Agency and Office of Data and Innovation. "
    "Engaged California uses deliberative democracy practices to give Californians a direct voice in "
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

st.set_page_config(page_title="Engaged California — AI impact survey explorer", layout="wide")

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
    num_chunks: int = 1


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
    mask = rows[question_col].notna() & (rows[question_col].str.strip() != "")
    filtered = rows[mask]
    if filtered.empty:
        return ""
    cite_ids = filtered["IDEA_ID"].map(uuid_to_int)
    parts = "[cite:" + cite_ids.astype(str) + "] " + filtered[question_col].str.strip()
    return "; ".join(parts)


def chunk_rows(rows: pd.DataFrame, answer_col: str, max_chars: int) -> list[pd.DataFrame]:
    """Split rows into DataFrames where each chunk's assembled answer text stays under max_chars."""
    valid = rows[rows[answer_col].notna() & (rows[answer_col].str.strip() != "")]
    chunks: list[pd.DataFrame] = []
    current: list = []
    current_len = 0
    for idx, row in valid.iterrows():
        entry_len = len(str(row[answer_col]).strip()) + 15  # cite tag + separator overhead
        if current and current_len + entry_len > max_chars:
            chunks.append(valid.loc[current])
            current, current_len = [idx], entry_len
        else:
            current.append(idx)
            current_len += entry_len
    if current:
        chunks.append(valid.loc[current])
    return chunks


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


def build_synthesis_prompt(
    dimension_label: str | None,
    sub_results: list[GroupAnalysis],
    user_prompt: str,
    theme_citation_map: dict[str, set[int]] | None = None,
    total_n: int = 0,
) -> str:
    counts_block = format_theme_counts_block(theme_citation_map, total_n) if theme_citation_map else ""
    counts_section = f"\n\n{counts_block}\n" if counts_block else ""

    if dimension_label:
        sub_texts = "\n\n".join(
            f"**{r.group_value}** ({r.n} responses):\n{r.text}"
            for r in sub_results
        )
        return (
            f"The following are analyses of survey responses broken down by {dimension_label}, "
            f"provided as source material. Using these, write a single response that directly answers "
            f"the original analysis question below.\n\n"
            f"Guidelines:\n"
            f"- **Lead with differences**: If notable differences exist between {dimension_label} groups, present those first — they are more analytically valuable than shared observations. Name the specific groups involved.\n"
            f"- **Then cover universal themes**: After any notable differences, summarize perspectives or concerns that appear consistently across groups.\n"
            f"- Do not produce a mechanical group-by-group breakdown, but do name specific groups whenever their responses stand out.\n"
            f"- Preserve representative quotes from the sub-analyses where they add value.\n"
            f"- **Use exact counts**: When describing theme prevalence, use the quantitative counts provided below — do not use qualitative language like 'many' or 'some'."
            f"{counts_section}"
            f"Original analysis question:\n{user_prompt}\n\n"
            f"Sub-analyses by {dimension_label}:\n\n{sub_texts}"
        )
    else:
        sub_texts = "\n\n".join(
            f"Batch {i+1} ({r.n} responses):\n{r.text}"
            for i, r in enumerate(sub_results)
        )
        return (
            f"The following are analyses of batches of survey responses. Using these, write a single "
            f"response that directly answers the original analysis question below.\n\n"
            f"Guidelines:\n"
            f"- Be selective — highlight the most representative findings, not every batch\n"
            f"- Do not structure your response as a per-batch breakdown\n"
            f"- Preserve representative quotes where they add value\n"
            f"- **Use exact counts**: When describing theme prevalence, use the quantitative counts provided below — do not use qualitative language like 'many' or 'some'."
            f"{counts_section}"
            f"Original analysis question:\n{user_prompt}\n\n"
            f"Batch analyses:\n\n{sub_texts}"
        )


def build_intra_group_synthesis_prompt(group_value: str, dimension_label: str, chunk_summaries: list[str]) -> str:
    """Combine multiple chunk summaries for a single demographic group into a compact MAP-style output."""
    parts = "\n\n".join(f"Batch {i+1}:\n{s}" for i, s in enumerate(chunk_summaries))
    return (
        f"The following are theme extractions from separate batches of responses from "
        f"{dimension_label}: **{group_value}**. Merge them into a single compact summary — "
        f"the 3–5 most prominent themes with 1–2 sentence descriptions and 1–2 verbatim quotes each. "
        f"Preserve all citation tags. This will be used as input to a larger synthesis.\n\n{parts}"
    )


def _analyze_group(group_value: str, group_rows: pd.DataFrame, answer_col: str, uuid_to_int: dict[str, int], model: str, dimension_label: str) -> GroupAnalysis:
    """Run MAP-pass LLM analysis for one demographic group, with dynamic intra-group chunking. Safe to call from a thread."""
    chunks = chunk_rows(group_rows, answer_col, MAX_CHARS_PER_LLM_CALL)
    if not chunks:
        return GroupAnalysis(group_value=group_value, n=len(group_rows), text="", tokens=0)

    if len(chunks) == 1:
        chunk_text   = assemble_chunk_text(chunks[0], answer_col, uuid_to_int)
        group_prompt = (
            f"The following responses are from respondents in this group — "
            f"{dimension_label}: **{group_value}**.\n\n{MAP_PROMPT} "
            f"If any themes or perspectives seem distinctive to this group specifically, "
            f"flag them clearly — this will help identify meaningful differences across groups in a later synthesis step."
        )
        result = run_cortex_complete(chunk_text, model, group_prompt)
        return GroupAnalysis(
            group_value=group_value,
            n=len(group_rows),
            text=result["choices"][0]["messages"],
            tokens=result["usage"]["total_tokens"],
            num_chunks=1,
        )

    # Multiple chunks: MAP each in parallel, then synthesize into a compact group summary
    total_tokens = 0
    chunk_summaries: list[str | None] = [None] * len(chunks)

    def _map_chunk(idx: int, chunk_df: pd.DataFrame) -> tuple[int, str, int]:
        text   = assemble_chunk_text(chunk_df, answer_col, uuid_to_int)
        prompt = f"Batch {idx+1} of {len(chunks)} from {dimension_label}: **{group_value}**.\n\n{MAP_PROMPT}"
        r      = run_cortex_complete(text, model, prompt)
        return idx, r["choices"][0]["messages"], r["usage"]["total_tokens"]

    with ThreadPoolExecutor(max_workers=min(len(chunks), 12)) as executor:
        futures = {executor.submit(_map_chunk, i, chunk): i for i, chunk in enumerate(chunks)}
        for future in as_completed(futures):
            idx, summary, tokens = future.result()
            chunk_summaries[idx]  = summary
            total_tokens         += tokens

    synth_result  = run_cortex_complete(
        "", model, build_intra_group_synthesis_prompt(group_value, dimension_label, [s for s in chunk_summaries if s is not None])
    )
    total_tokens += synth_result["usage"]["total_tokens"]
    return GroupAnalysis(
        group_value=group_value,
        n=len(group_rows),
        text=synth_result["choices"][0]["messages"],
        tokens=total_tokens,
        num_chunks=len(chunks),
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


_CITE_ASSIGNMENT_RE = re.compile(r'\[cite:(\d+)\]:\s*(.+)')

CLASSIFICATION_BATCH_SIZE = int(os.environ.get("CLASSIFICATION_BATCH_SIZE", "25"))


def parse_classification_output(text: str) -> dict[str, set[int]]:
    """Parse classification call output (one line per response) → {theme: {ids}}."""
    theme_citations: dict[str, set[int]] = {}
    for m in _CITE_ASSIGNMENT_RE.finditer(text):
        cite_id = int(m.group(1))
        for label in m.group(2).split(','):
            label = label.strip()
            if label and label.lower() != 'none':
                theme_citations.setdefault(label, set()).add(cite_id)
    return theme_citations


def extract_canonical_themes(map_summaries: list[str], model: str) -> list[str]:
    """Single LLM call: extract 3–6 canonical theme labels from MAP summaries."""
    combined = "\n\n---\n\n".join(map_summaries)
    prompt = (
        "The following are thematic summaries of survey responses. "
        "Extract a consolidated list of 3–6 top themes across all summaries. "
        "Output only the theme labels, one per line, no numbering or descriptions. "
        "Use concise 2–5 word labels."
    )
    result = run_cortex_complete(combined, model, prompt, synthesis=True)
    lines = result["choices"][0]["messages"].strip().splitlines()
    return [ln.strip().lstrip("-•*0123456789. ") for ln in lines if ln.strip()]


def run_classification_pass(
    rows: pd.DataFrame,
    answer_col: str,
    uuid_to_int: dict[str, int],
    themes: list[str],
    model: str,
) -> dict[str, set[int]]:
    """Classify all responses into themes using small parallelised batches. Returns {theme: {ids}}."""
    valid = rows[rows[answer_col].notna() & (rows[answer_col].str.strip() != "")]
    indices = list(valid.index)
    batches = [
        valid.loc[indices[i:i + CLASSIFICATION_BATCH_SIZE]]
        for i in range(0, len(indices), CLASSIFICATION_BATCH_SIZE)
    ]
    theme_list = "\n".join(f"- {t}" for t in themes)
    all_maps: list[dict[str, set[int]]] = [{}] * len(batches)

    def _classify_one(batch: pd.DataFrame) -> dict[str, set[int]]:
        chunk_text = assemble_chunk_text(batch, answer_col, uuid_to_int)
        prompt = (
            f"Classify each survey response below against these themes:\n{theme_list}\n\n"
            f"Output one line per response: [cite:N]: Theme Label\n"
            f"A response may match multiple themes — separate with commas.\n"
            f"If a response doesn't fit any theme: [cite:N]: none\n"
            f"Use the exact theme labels listed above."
        )
        result = run_cortex_complete(chunk_text, model, prompt)
        return parse_classification_output(result["choices"][0]["messages"])

    with ThreadPoolExecutor(max_workers=12) as executor:
        futures = {executor.submit(_classify_one, batch): i for i, batch in enumerate(batches)}
        for future in as_completed(futures):
            i = futures[future]
            try:
                all_maps[i] = future.result()
            except Exception:
                pass
    return merge_theme_citation_maps(all_maps)


def merge_theme_citation_maps(maps: list[dict[str, set[int]]]) -> dict[str, set[int]]:
    """Merge per-chunk citation maps, combining ID sets for same-named themes."""
    merged: dict[str, set[int]] = {}
    for m in maps:
        for label, ids in m.items():
            merged.setdefault(label, set()).update(ids)
    return merged


def format_theme_counts_block(theme_citation_map: dict[str, set[int]], total_n: int) -> str:
    """Format theme citation counts into a prompt-injectable block for use by the synthesis LLM."""
    if not theme_citation_map or total_n == 0:
        return ""
    lines = [
        f"Quantitative theme counts — computed from citation IDs, exact. "
        f"Use these for any numeric claims; do not use qualitative language like 'many' or 'some'.",
        f"Total responses in this analysis: {total_n}",
    ]
    for label, ids in sorted(theme_citation_map.items(), key=lambda x: -len(x[1])):
        n = len(ids)
        pct = round(n / total_n * 100)
        lines.append(f"- {label}: {n} of {total_n} responses ({pct}%)")
    return "\n".join(lines)


CHART_HEIGHT = 350
PALETTE = px.colors.qualitative.Plotly


def render_demographics_section(df: pd.DataFrame) -> None:
    BAR_DIMS = [
        ("AGE",                     "Age"),
        ("REGION",                  "Region"),
        ("GENDER_CATEGORY",         "Gender"),
        ("RACE_ETHNICITY_CATEGORY", "Race / Ethnicity"),
        ("CURRENT_WORK_STATUS",     "Work Status"),
        ("FIELD_OF_WORK",           "Field of Work"),
        ("ROLE_AT_WORK",            "Role at Work"),
    ]
    with st.expander("Respondent demographics"):
        # California county choropleth
        geojson_path = Path(__file__).parent / "california_counties.geojson"
        with open(geojson_path) as f:
            ca_geojson = json.load(f)

        county_counts = (
            df[df["COUNTY"].str.contains("County")]["COUNTY"]
            .value_counts().reset_index()
        )
        county_counts.columns = ["COUNTY", "Count"]
        county_counts["NAME"] = county_counts["COUNTY"].str.replace(" County", "")
        total_county = county_counts["Count"].sum()
        county_counts["% of Respondents"] = (
            (county_counts["Count"] / total_county * 100).round(1).astype(str) + "%"
        )

        fig_map = px.choropleth_map(
            county_counts,
            geojson=ca_geojson,
            locations="NAME",
            featureidkey="properties.NAME",
            color="Count",
            color_continuous_scale="Blues",
            hover_name="COUNTY",
            hover_data={"NAME": False, "Count": True, "% of Respondents": True},
            # map_style="white-bg",
            center={"lat": 37.5, "lon": -119.5},
            zoom=5,
            title="Geographic distribution of responses",
        )
        fig_map.update_layout(margin=dict(l=0, r=0, t=40, b=0), height=800, title_font_size=14)
        st.plotly_chart(fig_map, use_container_width=True)

        col_a, col_b = st.columns(2)
        for i, (col, label) in enumerate(BAR_DIMS):
            counts = df[col].dropna().value_counts().reset_index()
            counts.columns = [label, "Count"]
            total = counts["Count"].sum()
            counts["Pct"] = (counts["Count"] / total * 100).round(1).astype(str) + "%"
            fig = px.bar(
                counts, x="Count", y=label, orientation="h",
                title=label, height=CHART_HEIGHT,
                text="Count",
                custom_data=["Pct"],
                color_discrete_sequence=[PALETTE[i % len(PALETTE)]],
            )
            fig.update_traces(
                textposition="inside",
                textfont=dict(size=11, color="white"),
                hovertemplate="<b>%{y}</b><br>%{customdata[0]} of respondents<extra></extra>",
            )
            fig.update_layout(
                margin=dict(l=0, r=20, t=40, b=0),
                yaxis=dict(categoryorder="total ascending"),
                title_font_size=14,
                showlegend=False,
            )
            (col_a if i % 2 == 0 else col_b).plotly_chart(fig, use_container_width=True)


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

st.header("Engaged California — AI impact survey explorer")
st.markdown(
    "Explore and analyze responses from California residents on AI's impact on their lives. "
    "Use the sidebar to filter by demographics, then run LLM-powered analysis on the filtered responses."
)

# TODO: these summary stats could probably be fleshed out with more informative metrics
col1, col2, col3, col4, col5 = st.columns(5)
with col1:
    st.metric("Total responses", len(df), delta_color="off")
with col2:
    st.metric("Personal AI impact answers", df["PERSONAL_AI_IMPACT"].notna().sum(), delta_color="off")
with col3:
    st.metric("Economic impact answers", df["ECONOMIC_IMPACT_EXPECTATION"].notna().sum(), delta_color="off")
with col4:
    st.metric("Government action answers", df["GOVERNMENT_ACTION_SUGGESTION"].notna().sum(), delta_color="off")
with col5:
    # Don't county any response that doesn't have "County" in it
    st.metric("Counties represented", df["COUNTY"].dropna()[df["COUNTY"].dropna().str.contains("County")].nunique(), delta_color="off")

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
    st.header("Demographic filters")
    st.caption("Leave blank to include all values.")
    selected_filters: dict[str, list[str]] = {}
    for label, col in FILTER_COLS.items():
        options = sorted(df[col].dropna().unique().tolist())
        default = [v for v in options if "County" in v] if col == "COUNTY" else []
        selected_filters[col] = st.multiselect(label, options, default=default)

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

render_demographics_section(filtered_df)


# ---------------------------------------------------------------------------
# Tabs
# ---------------------------------------------------------------------------

tab1, tab2, tab3 = st.tabs(["LLM analysis", "Browse responses", "Data export"])


# ── Tab 1: LLM Analysis ──────────────────────────────────────────────────────

with tab1:
    if filtered_df.empty:
        st.warning("No responses match the current filters.")
        st.stop()

    selected_question = st.selectbox(
        "Survey question to analyze *",
        list(QUESTION_COL_MAP.keys()),
    )
    st.caption(f"_{QUESTION_TEXT[selected_question]}_")
    selected_dimension_label = st.selectbox(
        "Analyze by",
        [None] + list(DIMENSION_COLS.keys()),
        format_func=lambda x: "None — synthesize across all groups" if x is None else x,
        help="Choose a demographic dimension to break down the analysis, or leave as None for a holistic view.",
    )
    answer_col    = QUESTION_COL_MAP[selected_question]
    dimension_col = DIMENSION_COLS[selected_dimension_label] if selected_dimension_label else None

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

    quantitative_mode = st.checkbox(
        "Include quantitative counts",
        value=True,
        help=(
            "Runs a small-batch classification pass after the main analysis to count exactly "
            "how many responses support each theme. Adds ~15–30 seconds and a small amount of "
            "additional cost. Only active when analysis requires multiple batches."
        ),
    )

    # Run button
    if st.button("Run analysis", type="primary"):
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

            sub_results: list[GroupAnalysis] = []
            total_tokens = 0
            total_cost   = 0.0
            synthesis_text = None

            if selected_dimension_label is None:
                # ── Holistic: no demographic breakdown ──────────────────────────
                chunks = chunk_rows(respondents_with_answers, answer_col, MAX_CHARS_PER_LLM_CALL)

                if len(chunks) == 1:
                    with st.status(f"Analyzing {len(respondents_with_answers):,} responses…", expanded=True) as status:
                        all_text = assemble_chunk_text(respondents_with_answers, answer_col, uuid_to_int)
                        result   = run_cortex_complete(all_text, selected_llm, user_prompt)
                        status.update(label="Analysis complete", state="complete", expanded=False)
                    sub_results  = [GroupAnalysis(
                        group_value="",
                        n=len(respondents_with_answers),
                        text=result["choices"][0]["messages"],
                        tokens=result["usage"]["total_tokens"],
                    )]
                    total_tokens = sub_results[0].tokens
                    total_cost   = (total_tokens / 1_000_000) * MODEL_COSTS.get(selected_llm, 0)

                else:
                    with st.status(
                        f"Analyzing {len(respondents_with_answers):,} responses in {len(chunks)} batches…",
                        expanded=True,
                    ) as status:
                        batch_results: list[GroupAnalysis | None] = [None] * len(chunks)

                        def _map_holistic_chunk(idx: int, chunk_df: pd.DataFrame) -> tuple[int, str, int]:
                            text   = assemble_chunk_text(chunk_df, answer_col, uuid_to_int)
                            prompt = f"Batch {idx+1} of {len(chunks)}.\n\n{MAP_PROMPT}"
                            r      = run_cortex_complete(text, selected_llm, prompt)
                            return idx, r["choices"][0]["messages"], r["usage"]["total_tokens"]

                        with ThreadPoolExecutor(max_workers=min(len(chunks), 12)) as executor:
                            futures = {executor.submit(_map_holistic_chunk, i, chunk): i for i, chunk in enumerate(chunks)}
                            for future in as_completed(futures):
                                idx, text, tokens = future.result()
                                batch_results[idx] = GroupAnalysis(
                                    group_value=f"Batch {idx+1}",
                                    n=len(chunks[idx]),
                                    text=text,
                                    tokens=tokens,
                                )
                                total_tokens += tokens
                                total_cost   += (tokens / 1_000_000) * MODEL_COSTS.get(selected_llm, 0)
                                st.write(f"✓ Batch {idx+1} ({len(chunks[idx]):,} responses)")

                        sub_results = [r for r in batch_results if r is not None]

                        counts_map: dict[str, set[int]] = {}
                        if quantitative_mode and sub_results:
                            st.write("Extracting themes for quantitative counts…")
                            themes = extract_canonical_themes([r.text for r in sub_results], selected_llm)
                            st.write(f"Classifying {len(respondents_with_answers):,} responses across {len(themes)} themes…")
                            counts_map = run_classification_pass(respondents_with_answers, answer_col, uuid_to_int, themes, selected_llm)

                        st.write("Synthesizing batches…")
                        try:
                            synth_result   = run_cortex_complete(
                                "", selected_llm,
                                build_synthesis_prompt(None, sub_results, user_prompt, counts_map or None, len(respondents_with_answers)),
                                synthesis=True,
                            )
                            synthesis_text = synth_result["choices"][0]["messages"]
                            tokens         = synth_result["usage"]["total_tokens"]
                            total_tokens  += tokens
                            total_cost    += (tokens / 1_000_000) * MODEL_COSTS.get(selected_llm, 0)
                        except Exception as e:
                            st.warning(f"Synthesis failed: {e}")

                        status.update(label="Analysis complete", state="complete", expanded=False)

            else:
                # ── Dimension-based analysis ─────────────────────────────────────
                dim_series = respondents_with_answers[dimension_col].fillna("Not specified")
                groups = sorted(
                    respondents_with_answers.assign(_dim=dim_series).groupby("_dim"),
                    key=lambda g: -len(g[1]),
                )
                valid_groups = [
                    (str(gv), gdf[gdf[answer_col].notna() & (gdf[answer_col].str.strip() != "")])
                    for gv, gdf in groups
                ]
                valid_groups = [(gv, rows) for gv, rows in valid_groups if not rows.empty]
                group_order  = [gv for gv, _ in valid_groups]

                if len(valid_groups) == 1:
                    gv, group_rows_single = valid_groups[0]
                    chunks = chunk_rows(group_rows_single, answer_col, MAX_CHARS_PER_LLM_CALL)

                    if len(chunks) == 1:
                        # Single group fits in one call: apply user's prompt directly
                        with st.status(f"Analyzing {len(group_rows_single):,} responses…", expanded=True) as status:
                            all_text = assemble_chunk_text(group_rows_single, answer_col, uuid_to_int)
                            result   = run_cortex_complete(all_text, selected_llm, user_prompt)
                            status.update(label="Analysis complete", state="complete", expanded=False)
                        sub_results  = [GroupAnalysis(
                            group_value=gv,
                            n=len(group_rows_single),
                            text=result["choices"][0]["messages"],
                            tokens=result["usage"]["total_tokens"],
                        )]
                        total_tokens = sub_results[0].tokens
                        total_cost   = (total_tokens / 1_000_000) * MODEL_COSTS.get(selected_llm, 0)

                    else:
                        # Single group too large: MAP chunks then synthesize with user's prompt
                        with st.status(
                            f"Analyzing {len(group_rows_single):,} responses in {len(chunks)} batches…",
                            expanded=True,
                        ) as status:
                            batch_results_sg: list[GroupAnalysis | None] = [None] * len(chunks)

                            def _map_sg_chunk(idx: int, chunk_df: pd.DataFrame) -> tuple[int, str, int]:
                                text   = assemble_chunk_text(chunk_df, answer_col, uuid_to_int)
                                prompt = f"Batch {idx+1} of {len(chunks)}.\n\n{MAP_PROMPT}"
                                r      = run_cortex_complete(text, selected_llm, prompt)
                                return idx, r["choices"][0]["messages"], r["usage"]["total_tokens"]

                            with ThreadPoolExecutor(max_workers=min(len(chunks), 12)) as executor:
                                futures = {executor.submit(_map_sg_chunk, i, chunk): i for i, chunk in enumerate(chunks)}
                                for future in as_completed(futures):
                                    idx, text, tokens = future.result()
                                    batch_results_sg[idx] = GroupAnalysis(
                                        group_value=f"Batch {idx+1}",
                                        n=len(chunks[idx]),
                                        text=text,
                                        tokens=tokens,
                                    )
                                    total_tokens += tokens
                                    total_cost   += (tokens / 1_000_000) * MODEL_COSTS.get(selected_llm, 0)
                                    st.write(f"✓ Batch {idx+1} ({len(chunks[idx]):,} responses)")

                            sub_results = [r for r in batch_results_sg if r is not None]

                            counts_map_sg: dict[str, set[int]] = {}
                            if quantitative_mode and sub_results:
                                st.write("Extracting themes for quantitative counts…")
                                themes_sg = extract_canonical_themes([r.text for r in sub_results], selected_llm)
                                st.write(f"Classifying {len(group_rows_single):,} responses across {len(themes_sg)} themes…")
                                counts_map_sg = run_classification_pass(group_rows_single, answer_col, uuid_to_int, themes_sg, selected_llm)

                            st.write("Synthesizing batches…")
                            try:
                                synth_result   = run_cortex_complete(
                                    "", selected_llm,
                                    build_synthesis_prompt(None, sub_results, user_prompt, counts_map_sg or None, len(group_rows_single)),
                                    synthesis=True,
                                )
                                synthesis_text = synth_result["choices"][0]["messages"]
                                tokens         = synth_result["usage"]["total_tokens"]
                                total_tokens  += tokens
                                total_cost    += (tokens / 1_000_000) * MODEL_COSTS.get(selected_llm, 0)
                            except Exception as e:
                                st.warning(f"Synthesis failed: {e}")

                            status.update(label="Analysis complete", state="complete", expanded=False)

                else:
                    # Multiple groups: parallel MAP-reduce, with intra-group chunking via _analyze_group
                    with st.status(
                        f"Analyzing {len(all_ids):,} responses across {len(valid_groups)} "
                        f"{selected_dimension_label} group{'s' if len(valid_groups) != 1 else ''}…",
                        expanded=True,
                    ) as status:
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
                                    chunk_note = f" — {ga.num_chunks} batches" if ga.num_chunks > 1 else ""
                                    st.write(f"✓ **{ga.group_value}** ({ga.n} responses{chunk_note})")
                                except Exception as e:
                                    st.warning(f"Analysis failed for '{group_value}': {e}")

                        sub_results.sort(key=lambda r: group_order.index(r.group_value))

                        if len(sub_results) > 1:
                            counts_map_mg: dict[str, set[int]] = {}
                            if quantitative_mode and sub_results:
                                st.write("Extracting themes for quantitative counts…")
                                themes_mg = extract_canonical_themes([r.text for r in sub_results], selected_llm)
                                st.write(f"Classifying {len(all_ids):,} responses across {len(themes_mg)} themes…")
                                counts_map_mg = run_classification_pass(respondents_with_answers, answer_col, uuid_to_int, themes_mg, selected_llm)

                            st.write("Synthesizing results across groups…")
                            try:
                                synth_result   = run_cortex_complete(
                                    "", selected_llm,
                                    build_synthesis_prompt(selected_dimension_label, sub_results, user_prompt, counts_map_mg or None, len(all_ids)),
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
                    + (f" across {n_groups} {selected_dimension_label} groups" if n_groups > 1 and selected_dimension_label else "")
                )
                if total_citations:
                    st.caption(
                        f"This analysis cites {total_citations} response{'s' if total_citations != 1 else ''}. "
                        "Click any [†n] marker to jump to the source, or scroll to **Cited Responses** below."
                    )

                if synthesis_text:
                    st.markdown(apply_global_citations(synthesis_text, global_cite_map), unsafe_allow_html=True)
                else:
                    if n_groups == 1 and selected_dimension_label and sub_results[0].group_value:
                        st.caption(f"Only one {selected_dimension_label} group found.")
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
    st.subheader("Browse responses")
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
            "IDEA_ID":                       st.column_config.TextColumn("Idea ID"),
            "REGION":                        st.column_config.TextColumn("Region"),
            "COUNTY":                        st.column_config.TextColumn("County"),
            "GENDER_CATEGORY":               st.column_config.TextColumn("Gender"),
            "AGE":                           st.column_config.TextColumn("Age"),
            "RACE_ETHNICITY_CATEGORY":       st.column_config.TextColumn("Race/Ethnicity"),
            "FIELD_OF_WORK":                 st.column_config.TextColumn("Field of Work"),
            "ROLE_AT_WORK":                  st.column_config.TextColumn("Role at Work"),
            "CURRENT_WORK_STATUS":           st.column_config.TextColumn("Work Status"),
            "AVAILABILITY_FOR_DISCUSSION":   st.column_config.TextColumn("Available for Discussion"),
            "ECONOMIC_IMPACT_EXPECTATION":   st.column_config.TextColumn("Economic impact", width="large"),
            "GOVERNMENT_ACTION_SUGGESTION":  st.column_config.TextColumn("Government action", width="large"),
            "PERSONAL_AI_IMPACT":            st.column_config.TextColumn("Personal AI impact", width="large"),
        },
    )


# ── Tab 3: Data Export ───────────────────────────────────────────────────────

with tab3:
    st.subheader("Data export")
    st.markdown(
        f"Download the filtered dataset as CSV. "
        f"**{len(filtered_df):,} records** will be exported."
    )

    if not filtered_df.empty:
        export_df = filtered_df.copy()
        csv_data = export_df.to_csv(index=False)
        filename = f"engaged_california_ai_survey_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"

        st.download_button(
            label="Download CSV",
            data=csv_data,
            file_name=filename,
            mime="text/csv",
        )

        st.caption("Preview (first 10 rows):")
        st.dataframe(export_df.head(10), use_container_width=True, hide_index=True)
