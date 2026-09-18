-- Canonical AI engagement participant table: one row per participant, where a participant is a
-- Phase 1 participant (published the Phase 1 survey), a Phase 2 session attendee, or both.
--
-- This model carries PII (email, names) so it can be joined to registration and attendance
-- records. ai_engagement_participants is the PII-free mart view over it; point dashboards there.
--
-- Leadership decisions (2026-09-18):
--   * Phase 1 participation means one thing: a published survey response. The quality filters the
--     model used to apply (internal email, age, California region, open-text answer) are exposed
--     as boolean flags below and do NOT affect who counts as a participant.
--   * Phase 2 attendance counts every non-staff person marked 'attended' in the attendance tracker,
--     including "crashers" who attended without a sortition invitation and attendees with no Go
--     Vocal account at all.

with

-- One row per non-admin Go Vocal user with their survey responses (null when they took no survey).
-- Prefer the published survey when a user somehow has more than one row.
gv_users_x_survey as (
    select *
    from TRANSFORM_ENGCA_PRD.govocal.int_govocal_users_x_ai_survey
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
    from TRANSFORM_ENGCA_PRD.govocal.int_govocal_ai_response_label
),

-- Phase 1 participants: every non-admin user with a published survey response.
phase1_participants as (
    select user_id
    from gv_users_x_survey
    where
        survey_respondent_id is not null
        and publication_status = 'published'
),

-- Anyone who appears in the sortition selections table was invited to Phase 2.
sortition_invitees as (
    select distinct survey_respondent_id
    from TRANSFORM_ENGCA_PRD.AI_ENGAGEMENT.INT_AI_ENGAGEMENT_SORTITION_SELECTIONS
),

gv_users as (
    select
        user_id,
        email,
        first_name,
        last_name
    from TRANSFORM_ENGCA_PRD.govocal.stg_govocal_users
),

unmatched_participants as (
    select
        invitee_email,
        staff_or_moderator,
        survey_respondent_id_match
    from TRANSFORM_ENGCA_PRD.ai_engagement.stg_zoom_unmatched_participants
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
        att.invitee_first_name,
        att.invitee_last_name,
        coalesce(un.survey_respondent_id_match, gv.user_id) as user_id
    from TRANSFORM_ENGCA_PRD.ai_engagement.stg_attendance_tracker as att
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

-- One row per attendee: the Go Vocal user when matched, otherwise the tracker email (and tracker names,
-- which are only needed for attendees with no Go Vocal profile).
phase2_attendees as (
    select
        user_id,
        iff(user_id is null, invitee_email, null) as unmatched_email,
        any_value(iff(user_id is null, invitee_first_name, null)) as unmatched_first_name,
        any_value(iff(user_id is null, invitee_last_name, null)) as unmatched_last_name
    from attendance
    group by user_id, unmatched_email
),

-- Union of the two populations...
participant_rows as (
    select
        user_id,
        null as unmatched_email,
        null as unmatched_first_name,
        null as unmatched_last_name,
        true as participated_in_phase1,
        false as attended_phase2
    from phase1_participants
    union all
    select
        user_id,
        unmatched_email,
        unmatched_first_name,
        unmatched_last_name,
        false as participated_in_phase1,
        true as attended_phase2
    from phase2_attendees
),

-- ...collapsed to one row per person.
participants as (
    select
        user_id,
        unmatched_email,
        any_value(unmatched_first_name) as unmatched_first_name,
        any_value(unmatched_last_name) as unmatched_last_name,
        boolor_agg(participated_in_phase1) as participated_in_phase1,
        boolor_agg(attended_phase2) as attended_phase2
    from participant_rows
    group by user_id, unmatched_email
),

with_flags as (
    select
        -- Go Vocal user ID when the participant has an account; otherwise a hash of the attendance-tracker
        -- email so attendees with no account still get a stable, non-PII key.
        coalesce(p.user_id, md5(p.unmatched_email)) as participant_id,
        p.user_id as survey_respondent_id,
        coalesce(gv.email, p.unmatched_email) as email,
        coalesce(gv.first_name, p.unmatched_first_name) as first_name,
        coalesce(gv.last_name, p.unmatched_last_name) as last_name,
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
        -- participation flags
        p.participated_in_phase1,
        si.survey_respondent_id is not null as invited_to_phase2,
        p.attended_phase2,
        -- quality flags: these describe the participant but do NOT decide whether they are one
        lower(trim(coalesce(gv.email, p.unmatched_email))) like '%@innovation.ca.gov' as has_internal_email,
        coalesce(u.age is not null and u.age <> 'Under 18', false) as reported_age_18_plus,
        u.region is not null as has_california_region,
        ai.survey_respondent_id is not null as answered_open_text_ai_question
    from participants as p
    left join gv_users as gv
        on p.user_id = gv.user_id
    left join gv_users_x_survey as u
        on p.user_id = u.user_id
    left join ai_response_labels as ai
        on p.user_id = ai.survey_respondent_id
    left join sortition_invitees as si
        on p.user_id = si.survey_respondent_id
)

select
    *,
    -- the Phase 1 population this model reported before 2026-09-18 (published + all four quality filters)
    participated_in_phase1
    and not has_internal_email
    and reported_age_18_plus
    and has_california_region
    and answered_open_text_ai_question as meets_phase1_analysis_criteria
from with_flags