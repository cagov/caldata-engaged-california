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
)

select
    links.id,
    links.link,
    links.long_url,
    links.title,
    bitly_orgs.name as organization_name,
    bitly_groups.name as group_name,
    TO_DATE(links.created_at, 'YYYY-MM-DD"T"HH24:MI:SSTZHTZM') as created_date,
    COALESCE(bitly_users.name, 'Unknown User') as created_by
from links
inner join bitly_groups on links.group_guid = bitly_groups.guid
inner join bitly_orgs on bitly_groups.organization_guid = bitly_orgs.guid
left join bitly_users on links.created_by = bitly_users.login  -- not all created_by values are in the USERS table
where links._fivetran_deleted = FALSE
