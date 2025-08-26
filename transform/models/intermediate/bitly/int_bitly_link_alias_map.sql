with
links as (
    select * from {{ source('BITLY','BITLINK') }}
),

custom_links as (
    select 
        id, 
        flat.value::string custom_link
    from links,
        lateral flatten(custom_bitlinks) as flat
),

alias_ids as (
    select 
        replace(custom_link, 'https://', '') as link_id, 
        id as alias_id
    from custom_links
),

filter_alias_ids as (
    select 
        a.*
    from alias_ids a 
    join links l on l.id = a.link_id
)

select * from filter_alias_ids
