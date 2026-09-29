with

activity as (
    select * from TRANSFORM_ENGCA_PRD.sendgrid.int_sendgrid_email_activity
),

opens as (
    select
        subject_line,
        count_if(event = 'open') as total_opens
    from activity
    group by subject_line
),

clicks as (
    select
        subject_line,
        url,
        count_if(event = 'click') as total_clicks
    from activity
    where
        url is not null
        and subject_line is not null
    group by subject_line, url
),

mart as (
    select
        clicks.subject_line,
        clicks.url,
        clicks.total_clicks,
        opens.total_opens,
        coalesce(clicks.total_clicks / nullif(opens.total_opens, 0), 0) as click_rate
    from clicks
    left join opens on clicks.subject_line = opens.subject_line
)

select * from mart