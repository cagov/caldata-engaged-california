with unpivoted as (select * from {{ ref('int_ai_engagement_zoom_poll') }}),

grouped as (
    select
        question_num,
        question_text,
        response,
        poll_stage,
        count(meeting_id) as respondent_count
    from unpivoted
    where question_num = 4
    group by poll_stage, response, question_num, question_text
)

select *
from grouped
