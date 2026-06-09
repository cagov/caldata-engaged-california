with

invitees as (select * from {{ env_var('SNOWFLAKE_DATABASE') }}.ai_engagement.int_ai_engagement_sortition_selections),

users as (
    select
        user_id,
        email
    from {{ ref('stg_govocal_users') }}
),

phase2_responses as (
    select
        invitee_email,
        invitee_status
    from {{ ref('stg_phase2_attendees') }}
    qualify _fivetran_synced = max(_fivetran_synced) over (partition by invitee_email)
),

email_match as (
    select
        p2r.invitee_email,
        p2r.invitee_status,
        u.user_id
    from phase2_responses as p2r
    left join users as u
        on p2r.invitee_email = u.email
),

invitee_status as (
    select
        coalesce(i.survey_respondent_id, 'Unknown email') as survey_respondent_id,
        em.invitee_email,
        coalesce(em.invitee_status, 'No Response Found') as invitee_status
    from invitees as i
    full outer join email_match as em
        on i.survey_respondent_id = em.user_id
)

select * from invitee_status
