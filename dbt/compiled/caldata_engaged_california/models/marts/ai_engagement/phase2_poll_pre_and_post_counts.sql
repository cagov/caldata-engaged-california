with unpivoted as (
    select * from TRANSFORM_ENGCA_PRD.ai_engagement.int_ai_engagement_zoom_poll
    where question_num != 4
    qualify count(distinct poll_stage) over (partition by meeting_id) = 2
)

select
    poll_stage,
    question_text,
    question_num,
    response,
    count(meeting_id) as responses
from unpivoted
group by poll_stage, question_text, response, question_num