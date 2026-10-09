with
tags as (
    select * from RAW_ENGCA_PRD.BITLY.BITLINK_TAG
)

select
    bitlink_id,
    group_guid,
    tags
from tags
where _fivetran_deleted = FALSE