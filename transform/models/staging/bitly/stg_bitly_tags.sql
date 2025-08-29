with
tags --tags_odi
as (
    select * from {{ source('BITLY','BITLINK_TAG') }}
)

/* CalInnovate Bitly Account is not currently using tags */
--, tags_ci as (
--     select * from {{ source('BITLY_CALINNOVATE','BITLINK_TAG') }}
-- ),

-- tags as (
--     select * from tags_odi
--     union distinct
--     select * from tags_ci
-- )

select
    bitlink_id,
    group_guid,
    tags
from tags
where _fivetran_deleted = FALSE
