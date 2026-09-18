with

sessions as (
    select * from {{ ref('stg_transcript_times') }}
)

select
    session_id,
    session_date,
    discussion_start_sec,
    discussion_end_sec,
    row_number() over (order by session_date, session_id) as session_number
from sessions
