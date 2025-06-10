with
mailchimp_list as (
    select * from {{ ref('mailchimp_list_metrics') }}
),

mailchimp_subscriber_totals as (
    select
        max(iff(value = 'subscribed', number_unique_emails, 0)) as total_subscribed,
        max(iff(value = 'unsubscribed', number_unique_emails, 0)) as total_unsubscribed,
        max(max_fivetran_sync_date) as max_fivetran_sync_date
    from mailchimp_list
    where metric = 'subscribe status'

)

select * from mailchimp_subscriber_totals
