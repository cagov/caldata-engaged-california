select
    interests,
    count(*) as total
from {{ ref('int_mailchimp_subscribed_segment_members') }}
group by interests
