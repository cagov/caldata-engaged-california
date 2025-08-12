with
links as (
    select * from {{ source('BITLY','BITLINK') }}
),

groups as (
    select * from {{ source('BITLY','GROUPS') }}
),

orgs as (
    select * from {{ source('BITLY','ORGANIZATION') }}
),

users as (
    select * from {{ source('BITLY','USERS') }}
)

select
    links.id,
    links.link,
    links.long_url,
    links.title,
    orgs.name as organization_name,
    groups.name as group_name,
    links.created_at,
    COALESCE(users.name, 'Unknown User') as created_by
from links
inner join groups on links.group_guid = groups.guid
inner join orgs on groups.organization_guid = orgs.guid
left join users on links.created_by = users.login  -- not all created_by values are in the USERS table
where links._fivetran_deleted = FALSE
