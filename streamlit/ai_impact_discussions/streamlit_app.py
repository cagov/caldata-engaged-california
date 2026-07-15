import html
import json
import os
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone

import pandas as pd
import plotly.express as px
import streamlit as st
from dotenv import load_dotenv


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
# Config
# ---------------------------------------------------------------------------

RAW_TABLE = "raw_engca_dev.test_data.stg_events"

LLM_MODEL_LOW = os.environ.get("LLM_MODEL_LOW", "")
LLM_MODEL_MED = os.environ.get("LLM_MODEL_MED", "")
LLM_MODEL_HIGH = os.environ.get("LLM_MODEL_HIGH", "")

# Chunking params validated in notebooks/ai_impact_survey/phase_2_analysis.ipynb
MAX_CHARS_PER_CHUNK = int(os.environ.get("MAX_CHARS_PER_CHUNK", "30000"))
OVERLAP_TURNS = 4
TURN_PREFIX_OVERHEAD = 25  # index/timestamp/source prefix chars per rendered turn

PAGE_SIZE = 100  # transcript turns per page

# Hardcoded AI cost formulas used to estimate analysis costs for users.
# They're not exact, but they're not far off either. (Same approach as phase 1 app.)
COST_PER_SNOWFLAKE_CREDIT = 3.16
MODEL_CREDIT_COSTS = {
    LLM_MODEL_HIGH: 2.55,
    LLM_MODEL_MED:  0.96,
    LLM_MODEL_LOW:  0.25,
}
MODEL_COSTS = {m: c * COST_PER_SNOWFLAKE_CREDIT for m, c in MODEL_CREDIT_COSTS.items() if m}

LLM_TIERS = [
    (LLM_MODEL_MED,  "Medium", "Balanced (recommended)"),
    (LLM_MODEL_HIGH, "High",   "Most capable & costly"),
    (LLM_MODEL_LOW,  "Low",    "Fast & economical"),
]


# ---------------------------------------------------------------------------
# Prompts (validated in notebooks/ai_impact_survey/phase_2_analysis.ipynb)
# ---------------------------------------------------------------------------

TRANSCRIPT_SYSTEM_PROMPT = (
    "You are analyzing transcripts of live small-group discussions held by Engaged California, "
    "an official initiative of California's Government Operations Agency and Office of Data and "
    "Innovation. Engaged California uses deliberative democracy practices to give Californians a "
    "direct voice in state policymaking. The discussion program concerns how AI may impact "
    "Californians' work and lives and what actions government should take in response. "
    "IMPORTANT: Some recordings may be pilot tests, staff work sessions, or interviews that do "
    "not substantively discuss AI policy. Recordings of real discussions may also BEGIN with a "
    "staff setup/logistics segment before participants join — when a substantive participant "
    "discussion is present, base your analysis on that discussion and treat any pre-discussion "
    "staff logistics as incidental context, not as the subject of the session. "
    "Ground every claim in the transcript itself. If the transcript does not contain content "
    "relevant to the question you are asked, say so explicitly and briefly describe what was "
    "actually discussed — NEVER invent themes to fit the question. "
    "The transcript combines transcribed speech and text chat, interleaved chronologically. "
    "Each turn is formatted as: [index] (timestamp, source) speaker: text. "
    "When you reference what someone said, cite the turn index like [turn:42]. "
    "NEVER fabricate or reproduce quotes from memory — always refer to turns by their index. "
    "Format your response in Markdown with headers, bullet points, and bold text."
)

MAP_PROMPT_TRANSCRIPT = (
    "From this transcript excerpt, extract the following. Cite representative turns like "
    "[turn:N] throughout, and be concise — this summary feeds a larger synthesis.\n"
    "1. The prominent themes or perspectives (1-2 sentences each).\n"
    "2. EVERY concrete policy proposal or suggested government action, however brief or "
    "narrowly scoped — do not consolidate distinct proposals.\n"
    "3. Values or things participants explicitly name as important to protect — use the "
    "participants' own words as labels and keep distinct values separate.\n"
    "4. Deliberative moments: disagreement, persuasion, a participant changing their view, or "
    "a proposal being refined/reworded through group input."
)

PROTECT_PROMPT = (
    "Analyze what participants in this discussion want to PROTECT with regard to AI — values, "
    "rights, jobs, institutions, groups of people, or ways of life they feel are at risk. "
    "Identify each distinct theme participants actually raised, including themes voiced by only "
    "one participant. Keep distinct values separate — do not merge (e.g. ethics/humanity is not "
    "the same theme as privacy if participants treated them separately) — and prefer the "
    "participants' own words for theme labels. If the discussion does not substantively address "
    "this question, say so and summarize what was discussed instead. For each theme:\n\n"
    "#### [Theme label]\n\n"
    "*Description: 2-3 sentences on what participants want protected and why.*\n\n"
    "*Representative turns: [turn:N] citations for the strongest supporting moments.*"
)

GOV_ACTION_PROMPT = (
    "Analyze what participants in this discussion think GOVERNMENT SHOULD DO about AI. "
    "Capture EVERY distinct action or policy proposal participants actually made — including "
    "narrowly scoped ones (e.g. rules for a specific sector, service, or setting such as "
    "schools). Do not consolidate distinct proposals into one theme. If the discussion does not "
    "substantively address this question, say so and summarize what was discussed instead. "
    "For each:\n\n"
    "#### [Action label]\n\n"
    "*Description: 2-3 sentences on what participants are asking government to do.*\n\n"
    "*Representative turns: [turn:N] citations for the strongest supporting moments.*"
)

