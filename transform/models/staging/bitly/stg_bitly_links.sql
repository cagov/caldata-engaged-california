with
links as (
    select * from {{ source('BITLY','BITLINK') }}
),

bitly_groups as (
    select * from {{ source('BITLY','GROUPS') }}
),

bitly_orgs as (
    select * from {{ source('BITLY','ORGANIZATION') }}
),

bitly_users as (
    select * from {{ source('BITLY','USERS') }}
),

bitly_tags as (
    select * from {{ ref('stg_bitly_tags') }}
),

tags as (
    select
        bitlink_id,
        group_guid,
        listagg(distinct tags, ', ') within group (order by tags) as link_tags
    from bitly_tags
    group by bitlink_id, group_guid
)

select
    links.id,
    links.link,
    links.long_url,
    links.title,
    bitly_orgs.name as organization_name,
    bitly_groups.name as group_name,
    to_date(links.created_at, 'YYYY-MM-DD"T"HH24:MI:SSTZHTZM') as created_date,
    coalesce(bitly_users.name, 'Unknown User') as created_by,
    tags.link_tags
from links
inner join bitly_groups on links.group_guid = bitly_groups.guid
inner join bitly_orgs on bitly_groups.organization_guid = bitly_orgs.guid
left join bitly_users on links.created_by = bitly_users.login  -- not all created_by values are in the USERS table
left join tags on links.id = tags.bitlink_id and links.group_guid = tags.group_guid
where links._fivetran_deleted = FALSE
