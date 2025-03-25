with
lists as
    (select
        ID as list_id,
        NAME as list_name

        from {{ source('MAILCHIMP','LIST') }}
        where _FIVETRAN_DELETED = FALSE
        and list_name = 'Engaged California' --this is the list name for the Engaged CA audience in Mailchimp
    )

select
    member_id,
    campaign_id,
    action,
    timestamp,
    url,
    list_id,
    bounce_type,
    _FIVETRAN_SYNCED

from  {{ source('MAILCHIMP','CAMPAIGN_RECIPIENT_ACTIVITY') }} activity
where activity.list_id in (select list_id from lists)