DELIBERATIVE_PROMPT = (
    "Identify the deliberative moments in this discussion: disagreement between participants, "
    "persuasion, a participant changing their view, a proposal being refined or reworded "
    "through group input, or participants discovering shared values through clarifying "
    "questions. For each moment, describe what happened, who was involved (by turn reference, "
    "not name), and what the outcome was. Cite the relevant turns like [turn:N]. If the "
    "discussion contains no substantive deliberation, say so and summarize what was discussed "
    "instead."
)

SESSION_SUMMARY_PROMPT = (
    "Produce a structured analysis of this discussion. Respond ONLY with a JSON object with keys:\n"
    '- "overview": 2-3 sentence summary of the session. If the recording contains a substantive '
    "participant discussion, the overview must describe THAT discussion — mention any staff "
    "setup/logistics segment in at most one clause, or not at all\n"
    '- "protect_themes": each distinct thing participants want to protect regarding AI. Keep '
    "distinct values separate (e.g. ethics/humanity is not the same theme as privacy if "
    "participants treated them separately) and prefer participants' own words for theme labels. "
    "Include themes voiced by only one participant\n"
    '- "gov_action_themes": EVERY distinct government action or policy proposal participants '
    "made, including narrowly scoped ones (e.g. rules for a specific sector, service, or "
    "setting such as schools). Do not consolidate distinct proposals\n"
    '- "general_themes": other prominent themes from the participant discussion\n'
    '- "areas_of_tension": points where participants disagreed\n'
    '- "areas_of_consensus": points of broad agreement\n'
    '- "deliberative_moments": moments where a participant changed their view or was persuaded, '
    "a proposal was refined or reworded through group input, a disagreement was resolved, or "
    "participants discovered shared values through clarifying questions\n"
    "Every key except overview is a list of objects: "
    '{"theme": str, "description": str, "supporting_turn_idxs": [int, ...]}. '
    "supporting_turn_idxs must be actual turn indices from the transcript, and every theme MUST "
    "include at least one supporting turn index. "
    "If a section was not substantively discussed, return an empty list for it — do NOT invent "
    "themes to fill a section. "
    "Do not include speaker names in any text — reference contributions via turn indices only."
)

JSON_SYSTEM_PROMPT = (
    TRANSCRIPT_SYSTEM_PROMPT
    + " When asked for JSON, respond with JSON only — no prose, no markdown fences."
)

QUOTE_SYSTEM_PROMPT = (
    TRANSCRIPT_SYSTEM_PROMPT
    + " Respond ONLY with a JSON array of objects: "
    '[{"turn_idx": int, "why_relevant": str}]. '
    "Do NOT reproduce quote text — return indices only. "
    "Return AT MOST the 10 most relevant turns. Only include turns that are directly and "
    "substantively relevant to the query — do not pad the list with tangential matches. "
    "why_relevant must state specifically what in that turn relates to the query, not just "
    "repeat the query. "
    "Return [] if nothing is relevant. Do not include any prose before or after the JSON array."
)

# Pre-baked prompts for the Custom analysis tab
PROMPTS = {
    "What to protect": PROTECT_PROMPT,
    "Government actions": GOV_ACTION_PROMPT,
    "Deliberative moments": DELIBERATIVE_PROMPT,
    "Custom…": None,
}

# Structured summary sections: key -> (display label, badge color)
SECTIONS = {
    "protect_themes":       ("What to protect",      "#2e7d32"),
    "gov_action_themes":    ("Government actions",   "#1565c0"),
    "general_themes":       ("General themes",       "#616161"),
    "areas_of_tension":     ("Areas of tension",     "#ef6c00"),
    "areas_of_consensus":   ("Areas of consensus",   "#00796b"),
    "deliberative_moments": ("Deliberative moments", "#6a1b9a"),
}


# ---------------------------------------------------------------------------
# Page config
# ---------------------------------------------------------------------------

st.set_page_config(page_title="Engaged California — live discussion explorer", layout="wide")


# ---------------------------------------------------------------------------
# Core helpers (ported from phase_2_analysis.ipynb)
# ---------------------------------------------------------------------------

def run_cortex_complete(user_text: str, model: str, system_prompt: str) -> tuple[str, int]:
    """Run a Cortex COMPLETE call, returning (response_text, total_tokens).

    Prompts are passed as bind parameters rather than spliced into the SQL string —
    transcript text can contain quotes/backslashes that break string literals.
    """
    query = """
    SELECT SNOWFLAKE.CORTEX.COMPLETE(
        ?,
        ARRAY_CONSTRUCT(
            OBJECT_CONSTRUCT('role', 'system', 'content', ?),
            OBJECT_CONSTRUCT('role', 'user', 'content', ?)
        ),
        OBJECT_CONSTRUCT('temperature', 0)
    ) AS result
    """
    row = session.sql(query, params=[model, system_prompt, user_text]).to_pandas().iloc[0]
    result = json.loads(row["RESULT"])
    text = result["choices"][0]["messages"]
    tokens = result.get("usage", {}).get("total_tokens", 0)
    return text, tokens


