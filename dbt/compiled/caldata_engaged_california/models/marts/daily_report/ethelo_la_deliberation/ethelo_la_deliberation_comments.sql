--create a comments mart
with comments as (
    select * from TRANSFORM_ENGCA_PRD.ethelo_la_deliberation.stg_ethelo_la_deliberation_comments
),

survey as (
    select * from TRANSFORM_ENGCA_PRD.ethelo_la_deliberation.int_participant_survey_responses_wide
)

select
    count(distinct comments.comment_id) as num_comments,
    count(distinct comments.posted_by_id) as num_participants_w_commments,
    survey.evacuation_zone,
    max(comments._fivetran_synced) as max_fivetran_sync
from comments
left join survey on comments.posted_by_id = survey.participant_id
group by survey.evacuation_zone