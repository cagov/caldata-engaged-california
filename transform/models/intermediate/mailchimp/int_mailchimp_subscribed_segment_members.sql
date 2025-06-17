--ODI will define segments using a combination of Interests, Tags, Merge Fields, and Activities
--All segments built in Mailchimp Paid accounts are 'dynamic' segments, which are unavailable
--to pull directly from the API. So we have to recreate them by audience definition here.

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

--define any segments that rely on interests here:
interest_segments as (
    select
        subscribers.list_name,
        subscribers.unique_email_id,
        subscribers._fivetran_synced,
        case
            when interests.interest_name = 'Los Angeles fires recovery: Palisades' then 'palisades'
            when interests.interest_name = 'Los Angeles fires recovery: Eaton' then 'eaton'
            when interests.interest_name = 'Future topics' then 'future'
            else 'nointerest' end as segment
    from subscribers
    left join interests --not all subscribers have an interest, we want to count the ones that don't too
        on subscribers.member_id = interests.member_id
),

--define any segments that rely on merge fields here:
mergefield_segments as (
    select
        subscribers.list_name,
        subscribers.unique_email_id,
        subscribers._fivetran_synced,
        case member_merge_fields.merge_evaczone
            'Yes, I was in the Eaton fire evacuation zone' then 'eatonphase2'
            'Yes, I was in the Palisades fire evacuation zone' then 'palisadesphase2'
            'No' then 'nofirephase2'
            end as segment -- currently, this works because users MUST select an option
            --and can ONLY select one value in this field
    from subscribers
    inner join member_merge_fields --only include members with a merge field value,
    --since the interests cte already captures those without a value
        on subscribers.member_id = member_merge_fields.id
),

segment_components as (
    select * from interest_segments
    union all
    select * from mergefield_segments
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