def fmt_ts(sec) -> str:
    """Seconds since meeting start -> mm:ss (or h:mm:ss over an hour)."""
    if pd.isna(sec):
        return "??:??"
    sec = int(sec)
    h, rem = divmod(sec, 3600)
    m, s = divmod(rem, 60)
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m:02d}:{s:02d}"


def render_turns(df_slice: pd.DataFrame) -> str:
    """Render turns in the canonical LLM input format:

    [42] (12:34, chat) Jane D.: I think we need guardrails on...
    """
    return "\n".join(
        f"[{r.turn_idx}] ({fmt_ts(r.start_sec)}, {r.source}) {r.speaker}: {r.text}"
        for r in df_slice.itertuples()
    )


def chunk_turns(session_df: pd.DataFrame, max_chars: int = MAX_CHARS_PER_CHUNK,
                overlap_turns: int = OVERLAP_TURNS) -> list[pd.DataFrame]:
    """Split one session's turns into contiguous, time-ordered chunks under max_chars,
    with a small turn overlap between consecutive chunks so exchanges aren't severed."""
    df = session_df.sort_values("turn_idx").reset_index(drop=True)
    line_lens = (
        df["text"].fillna("").str.len()
        + df["speaker"].fillna("").str.len()
        + TURN_PREFIX_OVERHEAD
    )
    chunks: list[pd.DataFrame] = []
    start = 0
    while start < len(df):
        total, end = 0, start
        while end < len(df) and total + line_lens.iloc[end] <= max_chars:
            total += line_lens.iloc[end]
            end += 1
        end = max(end, start + 1)  # always make progress, even past a giant turn
        chunks.append(df.iloc[start:end])
        if end >= len(df):
            break
        start = max(end - overlap_turns, start + 1)
    return chunks


def parse_json_response(text: str, array_fallback: bool = False):
    """Tolerant JSON extraction: strips markdown fences and grabs the first JSON
    array/object if the model wrapped it in prose (Cortex JSON mode isn't guaranteed).

    If array_fallback=True and no JSON array is found, returns [] instead of raising.
    """
    cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", text.strip(), flags=re.MULTILINE)
    if array_fallback and "[" not in cleaned:
        return []
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        match = re.search(r"(\[.*\]|\{.*\})", cleaned, flags=re.DOTALL)
        if match:
            try:
                return json.loads(match.group(1))
            except json.JSONDecodeError:
                pass
        if array_fallback:
            return []
        raise


# ---------------------------------------------------------------------------
# LLM analysis pipeline (ported from phase_2_analysis.ipynb)
# ---------------------------------------------------------------------------

def map_chunks(chunks: list[pd.DataFrame], model: str = None,
               progress=None) -> tuple[list[str], int]:
    """Parallel MAP pass: per-chunk extraction. Returns (summaries in chunk order, tokens)."""
    model = model or LLM_MODEL_LOW
    summaries: list = [None] * len(chunks)
    total_tokens = 0
    done = 0
    with ThreadPoolExecutor(max_workers=8) as pool:
        futures = {
            pool.submit(
                run_cortex_complete,
                f"{MAP_PROMPT_TRANSCRIPT}\n\nTranscript excerpt:\n{render_turns(c)}",
                model,
                TRANSCRIPT_SYSTEM_PROMPT,
            ): i
            for i, c in enumerate(chunks)
        }
        for fut in as_completed(futures):
            text, tokens = fut.result()
            summaries[futures[fut]] = text
            total_tokens += tokens
            done += 1
            if progress:
                progress(f"Excerpt {done}/{len(chunks)} analyzed")
    return summaries, total_tokens


def build_transcript_synthesis_prompt(chunk_summaries: list[str], user_prompt: str) -> str:
    parts = "\n\n".join(f"Excerpt {i + 1} summary:\n{s}" for i, s in enumerate(chunk_summaries))
    return (
        "The following are theme extractions from consecutive excerpts of a single discussion "
        "transcript. Using these, write a single response that directly answers the original "
        "analysis question below.\n\n"
        "Guidelines:\n"
        "- Merge duplicate mentions of the SAME theme across excerpts, but never merge distinct "
        "themes or proposals into one; do not structure your response per-excerpt\n"
        "- Preserve [turn:N] citations from the excerpt summaries wherever they support a point\n"
        "- If the excerpt summaries do not address the question, say so — do not invent themes\n\n"
        f"Original analysis question:\n{user_prompt}\n\n"
        f"Excerpt summaries:\n\n{parts}"
    )


def analyze_session_prompt(session_df: pd.DataFrame, user_prompt: str, model: str,
                           progress=None) -> tuple[str, int]:
    """Run a prose analysis prompt against a session: whole-session single call when it
    fits, otherwise map-reduce (MAP at LOW tier, reduce at the selected model)."""
    if rendered_chars(session_df) <= MAX_CHARS_PER_CHUNK:
        return run_cortex_complete(
            f"{user_prompt}\n\nTranscript:\n{render_turns(session_df)}",
            model,
            TRANSCRIPT_SYSTEM_PROMPT,
        )
    chunks = chunk_turns(session_df)
    summaries, map_tokens = map_chunks(chunks, progress=progress)
    if progress:
        progress("Synthesizing…")
    synthesis, tokens = run_cortex_complete(
        build_transcript_synthesis_prompt(summaries, user_prompt),
        model,
        TRANSCRIPT_SYSTEM_PROMPT,
    )
    return synthesis, map_tokens + tokens


