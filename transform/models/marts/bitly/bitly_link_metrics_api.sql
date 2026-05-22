with link_metrics as (select * from {{ ref('stg_bitly_links_metrics_api') }}),

bitlinks as (select * from {{ ref('stg_bitly_links_api') }})

select
    bitlinks.bitlink_id,
    bitlinks.title,
    bitlinks.long_url,
    link_metrics.total_clicks,
    bitlinks.created_time,
    greatest(bitlinks._loaded_at, link_metrics._loaded_at) as _loaded_at

from bitlinks
left join
    link_metrics
    on bitlinks.bitlink_id = link_metrics.bitlink_id
