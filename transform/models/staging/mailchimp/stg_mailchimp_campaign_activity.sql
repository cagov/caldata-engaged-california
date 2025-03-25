with
lists as (
    select
        id as list_id,
        name as list_name

    from {{ source('MAILCHIMP','LIST') }}
    where
        _fivetran_deleted = FALSE
        and list_name = 'Engaged California' --this is the list name for the Engaged CA audience in Mailchimp
)

select
    activity.member_id,
    activity.campaign_id,
    activity.action,
    activity.timestamp,
    activity.url,
    activity.list_id,
    activity.bounce_type,
    activity._fivetran_synced

from {{ source('MAILCHIMP','CAMPAIGN_RECIPIENT_ACTIVITY') }} as activity
where activity.list_id in (select list_id from lists)
