with
org_odi as (
    select * from RAW_ENGCA_PRD.BITLY.ORGANIZATION
),

org_ci as (
    select * from RAW_ENGCA_PRD.BITLY_CALINNOVATE.ORGANIZATION
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