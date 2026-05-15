with ai_survey as (
    select * from {{ ref('int_govocal_ai_survey') }}
),

ai_users as (
    select * from {{ ref('int_govocal_users_x_ai_survey') }}
)

select
    s.survey_id as idea_id,
    s.county,
    s.field_of_work,
    s.current_work_status,
    s.role_at_work,
    s.availability_for_discussion,
    s.economic_impact_expectation,
    s.government_action_suggestion,
    s.personal_ai_impact,
    s.published_at,
    s.submitted_at,
    u.age,
    u.gender_category,
    u.race_ethnicity_category
from ai_survey as s
left join ai_users as u
    on s.survey_respondent_id = u.user_id
