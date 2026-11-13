select
    list_name,
    segments,
    count(*) as total_subscribers,
    max(max_fivetran_sync_date) as max_fivetran_sync_date
from TRANSFORM_ENGCA_PRD.mailchimp.int_mailchimp_engaged_california_subscribed_segment_members
group by list_name, segments