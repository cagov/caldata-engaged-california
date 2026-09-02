-- The pre-tagged transcript: one row per (tagged turn, theme), with the verbatim turn
-- text, speaker, and timestamps joined back from the source data. Because the AI only
-- ever returns turn indices — validated and translated to stable turn_hashes upstream in
-- phase2_transcript_session_summaries — quotes in this table cannot be hallucinated.
--
-- Use this to display theme-tagged turns in dashboards (e.g. badge turns in a transcript
-- view, or list supporting quotes under each theme) without any joins at read time.
-- NOTE: speaker display names are PII — theme/summary text upstream excludes them by
-- design, but this table intentionally carries them for verified quote display. Confirm
-- the display policy before exposing speakers publicly.

with theme_tags as (
    select *
    from {{ ref('phase2_transcript_session_summaries') }}
    where section != 'overview'
),

exploded as (
    select distinct
        tt.session_id,
        th.value::string as turn_hash,
        tt.section,
        tt.theme_seq,
        tt.theme_label,
        tt.summary_text as theme_description
    from theme_tags as tt,
        lateral flatten(input => tt.supporting_turn_hashes) as th
),

turns as (
    select * from {{ ref('phase2_zoom_transcripts_and_chats') }}
)

select
    e.session_id,
    e.turn_hash,
    t.turn_idx,
    e.section,
    e.theme_seq,
    e.theme_label,
    e.theme_description,
    t.start_sec,
    t.end_sec,
    t.source,
    t.speaker,
    t.text
from exploded as e
inner join turns as t
    on
        e.session_id = t.session_id
        and e.turn_hash = t.turn_hash
order by e.session_id, t.turn_idx, e.section, e.theme_seq
