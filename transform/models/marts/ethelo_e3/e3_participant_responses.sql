-- One row per participant with pivoted survey responses and top-level comments
with survey_pivoted as (
    select
        participant_id,
        max(
            case
                when question = 'Opening question - What makes you proud about your role in public service?' then answer
            end
        ) as point_of_pride,
        max(
            case when question = 'Share your idea - Which department or agency does your idea apply to?' then answer end
        ) as idea_dept,
        max(case when question = 'About you - Position type' then answer end) as pos_type,
        max(case when question = 'About you - How long have you worked for the State of California?' then answer end)
            as ca_tenure,
        max(response_date) as last_survey_response_date,
        max(_file_upload_date) as survey_file_upload_date
    from {{ ref('stg_ethelo_e3_survey') }}
    where
        question in (
            'Opening question - What makes you proud about your role in public service?',
            'Share your idea - Which department or agency does your idea apply to?',
            'About you - Position type',
            'About you - How long have you worked for the State of California?'
        )
        and response_date >= '2025-08-15'
    group by participant_id
),

comments_pivoted as (
    select
        posted_by_id as participant_id,
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
    group by posted_by_id
),

all_participants as (
    select participant_id from survey_pivoted
    union distinct
    select participant_id from comments_pivoted
)

select
    p.participant_id,
    s.point_of_pride,
    s.idea_dept,
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
