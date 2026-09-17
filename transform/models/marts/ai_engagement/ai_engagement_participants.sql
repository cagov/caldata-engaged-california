-- Canonical AI engagement participant table: one row per eligible Phase 1 survey respondent,
-- with flags for Phase 2 invitation and attendance. See _ai_engagement_mart_models.yml for the
-- full list of eligibility criteria.

with

phase1_respondents as (
    select *
    from {{ ref('int_govocal_users_x_ai_survey') }}
    where
        survey_respondent_id is not null
        and publication_status = 'published'
        -- exclude internal ODI staff and test accounts
        and lower(trim(email)) not like '%@innovation.ca.gov'
        -- exclude minors and respondents who left age blank
        and age is not null
        and age <> 'Under 18'
        -- CA residents only: null region covers 'I live outside of California', 'I don''t want to say', and blank
        and region is not null
),

-- One row per respondent who answered at least one of the three open-text AI questions.
-- The inner join below makes this an eligibility criterion.
-- The raw label column mixes vocabularies (mostly pos/neg/mix, with some neutral/pro/anti), so
-- normalize to pos/neg/mix here, matching int_govocal_sortition_candidates.
ai_response_labels as (
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

-- Anyone who appears in the sortition selections table was invited to Phase 2.
sortition_invitees as (
    select distinct survey_respondent_id
    from {{ source('AI_ENGAGEMENT', 'INT_AI_ENGAGEMENT_SORTITION_SELECTIONS') }}
),

gv_users as (
    select
        user_id,
        email
    from {{ ref('stg_govocal_users') }}
),

unmatched_participants as (
    select
        invitee_email,
        survey_respondent_id_match
    from {{ ref('stg_zoom_unmatched_participants') }}
),

-- Attendees are resolved from the attendance tracker by matching invitee_email. The manually-maintained
-- unmatched-participants match takes precedence over a direct Go Vocal email match: a participant can
-- register for Phase 2 with a different email that has its own (survey-less) Go Vocal account, in which
-- case the email match points at the wrong account and the curated match is the correct one.
attendance as (
    select coalesce(un.survey_respondent_id_match, gv.user_id) as survey_respondent_id
    from {{ ref('stg_attendance_tracker') }} as att
    left join gv_users as gv
        on lower(trim(att.invitee_email)) = lower(trim(gv.email))
    left join unmatched_participants as un
        on lower(trim(att.invitee_email)) = lower(trim(un.invitee_email))
    where lower(trim(att.actual_status)) = 'attended'
),

phase2_attendees as (
    select distinct survey_respondent_id
    from attendance
    where survey_respondent_id is not null
)

select
    r.survey_respondent_id,
    r.age,
    r.gender_array,
    r.gender_category,
    r.race_ethnicity_array,
    r.race_ethnicity_category,
    r.county,
    r.region,
    r.field_of_work,
    case
        when r.field_of_work is null or r.field_of_work = 'I don''t want to say' then 'Non-response' else
            (
                case r.field_of_work
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
                    else r.field_of_work
                end
            )
    end as field_of_work_rollup,
    r.current_work_status,
    r.role_at_work,
    ai.ai_response_label,
    si.survey_respondent_id is not null as invited_to_phase2,
    pa.survey_respondent_id is not null as attended_phase2
from phase1_respondents as r
-- inner join: respondents with no open-text AI answers have no label row and are excluded
inner join ai_response_labels as ai
    on r.survey_respondent_id = ai.survey_respondent_id
left join sortition_invitees as si
    on r.survey_respondent_id = si.survey_respondent_id
left join phase2_attendees as pa
    on r.survey_respondent_id = pa.survey_respondent_id
