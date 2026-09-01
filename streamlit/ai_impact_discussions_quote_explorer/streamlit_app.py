import html
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
# against the curated_discussion_themes seed). This app only reads tables — it makes
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

# One neutral pill color for all theme badges: with 29 themes the label text carries
# identity, so per-theme hues would only add noise (and 29 distinguishable colors
# don't exist anyway).
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
        SELECT session_id, theme_id, theme_label, theme_description, turn_seq, turn_hash,
               turn_idx, source, start_sec, end_sec, speaker, text,
               n_matched_turns, tag_status, transcript_fingerprint, llm_model, processed_at
        FROM {QUOTES_TABLE}
        ORDER BY theme_id, session_id, turn_idx
    """).to_pandas()
    df.columns = [c.lower() for c in df.columns]
    return df


@st.cache_data
def load_events() -> pd.DataFrame:
    """Combined speech + chat turns with the per-session turn_idx computed upstream in
    the dbt model. Used for the click-to-expand context around each quote."""
    df = session.sql(f"""
        SELECT session_id, source, src_ref, start_sec, end_sec, speaker, text, turn_hash, turn_idx
        FROM {EVENTS_TABLE}
        ORDER BY session_id, turn_idx
    """).to_pandas()
    df.columns = [c.lower() for c in df.columns]
    return df.sort_values(["session_id", "turn_idx"]).reset_index(drop=True)


@st.cache_data
def load_transcript_fingerprints() -> dict[str, int]:
    """Current per-session transcript fingerprint — the same HASH_AGG(turn_hash) the dbt
    model stamps on tag rows at tagging time. A tag whose stored fingerprint differs was
    made against an earlier version of the transcript (the pipeline re-tags it on its
    next run); the app flags the session as stale in the meantime."""
    df = session.sql(f"""
        SELECT session_id, HASH_AGG(turn_hash) AS fingerprint
        FROM {EVENTS_TABLE}
        GROUP BY session_id
    """).to_pandas()
    return {r.SESSION_ID: int(r.FINGERPRINT) for r in df.itertuples()}


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
    """Speaker demographic information, keyed by speaker_id (md5 of speaker || '|' || session_id)."""
    try:
        df = session.sql(f"""
            SELECT
            speaker_id, age_string, gender_string, race_ethnicity_string, region_string, field_of_work_string, ai_response_string,
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


def build_speaker_id(speaker: str, session_id: str) -> str:
    """Build the speaker_id: md5(speaker || '|' || session_id)."""
    import hashlib
    combined = f"{speaker}|{session_id}"
    return hashlib.md5(combined.encode()).hexdigest()


def get_speaker_demographics(speaker: str, session_id: str, speakers_df: pd.DataFrame) -> str | None:
    """Look up speaker demographics by speaker_id. Returns formatted string or None if not found."""
    if speakers_df.empty:
        return None
    speaker_id = build_speaker_id(speaker, session_id)
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
    return (
        f'<span style="background:{THEME_PILL_COLOR}; color:white; '
        f'border-radius:10px; padding:1px 8px; font-size:0.75em; margin-left:4px; '
        f'white-space:nowrap;">{html.escape(label)}</span>'
    )


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
        f'<div id="{anchor_prefix}-{turn_idx}" style="border-left:{border}; {opacity}'
        f'padding:6px 10px; margin:4px 0; border-radius:4px; scroll-margin-top:4.5rem; '
        f"{background}\">"
        f'<span style="color:{speaker_color}; font-weight:600;">{html.escape(str(speaker))}</span>'
        + (f' <span style="color:#333; font-size:0.80em; padding-left: 16px;">{html.escape(speaker_demographics)}</span>' if speaker_demographics else "")
        + f'<div style="color:#999; font-size:0.80em; margin-top:2px; margin-bottom:6px;">[{turn_idx}] · {fmt_ts(start_sec)} · {icon}</div>'
        f"{badges}"
        f'<div style="margin-top:2px;">{html.escape(str(text))}</div>'
        f"</div>"
    )


