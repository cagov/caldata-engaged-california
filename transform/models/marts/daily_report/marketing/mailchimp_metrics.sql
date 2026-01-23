with mailchimp_campaigns as (
    select * from {{ ref('mailchimp_campaign_summary') }}
),

rates as (
    select
        list_name,
        unique_email_ids_sent,
        unique_opens / unique_email_ids_sent as open_rate,
        unique_clicks / unique_email_ids_sent as click_rate,
        unique_bounces / unique_email_ids_sent as bounce_rate,
        campaign_type,
        max_fivetran_sync_date

    from mailchimp_campaigns
),

mailchimp_avg_rates as (
    select
        list_name,
        sum(unique_email_ids_sent) as total_sends,
        avg(open_rate) as avg_open_rate,
        avg(click_rate) as avg_click_rate,
        avg(bounce_rate) as avg_bounce_rate,
        campaign_type,
        max(max_fivetran_sync_date) as max_fivetran_sync_date

    from rates
    group by list_name, campaign_type
)

select * from mailchimp_avg_rates
