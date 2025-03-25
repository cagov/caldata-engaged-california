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
  --  subscribers.member_id, removing unless needed for reporting
    list_name,
    unique_email_id, 
  --  source,  removing unless needed for reporting
  -- subscribe_timestamp,  removing unless needed for reporting
  --  email_client,  removing unless needed for reporting
    iff(interest_name = 'Los Angeles fires recovery: Palisades',1,0) as la_fires_palisades,
    iff(interest_name = 'Los Angeles fires recovery: Eaton',1,0) as la_fires_eaton,
    iff(interest_name = 'Future topics',1,0) as future_topics
    from subscribers
    inner join interests
    on subscribers.member_id = interests.member_id
),

--build any segments that are based on 1 segment component here:
basic_segments as (
    select 
        unique_email_id,
        max(la_fires_palisades) as la_fires_palisades,
        max(la_fires_eaton) as la_fires_eaton,
        max(future_topics) as future_topics
    from segment_components 
    group by unique_email_id
)

--build any segments that are based on combos and conditionals of more than one component here:
select 
    *, 
    iff(la_fires_eaton + la_fires_palisades = 2, 1, 0) as la_fires_both,
    iff(future_topics - la_fires_eaton - la_fires_palisades = -1, 1, 0) as future_topics_only
from basic_segments