with
list as (
    select * from {{ ref('stg_mailchimp_list_members')}}

),

subs as (
    select
        list_name,
        subscribe_status as value,
        'subscribe_status' as metric,
        count(distinct unique_email_id) as number_unique_emails
    from list
    group by all
),

source as (
    select
        list_name,
        source as value,
        'subscriber source' as metric,
        count(distinct unique_email_id) as number_unique_emails
    from list
    group by all

),

unsubs as (
    select
        list_name,
        unsubscribe_reason as value,
        'unsubscribe_reason' as metric,
        count(distinct unique_email_id) as number_unique_emails
    from list
    where subscribe_status = 'unsubscribed'
    group by all

)

select * from subs
union all
select * from source
union all
select * from unsubs
