with

email_campaign_deliveries as (select * from {{ ref('stg_govocal_email_campaign_deliveries') }}),

email_campaigns as (select * from {{ ref('stg_govocal_email_campaigns') }})

select
    d.email_campaign_id,
    iff(c.sender is null, 'external', c.sender) as sender,
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
from email_campaign_deliveries as d
left join
    email_campaigns as c
    on d.email_campaign_id = c.email_campaign_id
group by all
