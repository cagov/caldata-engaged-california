-- This model calculates the count of Go Vocal users by various demographic and survey response fields.

{% set total_survey_fields = 11 %}

with

users_x_survey as (select * from {{ ref('int_govocal_users_x_ai_survey') }}),

counts as (
    select
        role_at_work,
        county,
        region,
        field_of_work,
        age,
        gender_category as gender,
        race_ethnicity_category as race_ethnicity,
        count(distinct user_id) as gv_users_count,
        count(distinct survey_respondent_id) as respondents_count,
        count(distinct case when publication_status = 'published' then survey_respondent_id end) as submitted_count,
        count(distinct case when publication_status = 'draft' then survey_respondent_id end) as drafts_count,
        count(distinct case when availability_for_discussion in ('Yes', 'Maybe') then survey_respondent_id end)
            as available_for_discussion_count,
        count(
            distinct case
                when
                    fields_completed_count = {{ total_survey_fields }}
                    then survey_respondent_id
            end
        ) as all_fields_completed_count,

        max(_loaded_at) as data_loaded_at

    from users_x_survey
    group by
        role_at_work,
        county,
        region,
        field_of_work,
        age,
        gender_category,
        race_ethnicity_category
)

select * from counts
