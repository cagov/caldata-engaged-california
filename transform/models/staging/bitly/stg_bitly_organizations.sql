with
org_odi as (
    select * from {{ source('BITLY', 'ORGANIZATION') }}
),

org_ci as (
    select * from {{ source('BITLY_CALINNOVATE', 'ORGANIZATION') }}
),

org_union as (
    select * from org_odi
    union distinct
    select * from org_ci
)

select distinct
    guid as organization_guid,
    name as organization_name
from org_union
where _fivetran_deleted = FALSE