def summarize_session_dict(session_df: pd.DataFrame, model: str,
                           progress=None) -> tuple[dict, int, list[str]]:
    """Structured session summary. Returns (summary_dict, tokens, warnings).

    Hallucinated turn indices are dropped; themes with no valid supporting turns are
    removed as unverifiable. Both are reported in warnings.
    """
    chunks = chunk_turns(session_df)
    tokens = 0
    if len(chunks) == 1:
        user_text = f"{SESSION_SUMMARY_PROMPT}\n\nTranscript:\n{render_turns(chunks[0])}"
    else:
        summaries, tokens = map_chunks(chunks, progress=progress)
        if progress:
            progress("Building structured summary…")
        parts = "\n\n".join(f"Excerpt {i + 1} summary:\n{s}" for i, s in enumerate(summaries))
        user_text = (
            f"{SESSION_SUMMARY_PROMPT}\n\n"
            "You are working from theme extractions of consecutive excerpts of the transcript. "
            "Each cites turns as [turn:N] — use those N values for supporting_turn_idxs.\n\n"
            f"{parts}"
        )
    text, t = run_cortex_complete(user_text, model, JSON_SYSTEM_PROMPT)
    tokens += t
    result = parse_json_response(text)

    valid_idxs = set(session_df["turn_idx"])
    warnings: list[str] = []
    for section in SECTIONS:
        kept = []
        for item in result.get(section, []):
            raw_idxs = item.get("supporting_turn_idxs", [])
            idxs = [i for i in raw_idxs if i in valid_idxs]
            if len(idxs) < len(raw_idxs):
                warnings.append(
                    f"{section}: dropped {len(raw_idxs) - len(idxs)} unverifiable turn "
                    f"reference(s) from '{item.get('theme', '')}'"
                )
            if not idxs:
                warnings.append(f"{section}: skipped unsupported theme '{item.get('theme', '')}'")
                continue
            item["supporting_turn_idxs"] = idxs
            kept.append(item)
        result[section] = kept
    return result, tokens, warnings


def find_quotes(session_df: pd.DataFrame, query: str,
                model: str = None) -> tuple[pd.DataFrame, int]:
    """Index-based quote extraction: the LLM returns turn indices only; verbatim
    text/speaker/timestamp are resolved from the source DataFrame.

    Returns (results_df, n_hallucinated_indices_dropped).
    """
    model = model or LLM_MODEL_LOW
    results = []
    chunks = chunk_turns(session_df)
    with ThreadPoolExecutor(max_workers=8) as pool:
        futures = [
            pool.submit(
                run_cortex_complete,
                f"Find the turns most relevant to: {query}\n\nTranscript excerpt:\n{render_turns(c)}",
                model,
                QUOTE_SYSTEM_PROMPT,
            )
            for c in chunks
        ]
        for fut in as_completed(futures):
            text, _ = fut.result()
            results.extend(parse_json_response(text, array_fallback=True))

    hits = pd.DataFrame(results)
    if hits.empty:
        return hits, 0
    hits = hits.drop_duplicates(subset="turn_idx")
    resolved = hits.merge(
        session_df[["turn_idx", "start_sec", "source", "speaker", "text"]],
        on="turn_idx", how="left",
    )
    hallucinated = resolved["text"].isna()
    resolved = resolved[~hallucinated].copy()
    cols = ["turn_idx", "start_sec", "source", "speaker", "text", "why_relevant"]
    return resolved[cols].sort_values("turn_idx").reset_index(drop=True), int(hallucinated.sum())


# ---------------------------------------------------------------------------
# Data loading
# ---------------------------------------------------------------------------

@st.cache_data
def load_events() -> pd.DataFrame:
    df = session.sql(f"""
        SELECT session_id, source, src_ref, start_sec, end_sec, speaker, text
        FROM {RAW_TABLE}
        ORDER BY session_id, start_sec
    """).to_pandas()
    df.columns = [c.lower() for c in df.columns]
    df = df.sort_values(["session_id", "start_sec"]).reset_index(drop=True)
    # turn_idx: chronological per-session index — the citation backbone
    df["turn_idx"] = df.groupby("session_id").cumcount()
    df["duration_sec"] = df["end_sec"] - df["start_sec"]
    df["n_chars"] = df["text"].fillna("").str.len()
    return df


def compute_session_stats(events_df: pd.DataFrame) -> pd.DataFrame:
    stats = (
        events_df.groupby("session_id")
        .agg(
            n_turns=("turn_idx", "size"),
            n_speakers=("speaker", "nunique"),
            duration_min=("end_sec", "max"),
            total_chars=("n_chars", "sum"),
            n_speech=("source", lambda s: int((s == "speech").sum())),
            n_chat=("source", lambda s: int((s == "chat").sum())),
        )
        .assign(duration_min=lambda d: (d["duration_min"] / 60).round(1))
    )
    return stats


def rendered_chars(session_df: pd.DataFrame) -> int:
    """Approximate char length of the rendered transcript fed to the LLM."""
    return int(session_df["n_chars"].sum()) + TURN_PREFIX_OVERHEAD * len(session_df)


# ---------------------------------------------------------------------------
# Cost estimation (same philosophy as phase 1 app)
# ---------------------------------------------------------------------------

