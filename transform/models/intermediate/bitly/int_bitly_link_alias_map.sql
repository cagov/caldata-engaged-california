with
links as (
    select * from {{ source('BITLY','BITLINK') }}
),

custom_links as (
    select
        links.id,
        flat.value::string as custom_link
    from links,
        lateral flatten(links.custom_bitlinks) as flat
),

alias_ids as (
    select
        replace(custom_link, 'https://', '') as link_id,
        id as alias_id
    from custom_links
),

filter_alias_ids as (
    select a.*
    from alias_ids as a
    inner join links as l on a.link_id = l.id
)

select * from filter_alias_ids
