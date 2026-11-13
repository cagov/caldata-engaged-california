with
links as (
    select * from TRANSFORM_ENGCA_PRD.bitly.stg_bitly_links
)

select min(_fivetran_synced) as last_update
from links