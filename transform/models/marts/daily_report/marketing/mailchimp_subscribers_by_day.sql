with
list_members as (
    select
        *,
        to_date(subscribe_timestamp) as subscribe_day
    from {{ ref('stg_mailchimp_list_members') }}
),

subscribers_by_day as (
    select
        list_name,
        subscribe_day,
        count(distinct unique_email_id) as total_subscribers,
        max(_fivetran_synced) as max_fivetran_sync_date
    from list_members
    group by list_name, subscribe_day

)

select * from subscribers_by_day
