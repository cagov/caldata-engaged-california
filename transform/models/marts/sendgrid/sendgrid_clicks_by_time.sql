with

activity as (
    select * from {{ ref('int_sendgrid_email_activity') }}
)

select
    subject_line,
    count_if(event = 'click') as total_clicks,
    date(convert_timezone('America/Los_Angeles', email_activity_timestamp)) as send_date,
    hour(convert_timezone('America/Los_Angeles', email_activity_timestamp)) as hour_of_day
from activity
group by subject_line, send_date, hour_of_day
