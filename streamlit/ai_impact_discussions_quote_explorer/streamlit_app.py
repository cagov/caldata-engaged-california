import html
import json
import os

import pandas as pd
import plotly.express as px
import streamlit as st
from dotenv import load_dotenv


# ---------------------------------------------------------------------------
# Session — works both inside Snowflake native apps and locally
# ---------------------------------------------------------------------------

def get_session():
    load_dotenv(override=True)  # local Snowflake creds, optionally table overrides
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

# Theme tags are pre-computed by the dbt tagging pipeline (model
# phase2_transcript_curated_theme_tags, built on phase2_zoom_transcripts_and_chats
# against the stg_phase2_policy_concepts_and_themes taxonomy). This app only reads tables — it makes
# zero live Cortex calls. Tags reference turns by stable turn_hash; the app resolves
# those to the current transcript on load and hides (with a warning) any that no longer
# resolve. Point it at your environment via .env; defaults target the production
# analytics schema.
DISCUSSIONS_DATABASE = os.environ.get("DISCUSSIONS_DATABASE", "analytics_engca_prd")
DISCUSSIONS_SCHEMA = os.environ.get("DISCUSSIONS_SCHEMA", "ai_engagement")

QUOTES_TABLE = f"{DISCUSSIONS_DATABASE}.{DISCUSSIONS_SCHEMA}.phase2_transcript_curated_theme_tags"
EVENTS_TABLE = f"{DISCUSSIONS_DATABASE}.{DISCUSSIONS_SCHEMA}.phase2_zoom_transcripts_and_chats"
SPEAKERS_TABLE = f"{DISCUSSIONS_DATABASE}.{DISCUSSIONS_SCHEMA}.phase2_speaker_ai_survey"
SESSIONS_TABLE = f"{DISCUSSIONS_DATABASE}.{DISCUSSIONS_SCHEMA}.phase2_sessions"

PAGE_SIZE_QUOTES = 10  # quotes per page within a theme group
CONTEXT_STEP = 3       # transcript turns revealed per "show earlier/later" click

# One neutral pill color for all policy-concept badges: with ~27 concepts the label text
# carries identity, so per-concept hues would only add noise (and that many
# distinguishable colors don't exist anyway).
THEME_PILL_COLOR = "#1565c0"


# ---------------------------------------------------------------------------
# Page config and PII acknowledgment gate
# ---------------------------------------------------------------------------

st.set_page_config(page_title="Engaged California — pull quote explorer", layout="wide")

PII_ACKNOWLEDGED_KEY = "pii_acknowledged"

if not st.session_state.get(PII_ACKNOWLEDGED_KEY, False):
    st.title("Personal Information (PII) Notice")
    st.markdown(
        "> This dashboard contains personal information (PII) and is intended for authorized use only. Please use and handle this information responsibly and in accordance with privacy and security policies.\n"
        ">\n"
        "> Do not copy, download, export, or share PII unless you are authorized to do so and there is a legitimate business need. Take care to protect this information from unauthorized access or disclosure. \n"
        ">\n"
        "> Do not submit any data downloaded from this dashboard that may contain PII – including names, demographic information, or transcript excerpts that may identify or contain information about a speaker – to external LLMs or other AI tools."
    )
    if st.button("I Understand and Agree", type="primary"):
        st.session_state[PII_ACKNOWLEDGED_KEY] = True
        st.rerun()
    st.stop()

st.warning(
    "⚠️ **Contains Personal Information (PII)** – Do not download, copy, share, or disclose PII except as authorized by existing policy. Do not provide dashboard outputs containing PII to external LLMs or AI tools."
)

# ---------------------------------------------------------------------------
# Data loading — pre-tagged dbt tables
# ---------------------------------------------------------------------------

@st.cache_data
def load_quotes() -> pd.DataFrame:
    """Curated theme tags: one row per (session, theme, tagged turn) with verbatim text,
    plus one status row (turn_seq = 0) per (session, theme) pair — that's how "call
    failed" is distinguished from "no turns matched"."""
    df = session.sql(f"""
        SELECT session_id, policy_concept_id, policy_concept, policy_concept_description,
               subtheme, theme, turn_seq, turn_hash, turn_idx, source, start_sec, end_sec,
               speaker, text, n_matched_turns, tag_status,
               transcript_fingerprint::VARCHAR AS transcript_fingerprint,
               llm_model, processed_at,
               -- speaker_id computed here, matching the dbt definition
               -- (stg_zoom_transcript_speakers), so the app never hashes PII itself
               MD5(speaker || '|' || session_id) AS speaker_id
        FROM {QUOTES_TABLE}
        ORDER BY policy_concept_id, session_id, turn_idx
    """).to_pandas()
    df.columns = [c.lower() for c in df.columns]
    return df


