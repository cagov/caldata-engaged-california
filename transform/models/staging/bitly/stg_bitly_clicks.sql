with
clicks_odi as (
    select * from {{ source('BITLY','LINK_CLICK') }}
),

clicks_ci as (
    select * from {{ source('BITLY_CALINNOVATE','LINK_CLICK') }}
),

clicks_union as (
    select * from clicks_odi
    union distinct
    select * from clicks_ci
)

select
    bitlink_id,
    cast(date as date) as click_date,  -- fivetran aggregates to date
    clicks
from clicks_union
where _fivetran_deleted = FALSE
