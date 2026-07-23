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
    lpad(floor(start_sec / 60)::int, 2, '0') || ':' || lpad(floor(mod(start_sec, 60))::int, 2, '0')
        as start_timestamp,
    lpad(floor(end_sec / 60)::int, 2, '0') || ':' || lpad(floor(mod(end_sec, 60))::int, 2, '0')
        as end_timestamp,
    start_sec,
    end_sec,
    end_sec - start_sec as duration_sec,
    regexp_count(trim(text), '\\s+') + 1 as word_count,
    text
from participant_turns
qualify
    row_number() over (
        partition by session_id, speaker
        order by end_sec - start_sec desc
    ) <= 3
order by session_id asc, speaker asc, duration_sec desc