@st.cache_data
def load_events() -> pd.DataFrame:
    """Combined speech + chat turns with the per-session turn_idx computed upstream in
    the dbt model. Used for the click-to-expand context around each quote."""
    df = session.sql(f"""
        SELECT session_id, source, src_ref, start_sec, end_sec, speaker, text, turn_hash, turn_idx,
               MD5(speaker || '|' || session_id) AS speaker_id
        FROM {EVENTS_TABLE}
        ORDER BY session_id, turn_idx
    """).to_pandas()
    df.columns = [c.lower() for c in df.columns]
    return df.sort_values(["session_id", "turn_idx"]).reset_index(drop=True)


@st.cache_data
def load_transcript_fingerprints() -> dict[str, str]:
    """Current per-session transcript fingerprint — the same HASH_AGG(turn_hash) the dbt
    model stamps on tag rows at tagging time. A tag whose stored fingerprint
    differs was made against an earlier version of the transcript (the pipeline re-tags
    it on its next run); the app flags the session as stale in the meantime."""
    df = session.sql(f"""
        SELECT session_id, HASH_AGG(turn_hash)::VARCHAR AS fingerprint
        FROM {EVENTS_TABLE}
        GROUP BY session_id
    """).to_pandas()
    return {r.SESSION_ID: str(r.FINGERPRINT) for r in df.itertuples()}


@st.cache_data
def load_sessions() -> pd.DataFrame:
    """Session-level data with chronological numbering: session_id, session_date,
    session_number. Used to label sessions everywhere in the UI."""
    df = session.sql(f"""
        SELECT session_id, session_date, session_number
        FROM {SESSIONS_TABLE}
        ORDER BY session_number
    """).to_pandas()
    df.columns = [c.lower() for c in df.columns]
    return df


@st.cache_data
def load_speakers() -> pd.DataFrame:
    """Speaker demographic information, keyed by speaker_id (md5 of speaker || '|' || session_id).
    The *_string columns feed the per-card demographics line; the raw columns feed the
    sidebar demographic filters (race_ethnicity_array keeps multi-response answers
    separate so a speaker matches any ethnicity they selected)."""
    try:
        df = session.sql(f"""
            SELECT
            speaker_id, age, gender_string, race_ethnicity_array, region_string,
            field_of_work_string, field_of_work_sortition_grouping, ai_response_string,
            '🎂 ' || age_string || '   |   ⚧️ ' || gender_string || '   |   🧑🏽‍🤝‍🧑🏿 ' ||
            race_ethnicity_string || '   |   📍 ' || region_string || '   |   💼 ' ||
            field_of_work_string || '   |   ✨ ' || ai_response_string
            as all_attributes_string
            FROM {SPEAKERS_TABLE}
        """).to_pandas()
        df.columns = [c.lower() for c in df.columns]
        return df
    except Exception:
        # Table may not exist or user lacks permissions; return empty dataframe
        return pd.DataFrame()


def get_speaker_demographics(speaker_id: str | None, speakers_df: pd.DataFrame) -> str | None:
    """Look up speaker demographics by speaker_id (computed in SQL at load time, matching
    the dbt definition). Returns formatted string or None if not found."""
    if speakers_df.empty or speaker_id is None or pd.isna(speaker_id):
        return None
    row = speakers_df[speakers_df["speaker_id"] == speaker_id]
    if row.empty:
        return None
    r = row.iloc[0]
    demographics = str(r["all_attributes_string"]) if pd.notna(r["all_attributes_string"]) else None
    return demographics if demographics else None


# ---------------------------------------------------------------------------
# UI rendering helpers
# ---------------------------------------------------------------------------

def fmt_ts(sec) -> str:
    """Seconds since meeting start -> mm:ss (or h:mm:ss over an hour)."""
    if pd.isna(sec):
        return "??:??"
    sec = int(sec)
    h, rem = divmod(sec, 3600)
    m, s = divmod(rem, 60)
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m:02d}:{s:02d}"


def speaker_colors(session_df: pd.DataFrame) -> dict[str, str]:
    """Stable per-session palette: sorted speakers mapped round-robin onto Plotly colors."""
    palette = px.colors.qualitative.Plotly
    speakers = sorted(session_df["speaker"].fillna("(unknown)").unique())
    return {s: palette[i % len(palette)] for i, s in enumerate(speakers)}


