with

email_campaigns as (select * from {{ ref('stg_govocal_email_campaigns') }}),

email_campaign_deliveries as (select * from {{ ref('stg_govocal_email_campaign_deliveries') }})

select
    c.email_campaign_id,
    c.sender,
    c.reply_to,
    c.subject,
    c.deliveries_count,
    c.created_at,
    c.updated_at,
    count_if(d.delivery_status = 'sent') as sent,
    count_if(d.delivery_status = 'delivered') as delivered,
    count_if(d.delivery_status = 'opened') as opened,
    count_if(d.delivery_status = 'clicked') as clicked,
    min(d.sent_at) as first_sent_at,
    max(d.sent_at) as last_sent_at
from email_campaigns as c
full outer join
    email_campaign_deliveries as d
    on c.email_campaign_id = d.email_campaign_id
group by 1, 2, 3, 4, 5, 6, 7
