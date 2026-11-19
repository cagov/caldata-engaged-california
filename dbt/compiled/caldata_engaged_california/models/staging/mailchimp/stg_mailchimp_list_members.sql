with
 __dbt__cte__stg_mailchimp_list_filter as (


select
    id as list_id,
    name as list_name

from RAW_ENGCA_PRD.MAILCHIMP.LIST
where
    _fivetran_deleted = FALSE
    and list_name in (
        'Engaged California', --this is the list name for the Engaged CA audience in Mailchimp
        'Engaged CA - State employees' --this is the list name for Engaged CA State Employees in Mailchimp
    )
), lists as (
    select * from __dbt__cte__stg_mailchimp_list_filter
),

members as (
    select
        id as member_id,
        unique_email_id,
        status as subscribe_status,
        source,
        timestamp_opt as subscribe_timestamp,
        last_changed,
        email_client,
        list_id,
        unsubscribe_reason,
        _fivetran_synced

    from RAW_ENGCA_PRD.MAILCHIMP.MEMBER
    where subscribe_status in ('subscribed', 'unsubscribed')

),

list_members as (
    select
        members.*,
        lists.list_name
    from members
    inner join lists
        on members.list_id = lists.list_id
)

select
    member_id,
    unique_email_id,
    list_id,
    list_name,
    subscribe_status,
    source,
    subscribe_timestamp,
    last_changed,
    email_client,
    unsubscribe_reason,
    _fivetran_synced

from list_members