def theme_badge(label: str) -> str:
    # rem (not em) so the pill doesn't shrink further when nested in small-text
    # containers like the quote footer.
    return (
        f'<span style="background:{THEME_PILL_COLOR}; color:white; '
        f'border-radius:10px; padding:1px 8px; font-size:0.8rem; margin-left:4px; '
        f'white-space:nowrap;">{html.escape(label)}</span>'
    )


def turn_copy_text(speaker, demographics, session_label: str, start_sec, source,
                   text, concepts: list[str]) -> str:
    """Plain-text rendering of a turn for copying: quote, attribution line,
    demographics, and any policy concepts tagged on the turn."""
    clean = " ".join(str("" if text is None or (isinstance(text, float) and pd.isna(text)) else text).split())
    name = "(unknown)" if speaker is None or (isinstance(speaker, float) and pd.isna(speaker)) else str(speaker)
    lines = [
        f'"{clean}"',
        f"— {name} · {session_label} · {fmt_ts(start_sec)} · {source}",
    ]
    if demographics:
        lines.append(f"Demographics: {demographics}")
    if concepts:
        lines.append("Policy concept(s): " + "; ".join(concepts))
    return "\n".join(lines)


def render_turn_html(turn_idx: int, source: str, speaker: str, start_sec, text: str,
                     theme_tags: list[str] | None = None,
                     color: str = "#888", anchor_prefix: str = "turn",
                     speaker_demographics: str | None = None,
                     dimmed: bool = False) -> str:
    """One turn as an HTML card with speaker color, demographics, meta line, and theme
    badges. dimmed=True renders the muted style used for surrounding-context turns."""
    is_chat = source == "chat"
    badges = "".join(theme_badge(lbl) for lbl in (theme_tags or []))
    # Low-alpha tint stays readable on both light and dark Streamlit themes
    background = "background:rgba(128,160,200,0.18);" if is_chat else ""
    icon = "💬 chat" if is_chat else "🎙 speech"
    border = "2px solid rgba(136,136,136,0.5)" if dimmed else f"4px solid {color}"
    opacity = "opacity:0.6;" if dimmed else ""
    speaker_color = "#888" if dimmed else color
    # scroll-margin-top keeps the card top visible below Streamlit's sticky header
    return (
        f'<div id="{anchor_prefix}-{turn_idx}" class="ecq-card" style="'
        f'border-left:{border}; {opacity}'
        f'padding:6px 10px; margin:4px 0; border-radius:4px; scroll-margin-top:4.5rem; '
        f"{background}\">"
        f'<span style="color:{speaker_color}; font-weight:600;">{html.escape(str(speaker))}</span>'
        # #888 (not the upstream app's #333) so the demographics line stays legible on the
        # dark Streamlit theme too
        + (f' <span style="color:#888; font-size:0.80em; padding-left: 16px;">{html.escape(speaker_demographics)}</span>' if speaker_demographics else "")
        + f'<div style="color:#999; font-size:0.80em; margin-top:2px; margin-bottom:6px;">[{turn_idx}] · {fmt_ts(start_sec)} · {icon}</div>'
        f"{badges}"
        f'<div style="margin-top:2px;">{html.escape(str(text))}</div>'
        f"</div>"
    )


# Solid full-width rule between quote blocks (deliberately distinct from the dashed
# gap_divider used inside transcript context). When one quote's expanded context grows
# to overlap the next quote's turns, the blocks still render independently — the
# separator marks block boundaries, not transcript continuity.
QUOTE_SEPARATOR = (
    '<div style="border-top:1px solid rgba(136,136,136,0.4); margin:4px 0 16px;"></div>'
)


def quote_footer_html(session_label: str, also_tagged: list[str]) -> str:
    """Small provenance line under a quote block: which session, and the turn's other
    themes (a multi-theme turn appears under each of its themes)."""
    also = ""
    if also_tagged:
        also = ' · also tagged: ' + "".join(theme_badge(lbl) for lbl in also_tagged)
    return (
        f'<div style="color:#888; font-size:0.9rem; margin:4px 0 14px 4px;">'
        f"{html.escape(session_label)}{also}</div>"
    )


# ---------------------------------------------------------------------------
# Load data
# ---------------------------------------------------------------------------

try:
    tags_df = load_quotes()
except Exception as e:
    st.error(f"Failed to load theme tags from {QUOTES_TABLE}: {e}")
    st.stop()

if tags_df.empty:
    st.warning(
        f"No theme tags found in {QUOTES_TABLE}. Run the "
        "`phase2_transcript_curated_theme_tags` dbt model to populate it."
    )
    st.stop()

