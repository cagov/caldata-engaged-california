with subs_july_15 as (
    select count(unique_email_id) as subcribers_up_to_july_15
    from transform_engca_prd.mailchimp.stg_mailchimp_list_members
    where
        subscribe_status = 'subscribed'
        and to_date(subscribe_timestamp) <= '2025-07-15'
),

subs_july_16 as (
    select count(unique_email_id) as subcribers_since_july_16
    from transform_engca_prd.mailchimp.stg_mailchimp_list_members
    where
        subscribe_status = 'subscribed'
        and to_date(subscribe_timestamp) >= '2025-07-16'
),

subs_prev_day as (
    select
        count(unique_email_id) as prev_day_subcribers,
        any_value(to_date(subscribe_timestamp)) as prev_day
    from transform_engca_prd.mailchimp.stg_mailchimp_list_members
    where
        subscribe_status = 'subscribed'
        and to_date(subscribe_timestamp) = current_date() - 1
)

select * from subs_july_15, subs_july_16, subs_prev_day -- noqa: RF02
