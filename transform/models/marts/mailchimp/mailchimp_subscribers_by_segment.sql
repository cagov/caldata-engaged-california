select
    segments,
    count(*) as total_subscribers,
    max(max_fivetran_sync_date) as max_fivetran_sync_date
from {{ ref('int_mailchimp_subscribed_segment_members') }}
group by segments