try:
    events_df = load_events()
except Exception as e:
    st.error(f"Failed to load transcript data from {EVENTS_TABLE}: {e}")
    st.stop()

speakers_df = load_speakers()

# Status rows (turn_seq == 0) carry tag_status per (session, theme) pair; quote rows
# (turn_seq > 0) are the tagged turns themselves.
status_df = tags_df[tags_df["turn_seq"] == 0]
quotes_df = tags_df[tags_df["turn_seq"] > 0].copy()

# Tags cite turns by stable turn_hash; resolve each to its CURRENT positional turn_idx so
# the UI (ordering, context expansion) can index the transcript. A hash that no longer
# exists means the turn changed since tagging — hide the quote (not shown rather than
# shown wrong) and surface a count; the pipeline re-tags the session on its next run.
idx_by_hash = {
    sid: dict(zip(g["turn_hash"], g["turn_idx"].astype(int)))
    for sid, g in events_df.groupby("session_id")
}
quotes_df["current_idx"] = [
    idx_by_hash.get(sid, {}).get(th)
    for sid, th in zip(quotes_df["session_id"], quotes_df["turn_hash"])
]
n_unresolved = int(quotes_df["current_idx"].isna().sum())
quotes_df = quotes_df[quotes_df["current_idx"].notna()].copy()
quotes_df["current_idx"] = quotes_df["current_idx"].astype(int)

# Sessions whose transcript changed since tagging (any stored fingerprint differs from the
# current one). Their surviving quotes still resolve correctly via turn_hash.
try:
    current_fingerprints = load_transcript_fingerprints()
except Exception:
    current_fingerprints = {}  # every session then reads as stale — fail visible, not silent
stale_sids = sorted({
    sid
    for sid, fp in zip(tags_df["session_id"], tags_df["transcript_fingerprint"])
    if (str(fp) if pd.notna(fp) else None) != current_fingerprints.get(sid)
})

# Session labels & chronological order from phase2_sessions, with a fallback for
# sessions missing from that table.
try:
    sessions_df = load_sessions()
    sessions_dict = dict(zip(sessions_df["session_id"], zip(sessions_df["session_number"], sessions_df["session_date"])))
except Exception:
    sessions_dict = {}


def format_session_label(sid: str) -> str:
    if sid in sessions_dict:
        session_num, session_date = sessions_dict[sid]
        date_str = session_date.strftime("%-m/%-d") if hasattr(session_date, "strftime") else str(session_date)
        return f"Session {session_num} ({date_str})"
    return f"{sid} (missing session data)"


all_sids = sorted(
    tags_df["session_id"].unique(),
    key=lambda sid: (sid not in sessions_dict, sessions_dict.get(sid, (0,))[0], sid),
)
session_rank = {sid: i for i, sid in enumerate(all_sids)}
quotes_df["session_rank"] = quotes_df["session_id"].map(session_rank)

# Per-session structures for context expansion: turn_idx-indexed events, index bounds,
# and a stable speaker color map.
events_by_session: dict[str, pd.DataFrame] = {}
idx_bounds: dict[str, tuple[int, int]] = {}
colors_by_session: dict[str, dict[str, str]] = {}
for sid, group in events_df.groupby("session_id"):
    indexed = group.set_index("turn_idx").sort_index()
    events_by_session[sid] = indexed
    idx_bounds[sid] = (int(indexed.index.min()), int(indexed.index.max()))
    colors_by_session[sid] = speaker_colors(group)

# Participant demographics per quote, for the sidebar filters. Quotes join to the survey
# table on speaker_id; anyone without a survey match (or who skipped a question) lands in
# "None specified" so the bucket can be included or excluded explicitly.
NONE_SPECIFIED = "None specified"
AGE_ORDER = ["18-24", "25-44", "45-64", "Over 65"]
DEMOGRAPHIC_FILTERS = [  # (quotes_df column, sidebar label)
    ("age_group", "Age range"),
    ("gender", "Gender"),
    ("ethnicity", "Race / ethnicity"),
    ("field_broad", "Industry (broad)"),
    ("field_detail", "Industry (detailed)"),
    ("region", "Region"),
]


def _parse_array(value) -> list[str]:
    """Snowflake ARRAY columns arrive as JSON strings (or lists); normalize to a list."""
    if isinstance(value, (list, tuple)):
        return [str(v) for v in value]
    if isinstance(value, str) and value.strip().startswith("["):
        try:
            return [str(v) for v in json.loads(value)]
        except json.JSONDecodeError:
            return []
    return []


