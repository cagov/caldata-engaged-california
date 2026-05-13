with
subject_lines as (
    select 
        msg_id, 
        short_id, 
        subject as subject_line, 
        _load_date, 
        _loaded_at 
    from {{ ref('stg_sendgrid_subject_line_map') }} 

email_activity as (
    select 
        SG_EVENT_ID, 
        SG_MESSAGE_ID, 
        SINGLESEND_ID, 
        SINGLESEND_NAME, 
        email_id, 
        EVENT, 
        TIMESTAMP, 
        _FIVETRAN_SYNCED
    from {{ ref('stg_sendgrid_email_activity') }} 
)


select *   
from email_activity left join subject_lines on email_activity.SG_MESSAGE_ID = subject_lines.msg_id
-- left join ensures we only look at data we have activity for, and that we pull all activity, even if subject line data is somehow missing
