with
subscribers as (
    select * from {{ ref('stg_mailchimp_list_members') }}
    where
        subscribe_status = 'subscribed' --only include subscribed members
        and list_name = 'Engaged California' --only include members from the Engaged California list
),

subs_july_15 as (
    select count(unique_email_id) as subcribers_up_to_july_15
    from subscribers
    where to_date(subscribe_timestamp) <= '2025-07-15'
),

subs_july_16 as (
    select count(unique_email_id) as subcribers_since_july_16
    from subscribers
    where to_date(subscribe_timestamp) >= '2025-07-16'
),

subs_prev_day as (
    select
        count(unique_email_id) as prev_day_subcribers,
        any_value(to_date(subscribe_timestamp)) as prev_day
    from subscribers
    where to_date(subscribe_timestamp) = current_date() - 1
)

select * from subs_july_15, subs_july_16, subs_prev_day -- noqa: RF02