if not speakers_df.empty:
    demo = speakers_df.drop_duplicates("speaker_id").set_index("speaker_id")
    quotes_df = quotes_df.join(
        demo[["age", "gender_string", "race_ethnicity_array", "region_string",
              "field_of_work_string", "field_of_work_sortition_grouping"]],
        on="speaker_id",
    )
else:
    for c in ["age", "gender_string", "race_ethnicity_array", "region_string",
              "field_of_work_string", "field_of_work_sortition_grouping"]:
        quotes_df[c] = None
quotes_df["age_group"] = quotes_df["age"].fillna(NONE_SPECIFIED)
quotes_df["gender"] = quotes_df["gender_string"].fillna(NONE_SPECIFIED)
quotes_df["ethnicity"] = [
    arr or [NONE_SPECIFIED] for arr in quotes_df["race_ethnicity_array"].map(_parse_array)
]
quotes_df["field_broad"] = quotes_df["field_of_work_sortition_grouping"].fillna(NONE_SPECIFIED)
quotes_df["field_detail"] = quotes_df["field_of_work_string"].fillna(NONE_SPECIFIED)
quotes_df["region"] = quotes_df["region_string"].fillna(NONE_SPECIFIED)


def demographic_options(col: str) -> list[str]:
    """Filter choices for one demographic column: age in life order, everything else by
    quote count, with the non-answer buckets last."""
    values = quotes_df[col].explode() if col == "ethnicity" else quotes_df[col]
    counts = values.value_counts()
    tail = [v for v in (NONE_SPECIFIED, "I don't want to say") if v in counts.index]
    if col == "age_group":
        head = [v for v in AGE_ORDER if v in counts.index]
    else:
        head = [v for v in counts.index if v not in tail]
    return head + tail


# (session, turn_hash) -> every policy concept tagged on that turn, for "also tagged" pills.
turn_concepts: dict[tuple[str, str], list[str]] = (
    quotes_df.groupby(["session_id", "turn_hash"])["policy_concept"]
    .agg(lambda s: sorted(s.unique()))
    .to_dict()
)


# ---------------------------------------------------------------------------
# Sidebar — filters
# ---------------------------------------------------------------------------

with st.sidebar:
    st.header("Filters")
    st.caption("Empty filters mean “show everything”. The chart and quote list react to all of them.")

    theme_filter = st.multiselect("Themes", sorted(quotes_df["theme"].unique()))
    concept_totals = quotes_df.groupby("policy_concept").size().sort_values(ascending=False)
    concept_filter = st.multiselect("Policy concepts", list(concept_totals.index))
    session_filter = st.multiselect("Sessions", all_sids, format_func=format_session_label)
    speaker_filter = st.multiselect("Speakers", sorted(quotes_df["speaker"].dropna().unique()))
    source_filter = st.multiselect("Source", ["speech", "chat"])

    st.subheader("Participant demographics")
    st.caption(
        "From the participant survey. Speakers without a survey match, or who skipped a "
        "question, are under “None specified”."
    )
    demographic_filters = {
        col: st.multiselect(label, demographic_options(col)) for col, label in DEMOGRAPHIC_FILTERS
    }

    st.divider()
    if st.button("Refresh data", type="primary", width="stretch"):
        load_quotes.clear()
        load_events.clear()
        load_transcript_fingerprints.clear()
        load_sessions.clear()
        load_speakers.clear()
        st.rerun()

filtered_df = quotes_df
if theme_filter:
    filtered_df = filtered_df[filtered_df["theme"].isin(theme_filter)]
if concept_filter:
    filtered_df = filtered_df[filtered_df["policy_concept"].isin(concept_filter)]
if session_filter:
    filtered_df = filtered_df[filtered_df["session_id"].isin(session_filter)]
if speaker_filter:
    filtered_df = filtered_df[filtered_df["speaker"].isin(speaker_filter)]
if source_filter:
    filtered_df = filtered_df[filtered_df["source"].isin(source_filter)]
for col, selected in demographic_filters.items():
    if not selected:
        continue
    if col == "ethnicity":  # list-valued: match if the speaker selected ANY chosen ethnicity
        chosen = set(selected)
        filtered_df = filtered_df[filtered_df[col].map(lambda arr: bool(chosen & set(arr)))]
    else:
        filtered_df = filtered_df[filtered_df[col].isin(selected)]


# ---------------------------------------------------------------------------
# Header
# ---------------------------------------------------------------------------

