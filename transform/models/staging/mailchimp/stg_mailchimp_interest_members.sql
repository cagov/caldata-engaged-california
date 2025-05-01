--ODI may define segments using a combination of Interests and Tags.
--All segments built in Mailchimp Paid accounts are 'dynamic' segments, which are unavailable
--to pull directly from the API. So we have to recreate them by audience definition here.


--Right now we are only using Interests to define segments, so we'll keep this simple


with

lists as (
    select * from {{ ref('stg_mailchimp_list_filter') }}
),

interest as (
    select
        interest.id as interest_id,
        interest.name as interest_name,
        interest._fivetran_synced

    from {{ source('MAILCHIMP', 'INTEREST') }} as interest
    where
        interest._fivetran_deleted = FALSE
        and interest.list_id in (select lists.list_id from lists)
),

interest_member as (
    select *
    from {{ source('MAILCHIMP', 'INTEREST_MEMBER') }}
    where _fivetran_deleted = FALSE
)

select
    interest.interest_id,
    interest.interest_name,
    interest_member.member_id,
    interest_member._fivetran_synced

from interest
inner join interest_member
    on interest.interest_id = interest_member.interest_id
