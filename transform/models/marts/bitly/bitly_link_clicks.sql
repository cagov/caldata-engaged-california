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
    links.long_url,
    links.title,
    links.organization_name,
    links.group_name,
    tags.link_tags,
    links.created_date,
    links.created_by,
    sum(clicks.clicks) as total_clicks
from links
inner join clicks on links.id = clicks.bitlink_id
left join tags on links.id = tags.link_id
group by
    links.link,
    links.long_url,
    links.title,
    links.organization_name,
    links.group_name,
    tags.link_tags,
    links.created_date,
    links.created_by
