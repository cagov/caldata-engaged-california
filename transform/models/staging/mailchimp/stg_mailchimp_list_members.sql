with
lists as (
    select * from {{ ref('stg_mailchimp_list_filter') }}
),

members as (
    select
        id as member_id,
        unique_email_id,
        status as subscribe_status,
        source,
        timestamp_opt as subscribe_timestamp,
        email_client,
        list_id,
        unsubscribe_reason,
        _fivetran_synced

    from {{ source('MAILCHIMP','MEMBER') }}
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
    list_name,
    subscribe_status,
    source,
    subscribe_timestamp,
    email_client,
    unsubscribe_reason,
    _fivetran_synced

from list_members