def estimate_cost(session_df: pd.DataFrame, model: str) -> tuple[float, int]:
    """Rough pre-run cost estimate. Returns (dollars, n_chunks)."""
    chars = rendered_chars(session_df)
    if chars <= MAX_CHARS_PER_CHUNK:
        return chars / 4 / 1e6 * MODEL_COSTS.get(model, 0), 1
    n_chunks = len(chunk_turns(session_df))
    map_cost = chars / 4 / 1e6 * MODEL_COSTS.get(LLM_MODEL_LOW, 0)
    reduce_cost = n_chunks * 2_500 / 4 / 1e6 * MODEL_COSTS.get(model, 0)
    return map_cost + reduce_cost, n_chunks


def tokens_to_cost(tokens: int, model: str) -> float:
    return tokens / 1e6 * MODEL_COSTS.get(model, 0)


# ---------------------------------------------------------------------------
# UI rendering helpers
# ---------------------------------------------------------------------------

def speaker_colors(session_df: pd.DataFrame) -> dict[str, str]:
    """Stable per-session palette: sorted speakers mapped round-robin onto Plotly colors."""
    palette = px.colors.qualitative.Plotly
    speakers = sorted(session_df["speaker"].fillna("(unknown)").unique())
    return {s: palette[i % len(palette)] for i, s in enumerate(speakers)}


def theme_badge(section: str, label: str) -> str:
    color = SECTIONS[section][1]
    title = SECTIONS[section][0]
    return (
        f'<span title="{html.escape(title)}" style="background:{color}; color:white; '
        f'border-radius:10px; padding:1px 8px; font-size:0.75em; margin-left:4px; '
        f'white-space:nowrap;">{html.escape(label)}</span>'
    )


def render_turn_html(turn_idx: int, source: str, speaker: str, start_sec, text: str,
                     theme_tags: list[tuple[str, str]] | None = None,
                     color: str = "#888", anchor_prefix: str = "turn") -> str:
    """One turn as an HTML card with speaker color, meta line, and theme badges."""
    is_chat = source == "chat"
    badges = "".join(theme_badge(sec, lbl) for sec, lbl in (theme_tags or []))
    # Low-alpha tint stays readable on both light and dark Streamlit themes
    background = "background:rgba(128,160,200,0.18);" if is_chat else ""
    icon = "💬 chat" if is_chat else "🎙 speech"
    return (
        f'<div id="{anchor_prefix}-{turn_idx}" style="border-left:4px solid {color}; '
        f'padding:6px 10px; margin:4px 0; border-radius:4px; {background}">'
        f'<span style="color:{color}; font-weight:600;">{html.escape(str(speaker))}</span> '
        f'<span style="color:#888; font-size:0.85em;">[{turn_idx}] · '
        f'{fmt_ts(start_sec)} · {icon}</span>'
        f"{badges}"
        f'<div style="margin-top:2px;">{html.escape(str(text))}</div>'
        f"</div>"
    )


def build_theme_turn_map(summary: dict) -> dict[int, list[tuple[str, str]]]:
    """Invert a structured summary: turn_idx -> [(section, theme_label), ...]."""
    turn_map: dict[int, list[tuple[str, str]]] = {}
    for section in SECTIONS:
        for item in summary.get(section, []):
            for idx in item.get("supporting_turn_idxs", []):
                turn_map.setdefault(idx, []).append((section, item.get("theme", "")))
    return turn_map


def gap_divider(n_skipped: int) -> str:
    """Visual separator between non-contiguous turns in a card list."""
    label = f"⋯ {n_skipped} turn{'s' if n_skipped > 1 else ''} skipped ⋯"
    return (
        f'<div style="border-top:1px dashed rgba(136,136,136,0.6); margin:10px 24px 2px; '
        f'text-align:center; color:#888; font-size:0.75em; line-height:1.6;">{label}</div>'
    )


TURN_CITE_RE = re.compile(r"\[turn:\s*(\d+)\]")


def apply_turn_citations(text: str, anchor_prefix: str) -> tuple[str, list[int]]:
    """Convert [turn:N] tags to anchored links; return (html_text, ordered cited idxs)."""
    cited: list[int] = []

    def replacer(m):
        n = int(m.group(1))
        if n not in cited:
            cited.append(n)
        return f'<a href="#{anchor_prefix}-{n}" style="text-decoration:none;">[†turn {n}]</a>'

    return TURN_CITE_RE.sub(replacer, text), cited


def render_cited_turns(session_df: pd.DataFrame, cited_idxs: list[int],
                       colors: dict[str, str], anchor_prefix: str):
    """Render anchored verbatim turn cards for cited indices; ⚠️ for invalid ones."""
    if not cited_idxs:
        return
    st.markdown("---")
    st.markdown("##### Cited turns (verbatim from source data)")
    indexed = session_df.set_index("turn_idx")
    cards = []
    for idx in cited_idxs:
        if idx in indexed.index:
            row = indexed.loc[idx]
            cards.append(render_turn_html(
                idx, row["source"], row["speaker"], row["start_sec"], row["text"],
                color=colors.get(row["speaker"], "#888"), anchor_prefix=anchor_prefix,
            ))
        else:
            cards.append(
                f'<div id="{anchor_prefix}-{idx}" style="border-left:4px solid #d32f2f; '
                f'padding:6px 10px; margin:4px 0;">⚠️ Turn [{idx}] not found in this session — '
                f"citation could not be verified.</div>"
            )
    st.markdown("".join(cards), unsafe_allow_html=True)


# ---------------------------------------------------------------------------
# Session state init
# ---------------------------------------------------------------------------

