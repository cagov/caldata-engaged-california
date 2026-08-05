with turns as (
    select * from {{ ref('int_phase2_transcript_turns') }}
),

turn_gaps as (
    select
        *,
        lead(speaker) over (partition by session_id order by start_sec, start_seq) as next_speaker,
        lead(start_sec) over (partition by session_id order by start_sec, start_seq) as next_start_sec
    from turns
),

turn_gap_sec as (
    select
        *,
        iff(next_speaker is not null and next_speaker != speaker, next_start_sec - end_sec, null) as gap_sec
    from turn_gaps
),

minute_density as (
    select
        session_id,
        floor(start_sec / 60) as start_minute,
        count(distinct speaker) as n_distinct_speakers,
        count(*) as n_turns,
        sum(gap_sec) as gap_sec
    from turn_gap_sec
    group by session_id, start_minute
),

session_avg as (
    select
        session_id,
        avg(n_distinct_speakers) as avg_speakers_per_minute
    from minute_density
    group by session_id
),

top_moments as (
    select
        d.session_id,
        d.start_minute,
        d.n_distinct_speakers,
        d.n_turns,
        d.gap_sec as minute_gap_sec,
        a.avg_speakers_per_minute,
        rank() over (
            partition by d.session_id
            order by d.n_distinct_speakers desc, d.gap_sec asc, d.n_turns desc
        ) as moment_rank
    from minute_density as d
    inner join session_avg as a on d.session_id = a.session_id
    qualify moment_rank <= 5
)

select
    t.session_id,
    m.moment_rank,
    m.start_minute,
    m.n_distinct_speakers,
    round(m.avg_speakers_per_minute, 2) as avg_speakers_per_minute,
    {{ format_hms('t.start_sec') }} as start_timestamp,
    {{ format_hms('t.end_sec') }} as end_timestamp,
    t.start_sec,
    t.end_sec,
    t.speaker,
    t.text,
    t.gap_sec
from turn_gap_sec as t
inner join top_moments as m
    on
        t.session_id = m.session_id
        and floor(t.start_sec / 60) = m.start_minute
order by t.session_id, m.moment_rank, t.start_sec
