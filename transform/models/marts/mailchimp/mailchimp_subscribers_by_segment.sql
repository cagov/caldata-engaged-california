select
    segments,
    count(*) as total_subscribers
from {{ ref('int_mailchimp_subscribed_segment_members') }}
group by segments
