with
int_model as (
    select * from {{ ref('int_sendgrid_email_activity') }}

),

mart as (
    select
        subject_line,
        min(email_activity_timestamp) as first_send_date,
        max(email_activity_timestamp) as latest_send_date,
        count(distinct email_user_id) as recipients,
        count_if(event = 'processed') as sends,
        count_if(event = 'delivered') as deliveries,
        count_if(event = 'open') as opens,
        count_if(event = 'bounce') as bounces,
        count_if(event = 'click') as clicks,
        count_if(event = 'deferred') as defers,
        count_if(event = 'unsubscribe') as unsubscribes,
        count_if(event = 'dropped') as drops,
        count_if(event = 'spamreport') as spam_reports
    from int_model
    group by all
)

select * from mart
