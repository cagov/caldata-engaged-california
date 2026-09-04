with groups_odi as (
    select * from RAW_ENGCA_PRD.BITLY.GROUPS
),

groups_ci as (
    select * from RAW_ENGCA_PRD.BITLY_CALINNOVATE.GROUPS
),

groups_union as (
    select * from groups_odi
    union distinct
    select * from groups_ci
)

select distinct
    guid as group_guid,
    name as group_name,
    organization_guid
from groups_union
where _fivetran_deleted = FALSE