for key, default in [
    ("session_summaries", {}),   # session_id -> {summary, model, tokens, cost, generated_at}
    ("quote_results", {}),       # (session_id, query) -> (DataFrame, n_hallucinated)
    ("analysis_results", {}),    # session_id -> [ {prompt_label, model, html, cited, tokens, cost, ts} ]
    ("last_query_tokens", 0),
    ("last_query_cost", 0.0),
]:
    if key not in st.session_state:
        st.session_state[key] = default


# ---------------------------------------------------------------------------
# Load data
# ---------------------------------------------------------------------------

try:
    events_df = load_events()
except Exception as e:
    st.error(f"Failed to load transcript data from {RAW_TABLE}: {e}")
    st.stop()

if events_df.empty:
    st.warning(f"No transcript data found in {RAW_TABLE}.")
    st.stop()

session_stats = compute_session_stats(events_df)


# ---------------------------------------------------------------------------
# Sidebar
# ---------------------------------------------------------------------------

with st.sidebar:
    st.header("Session")
    session_ids = session_stats.sort_index(ascending=False).index.tolist()
    selected_sid = st.selectbox(
        "Discussion session",
        session_ids,
        format_func=lambda sid: (
            f"{sid} — {session_stats.loc[sid, 'n_turns']} turns, "
            f"{session_stats.loc[sid, 'duration_min']:.0f} min"
        ),
    )

    st.divider()
    if st.button("Refresh data", type="primary", use_container_width=True):
        load_events.clear()
        st.session_state.session_summaries = {}
        st.session_state.quote_results = {}
        st.rerun()

    if st.session_state.last_query_tokens:
        st.info(
            f"Last analysis: {st.session_state.last_query_tokens:,} tokens "
            f"(~${st.session_state.last_query_cost:.4f})"
        )

session_df = events_df[events_df["session_id"] == selected_sid]
colors = speaker_colors(session_df)
stats = session_stats.loc[selected_sid]
cached = st.session_state.session_summaries.get(selected_sid)


# ---------------------------------------------------------------------------
# Header & session stats (zero LLM cost)
# ---------------------------------------------------------------------------

st.title("Engaged California — live discussion explorer")
st.markdown(
    "Explore phase 2 live-discussion transcripts. AI analyses cite turns by index and every "
    "quote is resolved verbatim from the source data — never from the model's memory."
)

m1, m2, m3, m4, m5 = st.columns(5)
m1.metric("Turns", f"{stats['n_turns']:,}")
m2.metric("Speakers", stats["n_speakers"])
m3.metric("Duration", f"{stats['duration_min']:.0f} min")
m4.metric("Speech turns", f"{stats['n_speech']:,}")
m5.metric("Chat messages", f"{stats['n_chat']:,}")

# --- Analyze session control ------------------------------------------------
an_col, info_col = st.columns([1, 3])
with an_col:
    analyze_clicked = st.button(
        "Re-analyze session" if cached else "Analyze session",
        type="primary",
        use_container_width=True,
    )
with info_col:
    est, n_chunks = estimate_cost(session_df, LLM_MODEL_MED)
    if cached:
        st.caption(
            f"Analyzed with `{cached['model']}` at {cached['generated_at'][:16]} — "
            f"{cached['tokens']:,} tokens (~${cached['cost']:.4f}). Cached; re-analyze to refresh."
        )
    else:
        st.caption(
            f"Runs the structured theme analysis with `{LLM_MODEL_MED}` "
            f"(~${est:.4f} est., {n_chunks} chunk{'s' if n_chunks > 1 else ''}). "
            "Results are cached for this browser session."
        )

if analyze_clicked:
    if not LLM_MODEL_MED:
        st.error("LLM_MODEL_MED is not configured — set it in .env.")
    else:
        with st.status("Analyzing session…", expanded=True) as status:
            try:
                summary, tokens, warnings = summarize_session_dict(
                    session_df, LLM_MODEL_MED, progress=status.write
                )
                cost = tokens_to_cost(tokens, LLM_MODEL_MED)
                st.session_state.session_summaries[selected_sid] = {
                    "summary": summary,
                    "model": LLM_MODEL_MED,
                    "tokens": tokens,
                    "cost": cost,
                    "generated_at": datetime.now(timezone.utc).isoformat(),
                    "warnings": warnings,
                }
                st.session_state.last_query_tokens = tokens
                st.session_state.last_query_cost = cost
                status.update(label="Analysis complete", state="complete", expanded=False)
            except Exception as e:
                status.update(label="Analysis failed", state="error")
                st.error(f"Session analysis failed: {e}")
        st.rerun()

cached = st.session_state.session_summaries.get(selected_sid)


# ---------------------------------------------------------------------------
# Tabs
# ---------------------------------------------------------------------------

tab_summary, tab_transcript, tab_quotes, tab_custom, tab_export = st.tabs(
    ["Session summary", "Transcript", "Quote search", "Custom analysis", "Data export"]
)


# --- Tab 1: Session summary ---------------------------------------------------