def quote_footer_html(session_label: str, also_tagged: list[str]) -> str:
    """Small provenance line under a quote block: which session, and the turn's other
    themes (a multi-theme turn appears under each of its themes)."""
    also = ""
    if also_tagged:
        also = ' · also tagged: ' + "".join(theme_badge(lbl) for lbl in also_tagged)
    return (
        f'<div style="color:#888; font-size:0.8em; margin:2px 0 14px 4px;">'
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
    if (int(fp) if pd.notna(fp) else None) != current_fingerprints.get(sid)
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

# (session, turn_hash) -> every theme label tagged on that turn, for "also tagged" pills.
turn_themes: dict[tuple[str, str], list[str]] = (
    quotes_df.groupby(["session_id", "turn_hash"])["theme_label"]
    .agg(lambda s: sorted(s.unique()))
    .to_dict()
)


# ---------------------------------------------------------------------------
# Sidebar — filters
# ---------------------------------------------------------------------------

with st.sidebar:
    st.header("Filters")
    st.caption("Empty filters mean “show everything”. The chart and quote list react to all of them.")

    theme_totals = quotes_df.groupby("theme_label").size().sort_values(ascending=False)
    theme_filter = st.multiselect("Themes", list(theme_totals.index))
    session_filter = st.multiselect("Sessions", all_sids, format_func=format_session_label)
    speaker_filter = st.multiselect("Speakers", sorted(quotes_df["speaker"].dropna().unique()))
    source_filter = st.multiselect("Source", ["speech", "chat"])

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
    filtered_df = filtered_df[filtered_df["theme_label"].isin(theme_filter)]
if session_filter:
    filtered_df = filtered_df[filtered_df["session_id"].isin(session_filter)]
if speaker_filter:
    filtered_df = filtered_df[filtered_df["speaker"].isin(speaker_filter)]
if source_filter:
    filtered_df = filtered_df[filtered_df["source"].isin(source_filter)]


# ---------------------------------------------------------------------------
# Header
# ---------------------------------------------------------------------------

st.title("Engaged California — pull quote explorer")
st.markdown(
    "Browse representative participant quotes from the phase 2 discussion sessions, organized "
    "by the manually-curated themes. Tags are pre-computed by the dbt pipeline; every quote is "
    "resolved verbatim from the source transcript, never from a model's memory. Facilitator and "
    "staff turns are excluded."
)

m1, m2, m3, m4 = st.columns(4)
m1.metric("Tagged quotes", f"{len(filtered_df):,}")
m2.metric("Themes", filtered_df["theme_label"].nunique())
m3.metric("Sessions", filtered_df["session_id"].nunique())
m4.metric("Speakers", filtered_df["speaker"].nunique())

failed_pairs = status_df[status_df["tag_status"] == "FAILED"]
if not failed_pairs.empty:
    st.warning(
        f"⚠️ {len(failed_pairs)} (session, theme) tagging call(s) FAILED — their quotes are "
        "missing below. Failed pairs are retried automatically on the next dbt pipeline run."
    )

if stale_sids or n_unresolved:
    stale_labels = ", ".join(format_session_label(sid) for sid in stale_sids)
    st.warning(
        f"⚠️ {len(stale_sids)} session(s) have **stale tags** — the transcript changed since "
        f"tagging ({stale_labels}). {n_unresolved} tagged quote(s) no longer resolve to a "
        "current turn and are hidden rather than shown wrong. The pipeline re-tags affected "
        "sessions automatically on its next run; until then treat their tags as provisional."
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

st.markdown("### Theme frequency by session")

# Themes ordered by filtered quote count (desc) — this order also drives the quote
# groups below, so the chart doubles as a table of contents.
theme_order = list(filtered_df.groupby("theme_label").size().sort_values(ascending=False).index)
chart_sids = [sid for sid in all_sids if sid in set(filtered_df["session_id"])]

heat = (
    filtered_df.groupby(["theme_label", "session_id"]).size().rename("n").reset_index()
    .pivot(index="theme_label", columns="session_id", values="n")
    .reindex(index=theme_order, columns=chart_sids)
    .fillna(0)
    .astype(int)
)
fig = px.imshow(
    heat.values,
    x=[format_session_label(sid) for sid in chart_sids],
    y=theme_order,
    color_continuous_scale="Blues",  # magnitude = one hue, light -> dark
    aspect="auto",
)
fig.update_traces(hovertemplate="%{y}<br>%{x}<br>%{z} quote(s)<extra></extra>")
fig.update_xaxes(side="top", tickangle=-40)
fig.update_layout(
    height=max(280, 120 + 24 * len(theme_order)),
    margin=dict(l=0, r=0, t=10, b=10),
    coloraxis_colorbar=dict(title="Quotes"),
    xaxis_title=None,
    yaxis_title=None,
)
st.plotly_chart(fig, use_container_width=True)

with st.expander("View as table"):
    table = heat.rename(columns={sid: format_session_label(sid) for sid in chart_sids})
    st.dataframe(table, width="stretch")

st.download_button(
    "Download filtered quotes CSV",
    filtered_df.sort_values(["theme_label", "session_rank", "current_idx"])[[
        "theme_id", "theme_label", "session_id", "turn_hash", "current_idx", "start_sec",
        "source", "speaker", "text",
    ]].rename(columns={"current_idx": "turn_idx"}).to_csv(index=False),
    file_name="engca_pull_quotes.csv",
    mime="text/csv",
)


# ---------------------------------------------------------------------------
# Quote list, grouped by theme
# ---------------------------------------------------------------------------

def _bump(state_key: str) -> None:
    st.session_state[state_key] = st.session_state.get(state_key, 0) + CONTEXT_STEP


def _shift_page(page_key: str, delta: int, n_pages: int) -> None:
    page = st.session_state.get(page_key, 0) + delta
    st.session_state[page_key] = max(0, min(n_pages - 1, page))


def render_quote_block(theme_id: int, row) -> None:
    """One tagged turn plus its expandable context: a "show earlier/later" button above
    and below reveals CONTEXT_STEP more transcript turns per click (state survives
    reruns via st.session_state). Context turns render dimmed and unbadged so the
    tagged turn stays visually primary.

    The tagged turn is addressed by its stable turn_hash, resolved upstream to its
    CURRENT turn_idx — everything here (content, timestamps, context) renders from the
    current transcript, so it can never drift from the source data."""
    sid = row.session_id
    idx = int(row.current_idx)
    indexed = events_by_session.get(sid)
    lo_bound, hi_bound = idx_bounds.get(sid, (idx, idx))
    base = f"{theme_id}_{sid}_{row.turn_hash}"
    up_key, dn_key = f"ctx_up_{base}", f"ctx_dn_{base}"
    lo = max(lo_bound, idx - st.session_state.get(up_key, 0))
    hi = min(hi_bound, idx + st.session_state.get(dn_key, 0))

    if lo > lo_bound:
        st.button(
            f"⋯ show {min(CONTEXT_STEP, lo - lo_bound)} earlier turn(s)",
            key=f"btn_{up_key}", on_click=_bump, args=(up_key,),
        )

    colors = colors_by_session.get(sid, {})
    anchor = f"q-{base}"
    cards = []
    for i in range(lo, hi + 1):
        if indexed is None or i not in indexed.index:
            continue
        r = indexed.loc[i]
        if i == idx:
            cards.append(render_turn_html(
                idx, r["source"], r["speaker"], r["start_sec"], r["text"],
                color=colors.get(r["speaker"], "#888"), anchor_prefix=anchor,
                speaker_demographics=get_speaker_demographics(r["speaker"], sid, speakers_df),
            ))
        else:
            cards.append(render_turn_html(
                i, r["source"], r["speaker"], r["start_sec"], r["text"],
                anchor_prefix=anchor, dimmed=True,
            ))
    also_tagged = [lbl for lbl in turn_themes.get((sid, row.turn_hash), []) if lbl != row.theme_label]
    cards.append(quote_footer_html(format_session_label(sid), also_tagged))
    st.markdown("".join(cards), unsafe_allow_html=True)

    if hi < hi_bound:
        st.button(
            f"⋯ show {min(CONTEXT_STEP, hi_bound - hi)} later turn(s)",
            key=f"btn_{dn_key}", on_click=_bump, args=(dn_key,),
        )


@st.fragment
def render_theme_group(theme_id: int, theme_df: pd.DataFrame) -> None:
    """Everything inside one theme's expander. As a fragment, button clicks in here
    (pagination, context expansion) rerun only this group — the rest of the page,
    including the other expanders' open state, is untouched."""
    page_key = f"qpage_{theme_id}"
    n_pages = max(1, -(-len(theme_df) // PAGE_SIZE_QUOTES))
    page = min(st.session_state.get(page_key, 0), n_pages - 1)
    st.session_state[page_key] = page

    if n_pages > 1:
        p1, p2, p3 = st.columns([1, 3, 1])
        p1.button("← Prev", key=f"prev_{theme_id}", disabled=page <= 0,
                  on_click=_shift_page, args=(page_key, -1, n_pages), width="stretch")
        p3.button("Next →", key=f"next_{theme_id}", disabled=page >= n_pages - 1,
                  on_click=_shift_page, args=(page_key, 1, n_pages), width="stretch")
        start, end = page * PAGE_SIZE_QUOTES, min((page + 1) * PAGE_SIZE_QUOTES, len(theme_df))
        p2.markdown(
            f"<div style='text-align:center; color:#888;'>Page {page + 1} of {n_pages} — "
            f"quotes {start + 1}–{end} of {len(theme_df)}</div>",
            unsafe_allow_html=True,
        )
    else:
        start, end = 0, len(theme_df)

    for quote_row in theme_df.iloc[start:end].itertuples():
        render_quote_block(theme_id, quote_row)


st.markdown("### Quotes by theme")

theme_ids = filtered_df.drop_duplicates("theme_label").set_index("theme_label")["theme_id"]
theme_descriptions = filtered_df.drop_duplicates("theme_label").set_index("theme_label")["theme_description"]

for theme_label in theme_order:
    theme_df = (
        filtered_df[filtered_df["theme_label"] == theme_label]
        .sort_values(["session_rank", "current_idx"])
    )
    with st.expander(f"**{theme_label}** ({len(theme_df)} quote{'s' if len(theme_df) != 1 else ''})"):
        description = theme_descriptions.get(theme_label)
        if isinstance(description, str) and description:
            st.caption(description)
        render_theme_group(theme_ids[theme_label], theme_df)
