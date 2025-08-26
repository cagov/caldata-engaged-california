with
bitly_tags as (
    select * from {{ ref('stg_bitly_tags') }}
),

alias_map as (
    select * from {{ ref('int_bitly_link_alias_map') }}
),

tags_agg as (
    select
        coalesce(m.link_id, t.bitlink_id) as id,
        listagg(distinct t.tags, ', ') within group (order by t.tags) as link_tags
    from bitly_tags as t
    left join alias_map as m
        on t.bitlink_id = m.alias_id
    group by coalesce(m.link_id, t.bitlink_id)
)

select * from tags_agg
