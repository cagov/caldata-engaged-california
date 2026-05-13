with
activity as (
    select 
        SG_EVENT_ID, 
        SG_MESSAGE_ID, 
        SINGLESEND_ID, 
        SINGLESEND_NAME, 
        EMAIL, 
        EVENT, 
        TIMESTAMP as EMAIL_ACTIVITY_TIMESTAMP, 
        _FIVETRAN_SYNCED
    from {{ source('SENDGRID_WEBHOOKS','EVENT') }}
    where email_activity_timestamp >= '2026-05-06' -- start date: platform opened. emails sent before this date are largely test / admin emails.
),

email_ids as (
    select 
        email_id, 
        email 
    from {{ ref('stg_sendgrid_email_ids') }}
)


select SG_EVENT_ID, 
        SG_MESSAGE_ID, 
        SINGLESEND_ID, 
        SINGLESEND_NAME, 
        EVENT, 
        email_id,
        TIMESTAMP as EMAIL_ACTIVITY_TIMESTAMP, 
         from activity join email_ids
         on activity.EMAIL = email_ids.email

