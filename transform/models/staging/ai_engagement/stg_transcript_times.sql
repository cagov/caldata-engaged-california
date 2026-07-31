with

seed as (
    select * from {{ ref('transcript_times') }}
)

select
    session_id,
    session_date,
    split_part(discussion_start_hms, ':', 1)::int * 3600
    + split_part(discussion_start_hms, ':', 2)::int * 60
    + split_part(discussion_start_hms, ':', 3)::int as discussion_start_sec,
    split_part(discussion_end_hms, ':', 1)::int * 3600
    + split_part(discussion_end_hms, ':', 2)::int * 60
    + split_part(discussion_end_hms, ':', 3)::int as discussion_end_sec
from seed
