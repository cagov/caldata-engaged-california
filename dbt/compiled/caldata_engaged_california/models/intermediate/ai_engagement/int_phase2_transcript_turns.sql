-- Group all sequential transcript lines (or 'cues') by the same person in a row together into "turns"
-- (e.g. 8 consecutive Participant A cues == 1 Participant A turn).

with cues as (
    select *
    from TRANSFORM_ENGCA_PRD.ai_engagement.stg_zoom_transcript_cues
),

-- Mark where the speaker changes: 1 = new turn starts here, 0 = same speaker as previous row.
flagged as (
    select
        *,
        case
            when EQUAL_NULL(speaker, LAG(speaker) over (partition by session_id order by seq))
                then 0
            else 1
        end as is_new_turn
    from cues
),

-- Running total of the 0/1 flags = a turn id. Ticks up by 1 at each speaker
-- change and stays flat within a turn, so all rows of one turn share a turn_grp.
grouped as (
    select
        *,
        SUM(is_new_turn) over (partition by session_id order by seq) as turn_grp
    from flagged
)

select
    session_id,
    MIN(seq) as start_seq,
    MAX(seq) as end_seq,
    ANY_VALUE(speaker) as speaker,
    MIN(start_sec) as start_sec,
    MAX(end_sec) as end_sec,
    -- Stitch the turn's cues back into one block of text, in cue order:
    LISTAGG(text, ' ') within group (order by seq) as text
from grouped
group by session_id, turn_grp
order by session_id, start_seq