with

polls_raw as (select * from {{ source('GOOGLE_DRIVE_AI_POLLS', 'ZOOM_POLL_RESULTS_RAW') }}),


latest_snapshot as (
    select
        _file,
        max(_modified) as max_modified
    from polls_raw
    group by _file
),

current_snapshot as (
    select polls_raw.*
    from polls_raw
    inner join latest_snapshot
        on
            polls_raw._file = latest_snapshot._file
            and polls_raw._modified = latest_snapshot.max_modified
    -- guard against the same snapshot getting synced more than once ( a backfill
    -- re-run), which would otherwise duplicate every row at that line
    qualify row_number() over (
        partition by polls_raw._file, polls_raw._line
        order by polls_raw._fivetran_synced desc
    ) = 1
),


poll_details_marker as (
    select
        _file,
        _line as marker_line
    from current_snapshot
    where column_0 = 'Poll Details'
),


question_labels as (
    select
        current_snapshot._file,
        current_snapshot.column_7 as question_1_text,
        current_snapshot.column_8 as question_2_text,
        current_snapshot.column_9 as question_3_text
    from current_snapshot
    inner join poll_details_marker
        on
            current_snapshot._file = poll_details_marker._file
            and current_snapshot._line = poll_details_marker.marker_line + 1
)

select
    iff(current_snapshot._file ilike '%_post%', 'post', 'pre') as poll_stage,
    try_cast(current_snapshot.column_0 as int) as response_seq,
    try_to_timestamp(current_snapshot.column_3) as submitted_at,
    current_snapshot.column_4 as collected_from,
    current_snapshot.column_5 as topic_name,
    current_snapshot.column_6 as meeting_id,
    current_snapshot.column_7 as question_1_response,
    question_labels.question_1_text,
    current_snapshot.column_8 as question_2_response,
    question_labels.question_2_text,
    current_snapshot.column_9 as question_3_response,
    question_labels.question_3_text,
    current_snapshot._file,
    current_snapshot._fivetran_synced
from current_snapshot
inner join poll_details_marker
    on current_snapshot._file = poll_details_marker._file
inner join question_labels
    on current_snapshot._file = question_labels._file
where
    current_snapshot._line > poll_details_marker.marker_line + 1
    and try_to_timestamp(current_snapshot.column_3) >= '2026-07-09'
    -- exclude test polls that do not follow expected formar
    and current_snapshot.column_5 ilike '%Impact of AI%'
    and current_snapshot.column_5 not ilike '%test%'
