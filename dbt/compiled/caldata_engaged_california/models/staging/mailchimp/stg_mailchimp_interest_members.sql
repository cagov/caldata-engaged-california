--ODI may define segments using a combination of Interests, Tags, Merge Fields, and more.
--All segments built in Mailchimp Paid accounts are 'dynamic' segments, which are unavailable
--to pull directly from the API. So we have to recreate them by audience definition here.


--Right now we are only using Interests to define segments, so we'll keep this simple


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

interest as (
    select
        interest.id as interest_id,
        interest.name as interest_name,
        interest.list_id,
        interest._fivetran_synced

    from RAW_ENGCA_PRD.MAILCHIMP.INTEREST as interest
    where
        interest._fivetran_deleted = FALSE
        and interest.list_id in (select lists.list_id from lists)
),

interest_member as (
    select *
    from RAW_ENGCA_PRD.MAILCHIMP.INTEREST_MEMBER
    where _fivetran_deleted = FALSE
)

select
    interest.interest_id,
    interest.interest_name,
    interest.list_id,
    interest_member.member_id,
    interest_member._fivetran_synced

from interest
inner join interest_member
    on interest.interest_id = interest_member.interest_id