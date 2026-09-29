-- This model calculates the count of Go Vocal users by various demographic and survey response fields.



with

users_x_survey as (select * from TRANSFORM_ENGCA_PRD.govocal.int_govocal_users_x_ai_survey),

ai_response_label as (
    select
        survey_respondent_id,
        case ai_response_label
            when 'neutral' then 'mix'
            when 'pro' then 'pos'
            when 'anti' then 'neg'
            else ai_response_label
        end as ai_response_label
    from TRANSFORM_ENGCA_PRD.govocal.int_govocal_ai_response_label
),

add_ai_label as (
    select
        u.*,
        a.ai_response_label
    from users_x_survey as u
    left join ai_response_label as a on u.survey_respondent_id = a.survey_respondent_id
),

counts as (
    select
        role_at_work,
        county,
        region,
        field_of_work,
        age,
        gender_category as gender,
        race_ethnicity_category as race_ethnicity,
        ai_response_label,
        count(distinct user_id) as gv_users_count,
        count(distinct survey_respondent_id) as respondents_count,
        count(distinct case when publication_status = 'published' then survey_respondent_id end) as submitted_count,
        count(distinct case when publication_status = 'draft' then survey_respondent_id end) as drafts_count,
        count(distinct case when availability_for_discussion in ('Yes', 'Maybe') then survey_respondent_id end)
            as available_for_discussion_count,
        count(
            distinct case
                when
                    fields_completed_count = 11
                    then survey_respondent_id
            end
        ) as all_fields_completed_count,

        max(_loaded_at) as data_loaded_at

    from add_ai_label
    group by
        role_at_work,
        county,
        region,
        field_of_work,
        age,
        gender_category,
        race_ethnicity_category,
        ai_response_label
)

select * from counts