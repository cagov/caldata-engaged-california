with
links as (
    select * from {{ ref('stg_bitly_links') }}
),

clicks as (
    select * from {{ ref('stg_bitly_clicks') }}
)

select
    links.link,
    links.title,
    clicks.click_date,
    clicks.clicks
from links
inner join clicks on links.id = clicks.bitlink_id