st.title("Engaged California — pull quote explorer")
st.markdown(
    "Browse representative participant quotes from the phase 2 discussion sessions, organized "
    "by the manually-curated policy concepts (grouped theme › subtheme › policy concept). "
    "Tags are pre-computed by the dbt pipeline; every quote is "
    "resolved verbatim from the source transcript, never from a model's memory. Facilitator and "
    "staff turns are excluded."
)

m1, m2, m3, m4 = st.columns(4)
# Unique turns, not tag rows — a turn tagged with several concepts is still one quote
m1.metric("Quotes", f"{len(filtered_df.drop_duplicates(['session_id', 'turn_hash'])):,}")
m2.metric("Policy concepts", filtered_df["policy_concept"].nunique())
m3.metric("Sessions", filtered_df["session_id"].nunique())
m4.metric("Speakers", filtered_df["speaker"].nunique())

failed_pairs = status_df[status_df["tag_status"] == "FAILED"]
if not failed_pairs.empty:
    st.warning(
        f"⚠️ {len(failed_pairs)} (session, theme) tagging call(s) FAILED — their quotes are "
        "missing below. Failed pairs are retried automatically on the next dbt pipeline run."
    )

if stale_sids:
    stale_labels = ", ".join(format_session_label(sid) for sid in stale_sids)
    st.warning(
        f"⚠️ {len(stale_sids)} session(s) have **stale tags** — the transcript changed since "
        f"tagging ({stale_labels}). Counted across all sessions, regardless of the current "
        "filters. The pipeline re-tags affected sessions automatically on its next run; "
        "until then treat their tags as provisional."
    )

if n_unresolved:
    st.warning(
        f"⚠️ {n_unresolved} tagged quote(s) no longer resolve to a current transcript turn "
        "and are hidden rather than shown wrong. Counted across all sessions, regardless of "
        "the current filters; they will be re-tagged on the next pipeline run."
    )

if not status_df.empty:
    latest = status_df.sort_values("processed_at").iloc[-1]
    st.caption(
        f"Tagged with `{latest['llm_model']}` · latest run {str(latest['processed_at'])[:16]} · "
        "served from the pre-tagged dbt table."
    )


# ---------------------------------------------------------------------------
# Theme frequency by session (reacts to the sidebar filters)
# ---------------------------------------------------------------------------

if filtered_df.empty:
    st.info("No quotes match the current filters.")
    st.stop()

# Policy concepts ordered by filtered quote count (desc) — this order also drives the
# quote groups below, so the chart doubles as a table of contents.
concept_order = list(filtered_df.groupby("policy_concept").size().sort_values(ascending=False).index)
chart_sids = [sid for sid in all_sids if sid in set(filtered_df["session_id"])]

heat = (
    filtered_df.groupby(["policy_concept", "session_id"]).size().rename("n").reset_index()
    .pivot(index="policy_concept", columns="session_id", values="n")
    .reindex(index=concept_order, columns=chart_sids)
    .fillna(0)
    .astype(int)
)

# Nested expanders aren't allowed in Streamlit, so the table lives in a tab here
# rather than its own expander.
with st.expander("📊 Policy concept frequency by session", expanded=False):
    chart_tab, table_tab = st.tabs(["Chart", "Table"])
    with chart_tab:
        fig = px.imshow(
            heat.values,
            x=[format_session_label(sid) for sid in chart_sids],
            y=concept_order,
            color_continuous_scale="Blues",  # magnitude = one hue, light -> dark
            aspect="auto",
        )
        fig.update_traces(hovertemplate="%{y}<br>%{x}<br>%{z} quote(s)<extra></extra>")
        fig.update_xaxes(side="top", tickangle=-40)
        fig.update_layout(
            height=max(280, 120 + 24 * len(concept_order)),
            margin=dict(l=0, r=0, t=10, b=10),
            coloraxis_colorbar=dict(title="Quotes"),
            xaxis_title=None,
            yaxis_title=None,
        )
        st.plotly_chart(fig, use_container_width=True)
    with table_tab:
        table = heat.rename(columns={sid: format_session_label(sid) for sid in chart_sids})
        st.dataframe(table, width="stretch")

st.download_button(
    "Download filtered quotes CSV",
    filtered_df.sort_values(["policy_concept", "session_rank", "current_idx"])[[
        "policy_concept_id", "policy_concept", "subtheme", "theme", "session_id", "turn_hash",
        "current_idx", "start_sec", "source", "speaker", "text",
    ]].rename(columns={"current_idx": "turn_idx"}).to_csv(index=False),
    file_name="engca_pull_quotes.csv",
    mime="text/csv",
)


