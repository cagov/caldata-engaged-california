--ODI will define segments using a combination of Interests, Tags, Merge Fields, and Activities
--All segments built in Mailchimp Paid accounts are 'dynamic' segments, which are unavailable
--to pull directly from the API. So we have to recreate them by audience definition here.

--Right now we are only using Interests to define segments, so we just need interests for now.

with subscribers as (
    select * from {{ ref('stg_mailchimp_list_members') }}
    where subscribe_status = 'subscribed' --only include subscribed members
),

interests as (
    select * from {{ ref('stg_mailchimp_interest_members') }}
),

member_merge_fields as (
    select
        id,
        merge_evaczone
    from {{ source('MAILCHIMP', 'MEMBER') }}
    where
        merge_evaczone is not null
        and merge_evaczone != '' --only include members with an evaczone merge field value
),

--define any segment components (e.g. interests, tags) here:
segment_components as (
    select
        subscribers.list_name,
        subscribers.unique_email_id,
        subscribers._fivetran_synced,
        case
            when interests.interest_name = 'Los Angeles fires recovery: Palisades' then 'palisades'
            when interests.interest_name = 'Los Angeles fires recovery: Eaton' then 'eaton'
            when interests.interest_name = 'Future topics' then 'future'
            when member_merge_fields.merge_evaczone = 'Yes, I was in the Eaton fire evacuation zone' then 'eatonphase2'
            when
                member_merge_fields.merge_evaczone = 'Yes, I was in the Palisades fire evacuation zone'
                then 'palisadesphase2'
            when member_merge_fields.merge_evaczone = 'No' then 'nofirephase2'
            else 'nosegment'
        end as segment
    from subscribers
    left join interests --not all subscribers have an interest, we want to count the ones that don't too
        on subscribers.member_id = interests.member_id
    left join member_merge_fields
        on subscribers.member_id = member_merge_fields.id


),

--create a string that captures all segments a member is a part of:
basic_segments as (
    select
        unique_email_id,
        listagg(distinct segment, '_') within group (
            order by segment
        ) as segments,
        max(_fivetran_synced) as max_fivetran_sync_date
    from segment_components
    group by unique_email_id
)

--final output
select * from basic_segments
