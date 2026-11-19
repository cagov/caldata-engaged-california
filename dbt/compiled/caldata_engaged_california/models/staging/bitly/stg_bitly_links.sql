with
grps as (
    select * from TRANSFORM_ENGCA_PRD.bitly.stg_bitly_groups
),

orgs as (
    select * from TRANSFORM_ENGCA_PRD.bitly.stg_bitly_organizations
),

usrs as (
    select * from TRANSFORM_ENGCA_PRD.bitly.stg_bitly_users
),

links_odi as (
    select * from RAW_ENGCA_PRD.BITLY.BITLINK
),

links_ci as (
    select * from RAW_ENGCA_PRD.BITLY_CALINNOVATE.BITLINK
),

links as (
    select * from links_odi
    union distinct
    select * from links_ci
)

select
    links.id,
    links.link,
    links.long_url,
    links.title,
    links.custom_bitlinks,
    links._fivetran_synced,
    orgs.organization_name,
    grps.group_name,
    to_date(links.created_at, 'YYYY-MM-DD"T"HH24:MI:SSTZHTZM') as created_date,
    coalesce(usrs.name, 'Unknown User') as created_by
from links
inner join grps on links.group_guid = grps.group_guid
inner join orgs on grps.organization_guid = orgs.organization_guid
left join usrs on links.created_by = usrs.login  -- not all created_by values are in the USERS table
where links._fivetran_deleted = FALSE