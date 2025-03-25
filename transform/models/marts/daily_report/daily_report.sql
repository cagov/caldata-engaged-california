with mailchimp_campaigns as (
    select * from {{ ref('mailchimp_campaign_summary')}}
),

mailchimp_list as (
    select * from {{ ref('mailchimp_list_metrics')}}
),

mailchimp_segments as (
    select * from {{ ref('mailchimp_subscribers_by_segment')}}
),

rates as (
    select 
        unique_email_ids_sent,
        unique_opens/unique_email_ids_sent as open_rate,
        unique_clicks/unique_email_ids_sent as click_rate,
        unique_bounces/unique_email_ids_sent as bounce_rate

    from mailchimp_campaigns
),

mailchimp_avg_rates as (
select 
    sum(unique_email_ids_sent) as total_sends, 
    avg(open_rate) * 100 as avg_open_rate, 
    avg(click_rate) * 100 as avg_click_rate,
    avg(bounce_rate)* 100  as avg_bounce_rate

from rates
),

mailchimp_subscriber_totals as (
    select 
        max(iff(value = 'subscribed', number_unique_emails, 0)) as total_subscribed,
        max(iff(value = 'unsubscribed', number_unique_emails, 0)) as total_unsubscribed
    from mailchimp_list 
    where metric = 'subscribe_status'

)

select * 
from mailchimp_subscriber_totals
full outer join mailchimp_segments
full outer join mailchimp_avg_rates
