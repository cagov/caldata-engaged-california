with
lists as (
    select * from {{ ref('stg_mailchimp_list_filter')}}
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
where activity.list_id in (select lists.list_id from lists)
