-- this model joins all non-admin users with their responses from the ai survey.
-- users who did not submit a survey are included.

with

survey as (select * from TRANSFORM_ENGCA_PRD.govocal.int_govocal_ai_survey),

users as (select * from TRANSFORM_ENGCA_PRD.govocal.stg_govocal_users),

non_admin_users as (
    select *
    from users
    where is_admin = FALSE
),

multiselects as (
    select
        *,
        -- if array size is 1, then use the value from the array as a string and add ' (only)',
        -- if the array size is >1, then return the string 'Multiple', if the array is null, return null
        IFF(ARRAY_SIZE(gender_array) > 1, 'Multiple', gender_array[0] || ' (only)') as gender_category,
        IFF(ARRAY_SIZE(race_ethnicity_array) > 1, 'Multiple', race_ethnicity_array[0] || ' (only)')
            as race_ethnicity_category
    from non_admin_users
),

count_user_demographic_fields as (
    select
        *,
        IFF(age is not NULL, 1, 0)
        + IFF(gender_category is not NULL, 1, 0)
        + IFF(race_ethnicity_category is not NULL, 1, 0)
            as user_demographic_fields_completed_count
    from multiselects
)

select
    u.user_id,
    s.survey_respondent_id,
    s.survey_id,
    u.age,
    u.gender_array,
    u.gender_category,
    u.race_ethnicity_array,
    u.race_ethnicity_category,
    u.user_status,
    s.publication_status,
    s.current_work_status,
    s.role_at_work,
    s.county,
    s.region,
    s.field_of_work,
    s.economic_impact_expectation,
    s.government_action_suggestion,
    s.personal_ai_impact,
    s.availability_for_discussion,
    s.survey_fields_completed_count + u.user_demographic_fields_completed_count as fields_completed_count,
    u._loaded_at
from count_user_demographic_fields as u
left join survey as s on u.user_id = s.survey_respondent_id