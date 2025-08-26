with
links as (
    select * from {{ ref('stg_bitly_links') }}
),

clicks as (
    select * from {{ ref('stg_bitly_clicks') }}
),

tags as (
    select * from {{ ref('int_bitly_link_tags') }}
)

select
    links.link,
    links.title,
    tags.link_tags,
    links.created_date,
    clicks.click_date,
    clicks.click_date - links.created_date as days_since_creation,
    clicks.clicks
from links
inner join clicks on links.id = clicks.bitlink_id
left join tags on links.id = tags.id
where clicks.click_date >= links.created_date  -- remove daily counts before the link was created
