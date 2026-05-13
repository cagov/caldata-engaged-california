with
activity as (
    select
        sg_event_id,
        sg_message_id,
        singlesend_id,
        singlesend_name,
        email,
        event,
        timestamp as email_activity_timestamp,
        _fivetran_synced
    from {{ source('SENDGRID_WEBHOOKS','EVENT') }}
    -- start date: platform opened. emails sent before this date are largely test / admin emails.
    where timestamp >= '2026-05-06'
),

--pull only derived ID, rather than email address through pipeline
email_ids as (
    select
        email_user_id,
        email
    from {{ ref('stg_sendgrid_email_ids') }}
)


select
    activity.sg_event_id,
    activity.sg_message_id,
    activity.singlesend_id,
    activity.singlesend_name,
    activity.event,
    email_ids.email_user_id,
    activity.email_activity_timestamp,
    activity._fivetran_synced
from activity inner join email_ids
    on activity.email = email_ids.email
