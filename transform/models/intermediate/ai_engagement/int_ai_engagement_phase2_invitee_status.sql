with

invitees as (
    select
        *,
        dense_rank() over (order by selection_timestamp desc) as sortition_round
    from {{ source('AI_ENGAGEMENT', 'INT_AI_ENGAGEMENT_SORTITION_SELECTIONS') }}
),

users as (
    select
        user_id,
        email
    from {{ ref('stg_govocal_users') }}
),

-- Get the most recent responses for each zoom event (as determined by start_date_time)
phase2_responses as (
    select
        invitee_email,
        invitee_status
    from {{ ref('stg_phase2_attendees') }}
    qualify _fivetran_synced::DATE = max(_fivetran_synced::DATE) over (partition by start_date_time)
),

any_acceptance as (
    select
        invitee_email,
        -- the only possible statuses are 'accepted' and 'declined'
        -- if an invitee has 'accepted' any zoom event, then return 'accepted', otherwise return 'declined'
        min(invitee_status) as invitee_status
    from phase2_responses
    group by invitee_email
),

manually_matched_participants as (
    select
        invitee_email,
        staff_or_moderator,
        survey_respondent_id_match,
        email_match,
        sortition_round
    from {{ source('ZOOM', 'UNMATCHED_PARTICIPANTS') }}
    where staff_or_moderator = FALSE -- remove all staff and moderators who have signed up for time slots
),

--reconcile attendees with GV profiles:
email_match as (
    select
        aa.invitee_email,
        aa.invitee_status,
        coalesce(u.user_id, um.survey_respondent_id_match) as survey_respondent_id,
        um.email_match,
        um.sortition_round
    from any_acceptance as aa
    left join users as u
        on lower(trim(aa.invitee_email)) = lower(trim(u.email)) -- exact matches
    left join manually_matched_participants as um
        on lower(trim(aa.invitee_email)) = lower(trim(um.invitee_email)) -- manually matched emails
),

invitee_status as (
    select
        coalesce(i.sortition_round, em.sortition_round) as sortition_round,
        coalesce(i.survey_respondent_id, em.survey_respondent_id, 'Unknown email') as survey_respondent_id,
        em.invitee_email,
        em.email_match,
        coalesce(em.invitee_status, 'No Response Found') as invitee_status
    from invitees as i
    full outer join email_match as em
        on i.survey_respondent_id = em.survey_respondent_id
)

select * from invitee_status
