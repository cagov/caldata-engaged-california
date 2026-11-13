with

source as (
    select * from TRANSFORM_ENGCA_PRD.sendgrid.int_sendgrid_email_activity
),

zoom_invite_clicks as (
    select
        date(convert_timezone('America/Los_Angeles', email_activity_timestamp)) as click_date,
        url,
        count(*) as clicks
    from source
    where
        event = 'click'
        and subject_line ilike 'Join a discussion about AI%'
    group by click_date, url
)

select
    click_date,
    url,
    clicks
from zoom_invite_clicks
order by click_date