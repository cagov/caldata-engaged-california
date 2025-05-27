--ODI will define segments using a combination of Interests, Tags, and Activities
--All segments built in Mailchimp Paid accounts are 'dynamic' segments, which are unavailable
--to pull directly from the API. So we have to recreate them by audience definition here.

--Right now we are only using Interests to define segments, so we just need interests for now.

with subscribers as (
    select * from {{ ref('stg_mailchimp_list_members') }}
),

interests as (
    select * from {{ ref('stg_mailchimp_interest_members') }}
),

--define any segment components (e.g. interests, tags) here:
segment_components as (
    select
        subscribers.list_name,
        subscribers.unique_email_id,
        subscribers._fivetran_synced,
        case interests.interest_name
            when 'Los Angeles fires recovery: Palisades' then 'palisades'
            when 'Los Angeles fires recovery: Eaton' then 'eaton'
            when 'Future topics' then 'future'
            else 'no-interest'
        end as segment
    from subscribers
    left join interests --not all subscribers have an interest, we want to count the ones that don't too
        on subscribers.member_id = interests.member_id
),

--build any segments that are based on 1 segment component here:
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

--build any segments that are based on combos and conditionals of more than one component here:
select * from basic_segments
