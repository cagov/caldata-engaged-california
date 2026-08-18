with

sortition_round as (
    select
        *,
        dense_rank() over (order by selection_timestamp asc) as sortition_round
    from {{ source('AI_ENGAGEMENT', 'INT_AI_ENGAGEMENT_SORTITION_SELECTIONS') }}
),

invitees as (
    select
        *,
        sortition_round = max(sortition_round) over () as current_sortition_round
    from sortition_round
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
        invitee_status,
        start_date_time
    from {{ ref('stg_phase2_attendees') }}
    qualify _fivetran_synced::DATE = max(_fivetran_synced::DATE) over (partition by start_date_time)
),

any_acceptance as (
    select
        invitee_email,
        -- the only possible statuses are 'accepted' and 'declined'
        -- if an invitee has 'accepted' any zoom event, then return 'accepted', otherwise return 'declined'
        min(invitee_status) as invitee_status,
        array_agg(distinct iff(invitee_status = 'accepted', start_date_time, null)) as start_date_time_array,
        iff(array_size(start_date_time_array) > 1, 'multiple events accepted', start_date_time_array[0])
            as accepted_event_start_date_time
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
    where
        -- remove all staff and moderators who have signed up for time slots
        staff_or_moderator is null
        or staff_or_moderator = false
),

attendance_status as (
    select
        invitee_email,
        actual_status
    from {{ source('ZOOM', 'ATTENDANCE_TRACKER') }}
),

--reconcile attendees with GV profiles:
email_match as (
    select
        aa.invitee_email,
        aa.invitee_status,
        aa.accepted_event_start_date_time,
        coalesce(u.user_id, um.survey_respondent_id_match) as survey_respondent_id,
        um.email_match,
        case
            when a.actual_status is null and aa.invitee_status = 'accepted' then 'session in the future'
            when
                a.actual_status is null and (aa.invitee_status <> 'accepted' or aa.invitee_status is null)
                then 'not registered'
            else lower(a.actual_status)
        end as attendee_status
    from any_acceptance as aa
    left join users as u
        on lower(trim(aa.invitee_email)) = lower(trim(u.email)) -- exact matches
    left join manually_matched_participants as um
        on lower(trim(aa.invitee_email)) = lower(trim(um.invitee_email)) -- manually matched emails
    left join attendance_status as a
        on lower(trim(aa.invitee_email)) = lower(trim(a.invitee_email))
),

invitee_status as (
    select
        i.sortition_round,
        coalesce(i.survey_respondent_id, em.survey_respondent_id, 'Unknown email') as survey_respondent_id,
        em.invitee_email,
        em.email_match,
        case
            when em.invitee_status is null and not i.current_sortition_round then 'invitation closed'
            when em.invitee_status is null and i.current_sortition_round then 'invitation open'
            else em.invitee_status
        end as invitee_status,
        em.accepted_event_start_date_time,
        em.attendee_status
    from invitees as i
    full outer join email_match as em
        on i.survey_respondent_id = em.survey_respondent_id
),

single_status as (
    select
        survey_respondent_id,
        min_by(
            invitee_email,
            case attendee_status
                when 'staff' then 1
                when 'attended' then 2
                when 'session in the future' then 3
                when 'no show' then 4
                when 'not registered' then 5
                else 9
            end
        ) as invitee_email,
        count(distinct sortition_round) as invite_count,
        listagg(sortition_round, ', ') as list_sortition_rounds,
        any_value(distinct email_match) as email_match,
        min_by(
            invitee_status,
            case invitee_status
                when 'accepted' then 1
                when 'invitation open' then 2
                when 'declined' then 3
                when 'invitation closed' then 4
                else 9
            end
        ) as invitee_status,
        any_value(accepted_event_start_date_time) as accepted_event_start_date_time,
        min_by(
            attendee_status,
            case attendee_status
                when 'staff' then 1
                when 'attended' then 2
                when 'session in the future' then 3
                when 'no show' then 4
                when 'not registered' then 5
                else 9
            end
        ) as attendee_status
    from invitee_status
    group by survey_respondent_id
)

select * from single_status
