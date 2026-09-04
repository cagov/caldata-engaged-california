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

from RAW_ENGCA_PRD.MAILCHIMP.CAMPAIGN_RECIPIENT_ACTIVITY as activity
where activity.list_id in (select lists.list_id from lists)