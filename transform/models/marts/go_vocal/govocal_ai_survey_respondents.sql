-- This model provides Phase 1 AI survey responses with demographic info added from user profiles.
-- It is limited to only the non-admin respondents who submitted ('published') the survey, removing drafts.

with

users_x_survey as (select * from {{ ref('int_govocal_users_x_ai_survey') }}),

survey_respondents as (
    select * exclude user_id
    from users_x_survey
    where
        survey_respondent_id is not null
        and publication_status <> 'draft'
        -- and user_status = 'active'
        -- and current_work_status <> 'No, I''m retired or choose not to work'
)

select * from survey_respondents