with tab_summary:
    if not cached:
        st.info("Run **Analyze session** above to generate the structured summary.")
    else:
        summary = cached["summary"]
        for w in cached.get("warnings", []):
            st.caption(f"⚠️ {w}")

        st.markdown("#### Overview")
        st.markdown(summary.get("overview", "_No overview returned._"))

        indexed = session_df.set_index("turn_idx")
        for section, (label, color) in SECTIONS.items():
            items = summary.get(section, [])
            st.markdown(
                f'#### <span style="color:{color};">{label}</span> '
                f'<span style="color:#888; font-size:0.7em;">({len(items)})</span>',
                unsafe_allow_html=True,
            )
            if not items:
                st.caption("Not substantively discussed in this session.")
                continue
            for item in items:
                st.markdown(f"**{item.get('theme', '')}** — {item.get('description', '')}")
                idxs = item.get("supporting_turn_idxs", [])
                with st.expander(f"Supporting turns ({len(idxs)})"):
                    cards = []
                    prev_idx = None
                    for idx in sorted(idxs):
                        if idx not in indexed.index:
                            continue
                        # Divider between non-contiguous stretches of conversation
                        if prev_idx is not None and idx - prev_idx > 1:
                            cards.append(gap_divider(idx - prev_idx - 1))
                        row = indexed.loc[idx]
                        cards.append(render_turn_html(
                            idx, row["source"], row["speaker"], row["start_sec"],
                            row["text"], color=colors.get(row["speaker"], "#888"),
                            anchor_prefix=f"sum-{section}",
                        ))
                        prev_idx = idx
                    st.markdown("".join(cards), unsafe_allow_html=True)


# --- Tab 2: Transcript --------------------------------------------------------

