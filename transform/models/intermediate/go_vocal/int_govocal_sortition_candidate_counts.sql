with

users_x_survey as (select * from {{ ref('int_govocal_users_x_ai_survey') }}),

candidates as (
    select *
    from users_x_survey
    where
        survey_respondent_id is not null
        and publication_status <> 'draft'
        and availability_for_discussion in ('Yes', 'Maybe')
        and region is not null  -- this will exclude county in ('I don''t want to say', 'I live outside of California')
        -- and county <> 'I don''t want to say'
        -- and county <> 'I live outside of California'
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
                        when 'Legal' then 'Legal / Financial'
                        when 'Finance' then 'Legal / Financial'
                        when 'Transportation or warehousing' then 'Logistics'
                        when 'Manufacturing' then 'Logistics'
                        when 'Healthcare' then 'Healthcare'
                        when 'Government' then 'Public sector'
                        when 'Education' then 'Academia'
                        when 'Arts, entertainment, or media' then 'Creative'
                        when 'Retail or wholesale trade' then 'Retail'
                        when 'Information technology' then 'Information technology'
                        else 'Other'
                    end
                )
        end as field_of_work
    from candidates
),

unpivoted as (
    select
        question,
        answer,
        count(*) as candidates_count
    from group_categorize
    unpivot (answer for question in (age, gender_category, race_ethnicity_category, region, field_of_work))
    group by question, answer
)

select * from unpivoted
