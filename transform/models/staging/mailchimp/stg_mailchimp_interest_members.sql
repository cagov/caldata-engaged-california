--ODI may define segments using a combination of Interests and Tags.
--All segments built in Mailchimp Paid accounts are 'dynamic' segments, which are unavailable
--to pull directly from the API. So we have to recreate them by audience definition here.


--Right now we are only using Interests to define segments, so we'll keep this simple


with

lists as
(select
    ID as list_id,
    NAME as list_name

    from {{ source('MAILCHIMP','LIST') }}
    where _FIVETRAN_DELETED = FALSE
    and list_name = 'Engaged California' --this is the list name for the Engaged CA audience in Mailchimp
),

interest as (
    select
    ID as interest_id,
    NAME as interest_name,
    _FIVETRAN_SYNCED

    from {{ source('MAILCHIMP', 'INTEREST') }}
    where _FIVETRAN_DELETED = FALSE
    and list_id in (select list_id from lists)
),

interest_member as (
    select *
    from {{ source('MAILCHIMP', 'INTEREST_MEMBER')}}
    where _FIVETRAN_DELETED = FALSE
)

select
    interest.interest_id,
    interest_name,
    member_id,
    interest_member._FIVETRAN_SYNCED

from interest
inner join interest_member
on interest.interest_id = interest_member.interest_id
