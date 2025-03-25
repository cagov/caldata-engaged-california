--ODI will define segments using a combination of Interests, Tags, and Activities
--All segments built in Mailchimp Paid accounts are 'dynamic' segments, which are unavailable
--to pull directly from the API. So we have to recreate them by audience definition here.

--Right now we are only using Interests to define segments, so we just need interests for now.

with subscribers as (
    select * from {{ ref('stg_mailchimp_list_members') }}
    where subscribe_status = 'subscribed'
),

interests as (
    select * from {{ ref('stg_mailchimp_interest_members') }}
),

--convert segment components (e.g. interests, tags) into binary for easy segment building
segment_components as (
    select
        subscribers.list_name,
        subscribers.unique_email_id,
        case interests.interest_name
            when 'Los Angeles fires recovery: Palisades' then 'palisades'
            when 'Los Angeles fires recovery: Eaton' then 'eaton'
            when 'Future topics' then 'future'
        end as interest
    from subscribers
    inner join interests
        on subscribers.member_id = interests.member_id
),

--build any segments that are based on 1 segment component here:
basic_segments as (
    select
        unique_email_id,
        listagg(distinct interest, '_') within group (order by interest) as interests
    from segment_components
    group by unique_email_id
)

select * from basic_segments
