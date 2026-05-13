with
subjects as (
    select
        msg_id,
        short_id,
        subject_line,
        _load_date,
        _loaded_at
    from {{ ref('stg_sendgrid_subject_line_map') }}
),

activity as (
    select
        sg_event_id,
        sg_message_id,
        singlesend_id,
        singlesend_name,
        email_user_id,
        event,
        email_activity_timestamp,
        _fivetran_synced
    from {{ ref('stg_sendgrid_email_activity') }}
)


select
    subjects.msg_id,
    subjects.short_id,
    subjects._loaded_at,
    activity.sg_event_id,
    activity.sg_message_id,
    activity.singlesend_id,
    activity.singlesend_name,
    activity.email_user_id,
    activity.event,
    activity.email_activity_timestamp,
    activity._fivetran_synced,

    --a few emails are missing from Email Activity API:
    case
        when
            activity.sg_message_id = 'kxic6ozORSaI5R_2pEUQRQ.recvd-6575d5864f-k69dv-1-69F27280-75.0'
            then 'Welcome to Engaged California'
        when
            activity.sg_message_id = '2rXayF1lSxeHIu_fGF8-UQ.recvd-5b4fcf68c-vmcgn-1-69F8E890-33.0'
            then 'Welcome to Engaged California'
        when
            activity.sg_message_id = 'fGBOduEvSembulcww1ZpvQ.recvd-6575d5864f-cvv66-1-69F8EBDC-55.0'
            then 'Engaged California: Reset your password'
        when
            activity.sg_message_id = 'faFpsSGmTOa6OarNbIO1_g.recvd-5b4fcf68c-cj57t-1-69F8EDDD-8.0'
            then 'Thank you for your response!'
        else subjects.subject_line
    end as subject_line
from activity
left join subjects -- left join ensures we only look at data we have activity picked up from webhooks,
    --and that we pull all activity, even if subject line data is somehow missing
    on activity.sg_message_id = subjects.msg_id
