with

invitees as (
    select
        *,
        rank() over (order by selection_timestamp desc) as sortition_round
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

email_match as (
    select
        aa.invitee_email,
        aa.invitee_status,
        u.user_id
    from any_acceptance as aa
    left join users as u
        on lower(trim(aa.invitee_email)) = lower(trim(u.email))
),

invitee_status as (
    select
        i.sortition_round,
        coalesce(i.survey_respondent_id, 'Unknown email') as survey_respondent_id,
        em.invitee_email,
        coalesce(em.invitee_status, 'No Response Found') as invitee_status
    from invitees as i
    full outer join email_match as em
        on i.survey_respondent_id = em.user_id
)

select * from invitee_status
