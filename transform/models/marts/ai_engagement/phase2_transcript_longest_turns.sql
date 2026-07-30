-- The 1-3 longest speaking turns per participant in each Phase 2 transcript, with timestamps.
-- Facilitators/staff are excluded if their zoom name includes Staff/Facilitator or EngageCA

with turns as (
    select * from {{ ref('int_phase2_transcript_turns') }}
),

participant_turns as (
    select *
    from turns
    where
        speaker is not null
        and speaker not ilike '%engage%'
        and speaker not ilike '%facilitator%'
        and speaker not ilike '%staff%'
)

select
    session_id,
    speaker,
    {{ format_hms('start_sec') }} as start_timestamp,
    {{ format_hms('end_sec') }} as end_timestamp,
    start_sec,
    end_sec,
    end_sec - start_sec as duration_sec,
    regexp_count(trim(text), '\\s+') + 1 as word_count,
    text
from participant_turns
qualify
    rank() over (
        partition by session_id, speaker
        order by end_sec - start_sec desc
    ) <= 3
order by session_id asc, speaker asc, duration_sec desc
