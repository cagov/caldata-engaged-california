with
list_members as (
    select
        *,
        to_date(subscribe_timestamp) as subscribe_day,
        max(_fivetran_synced) over () as max_fivetran_sync_date
    from TRANSFORM_ENGCA_PRD.mailchimp.stg_mailchimp_list_members
),

subscribers_by_day as (
    select
        list_name,
        subscribe_day,
        count(distinct unique_email_id) as total_subscribers,
        max_fivetran_sync_date
    from list_members
    group by list_name, subscribe_day, max_fivetran_sync_date

)

select * from subscribers_by_day