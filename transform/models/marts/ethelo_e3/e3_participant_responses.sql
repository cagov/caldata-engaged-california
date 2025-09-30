-- One row per comment with pivoted survey responses and top-level comments
with survey_pivoted as (
    select
        participant_id,
        point_of_pride,
        pos_type,
        ca_tenure,
        last_survey_response_date,
        _file_upload_date as survey_file_upload_date
    from {{ ref('int_participant_survey_responses') }}
),

comments_pivoted as (
    select
        posted_by_id as participant_id,
        comment_id,
        max(
            case
                when target = 'Share your idea - Primary problem and ideas to solve the problem' then comment_content
            end
        ) as main_idea,
        max(case when target = 'Share what has been working - Examples' then comment_content end) as whats_working,
        max(
            case
                when
                    target
                    = 'Anything else? - Would you add any other ideas, including from your perspective as a California resident?' -- noqa: LT05
                    then comment_content
            end
        ) as other_ideas,
        max(posted_on) as last_comment_date,
        max(_file_upload_date) as comments_file_upload_date
    from {{ ref('stg_ethelo_e3_comments') }}
    where
        reply_to_id is null  -- Only top-level comments
        and target in (
            'Share your idea - Primary problem and ideas to solve the problem',
            'Share what has been working - Examples',
            'Anything else? - Would you add any other ideas, including from your perspective as a California resident?'
        )
        and posted_on >= '2025-08-15'
    group by posted_by_id, comment_id
),

department as (
    select
        comment_id,
        department_list
    from {{ ref('int_comment_department') }}
),

all_participants as (
    select participant_id from survey_pivoted
    union distinct
    select participant_id from comments_pivoted
)

select
    p.participant_id,
    c.comment_id,
    s.point_of_pride,
    d.department_list,
    s.pos_type,
    s.ca_tenure,
    c.main_idea,
    c.whats_working,
    c.other_ideas,
    s.last_survey_response_date,
    c.last_comment_date,
    coalesce(s.survey_file_upload_date, c.comments_file_upload_date) as _file_upload_date
from all_participants as p
left join survey_pivoted as s on p.participant_id = s.participant_id
left join comments_pivoted as c on p.participant_id = c.participant_id
left join department as d on c.comment_id = d.comment_id
