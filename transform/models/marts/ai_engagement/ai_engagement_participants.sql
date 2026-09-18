-- Canonical AI engagement participant table: one row per participant, where a participant is an
-- eligible Phase 1 survey respondent, a Phase 2 session attendee, or both. See
-- _ai_engagement_mart_models.yml for the full list of Phase 1 eligibility criteria.
--
-- Phase 2 attendance counts every non-staff person marked 'attended' in the attendance tracker,
-- including "crashers" who attended without a sortition invitation and even attendees with no Go
-- Vocal account at all (leadership decision, 2026-09). Those attendees get their own rows with
-- participated_in_phase1 = false, so the Phase 1 population is unchanged when filtered on that flag.

with

-- One row per non-admin Go Vocal user with their survey responses (null when they took no survey).
-- Prefer the published survey when a user somehow has more than one row, so the Phase 1 population
-- below is unaffected by drafts.
gv_users_x_survey as (
    select *
    from {{ ref('int_govocal_users_x_ai_survey') }}
    qualify
        row_number()
            over (
                partition by user_id
                order by iff(publication_status = 'published', 0, 1), published_at desc nulls last
            )
        = 1
),

-- One row per respondent who answered at least one of the three open-text AI questions.
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

-- Phase 1 participants: eligible survey respondents.
phase1_participants as (
    select u.user_id
    from gv_users_x_survey as u
    -- inner join: respondents with no open-text AI answers have no label row and are not eligible
    inner join ai_response_labels as ai
        on u.user_id = ai.survey_respondent_id
    where
        u.survey_respondent_id is not null
        and u.publication_status = 'published'
        -- exclude internal ODI staff and test accounts
        and lower(trim(u.email)) not like '%@innovation.ca.gov'
        -- exclude minors and respondents who left age blank
        and u.age is not null
        and u.age <> 'Under 18'
        -- CA residents only: null region covers 'I live outside of California', 'I don''t want to say', and blank
        and u.region is not null
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
        staff_or_moderator,
        survey_respondent_id_match
    from {{ ref('stg_zoom_unmatched_participants') }}
),

-- Phase 2 attendees are every non-staff 'attended' row in the attendance tracker, resolved to a Go Vocal
-- user where possible by matching invitee_email. The manually-maintained unmatched-participants match takes
-- precedence over a direct Go Vocal email match: a participant can register for Phase 2 with a different
-- email that has its own (survey-less) Go Vocal account, in which case the email match points at the wrong
-- account and the curated match is the correct one. Attendees with no Go Vocal account keep a null user_id
-- and are identified by their tracker email instead.
attendance as (
    select
        lower(trim(att.invitee_email)) as invitee_email,
        coalesce(un.survey_respondent_id_match, gv.user_id) as user_id
    from {{ ref('stg_attendance_tracker') }} as att
    left join gv_users as gv
        on lower(trim(att.invitee_email)) = lower(trim(gv.email))
    left join unmatched_participants as un
        on lower(trim(att.invitee_email)) = lower(trim(un.invitee_email))
    where
        lower(trim(att.actual_status)) = 'attended'
        -- staff are recorded with actual_status = 'Staff', but also drop anyone flagged as staff/moderator
        -- in the curated match list or registered with an internal email
        and coalesce(un.staff_or_moderator, false) = false
        and lower(trim(att.invitee_email)) not like '%@innovation.ca.gov'
),

-- One row per attendee: the Go Vocal user when matched, otherwise the tracker email.
phase2_attendees as (
    select distinct
        user_id,
        iff(user_id is null, invitee_email, null) as unmatched_email
    from attendance
),

-- Union of the two populations...
participant_rows as (
    select
        user_id,
        null as unmatched_email,
        true as participated_in_phase1,
        false as attended_phase2
    from phase1_participants
    union all
    select
        user_id,
        unmatched_email,
        false as participated_in_phase1,
        true as attended_phase2
    from phase2_attendees
),

-- ...collapsed to one row per person.
participants as (
    select
        user_id,
        unmatched_email,
        boolor_agg(participated_in_phase1) as participated_in_phase1,
        boolor_agg(attended_phase2) as attended_phase2
    from participant_rows
    group by user_id, unmatched_email
)

select
    -- Go Vocal user ID when the participant has an account; otherwise a hash of the attendance-tracker
    -- email so attendees with no account still get a stable, non-PII key.
    coalesce(p.user_id, md5(p.unmatched_email)) as participant_id,
    p.user_id as survey_respondent_id,
    u.age,
    u.gender_array,
    u.gender_category,
    u.race_ethnicity_array,
    u.race_ethnicity_category,
    u.county,
    u.region,
    u.field_of_work,
    case
        when u.field_of_work is null or u.field_of_work = 'I don''t want to say' then 'Non-response' else
            (
                case u.field_of_work
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
                    else u.field_of_work
                end
            )
    end as field_of_work_rollup,
    u.current_work_status,
    u.role_at_work,
    ai.ai_response_label,
    p.participated_in_phase1,
    si.survey_respondent_id is not null as invited_to_phase2,
    p.attended_phase2
from participants as p
left join gv_users_x_survey as u
    on p.user_id = u.user_id
left join ai_response_labels as ai
    on p.user_id = ai.survey_respondent_id
left join sortition_invitees as si
    on p.user_id = si.survey_respondent_id
