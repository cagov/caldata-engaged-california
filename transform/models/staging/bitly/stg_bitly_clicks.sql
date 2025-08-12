with
clicks as (
    select * from {{ source('BITLY','LINK_CLICK') }}
)

select
    bitlink_id,
    cast(date as date) as click_date,  -- fivetran aggregates to date
    clicks
from clicks
where _fivetran_deleted = FALSE
