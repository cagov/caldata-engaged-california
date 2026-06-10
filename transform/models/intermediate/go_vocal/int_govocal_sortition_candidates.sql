with

users_x_survey as (select * from {{ ref('int_govocal_users_x_ai_survey') }}),

-- ai labels, mapping 'neutral' to 'mix', 'pro' to 'pos', and 'anti' to 'neg'
ai_response_label as (
    select
        survey_respondent_id,
        case ai_response_label
            when 'neutral' then 'mix'
            when 'pro' then 'pos'
            when 'anti' then 'neg'
            else ai_response_label
        end as ai_response_label
    from {{ ref('int_govocal_ai_response_label') }}
),

invitee_status as (select * from {{ ref('int_ai_engagement_phase2_invitee_status') }}),

candidates as (
    select *
    from users_x_survey
    where
        survey_respondent_id is not null
        and publication_status <> 'draft'
        and availability_for_discussion in ('Yes', 'Maybe')
        and region is not null  -- this will exclude county in ('I don''t want to say', 'I live outside of California')
        and age <> 'Under 18'
        and current_work_status <> 'No, I''m retired or choose not to work'
        and current_work_status is not null
        and current_work_status <> 'I don''t want to say'
),

group_categorize as (
    select
        survey_respondent_id,
        case when age is null or age = 'I don''t want to say' then 'Non-response' else age end as age,
        case
            when gender_category is null or gender_category = 'I don''t want to say (only)' then 'Non-response'
            when
                gender_category in
                (
                    'Another gender identity (like transgender, non-binary, or gender non-conforming) (only)',
                    'Multiple'
                ) then 'Nonbinary / multi / other'
            else gender_category
        end as gender_category,
        case
            when
                race_ethnicity_category is null or race_ethnicity_category = 'I don''t want to say (only)'
                then 'Non-response'
            else race_ethnicity_category
        end as race_ethnicity_category,
        region,
        case
            when field_of_work is null or field_of_work = 'I don''t want to say' then 'Non-response' else
                (
                    case field_of_work
                        when 'Agriculture, forestry, or fishing' then 'Goods producing and harvesting'
                        when 'Architecture or engineering' then 'Professional services'
                        when 'Construction' then 'Goods producing and harvesting'
                        when 'Corporate ownership or governance' then 'Professional services'
                        when 'Finance' then 'Financial'
                        when 'I don''t currently work' then 'Unemployed, looking'
                        when 'Insurance' then 'Financial'
                        when 'Legal' then 'Professional services'
                        when 'Manufacturing' then 'Goods producing and harvesting'
                        when 'Mining, quarrying, or oil and gas extraction' then 'Goods producing and harvesting'
                        when 'Non-profit' then 'Other'
                        when 'Real estate or leasing' then 'Financial'
                        when 'Retail or wholesale trade' then 'Retail or wholesale trade'
                        when 'Science' then 'Professional services'
                        when 'Transportation or warehousing' then 'Logistics'
                        when 'Utilities or waste management' then 'Logistics'
                        else field_of_work
                    end
                )
        end as field_of_work
    from candidates
),

-- add ai lables, with filtering to ensure any unexpected label values are converted to 'mix'
add_ai_labels as (
    select
        g.*,
        coalesce(ai.ai_response_label, 'mix') as ai_response_label
    from group_categorize as g
    left join ai_response_label as ai
        on g.survey_respondent_id = ai.survey_respondent_id
    where ai.ai_response_label in ('pos', 'neg', 'mix')
),

add_invitee_status as (
    select
        a.*,
        i.invitee_status
    from add_ai_labels as a
    left join invitee_status as i
        on a.survey_respondent_id = i.survey_respondent_id
)

select * from add_invitee_status