# ---------------------------------------------------------------------------
# Quote list, grouped by theme
# ---------------------------------------------------------------------------

def _bump(state_key: str) -> None:
    st.session_state[state_key] = st.session_state.get(state_key, 0) + CONTEXT_STEP


def _flip(state_key: str) -> None:
    st.session_state[state_key] = not st.session_state.get(state_key, False)


def _reset(state_key: str) -> None:
    st.session_state[state_key] = 0


def _shift_page(page_key: str, delta: int, n_pages: int) -> None:
    page = st.session_state.get(page_key, 0) + delta
    st.session_state[page_key] = max(0, min(n_pages - 1, page))


def render_quote_block(concept_id: str, row, show_separator: bool = False) -> None:
    """One tagged turn plus its expandable context: a "show earlier/later" button above
    and below reveals CONTEXT_STEP more transcript turns per click, and a "hide" button
    collapses that side again (state survives reruns via st.session_state). Context
    turns render dimmed and unbadged so the tagged turn stays visually primary.

    The tagged turn is addressed by its stable turn_hash, resolved upstream to its
    CURRENT turn_idx — everything here (content, timestamps, context) renders from the
    current transcript, so it can never drift from the source data."""
    sid = row.session_id
    idx = int(row.current_idx)
    indexed = events_by_session.get(sid)
    lo_bound, hi_bound = idx_bounds.get(sid, (idx, idx))
    base = f"{concept_id}_{sid}_{row.turn_hash}"
    up_key, dn_key = f"ctx_up_{base}", f"ctx_dn_{base}"
    lo = max(lo_bound, idx - st.session_state.get(up_key, 0))
    hi = min(hi_bound, idx + st.session_state.get(dn_key, 0))

    if show_separator:
        st.markdown(QUOTE_SEPARATOR, unsafe_allow_html=True)

    if lo > lo_bound or lo < idx:
        b1, b2, _ = st.columns([1, 1, 2])
        if lo > lo_bound:
            b1.button(
                f"⋯ show {min(CONTEXT_STEP, lo - lo_bound)} earlier turn(s)",
                key=f"btn_{up_key}", on_click=_bump, args=(up_key,),
            )
        if lo < idx:
            b2.button(
                "hide earlier turns",
                key=f"btnhide_{up_key}", on_click=_reset, args=(up_key,),
            )

    colors = colors_by_session.get(sid, {})
    anchor = f"q-{base}"
    session_label = format_session_label(sid)
    cards = []
    quote_copy_text = None
    for i in range(lo, hi + 1):
        if indexed is None or i not in indexed.index:
            continue
        r = indexed.loc[i]
        demographics = get_speaker_demographics(r["speaker_id"], speakers_df)
        if i == idx:
            quote_copy_text = turn_copy_text(
                r["speaker"], demographics, session_label, r["start_sec"], r["source"],
                r["text"], turn_concepts.get((sid, r["turn_hash"]), []),
            )
            cards.append(render_turn_html(
                idx, r["source"], r["speaker"], r["start_sec"], r["text"],
                color=colors.get(r["speaker"], "#888"), anchor_prefix=anchor,
                speaker_demographics=demographics,
            ))
        else:
            cards.append(render_turn_html(
                i, r["source"], r["speaker"], r["start_sec"], r["text"],
                anchor_prefix=anchor, dimmed=True,
            ))
    also_tagged = [lbl for lbl in turn_concepts.get((sid, row.turn_hash), []) if lbl != row.policy_concept]
    cards.append(quote_footer_html(format_session_label(sid), also_tagged))
    st.markdown("".join(cards), unsafe_allow_html=True)

    # Copy affordance with NO JavaScript: a code block gets Streamlit's native copy button.
    # (Any script or iframe on this page — st.components.v1.html, or st.html with
    # unsafe_allow_javascript — drops the websocket session right after the initial render
    # on Streamlit 1.62 and silently kills every button; verified headless 2026-09-02.)
    if quote_copy_text:
        c1, _ = st.columns([1, 3])
        with c1.popover("⧉ Copy quote", help="Quote with attribution and demographics, ready to paste"):
            st.code(quote_copy_text, language=None, wrap_lines=True)

    if hi < hi_bound or hi > idx:
        b1, b2, _ = st.columns([1, 1, 2])
        if hi < hi_bound:
            b1.button(
                f"⋯ show {min(CONTEXT_STEP, hi_bound - hi)} later turn(s)",
                key=f"btn_{dn_key}", on_click=_bump, args=(dn_key,),
            )
        if hi > idx:
            b2.button(
                "hide later turns",
                key=f"btnhide_{dn_key}", on_click=_reset, args=(dn_key,),
            )


