with
lists as
    (select
        ID as list_id,
        NAME as list_name

        from {{ source('MAILCHIMP','LIST') }}
        where _FIVETRAN_DELETED = FALSE
        and list_name = 'Engaged California' --this is the list name for the Engaged CA audience in Mailchimp
    ),

members as
    (select
        ID as member_id,
        UNIQUE_EMAIL_ID as unique_email_id,
        STATUS as subscribe_status,
        SOURCE as source,
        TIMESTAMP_OPT as subscribe_timestamp,
        EMAIL_CLIENT as email_client,
        LIST_ID as list_id,
        UNSUBSCRIBE_REASON as unsubscribe_reason,
        _FIVETRAN_SYNCED

        from {{ source('MAILCHIMP','MEMBER')}}
        where subscribe_status in ('subscribed', 'unsubscribed')

    ),

list_members as
    (select
        members.*,
        lists.list_name
     from members
    inner join lists
    on lists.list_id = members.list_id
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
    _FIVETRAN_SYNCED

from list_members