with tab_transcript:
    theme_map = build_theme_turn_map(cached["summary"]) if cached else {}
    if not cached:
        st.info("Run **Analyze session** to tag turns with themes. Showing plain transcript.")

    # Legend
    legend = " ".join(
        f'<span style="background:{color}; color:white; border-radius:10px; '
        f'padding:1px 8px; font-size:0.75em; margin-right:4px;">{label}</span>'
        for label, color in SECTIONS.values()
    )
    st.markdown(f"**Theme legend:** {legend}", unsafe_allow_html=True)

    with st.expander("Full transcript", expanded=False):
        f1, f2 = st.columns(2)
        speaker_filter = f1.multiselect("Speakers", sorted(session_df["speaker"].unique()))
        source_filter = f2.multiselect("Source", ["speech", "chat"])

        view_df = session_df
        if speaker_filter:
            view_df = view_df[view_df["speaker"].isin(speaker_filter)]
        if source_filter:
            view_df = view_df[view_df["source"].isin(source_filter)]

        n_pages = max(1, -(-len(view_df) // PAGE_SIZE))
        page_key = f"transcript_page_{selected_sid}"
        page = st.session_state.get(page_key, 0)
        page = min(page, n_pages - 1)

        p1, p2, p3 = st.columns([1, 3, 1])
        if p1.button("← Prev", disabled=page <= 0, use_container_width=True):
            st.session_state[page_key] = page - 1
            st.rerun()
        if p3.button("Next →", disabled=page >= n_pages - 1, use_container_width=True):
            st.session_state[page_key] = page + 1
            st.rerun()
        start, end = page * PAGE_SIZE, min((page + 1) * PAGE_SIZE, len(view_df))
        p2.markdown(
            f"<div style='text-align:center; color:#888;'>Page {page + 1} of {n_pages} — "
            f"turns {start + 1}–{end} of {len(view_df)}</div>",
            unsafe_allow_html=True,
        )

        page_df = view_df.iloc[start:end]
        cards = [
            render_turn_html(
                row.turn_idx, row.source, row.speaker, row.start_sec, row.text,
                theme_tags=theme_map.get(row.turn_idx),
                color=colors.get(row.speaker, "#888"),
                anchor_prefix="turn",
            )
            for row in page_df.itertuples()
        ]
        st.markdown("".join(cards), unsafe_allow_html=True)


# --- Tab 3: Quote search --------------------------------------------------------

with tab_quotes:
    st.markdown(
        "Find verbatim quotes about a topic. The AI returns **turn indices only** — quote "
        "text, speaker, and timestamp are resolved from the source data, so quotes cannot "
        "be fabricated."
    )
    q_col, b_col = st.columns([4, 1])
    query = q_col.text_input(
        "Search for quotes about…",
        placeholder="e.g. privacy and personal data, job displacement, AI in schools",
        label_visibility="collapsed",
    )
    search_clicked = b_col.button("Search", use_container_width=True)

    cache_key = (selected_sid, query.strip().lower())
    if search_clicked and query.strip():
        if not LLM_MODEL_LOW:
            st.error("LLM_MODEL_LOW is not configured — set it in .env.")
        else:
            with st.status("Searching transcript…") as status:
                try:
                    result = find_quotes(session_df, query.strip())
                    st.session_state.quote_results[cache_key] = result
                    status.update(label="Search complete", state="complete")
                except Exception as e:
                    status.update(label="Search failed", state="error")
                    st.error(f"Quote search failed: {e}")

    if query.strip() and cache_key in st.session_state.quote_results:
        quotes_df, n_hallucinated = st.session_state.quote_results[cache_key]
        if n_hallucinated:
            st.warning(f"{n_hallucinated} unverifiable turn reference(s) were discarded.")
        if quotes_df.empty:
            st.info("No relevant turns found in this session.")
        else:
            st.caption(f"{len(quotes_df)} verified quote(s), in conversation order:")
            for row in quotes_df.itertuples():
                st.markdown(
                    render_turn_html(
                        row.turn_idx, row.source, row.speaker, row.start_sec, row.text,
                        color=colors.get(row.speaker, "#888"), anchor_prefix="quote",
                    ),
                    unsafe_allow_html=True,
                )
                st.caption(f"↳ {row.why_relevant}")


# --- Tab 4: Custom analysis ------------------------------------------------------

with tab_custom:
    c1, c2 = st.columns(2)
    prompt_label = c1.selectbox("Analysis prompt", list(PROMPTS.keys()))
    model_choice = c2.selectbox(
        "Model",
        [m for m, _, _ in LLM_TIERS if m],
        format_func=lambda m: next(
            f"{tier} — {desc} ({m})" for mm, tier, desc in LLM_TIERS if mm == m
        ),
    )

    if PROMPTS[prompt_label] is None:
        user_prompt = st.text_area(
            "Custom prompt",
            height=160,
            placeholder=(
                "Ask anything about this discussion. The AI sees the full transcript with "
                "turn indices and will cite [turn:N]."
            ),
        )
    else:
        user_prompt = PROMPTS[prompt_label]
        with st.expander("View prompt"):
            st.code(user_prompt, language=None)

    est, n_chunks = estimate_cost(session_df, model_choice)
    run_col, est_col = st.columns([1, 3])
    run_clicked = run_col.button("Run analysis", type="primary", use_container_width=True)
    est_col.caption(
        f"~${est:.4f} estimated · {n_chunks} chunk{'s' if n_chunks > 1 else ''}"
        + (" · MAP pass uses the Low tier" if n_chunks > 1 else " · single whole-session call")
    )

    if run_clicked:
        if not (user_prompt and user_prompt.strip()):
            st.warning("Enter a prompt first.")
        else:
            with st.status("Analyzing…", expanded=n_chunks > 1) as status:
                try:
                    text, tokens = analyze_session_prompt(
                        session_df, user_prompt.strip(), model_choice, progress=status.write
                    )
                    cost = tokens_to_cost(tokens, model_choice)
                    html_text, cited = apply_turn_citations(text, anchor_prefix="ca")
                    st.session_state.analysis_results.setdefault(selected_sid, []).insert(0, {
                        "prompt_label": prompt_label,
                        "model": model_choice,
                        "html": html_text,
                        "cited": cited,
                        "tokens": tokens,
                        "cost": cost,
                        "ts": datetime.now(timezone.utc).isoformat(),
                    })
                    st.session_state.last_query_tokens = tokens
                    st.session_state.last_query_cost = cost
                    status.update(label="Analysis complete", state="complete", expanded=False)
                except Exception as e:
                    status.update(label="Analysis failed", state="error")
                    st.error(f"Analysis failed: {e}")

    for i, run in enumerate(st.session_state.analysis_results.get(selected_sid, [])):
        st.markdown("---")
        st.caption(
            f"**{run['prompt_label']}** · {run['model']} · {run['ts'][:16]} · "
            f"{run['tokens']:,} tokens (~${run['cost']:.4f})"
        )
        st.markdown(run["html"], unsafe_allow_html=True)
        if i == 0:  # render cited turn cards for the most recent run only (anchors are unique)
            render_cited_turns(session_df, run["cited"], colors, anchor_prefix="ca")


# --- Tab 5: Data export ----------------------------------------------------------

with tab_export:
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")

    st.markdown("##### Transcript")
    transcript_csv = session_df[
        ["turn_idx", "start_sec", "end_sec", "source", "speaker", "text"]
    ].to_csv(index=False)
    st.download_button(
        "Download transcript CSV",
        transcript_csv,
        file_name=f"engca_discussion_{selected_sid}_transcript_{ts}.csv",
        mime="text/csv",
    )

    st.markdown("##### Structured session summary")
    if cached:
        summary_payload = {
            "session_id": selected_sid,
            "model": cached["model"],
            "generated_at": cached["generated_at"],
            "total_tokens": cached["tokens"],
            **cached["summary"],
        }
        st.download_button(
            "Download summary JSON",
            json.dumps(summary_payload, indent=2),
            file_name=f"engca_discussion_{selected_sid}_summary_{ts}.json",
            mime="application/json",
        )
        st.caption("Summary text contains no speaker names by design — turns are referenced by index.")

        # Theme review CSV: one row per (theme, supporting turn) with verbatim quotes
        rows = []
        indexed = session_df.set_index("turn_idx")
        for section in SECTIONS:
            for item in cached["summary"].get(section, []):
                for idx in item.get("supporting_turn_idxs", []):
                    if idx in indexed.index:
                        r = indexed.loc[idx]
                        rows.append({
                            "session_id": selected_sid,
                            "section": section,
                            "theme": item.get("theme", ""),
                            "description": item.get("description", ""),
                            "turn_idx": idx,
                            "timestamp": fmt_ts(r["start_sec"]),
                            "speaker": r["speaker"],
                            "source": r["source"],
                            "quote": r["text"],
                        })
        if rows:
            st.download_button(
                "Download theme review CSV (themes + verbatim quotes)",
                pd.DataFrame(rows).to_csv(index=False),
                file_name=f"engca_discussion_{selected_sid}_themes_{ts}.csv",
                mime="text/csv",
            )
    else:
        st.caption("Run **Analyze session** first to enable summary and theme-review downloads.")

    st.markdown("##### Preview")
    st.dataframe(
        session_df[["turn_idx", "start_sec", "source", "speaker", "text"]].head(10),
        use_container_width=True,
        hide_index=True,
    )