@st.fragment
def render_theme_group(concept_id: str, theme_df: pd.DataFrame) -> None:
    """Everything inside one theme's expander. As a fragment, button clicks in here
    (pagination, context expansion) rerun only this group — the rest of the page,
    including the other expanders' open state, is untouched."""
    page_key = f"qpage_{concept_id}"
    n_pages = max(1, -(-len(theme_df) // PAGE_SIZE_QUOTES))
    page = min(st.session_state.get(page_key, 0), n_pages - 1)
    st.session_state[page_key] = page

    if n_pages > 1:
        p1, p2, p3 = st.columns([1, 3, 1])
        p1.button("← Prev", key=f"prev_{concept_id}", disabled=page <= 0,
                  on_click=_shift_page, args=(page_key, -1, n_pages), width="stretch")
        p3.button("Next →", key=f"next_{concept_id}", disabled=page >= n_pages - 1,
                  on_click=_shift_page, args=(page_key, 1, n_pages), width="stretch")
        start, end = page * PAGE_SIZE_QUOTES, min((page + 1) * PAGE_SIZE_QUOTES, len(theme_df))
        p2.markdown(
            f"<div style='text-align:center; color:#888;'>Page {page + 1} of {n_pages} — "
            f"quotes {start + 1}–{end} of {len(theme_df)}</div>",
            unsafe_allow_html=True,
        )
    else:
        start, end = 0, len(theme_df)

    for j, quote_row in enumerate(theme_df.iloc[start:end].itertuples()):
        render_quote_block(concept_id, quote_row, show_separator=j > 0)


st.markdown("### Quotes by policy concept")

concept_meta = filtered_df.drop_duplicates("policy_concept").set_index("policy_concept")

# Quote groups render LAZILY: only an opened concept's quotes are built and sent to the
# browser. Rendering all ~27 groups eagerly (hundreds of cards, buttons, and popovers)
# pushed the initial page past the point where the browser session survived — the websocket
# dropped right after the first render and every button silently died (verified headless,
# 2026-09-02; adding any element type, even an empty iframe, tipped it over). The
# accordion is hand-rolled from buttons because Streamlit-in-Snowflake tops out at 1.52,
# and st.expander only exposes its open state (key/on_change) from 1.62.
st.markdown(
    # Dress the tertiary accordion buttons as expander-style header rows: left-aligned
    # (the centering lives on an unnamed flex div INSIDE the button, hence the > div
    # selector — verified against streamlit 1.52.2 DOM), bordered, with a hover tint so
    # they read as clickable. Scoped to tertiary, which only the accordion uses; styling
    # secondary would leak onto every default button in the app.
    "<style>"
    "[data-testid='stBaseButton-tertiary'], [data-testid='stBaseButton-tertiary'] > div "
    "{ justify-content: flex-start; text-align: left; }"
    "[data-testid='stBaseButton-tertiary'] {"
    "  border: 1px solid rgba(136, 136, 136, 0.35); border-radius: 8px;"
    "  padding: 0.5rem 0.75rem; margin-bottom: 2px;"
    "}"
    "[data-testid='stBaseButton-tertiary']:hover {"
    "  border-color: #1565c0; background: rgba(21, 101, 192, 0.06);"
    "}"
    "</style>",
    unsafe_allow_html=True,
)
for policy_concept in concept_order:
    theme_df = (
        filtered_df[filtered_df["policy_concept"] == policy_concept]
        .sort_values(["session_rank", "current_idx"])
    )
    meta = concept_meta.loc[policy_concept]
    state_key = f"exp_{meta['policy_concept_id']}"
    is_open = st.session_state.get(state_key, False)
    st.button(
        f"{'▾' if is_open else '▸'} **{policy_concept}** "
        f"({len(theme_df)} quote{'s' if len(theme_df) != 1 else ''})",
        key=f"btn_{state_key}",
        on_click=_flip,
        args=(state_key,),
        type="tertiary",
        width="stretch",
    )
    if not is_open:
        continue
    with st.container(border=True):
        crumb = " › ".join(str(v) for v in [meta["theme"], meta["subtheme"]] if pd.notna(v) and v)
        description = meta["policy_concept_description"]
        caption = " — ".join(p for p in [crumb, description if isinstance(description, str) else ""] if p)
        if caption:
            st.caption(caption)
        render_theme_group(meta["policy_concept_id"], theme_df)
